import {
  withTransaction,
  createDocument as dbCreateDocument,
  createEdge,
  deleteCommentsByTarget,
  deleteRevisionsByTarget,
  deleteDocument as dbDeleteDocument,
  detachDocumentChildren,
  clearOverviewDocumentRefs,
  getArtifact,
  getDocument as dbGetDocument,
  getDocumentByTask as dbGetDocumentByTask,
  getFolderByProjectAndId,
  getPrototype,
  getTask,
  isSqliteBusy,
  retryOnSqliteBusy,
  TransactionRollback,
  listDocuments as dbListDocuments,
  listEdges as dbListEdges,
  listEdgesByEndpoint,
  listFolders as dbListFolders,
  listTasks,
  updateDocument as dbUpdateDocument,
  type Db,
  type DbClient,
  type Document,
  type Edge,
  type LinkEntityType,
} from '@plandesk/db';
import { ensureWikiLinkEdges, prepareDocumentBody } from '../document-wiki-links.js';
import type { WikiLinkResolved } from '../markdown.js';
import {
  buildFolderTree,
  serializeDocument,
  serializeTask,
  type PaginationParams,
  type SerializedDocument,
  type SerializedDocumentFolderTree,
  type SerializedDocumentTree,
  type SerializedEntityLink,
} from '../serialize.js';
import { serializeActor } from '../write-actor.js';
import {
  assertPermission,
  resolveOrgId,
  resolveWriteActor,
  type OrgScopedDeps,
} from './org-scope.js';
import {
  captureRevision,
  changedVersionedFields,
  DOCUMENT_VERSIONED_FIELDS,
  versionedFieldSnapshot,
} from './revision-capture.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';
import type { TaskService } from './tasks.js';

type SerializedTask = ReturnType<typeof serializeTask>;

export type DocumentServiceDeps = OrgScopedDeps & {
  db: Db;
  /** Positive keep-count, or null/omit for unlimited. */
  maxRevisions?: number | null;
  /**
   * Existing task write path — convertBullets must not invent a second one.
   * Optional only so document-only unit tests that never call convertBullets
   * can omit it; the production wiring always supplies it.
   */
  taskService?: TaskService;
};

export type ConvertBulletsResult = {
  created: SerializedTask[];
  skipped: string[];
};

/** Vertical gap between cards placed from a convert pass (matches board skill). */
const CONVERT_Y_SPACING = 200;

export type CreateDocumentInput = {
  title: string;
  body?: string | null;
  statusLine?: string | null;
  parentId?: string | null;
  folderId?: string | null;
};

export type UpdateDocumentInput = {
  title?: string;
  body?: string | null;
  statusLine?: string | null;
  parentId?: string | null;
  folderId?: string | null;
};

export class InvalidDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDocumentError';
  }
}

/**
 * Folder tree node with a live document count. `doc_count` is the number of
 * documents whose `folder_id` equals this folder (direct only — not recursive),
 * and comes from `serialize.buildFolderTree`.
 *
 * Folders carry metadata and counts only. Every document in the project lives in
 * the flat `documents` collection below, so there is exactly one place to
 * enumerate them and `folder_id` is safe to filter on.
 */
export type FolderTreeNode = Omit<SerializedDocumentFolderTree['folders'][number], 'folders'> & {
  doc_count: number;
  folders: FolderTreeNode[];
};

export type DocumentFolderTree = {
  folders: FolderTreeNode[];
  documents: SerializedDocument[];
};

async function assertParentInProject(db: Db, projectId: string, parentId: string): Promise<void> {
  const parent = await dbGetDocument(db, parentId);
  if (!parent || parent.projectId !== projectId) {
    throw new InvalidDocumentError('Parent document does not belong to project');
  }
}

async function assertFolderInProject(db: Db, projectId: string, folderId: string): Promise<void> {
  if (!(await getFolderByProjectAndId(db, projectId, folderId))) {
    throw new InvalidDocumentError('Folder does not belong to project');
  }
}

/**
 * Resolve the display title for one endpoint. Returns undefined when the
 * entity is missing or outside projectId — callers must drop the entry so a
 * stray edge never leaks a foreign title.
 */
async function resolveEndpointTitle(
  db: DbClient,
  projectId: string,
  type: LinkEntityType,
  id: string,
): Promise<string | undefined> {
  switch (type) {
    case 'task': {
      const task = await getTask(db, id);
      if (!task || task.projectId !== projectId) {
        return undefined;
      }
      return task.label;
    }
    case 'document': {
      const document = await dbGetDocument(db, id);
      if (!document || document.projectId !== projectId) {
        return undefined;
      }
      return document.title;
    }
    case 'artifact': {
      const artifact = await getArtifact(db, id);
      if (!artifact || artifact.projectId !== projectId) {
        return undefined;
      }
      return artifact.title;
    }
    case 'prototype': {
      const prototype = await getPrototype(db, id);
      if (!prototype || prototype.projectId !== projectId) {
        return undefined;
      }
      return prototype.name;
    }
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

function edgeFromType(edge: Edge): LinkEntityType {
  return edge.fromType;
}

function edgeToType(edge: Edge): LinkEntityType {
  return edge.toType;
}

function edgeFromId(edge: Edge): string {
  return edge.fromId;
}

function edgeToId(edge: Edge): string {
  return edge.toId;
}

/**
 * Build links (outgoing) and backlinks (incoming) for one document from a
 * preloaded edge list. Only endpoints that resolve inside projectId are kept.
 */
async function linksForDocument(
  db: DbClient,
  projectId: string,
  documentId: string,
  edges: Edge[],
): Promise<{ links: SerializedEntityLink[]; backlinks: SerializedEntityLink[] }> {
  const links: SerializedEntityLink[] = [];
  const backlinks: SerializedEntityLink[] = [];

  for (const edge of edges) {
    const fromType = edgeFromType(edge);
    const toType = edgeToType(edge);
    const fromId = edgeFromId(edge);
    const toId = edgeToId(edge);

    if (fromType === 'document' && fromId === documentId) {
      const title = await resolveEndpointTitle(db, projectId, toType, toId);
      if (title !== undefined) {
        links.push({ type: toType, id: toId, title, label: edge.label, edge_id: edge.id });
      }
      continue;
    }

    if (toType === 'document' && toId === documentId) {
      const title = await resolveEndpointTitle(db, projectId, fromType, fromId);
      if (title !== undefined) {
        backlinks.push({ type: fromType, id: fromId, title, label: edge.label, edge_id: edge.id });
      }
    }
  }

  return { links, backlinks };
}

async function serializeDocumentWithLinks(
  db: DbClient,
  document: Document,
): Promise<SerializedDocument> {
  const edges = await listEdgesByEndpoint(db, document.projectId, 'document', document.id);
  const { links, backlinks } = await linksForDocument(db, document.projectId, document.id, edges);
  return serializeDocument(document, { links, backlinks });
}

/**
 * Incoming neighbours of any typed endpoint (document or task), scoped to the
 * endpoint's project. The other end must still resolve in that project or it
 * is dropped — edge presence alone is not enough to read a title.
 */
async function collectIncomingLinks(
  db: DbClient,
  projectId: string,
  type: LinkEntityType,
  id: string,
): Promise<SerializedEntityLink[]> {
  const edges = await listEdgesByEndpoint(db, projectId, type, id);
  const backlinks: SerializedEntityLink[] = [];

  for (const edge of edges) {
    const toType = edgeToType(edge);
    const toId = edgeToId(edge);
    if (toType !== type || toId !== id) {
      continue;
    }
    const fromType = edgeFromType(edge);
    const fromId = edgeFromId(edge);
    const title = await resolveEndpointTitle(db, projectId, fromType, fromId);
    if (title === undefined) {
      continue;
    }
    backlinks.push({ type: fromType, id: fromId, title, label: edge.label, edge_id: edge.id });
  }

  return backlinks;
}

export function createDocumentService(deps: DocumentServiceDeps) {
  const { db } = deps;

  const api = {
    async listTree(
      projectId: string,
      pagination: PaginationParams = {},
    ): Promise<SerializedDocumentTree[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      const documents = await dbListDocuments(db, projectId, pagination);
      const edges = await dbListEdges(db, projectId);
      const hydrated: Document[] = documents;
      // buildDocumentTree calls serializeDocument without links; rebuild with hydration.
      const nodes = new Map<string, SerializedDocumentTree>();
      for (const document of hydrated) {
        const { links, backlinks } = await linksForDocument(db, projectId, document.id, edges);
        nodes.set(document.id, {
          ...serializeDocument(document, { links, backlinks }),
          children: [],
        });
      }
      const roots: SerializedDocumentTree[] = [];
      for (const document of hydrated) {
        const node = nodes.get(document.id);
        if (!node) {
          continue;
        }
        if (document.parentId === null) {
          roots.push(node);
          continue;
        }
        const parent = nodes.get(document.parentId);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
      return roots;
    },

    async listFolderTree(projectId: string): Promise<DocumentFolderTree | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      // Build the folder metadata and flat document collection, then hydrate links.
      // buildFolderTree serializes documents without options, so re-hydrate after
      // the structural build to give every document its links and backlinks.
      // `doc_count` comes from buildFolderTree — direct documents only; documents
      // in a sub-folder are counted on that sub-folder's own node.
      const folders = await dbListFolders(db, projectId);
      const documents = await dbListDocuments(db, projectId);
      const tree = buildFolderTree(folders, documents);
      const edges = await dbListEdges(db, projectId);

      async function hydrateDocuments(): Promise<SerializedDocument[]> {
        const out: SerializedDocument[] = [];
        for (const document of documents) {
          const { links, backlinks } = await linksForDocument(db, projectId, document.id, edges);
          out.push(serializeDocument(document, { links, backlinks }));
        }
        return out;
      }

      async function hydrateFolders(
        folderNodes: SerializedDocumentFolderTree['folders'],
      ): Promise<FolderTreeNode[]> {
        const out: FolderTreeNode[] = [];
        for (const folder of folderNodes) {
          // The spread carries doc_count from buildFolderTree; recomputing it here
          // would be a second definition of the same rule, free to disagree.
          out.push({
            ...folder,
            folders: await hydrateFolders(folder.folders),
          });
        }
        return out;
      }

      return {
        folders: await hydrateFolders(tree.folders),
        documents: await hydrateDocuments(),
      };
    },

    async listByFolder(
      projectId: string,
      folderId: string,
    ): Promise<SerializedDocument[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      if (!(await getFolderByProjectAndId(db, projectId, folderId))) {
        return undefined;
      }
      // Folder filtering returns the same flat document shape as project listing.
      const documents = await dbListDocuments(db, projectId, { folderId });
      const edges = await dbListEdges(db, projectId);
      const hydrated: SerializedDocument[] = [];
      for (const document of documents) {
        const { links, backlinks } = await linksForDocument(db, projectId, document.id, edges);
        hydrated.push(serializeDocument(document, { links, backlinks }));
      }
      return hydrated;
    },

    async create(
      projectId: string,
      input: CreateDocumentInput,
    ): Promise<SerializedDocument | undefined> {
      assertPermission(deps, 'document', 'create');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      if (input.parentId !== undefined && input.parentId !== null) {
        await assertParentInProject(db, projectId, input.parentId);
      }

      if (input.folderId !== undefined && input.folderId !== null) {
        await assertFolderInProject(db, projectId, input.folderId);
      }

      const projectDocuments = await dbListDocuments(db, projectId);
      const prepared = prepareDocumentBody(input.body, projectId, projectDocuments);

      const document = await withTransaction<Document | undefined>(db, async (tx) => {
        const row = await dbCreateDocument(tx, {
          projectId,
          title: input.title,
          body: prepared.body,
          statusLine: input.statusLine,
          parentId: input.parentId,
          folderId: input.folderId,
        });
        await ensureWikiLinkEdges(tx, projectId, row.id, prepared.resolved);
        return row;
      });
      if (!document) {
        return undefined;
      }

      return serializeDocumentWithLinks(db, document);
    },

    async get(id: string): Promise<SerializedDocument | undefined> {
      const document = await dbGetDocument(db, id);
      if (!document) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, document.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return serializeDocumentWithLinks(db, document);
    },

    async update(id: string, input: UpdateDocumentInput): Promise<SerializedDocument | undefined> {
      assertPermission(deps, 'document', 'update');
      const existing = await dbGetDocument(db, id);
      if (!existing) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      if (input.parentId !== undefined && input.parentId !== null) {
        if (input.parentId === id) {
          throw new InvalidDocumentError('Document cannot be its own parent');
        }
        await assertParentInProject(db, existing.projectId, input.parentId);
      }

      if (input.folderId !== undefined && input.folderId !== null) {
        await assertFolderInProject(db, existing.projectId, input.folderId);
      }

      const document = await withTransaction<Document | undefined>(db, async (tx) => {
        const prior = await dbGetDocument(tx, id);
        if (!prior) {
          throw new TransactionRollback(undefined);
        }
        const projectDocuments = await dbListDocuments(tx, prior.projectId);
        const prepared =
          input.body !== undefined
            ? prepareDocumentBody(input.body, prior.projectId, projectDocuments, id)
            : { body: input.body, resolved: [] as WikiLinkResolved[] };
        const versionedInput = input.body !== undefined ? { ...input, body: prepared.body } : input;
        const versionedChanges = changedVersionedFields(
          prior,
          versionedInput,
          DOCUMENT_VERSIONED_FIELDS,
        );
        let row: Document | undefined;
        try {
          row = await retryOnSqliteBusy(() =>
            dbUpdateDocument(tx, id, versionedInput, { expectedUpdatedAt: prior.updatedAt }),
          );
        } catch (error) {
          if (isSqliteBusy(error)) {
            throw new TransactionRollback(undefined);
          }
          throw error;
        }
        if (!row) {
          throw new TransactionRollback(undefined);
        }
        if (prepared.resolved.length > 0) {
          await ensureWikiLinkEdges(tx, prior.projectId, id, prepared.resolved);
        }
        if (versionedChanges.length > 0) {
          const author = serializeActor(resolveWriteActor(deps));
          await captureRevision(
            tx,
            {
              projectId: prior.projectId,
              targetType: 'document',
              targetId: id,
              snapshot: JSON.stringify(versionedFieldSnapshot(prior, DOCUMENT_VERSIONED_FIELDS)),
              changedFields: JSON.stringify(versionedChanges),
              author,
            },
            deps.maxRevisions ?? null,
          );
        }
        return row;
      });
      if (!document) {
        return undefined;
      }

      return serializeDocumentWithLinks(db, document);
    },

    /**
     * Move many documents into `folderId` (or Unfiled when null).
     * Per-item results — not atomic: each id is attempted independently so a
     * single missing/foreign/invalid id does not roll back the rest.
     * Cross-tenant ids surface as "not found" for that item (fail closed).
     */
    async moveMany(
      documentIds: string[],
      folderId: string | null,
    ): Promise<{
      moved: string[];
      failed: Array<{ document_id: string; error: string }>;
    }> {
      assertPermission(deps, 'document', 'update');
      const moved: string[] = [];
      const failed: Array<{ document_id: string; error: string }> = [];
      const seen = new Set<string>();

      for (const documentId of documentIds) {
        if (seen.has(documentId)) {
          continue;
        }
        seen.add(documentId);
        try {
          const result = await api.update(documentId, { folderId });
          if (result === undefined) {
            failed.push({ document_id: documentId, error: 'Document not found' });
          } else {
            moved.push(documentId);
          }
        } catch (error) {
          if (error instanceof InvalidDocumentError) {
            failed.push({ document_id: documentId, error: error.message });
          } else {
            throw error;
          }
        }
      }

      return { moved, failed };
    },

    async getByTask(taskId: string): Promise<SerializedDocument | undefined> {
      const task = await getTask(db, taskId);
      if (!task) {
        return undefined;
      }

      const document = await dbGetDocumentByTask(db, task.projectId, taskId);
      if (!document) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, document.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      return serializeDocumentWithLinks(db, document);
    },

    /**
     * Every entity that points at this document or task (to-side lookup).
     * Tenant-scoped via the target's project; foreign workspace → undefined.
     */
    async listBacklinks(
      type: LinkEntityType,
      id: string,
    ): Promise<SerializedEntityLink[] | undefined> {
      if (type === 'document') {
        const document = await dbGetDocument(db, id);
        if (!document) {
          return undefined;
        }
        try {
          await assertProjectInOrg(db, document.projectId, resolveOrgId(deps));
        } catch (error) {
          if (error instanceof ProjectNotInOrgError) {
            return undefined;
          }
          throw error;
        }
        return collectIncomingLinks(db, document.projectId, 'document', id);
      }

      const task = await getTask(db, id);
      if (!task) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, task.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return collectIncomingLinks(db, task.projectId, 'task', id);
    },

    async delete(id: string) {
      assertPermission(deps, 'document', 'delete');
      const existing = await dbGetDocument(db, id);
      if (!existing) {
        return false;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return false;
        }
        throw error;
      }

      await withTransaction(db, async (tx) => {
        await detachDocumentChildren(tx, id);
        await clearOverviewDocumentRefs(tx, id);
        await deleteCommentsByTarget(tx, 'document', id);
        await deleteRevisionsByTarget(tx, 'document', id);
        await dbDeleteDocument(tx, id);
      });

      return true;
    },

    /**
     * Create one `scope` task per label from a document bullet selection.
     * Does not mutate the document body. Skips a label when a task with that
     * exact label is already linked from this document (documents → task).
     * Placement starts below the project's lowest card so new cards never overlap.
     */
    async convertBullets(id: string, labels: string[]): Promise<ConvertBulletsResult | undefined> {
      // Writing the document is the gate: converting is an edit affordance on
      // the source doc, even though the body itself is left unchanged.
      assertPermission(deps, 'document', 'update');
      assertPermission(deps, 'edge', 'create');

      const taskService = deps.taskService;
      if (taskService === undefined) {
        throw new Error('documentService.convertBullets requires taskService');
      }

      const existing = await dbGetDocument(db, id);
      if (!existing) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      const projectId = existing.projectId;
      const bodyBefore = existing.body;
      const edges = await listEdgesByEndpoint(db, projectId, 'document', id);
      const linkedTaskIds = new Set<string>();
      for (const edge of edges) {
        if (edge.fromType === 'document' && edge.fromId === id && edge.toType === 'task') {
          linkedTaskIds.add(edge.toId);
        }
      }

      const projectTasks = await listTasks(db, projectId);
      const linkedLabels = new Set<string>();
      for (const task of projectTasks) {
        if (linkedTaskIds.has(task.id)) {
          linkedLabels.add(task.label);
        }
      }

      let maxY = 0;
      for (const task of projectTasks) {
        if (task.y > maxY) {
          maxY = task.y;
        }
      }
      let nextY = projectTasks.length === 0 ? 0 : maxY + CONVERT_Y_SPACING;

      const created: SerializedTask[] = [];
      const skipped: string[] = [];

      for (const raw of labels) {
        const label = raw.trim();
        if (label === '') {
          continue;
        }
        if (linkedLabels.has(label)) {
          skipped.push(label);
          continue;
        }

        const task = await taskService.create(projectId, {
          label,
          status: 'scope',
          x: 0,
          y: nextY,
        });
        if (task === undefined) {
          return undefined;
        }

        await createEdge(db, {
          projectId,
          fromType: 'document',
          fromId: id,
          toType: 'task',
          toId: task.id,
          label: 'documents',
        });

        linkedLabels.add(label);
        created.push(task);
        nextY += CONVERT_Y_SPACING;
      }

      // Body must stay byte-identical — convert never writes the document.
      const after = await dbGetDocument(db, id);
      if (after === undefined || after.body !== bodyBefore) {
        throw new Error('convertBullets mutated document body');
      }

      return { created, skipped };
    },
  };

  return api;
}

export type DocumentService = ReturnType<typeof createDocumentService>;

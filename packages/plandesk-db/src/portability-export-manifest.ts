import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { DbClient } from './client.js';
import type { AgentRun } from './repositories/agent-runs.js';
import type { Artifact } from './repositories/artifacts.js';
import type { Comment } from './repositories/comments.js';
import type { Document } from './repositories/documents.js';
import type { Edge } from './repositories/edges.js';
import type { Folder } from './repositories/folders.js';
import type { Goal } from './repositories/goals.js';
import type { Note } from './repositories/notes.js';
import type { Project } from './repositories/projects.js';
import type { Tag } from './repositories/tags.js';
import type { Task } from './repositories/tasks.js';
import { parseCommitRefs } from './commit-refs.js';
import {
  emitAgentRunEventsImport,
  emitAgentRunsImport,
  emitArtifactsImport,
  emitCommentsImport,
  emitDocumentsImport,
  emitEdgesImport,
  emitFilesImport,
  emitFoldersImport,
  emitGoalsImport,
  emitNotesImport,
  emitProjectImport,
  emitTagsImport,
  emitTaskTagsImport,
  emitTasksImport,
  preallocateAgentRunIds,
  preallocateArtifactIds,
  preallocateDocumentIds,
  preallocateEdgeIds,
  preallocateFolderIds,
  preallocateGoalIds,
  preallocateTagIds,
  preallocateTaskIds,
  type ImportManifestHandler,
} from './portability-import.js';
import { listArtifactsByProject } from './repositories/artifacts.js';
import { listFilesByProject } from './repositories/files.js';
import { listFolders } from './repositories/folders.js';
import { listGoals } from './repositories/goals.js';
import { getProject } from './repositories/projects.js';
import { listTags, listTagsByTaskForProject } from './repositories/tags.js';
import { listCommentsByProject } from './repositories/comments.js';
import { listAgentRunEvents } from './repositories/agent-run-events.js';
import { listAgentRuns } from './repositories/agent-runs.js';
import { listDocuments } from './repositories/documents.js';
import { listEdges } from './repositories/edges.js';
import { listNotes } from './repositories/notes.js';
import { listTasks } from './repositories/tasks.js';
import {
  agentRunEvents,
  agentRuns,
  artifacts,
  comments,
  documents,
  edges,
  files,
  folders,
  goals,
  notes,
  projects,
  tags,
  taskTags,
  tasks,
} from './schema.js';
import type {
  PlandeskExport,
  PlandeskExportAgentRun,
  PlandeskExportAgentRunEvent,
  PlandeskExportArtifact,
  PlandeskExportComment,
  PlandeskExportDocument,
  PlandeskExportEdge,
  PlandeskExportFile,
  PlandeskExportFolder,
  PlandeskExportGoal,
  PlandeskExportInput,
  PlandeskExportNote,
  PlandeskExportProject,
  PlandeskExportTag,
  PlandeskExportTask,
} from './portability.js';

export type PlandeskExportCollectionKey = keyof Omit<PlandeskExport, 'version'>;

export type ExportAux = {
  task_tags: Awaited<ReturnType<typeof listTagsByTaskForProject>>;
  agent_run_events: Map<string, Awaited<ReturnType<typeof listAgentRunEvents>>>;
};

export type PortabilityCoverageSpec = {
  drizzleTable: SQLiteTable;
  roundTrippedColumns: readonly string[];
  columnExclusions: Record<string, string>;
};

type ManifestImport = ImportManifestHandler;

type SingletonManifestEntry = {
  scope: 'singleton';
  collection: 'project';
  read: typeof getProject;
  serialize: (row: NonNullable<Awaited<ReturnType<typeof getProject>>>) => PlandeskExportProject;
  initAux?: never;
  import: ManifestImport;
  portability: PortabilityCoverageSpec;
};

type RowsManifestEntry<Row, Serialized> = {
  scope: 'rows';
  collection: Exclude<PlandeskExportCollectionKey, 'project'>;
  read: (db: DbClient, projectId: string) => Promise<Row[]>;
  serialize: (row: Row, aux: ExportAux) => Serialized;
  initAux?: never;
  import: ManifestImport;
  portability: PortabilityCoverageSpec;
};

type AssociationManifestEntry<AuxValue> = {
  scope: 'association';
  collection: PlandeskExportCollectionKey;
  auxKey: keyof ExportAux;
  initAux: () => AuxValue;
  read: (db: DbClient, projectId: string) => Promise<AuxValue>;
  import: ManifestImport;
  portability: PortabilityCoverageSpec;
};

type NestedPerParentManifestEntry<ParentRow, AuxValue> = {
  scope: 'nested_per_parent';
  collection: PlandeskExportCollectionKey;
  parentTable: 'agent_runs';
  auxKey: keyof ExportAux;
  initAux: () => AuxValue;
  read: typeof listAgentRunEvents;
  parentIdFrom: (parent: ParentRow) => string;
  import: ManifestImport;
  portability: PortabilityCoverageSpec;
};

type ExportTableManifestEntryShape =
  | SingletonManifestEntry
  | RowsManifestEntry<Goal, PlandeskExportGoal>
  | RowsManifestEntry<Task, PlandeskExportTask>
  | RowsManifestEntry<Tag, PlandeskExportTag>
  | RowsManifestEntry<Edge, PlandeskExportEdge>
  | RowsManifestEntry<Folder, PlandeskExportFolder>
  | RowsManifestEntry<Document, PlandeskExportDocument>
  | RowsManifestEntry<Note, PlandeskExportNote>
  | RowsManifestEntry<Comment, PlandeskExportComment>
  | RowsManifestEntry<AgentRun, PlandeskExportAgentRun>
  | RowsManifestEntry<Awaited<ReturnType<typeof listFilesByProject>>[number], PlandeskExportFile>
  | RowsManifestEntry<Artifact, PlandeskExportArtifact>
  | AssociationManifestEntry<Awaited<ReturnType<typeof listTagsByTaskForProject>>>
  | NestedPerParentManifestEntry<AgentRun, Map<string, Awaited<ReturnType<typeof listAgentRunEvents>>>>;

/**
 * Single registration point for portable export reads, serializers, and import
 * handlers. {@link exportProject} and {@link importProject} both derive from
 * this manifest — there is no hand-written list path left to extend.
 */
export const PLANDESK_EXPORT_TABLE_MANIFEST = {
  projects: {
    scope: 'singleton',
    collection: 'project',
    read: getProject,
    serialize: (project: Project): PlandeskExportProject => ({
      name: project.name,
      description: project.description,
      repo_url: project.repoUrl,
      folder_path: project.folderPath,
      canvas_layout: project.canvasLayout,
    }),
    import: { order: 10, emit: emitProjectImport },
    portability: {
      drizzleTable: projects,
      roundTrippedColumns: ['name', 'description', 'repo_url', 'folder_path', 'canvas_layout'],
      columnExclusions: {
        id: 'Remapped on import; export creates a new project',
        org_id: 'Scoped by import options, not the export file',
        workspace_id: 'Scoped by import options, not the export file',
        created_at: 'Server-assigned on import',
        updated_at: 'Server-assigned on import',
      },
    },
  },
  goals: {
    scope: 'rows',
    collection: 'goals',
    read: listGoals,
    serialize: (goal: Goal): PlandeskExportGoal => ({
      id: goal.id,
      objective: goal.objective,
      status: goal.status,
      verification_surface: goal.verificationSurface,
      constraints: goal.constraints,
      boundaries: goal.boundaries,
      iteration_policy: goal.iterationPolicy,
      stop_condition: goal.stopCondition,
      budget: goal.budget,
      last_verification: goal.lastVerification,
      created_at: goal.createdAt.toISOString(),
      updated_at: goal.updatedAt.toISOString(),
    }),
    import: { order: 20, preallocateIds: preallocateGoalIds, emit: emitGoalsImport },
    portability: {
      drizzleTable: goals,
      roundTrippedColumns: [
        'objective',
        'status',
        'verification_surface',
        'constraints',
        'boundaries',
        'iteration_policy',
        'stop_condition',
        'budget',
        'last_verification',
      ],
      columnExclusions: {
        id: 'Remapped on import',
        project_id: 'Implied by nesting under the imported project',
        created_at: 'Server-assigned on import (export writes them; import stamps now)',
        updated_at: 'Server-assigned on import (export writes them; import stamps now)',
      },
    },
  },
  tasks: {
    scope: 'rows',
    collection: 'tasks',
    read: listTasks,
    serialize: (task: Task, aux: ExportAux): PlandeskExportTask => {
      const tagsByTask = aux.task_tags;
      return {
        id: task.id,
        label: task.label,
        status: task.status,
        kind: task.kind,
        description: task.description,
        x: task.x,
        y: task.y,
        assignee: task.assignee,
        due_date: task.dueDate?.toISOString() ?? null,
        goal_id: task.goalId,
        tag_ids: (tagsByTask.get(task.id) ?? []).map((tag) => tag.id),
        commit_refs: parseCommitRefs(task.commitRefs),
        created_at: task.createdAt.toISOString(),
        updated_at: task.updatedAt.toISOString(),
      };
    },
    import: { order: 30, preallocateIds: preallocateTaskIds, emit: emitTasksImport },
    portability: {
      drizzleTable: tasks,
      roundTrippedColumns: [
        'goal_id',
        'label',
        'status',
        'kind',
        'description',
        'x',
        'y',
        'assignee',
        'due_date',
        'commit_refs',
      ],
      columnExclusions: {
        id: 'Remapped on import',
        project_id: 'Implied by nesting under the imported project',
        created_at: 'Server-assigned on import (export writes them; import stamps now)',
        updated_at: 'Server-assigned on import (export writes them; import stamps now)',
      },
    },
  },
  tags: {
    scope: 'rows',
    collection: 'tags',
    read: listTags,
    serialize: (tag: Tag): PlandeskExportTag => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
    }),
    import: { order: 40, preallocateIds: preallocateTagIds, emit: emitTagsImport },
    portability: {
      drizzleTable: tags,
      roundTrippedColumns: ['name', 'color'],
      columnExclusions: {
        id: 'Remapped on import',
        project_id: 'Implied by nesting under the imported project',
        created_at: 'Server-assigned on import',
      },
    },
  },
  task_tags: {
    scope: 'association',
    collection: 'tasks',
    auxKey: 'task_tags',
    initAux: () => new Map<string, Tag[]>(),
    read: listTagsByTaskForProject,
    import: { order: 50, emit: emitTaskTagsImport },
    portability: {
      drizzleTable: taskTags,
      roundTrippedColumns: [],
      columnExclusions: {
        task_id:
          'Association serialised as task.tag_ids — no direct export type; membership asserted via tag round-trip',
        tag_id:
          'Association serialised as task.tag_ids — no direct export type; membership asserted via tag round-trip',
      },
    },
  },
  edges: {
    scope: 'rows',
    collection: 'edges',
    read: listEdges,
    serialize: (edge: Edge): PlandeskExportEdge => ({
      id: edge.id,
      from_type: edge.fromType,
      from_id: edge.fromId,
      to_type: edge.toType,
      to_id: edge.toId,
      label: edge.label,
      arrow_direction: edge.arrowDirection,
      style: edge.style,
    }),
    import: { order: 60, preallocateIds: preallocateEdgeIds, emit: emitEdgesImport },
    portability: {
      drizzleTable: edges,
      roundTrippedColumns: ['from_type', 'from_id', 'to_type', 'to_id', 'label', 'arrow_direction', 'style'],
      columnExclusions: {
        id: 'Remapped on import',
        project_id: 'Implied by nesting under the imported project',
        created_at: 'Server-assigned on import',
      },
    },
  },
  folders: {
    scope: 'rows',
    collection: 'folders',
    read: listFolders,
    serialize: (folder: Folder): PlandeskExportFolder => ({
      id: folder.id,
      name: folder.name,
      parent_folder_id: folder.parentFolderId,
    }),
    import: { order: 70, preallocateIds: preallocateFolderIds, emit: emitFoldersImport },
    portability: {
      drizzleTable: folders,
      roundTrippedColumns: ['name', 'parent_folder_id'],
      columnExclusions: {
        id: 'Remapped on import',
        project_id: 'Implied by nesting under the imported project',
        created_at: 'Server-assigned on import',
        updated_at: 'Server-assigned on import',
      },
    },
  },
  documents: {
    scope: 'rows',
    collection: 'documents',
    read: listDocuments,
    serialize: (document: Document): PlandeskExportDocument => ({
      id: document.id,
      title: document.title,
      body: document.body,
      status_line: document.statusLine,
      parent_id: document.parentId,
      folder_id: document.folderId,
    }),
    import: { order: 80, preallocateIds: preallocateDocumentIds, emit: emitDocumentsImport },
    portability: {
      drizzleTable: documents,
      roundTrippedColumns: ['title', 'body', 'status_line', 'parent_id', 'folder_id'],
      columnExclusions: {
        id: 'Remapped on import',
        project_id: 'Implied by nesting under the imported project',
        created_at: 'Server-assigned on import',
        updated_at: 'Server-assigned on import',
      },
    },
  },
  notes: {
    scope: 'rows',
    collection: 'notes',
    read: listNotes,
    serialize: (note: Note): PlandeskExportNote => ({
      id: note.id,
      title: note.title,
      body: note.body,
    }),
    import: { order: 90, emit: emitNotesImport },
    portability: {
      drizzleTable: notes,
      roundTrippedColumns: ['title', 'body'],
      columnExclusions: {
        id: 'Remapped on import (content-only identity)',
        project_id: 'Implied by nesting under the imported project',
        created_at: 'Server-assigned on import',
        updated_at: 'Server-assigned on import',
      },
    },
  },
  comments: {
    scope: 'rows',
    collection: 'comments',
    read: (db, projectId) => listCommentsByProject(db, projectId, { includeResolved: true }),
    serialize: (comment: Comment): PlandeskExportComment => ({
      id: comment.id,
      target_type: comment.targetType,
      target_id: comment.targetId,
      passage: comment.passage,
      anchor: comment.anchor,
      body: comment.body,
      resolved: comment.resolved,
      created_at: comment.createdAt.toISOString(),
    }),
    import: { order: 100, emit: emitCommentsImport },
    portability: {
      drizzleTable: comments,
      roundTrippedColumns: ['target_type', 'target_id', 'passage', 'anchor', 'body', 'resolved', 'created_at'],
      columnExclusions: {
        id: 'Remapped on import',
        project_id: 'Implied by nesting under the imported project',
      },
    },
  },
  agent_runs: {
    scope: 'rows',
    collection: 'agent_runs',
    read: listAgentRuns,
    serialize: (run: AgentRun, aux: ExportAux): PlandeskExportAgentRun => {
      const eventsByRun = aux.agent_run_events;
      return {
        id: run.id,
        status: run.status,
        label: run.label,
        started_at: run.startedAt.toISOString(),
        completed_at: run.completedAt?.toISOString() ?? null,
        events: (eventsByRun.get(run.id) ?? []).map(
          (event): PlandeskExportAgentRunEvent => ({
            message: event.message,
            created_at: event.createdAt.toISOString(),
          }),
        ),
      };
    },
    import: { order: 110, preallocateIds: preallocateAgentRunIds, emit: emitAgentRunsImport },
    portability: {
      drizzleTable: agentRuns,
      roundTrippedColumns: ['status', 'label', 'started_at', 'completed_at'],
      columnExclusions: {
        id: 'Remapped on import',
        project_id: 'Implied by nesting under the imported project',
      },
    },
  },
  agent_run_events: {
    scope: 'nested_per_parent',
    collection: 'agent_runs',
    parentTable: 'agent_runs',
    auxKey: 'agent_run_events',
    initAux: () => new Map<string, Awaited<ReturnType<typeof listAgentRunEvents>>>(),
    read: listAgentRunEvents,
    parentIdFrom: (run) => run.id,
    import: { order: 115, emit: emitAgentRunEventsImport },
    portability: {
      drizzleTable: agentRunEvents,
      roundTrippedColumns: ['message', 'created_at'],
      columnExclusions: {
        id: 'Remapped on import',
        run_id: 'Implied by nesting under the parent agent_run in the export',
      },
    },
  },
  files: {
    scope: 'rows',
    collection: 'files',
    read: listFilesByProject,
    serialize: (
      file: Awaited<ReturnType<typeof listFilesByProject>>[number],
    ): PlandeskExportFile => ({
      id: file.id,
      filename: file.filename,
      mime: file.mime,
      size: file.size,
      bytes_base64: file.bytes ? file.bytes.toString('base64') : null,
      external_url: file.externalUrl,
      created_at: file.createdAt,
    }),
    import: { order: 120, emit: emitFilesImport },
    portability: {
      drizzleTable: files,
      roundTrippedColumns: ['id', 'filename', 'mime', 'size', 'bytes', 'external_url', 'created_at'],
      columnExclusions: {
        project_id: 'Implied by nesting under the imported project',
      },
    },
  },
  artifacts: {
    scope: 'rows',
    collection: 'artifacts',
    read: listArtifactsByProject,
    serialize: (artifact: Artifact): PlandeskExportArtifact => ({
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      content: artifact.content,
      created_at: artifact.createdAt.toISOString(),
      updated_at: artifact.updatedAt.toISOString(),
    }),
    import: { order: 130, preallocateIds: preallocateArtifactIds, emit: emitArtifactsImport },
    portability: {
      drizzleTable: artifacts,
      roundTrippedColumns: ['title', 'kind', 'content'],
      columnExclusions: {
        id: 'Remapped on import',
        project_id: 'Implied by nesting under the imported project',
        created_at: 'Server-assigned on import (export writes them; import stamps now)',
        updated_at: 'Server-assigned on import (export writes them; import stamps now)',
      },
    },
  },
} satisfies Record<string, ExportTableManifestEntryShape>;

export type PlandeskExportTable = keyof typeof PLANDESK_EXPORT_TABLE_MANIFEST;

export type ExportTableManifestEntry =
  (typeof PLANDESK_EXPORT_TABLE_MANIFEST)[PlandeskExportTable];

/** Tables that nested_per_parent entries attach to — derived from manifest parentTable fields. */
export type PlandeskExportParentTable = {
  [K in PlandeskExportTable]: (typeof PLANDESK_EXPORT_TABLE_MANIFEST)[K] extends {
    parentTable: infer P;
  }
    ? P
    : never;
}[PlandeskExportTable];

type ManifestSpec<K extends PlandeskExportTable> = (typeof PLANDESK_EXPORT_TABLE_MANIFEST)[K];

type RowsManifestSpec<K extends PlandeskExportTable> = Extract<ManifestSpec<K>, { scope: 'rows' }>;

type RowScopedTable = {
  [K in PlandeskExportTable]: ManifestSpec<K> extends { scope: 'rows' } ? K : never;
}[PlandeskExportTable];

type RowFor<K extends RowScopedTable> = RowsManifestSpec<K>['read'] extends (
  db: DbClient,
  projectId: string,
) => Promise<(infer Row)[]>
  ? Row
  : never;

type ExportRowReads = {
  [K in RowScopedTable]?: RowFor<K>[];
};

export const PLANDESK_EXPORT_TABLES: readonly PlandeskExportTable[] = Object.keys(
  PLANDESK_EXPORT_TABLE_MANIFEST,
) as PlandeskExportTable[];

const PLANDESK_EXPORT_TABLE_COLLECTIONS_INTERNAL = Object.freeze(
  Object.fromEntries(
    Object.entries(PLANDESK_EXPORT_TABLE_MANIFEST).map(([table, spec]) => [table, spec.collection]),
  ),
) as Readonly<Record<PlandeskExportTable, PlandeskExportCollectionKey>>;

/** Immutable snapshot — mutation cannot change validation or export assembly. */
export const PLANDESK_EXPORT_TABLE_COLLECTIONS: Readonly<
  Record<PlandeskExportTable, PlandeskExportCollectionKey>
> = PLANDESK_EXPORT_TABLE_COLLECTIONS_INTERNAL;

const REQUIRED_EXPORT_COLLECTIONS = new Set<PlandeskExportCollectionKey>(
  Object.values(PLANDESK_EXPORT_TABLE_COLLECTIONS_INTERNAL),
);

type MappedExportCollection =
  (typeof PLANDESK_EXPORT_TABLE_COLLECTIONS_INTERNAL)[PlandeskExportTable];

type AssertExportCollectionsCovered =
  PlandeskExportCollectionKey extends MappedExportCollection
    ? MappedExportCollection extends PlandeskExportCollectionKey
      ? true
      : never
    : never;

const _assertExportCollectionsCovered: AssertExportCollectionsCovered = true;
void _assertExportCollectionsCovered;

/** Import-only top-level keys from exports written before polymorphic comments. */
const IMPORT_LEGACY_OWN_KEYS = new Set(['document_comments']);

export function allowedImportOwnKeys(): ReadonlySet<string> {
  const allowed = new Set<string>(['version']);
  for (const key of REQUIRED_EXPORT_COLLECTIONS) {
    allowed.add(key);
  }
  for (const key of IMPORT_LEGACY_OWN_KEYS) {
    allowed.add(key);
  }
  return allowed;
}

export function validateImportOwnKeys(data: PlandeskExportInput): void {
  const allowed = allowedImportOwnKeys();
  const snapshot = new Map<string, unknown>(Object.entries(data));
  for (const key of snapshot.keys()) {
    if (!allowed.has(key)) {
      throw new Error(`import collection not registered in PLANDESK_EXPORT_TABLES: ${key}`);
    }
  }
}

export type ManifestImportEntry = {
  table: PlandeskExportTable;
  import: ImportManifestHandler;
};

export function listImportManifestEntries(): ManifestImportEntry[] {
  return PLANDESK_EXPORT_TABLES.map((table) => ({
    table,
    import: PLANDESK_EXPORT_TABLE_MANIFEST[table].import,
  }));
}

export function getPortabilityCoverageFromManifest(): Record<
  PlandeskExportTable,
  PortabilityCoverageSpec
> {
  const coverage = {} as Record<PlandeskExportTable, PortabilityCoverageSpec>;
  for (const table of PLANDESK_EXPORT_TABLES) {
    coverage[table] = PLANDESK_EXPORT_TABLE_MANIFEST[table].portability;
  }
  return coverage;
}

export function requiredExportCollections(): ReadonlySet<PlandeskExportCollectionKey> {
  return REQUIRED_EXPORT_COLLECTIONS;
}

function createExportAux(): ExportAux {
  return {
    task_tags: PLANDESK_EXPORT_TABLE_MANIFEST.task_tags.initAux(),
    agent_run_events: PLANDESK_EXPORT_TABLE_MANIFEST.agent_run_events.initAux(),
  };
}

async function readProjectScopedRows(
  db: DbClient,
  projectId: string,
): Promise<ExportRowReads> {
  const manifest = PLANDESK_EXPORT_TABLE_MANIFEST;
  const [
    goals,
    tasks,
    tags,
    edges,
    folders,
    documents,
    notes,
    comments,
    agent_runs,
    files,
    artifacts,
  ] = await Promise.all([
    manifest.goals.read(db, projectId),
    manifest.tasks.read(db, projectId),
    manifest.tags.read(db, projectId),
    manifest.edges.read(db, projectId),
    manifest.folders.read(db, projectId),
    manifest.documents.read(db, projectId),
    manifest.notes.read(db, projectId),
    manifest.comments.read(db, projectId),
    manifest.agent_runs.read(db, projectId),
    manifest.files.read(db, projectId),
    manifest.artifacts.read(db, projectId),
  ]);
  return {
    goals,
    tasks,
    tags,
    edges,
    folders,
    documents,
    notes,
    comments,
    agent_runs,
    files,
    artifacts,
  };
}

async function gatherExportAux(
  db: DbClient,
  projectId: string,
  rowReads: ExportRowReads,
): Promise<ExportAux> {
  const manifest = PLANDESK_EXPORT_TABLE_MANIFEST;
  const aux = createExportAux();
  aux.task_tags = await manifest.task_tags.read(db, projectId);

  const agentRuns = rowReads.agent_runs ?? [];
  for (const run of agentRuns) {
    const events = await manifest.agent_run_events.read(db, run.id);
    aux.agent_run_events.set(run.id, events);
  }

  return aux;
}

function assembleRowCollections(
  rowReads: ExportRowReads,
  aux: ExportAux,
): Omit<PlandeskExport, 'version' | 'project'> {
  const manifest = PLANDESK_EXPORT_TABLE_MANIFEST;
  return {
    goals: (rowReads.goals ?? []).map((row) => manifest.goals.serialize(row)),
    tasks: (rowReads.tasks ?? []).map((row) => manifest.tasks.serialize(row, aux)),
    tags: (rowReads.tags ?? []).map((row) => manifest.tags.serialize(row)),
    edges: (rowReads.edges ?? []).map((row) => manifest.edges.serialize(row)),
    folders: (rowReads.folders ?? []).map((row) => manifest.folders.serialize(row)),
    documents: (rowReads.documents ?? []).map((row) => manifest.documents.serialize(row)),
    notes: (rowReads.notes ?? []).map((row) => manifest.notes.serialize(row)),
    comments: (rowReads.comments ?? []).map((row) => manifest.comments.serialize(row)),
    agent_runs: (rowReads.agent_runs ?? []).map((row) => manifest.agent_runs.serialize(row, aux)),
    files: (rowReads.files ?? []).map((row) => manifest.files.serialize(row)),
    artifacts: (rowReads.artifacts ?? []).map((row) => manifest.artifacts.serialize(row)),
  };
}

/**
 * Read every registered export table and assemble portable collections via the
 * manifest. Returns undefined when the project row is absent.
 */
export async function assembleExportFromManifest(
  db: DbClient,
  projectId: string,
): Promise<Omit<PlandeskExport, 'version'> | undefined> {
  const projectSpec = PLANDESK_EXPORT_TABLE_MANIFEST.projects;
  const project = await projectSpec.read(db, projectId);
  if (!project) {
    return undefined;
  }

  const rowReads = await readProjectScopedRows(db, projectId);
  const aux = await gatherExportAux(db, projectId, rowReads);

  return {
    project: projectSpec.serialize(project),
    ...assembleRowCollections(rowReads, aux),
  };
}

/** @internal Exported for regression tests only. */
export function _createExportAuxForTest(): ExportAux {
  return createExportAux();
}

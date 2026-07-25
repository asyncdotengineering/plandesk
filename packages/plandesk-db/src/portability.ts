import { randomUUID } from 'node:crypto';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db, DbClient } from './client.js';
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
  DEFAULT_ORG_ID,
  DEFAULT_WORKSPACE_ID,
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
  type AgentRunStatus,
  type ArtifactKind,
  type CommentTargetType,
  type GoalStatus,
  type LinkEntityType,
  type TaskStatus,
} from './schema.js';

/** Version stamped into new exports. */
export const PLANDESK_EXPORT_VERSION = 'plandesk-export-v2' as const;

/**
 * Every version this importer understands, newest first.
 *
 * The check used to be equality against the one current version, which froze it:
 * bumping the constant would have orphaned every export file already on disk, so
 * nine successive features were bolted on as optional fields instead and the
 * version never moved. Accepting a set is what lets it move.
 *
 * v1 → v2: edges gained polymorphic endpoints (from_type/from_id/to_type/to_id)
 * and from_task_id/to_task_id became nullable, because an edge between two
 * documents names no task. A v1 file still imports — the reader falls back to
 * the task pair when the typed fields are absent.
 */
export const SUPPORTED_EXPORT_VERSIONS = ['plandesk-export-v2', 'plandesk-export-v1'] as const;

export type PlandeskExportProject = {
  name: string;
  description: string | null;
  canvas_layout: string | null;
};

export type PlandeskExportGoal = {
  id: string;
  objective: string;
  status: GoalStatus;
  verification_surface: string | null;
  constraints: string | null;
  boundaries: string | null;
  iteration_policy: string | null;
  stop_condition: string | null;
  budget: string | null;
  last_verification?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PlandeskExportTask = {
  id: string;
  label: string;
  status: TaskStatus;
  description: string | null;
  x: number;
  y: number;
  assignee: string | null;
  due_date: string | null;
  // Always written on export; optional on import for exports written before goals existed.
  goal_id?: string;
  // Optional for backward compatibility with exports written before tags existed.
  tag_ids?: string[];
  created_at?: string;
  updated_at?: string;
};

export type PlandeskExportTag = {
  id: string;
  name: string;
  color: string | null;
};

export type PlandeskExportEdge = {
  id: string;
  /** Null for a document→document edge, which names no task. */
  from_task_id: string | null;
  to_task_id: string | null;
  /**
   * Polymorphic endpoints. Absent in exports written before links spanned
   * documents; the importer falls back to the task pair for those.
   */
  from_type?: string | null;
  from_id?: string | null;
  to_type?: string | null;
  to_id?: string | null;
  label: string | null;
  arrow_direction: string | null;
  style: string | null;
};

export type PlandeskExportFolder = {
  id: string;
  name: string;
  parent_folder_id: string | null;
};

export type PlandeskExportDocument = {
  id: string;
  title: string;
  body: string | null;
  status_line: string | null;
  parent_id: string | null;
  // Optional for backward compatibility with exports written before folders existed.
  folder_id?: string | null;
  linked_task_id: string | null;
};

export type PlandeskExportNote = {
  id: string;
  title: string;
  body: string | null;
};

export type PlandeskExportComment = {
  id: string;
  target_type: CommentTargetType;
  target_id: string;
  passage: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
};

export type PlandeskExportDocumentComment = {
  id: string;
  document_id: string;
  passage: string | null;
  body: string;
  resolved: boolean;
  created_at?: string;
};

export type PlandeskExportArtifact = {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  created_at?: string;
  updated_at?: string;
};

export type PlandeskExportFile = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  // Present for locally-stored (BLOB) files; null for s3-backed files.
  bytes_base64: string | null;
  // Present for s3-backed files; null for locally-stored (BLOB) files.
  external_url: string | null;
  created_at: string;
};

export type PlandeskExportAgentRunEvent = {
  message: string;
  created_at: string;
};

export type PlandeskExportAgentRun = {
  id: string;
  status: AgentRunStatus;
  label: string | null;
  started_at: string;
  completed_at: string | null;
  events: PlandeskExportAgentRunEvent[];
};

export type PlandeskExport = {
  version: typeof PLANDESK_EXPORT_VERSION;
  project: PlandeskExportProject;
  goals: PlandeskExportGoal[];
  tasks: PlandeskExportTask[];
  tags: PlandeskExportTag[];
  edges: PlandeskExportEdge[];
  folders: PlandeskExportFolder[];
  documents: PlandeskExportDocument[];
  notes: PlandeskExportNote[];
  comments: PlandeskExportComment[];
  agent_runs: PlandeskExportAgentRun[];
  files: PlandeskExportFile[];
  artifacts: PlandeskExportArtifact[];
};

export type PlandeskExportInput = {
  version: string;
  project: PlandeskExportProject;
  tasks: PlandeskExportTask[];
  // Optional for backward compatibility with exports written before goals existed.
  goals?: PlandeskExportGoal[];
  // Optional for backward compatibility with exports written before tags existed.
  tags?: PlandeskExportTag[];
  edges: PlandeskExportEdge[];
  // Optional for backward compatibility with exports written before folders existed.
  folders?: PlandeskExportFolder[];
  documents: PlandeskExportDocument[];
  // Optional for backward compatibility with exports written before notes existed.
  notes?: PlandeskExportNote[];
  // Optional for backward compatibility with exports written before comments existed.
  comments?: PlandeskExportComment[];
  // Legacy shape from exports written before polymorphic comments.
  document_comments?: PlandeskExportDocumentComment[];
  agent_runs: PlandeskExportAgentRun[];
  // Optional for backward compatibility with exports written before files existed.
  files?: PlandeskExportFile[];
  // Optional for backward compatibility with exports written before artifacts existed.
  artifacts?: PlandeskExportArtifact[];
};

export class InvalidExportVersionError extends Error {
  constructor(version: string) {
    super(
      `Unsupported export version: ${version}. This build reads ${SUPPORTED_EXPORT_VERSIONS.join(', ')}. A newer version means the file was written by a newer Plan Desk — upgrade to import it.`,
    );
    this.name = 'InvalidExportVersionError';
  }
}

function sortDocumentsForImport(documents: PlandeskExportDocument[]): PlandeskExportDocument[] {
  const remaining = [...documents];
  const sorted: PlandeskExportDocument[] = [];
  const created = new Set<string>();

  while (remaining.length > 0) {
    let progress = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const document = remaining[i];
      if (!document) {
        continue;
      }
      if (document.parent_id === null || created.has(document.parent_id)) {
        sorted.push(document);
        created.add(document.id);
        remaining.splice(i, 1);
        progress = true;
      }
    }
    if (!progress) {
      throw new Error('Document parent cycle or missing parent in export');
    }
  }

  return sorted;
}

function sortFoldersForImport(folders: PlandeskExportFolder[]): PlandeskExportFolder[] {
  const remaining = [...folders];
  const sorted: PlandeskExportFolder[] = [];
  const created = new Set<string>();

  while (remaining.length > 0) {
    let progress = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const folder = remaining[i];
      if (!folder) {
        continue;
      }
      if (folder.parent_folder_id === null || created.has(folder.parent_folder_id)) {
        sorted.push(folder);
        created.add(folder.id);
        remaining.splice(i, 1);
        progress = true;
      }
    }
    if (!progress) {
      throw new Error('Folder parent cycle or missing parent in export');
    }
  }

  return sorted;
}

function remapId(idMap: Map<string, string>, oldId: string | null): string | null {
  if (oldId === null) {
    return null;
  }
  const mapped = idMap.get(oldId);
  if (!mapped) {
    throw new Error(`Missing ID remap for ${oldId}`);
  }
  return mapped;
}

/**
 * Remap a polymorphic edge endpoint through the id map for its own type.
 * Returns undefined when the export predates polymorphic links, so the caller
 * can fall back to the task pair.
 */
/** Narrow an exported endpoint type to the column's enum, rejecting anything else. */
function toLinkEntityType(value: string | null | undefined): LinkEntityType | null {
  return value === 'task' || value === 'document' ? value : null;
}

function remapEndpointId(
  type: string | null | undefined,
  id: string | null | undefined,
  taskIdMap: Map<string, string>,
  documentIdMap: Map<string, string>,
): string | null | undefined {
  if (type === undefined || type === null || id === undefined || id === null) {
    return undefined;
  }
  if (type === 'document') {
    return remapId(documentIdMap, id);
  }
  return remapId(taskIdMap, id);
}

export async function exportProject(
  db: DbClient,
  projectId: string,
): Promise<PlandeskExport | undefined> {
  const project = await getProject(db, projectId);
  if (!project) {
    return undefined;
  }

  const projectGoals = await listGoals(db, projectId);
  const tasks = await listTasks(db, projectId);
  const tags = await listTags(db, projectId);
  const tagsByTask = await listTagsByTaskForProject(db, projectId);
  const edges = await listEdges(db, projectId);
  const folders = await listFolders(db, projectId);
  const documents = await listDocuments(db, projectId);
  const notes = await listNotes(db, projectId);
  const comments = await listCommentsByProject(db, projectId, { includeResolved: true });
  const runs = await listAgentRuns(db, projectId);
  const projectFiles = await listFilesByProject(db, projectId);
  const projectArtifacts = await listArtifactsByProject(db, projectId);

  return {
    version: PLANDESK_EXPORT_VERSION,
    project: {
      name: project.name,
      description: project.description,
      canvas_layout: project.canvasLayout,
    },
    goals: projectGoals.map((goal) => ({
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
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      label: task.label,
      status: task.status,
      description: task.description,
      x: task.x,
      y: task.y,
      assignee: task.assignee,
      due_date: task.dueDate?.toISOString() ?? null,
      goal_id: task.goalId,
      tag_ids: (tagsByTask.get(task.id) ?? []).map((tag) => tag.id),
      created_at: task.createdAt.toISOString(),
      updated_at: task.updatedAt.toISOString(),
    })),
    tags: tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      from_task_id: edge.fromTaskId,
      to_task_id: edge.toTaskId,
      from_type: edge.fromType,
      from_id: edge.fromId,
      to_type: edge.toType,
      to_id: edge.toId,
      label: edge.label,
      arrow_direction: edge.arrowDirection,
      style: edge.style,
    })),
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parent_folder_id: folder.parentFolderId,
    })),
    documents: documents.map((document) => ({
      id: document.id,
      title: document.title,
      body: document.body,
      status_line: document.statusLine,
      parent_id: document.parentId,
      folder_id: document.folderId,
      linked_task_id: document.linkedTaskId,
    })),
    notes: notes.map((note) => ({
      id: note.id,
      title: note.title,
      body: note.body,
    })),
    comments: comments.map((comment) => ({
      id: comment.id,
      target_type: comment.targetType,
      target_id: comment.targetId,
      passage: comment.passage,
      body: comment.body,
      resolved: comment.resolved,
      created_at: comment.createdAt.toISOString(),
    })),
    agent_runs: await Promise.all(
      runs.map(async (run) => ({
        id: run.id,
        status: run.status,
        label: run.label,
        started_at: run.startedAt.toISOString(),
        completed_at: run.completedAt?.toISOString() ?? null,
        events: (await listAgentRunEvents(db, run.id)).map((event) => ({
          message: event.message,
          created_at: event.createdAt.toISOString(),
        })),
      })),
    ),
    files: projectFiles.map((file) => ({
      id: file.id,
      filename: file.filename,
      mime: file.mime,
      size: file.size,
      bytes_base64: file.bytes ? file.bytes.toString('base64') : null,
      external_url: file.externalUrl,
      created_at: file.createdAt,
    })),
    artifacts: projectArtifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      content: artifact.content,
      created_at: artifact.createdAt.toISOString(),
      updated_at: artifact.updatedAt.toISOString(),
    })),
  };
}

export type ImportProjectOptions = {
  /** Hosted org to own the imported project. When omitted, uses the default org. */
  orgId?: string;
  /** Workspace to own the imported project. When omitted, uses the default workspace. */
  workspaceId?: string;
};

function requireRootDb(db: DbClient): Db {
  if (!('$client' in db)) {
    throw new Error('importProject requires a root Db handle (db.batch)');
  }
  return db;
}

function asNonEmptyBatch(
  statements: BatchItem<'sqlite'>[],
): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] {
  const first = statements[0];
  if (first === undefined) {
    throw new Error('import batch is empty');
  }
  return [first, ...statements.slice(1)];
}

/**
 * Import a portable export as a new project.
 *
 * Uses `db.batch([...])` — one round-trip, all-or-nothing — so remote Turso
 * imports stay under the interactive-transaction time budget. All ids are
 * pre-generated; no interactive read-then-write inside the batch.
 */
export async function importProject(
  db: DbClient,
  data: PlandeskExportInput,
  options?: ImportProjectOptions,
): Promise<{ projectId: string }> {
  if (!(SUPPORTED_EXPORT_VERSIONS as readonly string[]).includes(data.version)) {
    throw new InvalidExportVersionError(data.version);
  }

  const root = requireRootDb(db);

  const taskIdMap = new Map<string, string>();
  const goalIdMap = new Map<string, string>();
  const tagIdMap = new Map<string, string>();
  const edgeIdMap = new Map<string, string>();
  const folderIdMap = new Map<string, string>();
  const documentIdMap = new Map<string, string>();
  const artifactIdMap = new Map<string, string>();
  const agentRunIdMap = new Map<string, string>();

  for (const task of data.tasks) {
    taskIdMap.set(task.id, randomUUID());
  }
  for (const goal of data.goals ?? []) {
    goalIdMap.set(goal.id, randomUUID());
  }
  for (const tag of data.tags ?? []) {
    tagIdMap.set(tag.id, randomUUID());
  }
  for (const edge of data.edges) {
    edgeIdMap.set(edge.id, randomUUID());
  }
  for (const folder of data.folders ?? []) {
    folderIdMap.set(folder.id, randomUUID());
  }
  for (const document of data.documents) {
    documentIdMap.set(document.id, randomUUID());
  }
  for (const artifact of data.artifacts ?? []) {
    artifactIdMap.set(artifact.id, randomUUID());
  }
  for (const run of data.agent_runs) {
    agentRunIdMap.set(run.id, randomUUID());
  }

  const orgId = options?.orgId ?? DEFAULT_ORG_ID;
  const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const projectId = randomUUID();
  const now = new Date();

  const exportGoals = data.goals ?? [];
  let defaultGoalId: string;
  if (exportGoals.length === 0) {
    defaultGoalId = randomUUID();
  } else {
    const firstGoal = exportGoals[0];
    if (firstGoal === undefined) {
      throw new Error('export goals unexpectedly empty');
    }
    // Match prior sequential import: first-inserted goal becomes the default.
    defaultGoalId = remapId(goalIdMap, firstGoal.id) ?? firstGoal.id;
  }

  const statements: BatchItem<'sqlite'>[] = [];

  statements.push(
    root.insert(projects).values({
      id: projectId,
      orgId,
      workspaceId,
      name: data.project.name,
      description: data.project.description,
      canvasLayout: data.project.canvas_layout,
      createdAt: now,
      updatedAt: now,
    }),
  );

  if (exportGoals.length === 0) {
    statements.push(
      root.insert(goals).values({
        id: defaultGoalId,
        projectId,
        objective: 'General',
        status: 'active',
        verificationSurface: null,
        constraints: null,
        boundaries: null,
        iterationPolicy: null,
        stopCondition: null,
        budget: null,
        lastVerification: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  } else {
    for (const goal of exportGoals) {
      statements.push(
        root.insert(goals).values({
          id: remapId(goalIdMap, goal.id) ?? goal.id,
          projectId,
          objective: goal.objective,
          status: goal.status,
          verificationSurface: goal.verification_surface,
          constraints: goal.constraints,
          boundaries: goal.boundaries,
          iterationPolicy: goal.iteration_policy,
          stopCondition: goal.stop_condition,
          budget: goal.budget,
          lastVerification: goal.last_verification ?? null,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
  }

  for (const task of data.tasks) {
    const goalId =
      (task.goal_id !== undefined ? goalIdMap.get(task.goal_id) : undefined) ?? defaultGoalId;
    statements.push(
      root.insert(tasks).values({
        id: remapId(taskIdMap, task.id) ?? task.id,
        projectId,
        goalId,
        label: task.label,
        status: task.status,
        description: task.description,
        x: task.x,
        y: task.y,
        assignee: task.assignee,
        dueDate: task.due_date ? new Date(task.due_date) : null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  for (const tag of data.tags ?? []) {
    statements.push(
      root.insert(tags).values({
        id: remapId(tagIdMap, tag.id) ?? tag.id,
        projectId,
        name: tag.name,
        color: tag.color,
        createdAt: now,
      }),
    );
  }

  for (const task of data.tasks) {
    const tagIds = task.tag_ids ?? [];
    if (tagIds.length === 0) {
      continue;
    }
    const taskId = remapId(taskIdMap, task.id) ?? task.id;
    const unique = [...new Set(tagIds.map((tagId) => remapId(tagIdMap, tagId) ?? tagId))];
    if (unique.length === 0) {
      continue;
    }
    statements.push(
      root.insert(taskTags).values(unique.map((tagId) => ({ taskId, tagId }))),
    );
  }

  for (const edge of data.edges) {
    statements.push(
      root.insert(edges).values({
        id: remapId(edgeIdMap, edge.id) ?? edge.id,
        projectId,
        fromTaskId:
          edge.from_task_id === null
            ? null
            : (remapId(taskIdMap, edge.from_task_id) ?? edge.from_task_id),
        toTaskId:
          edge.to_task_id === null ? null : (remapId(taskIdMap, edge.to_task_id) ?? edge.to_task_id),
        // Remap by endpoint type. An export predating polymorphic links carries
        // neither field; fall back to the task pair so those imports still land.
        fromType: toLinkEntityType(edge.from_type ?? (edge.from_task_id === null ? null : 'task')),
        fromId: remapEndpointId(edge.from_type, edge.from_id, taskIdMap, documentIdMap) ?? remapId(taskIdMap, edge.from_task_id),
        toType: toLinkEntityType(edge.to_type ?? (edge.to_task_id === null ? null : 'task')),
        toId: remapEndpointId(edge.to_type, edge.to_id, taskIdMap, documentIdMap) ?? remapId(taskIdMap, edge.to_task_id),
        label: edge.label,
        arrowDirection: edge.arrow_direction,
        style: edge.style,
        createdAt: now,
      }),
    );
  }

  for (const folder of sortFoldersForImport(data.folders ?? [])) {
    statements.push(
      root.insert(folders).values({
        id: remapId(folderIdMap, folder.id) ?? folder.id,
        projectId,
        name: folder.name,
        parentFolderId: remapId(folderIdMap, folder.parent_folder_id),
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  for (const document of sortDocumentsForImport(data.documents)) {
    statements.push(
      root.insert(documents).values({
        id: remapId(documentIdMap, document.id) ?? document.id,
        projectId,
        title: document.title,
        body: document.body,
        statusLine: document.status_line,
        parentId: remapId(documentIdMap, document.parent_id),
        folderId: remapId(folderIdMap, document.folder_id ?? null),
        linkedTaskId: remapId(taskIdMap, document.linked_task_id),
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  for (const note of data.notes ?? []) {
    statements.push(
      root.insert(notes).values({
        id: randomUUID(),
        projectId,
        title: note.title,
        body: note.body,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  const commentEntries: PlandeskExportComment[] = [
    ...(data.comments ?? []),
    ...(data.document_comments ?? []).map((legacy) => ({
      id: legacy.id,
      target_type: 'document' as const,
      target_id: legacy.document_id,
      passage: legacy.passage,
      body: legacy.body,
      resolved: legacy.resolved,
      created_at: legacy.created_at ?? new Date().toISOString(),
    })),
  ];

  for (const comment of commentEntries) {
    const targetId =
      comment.target_type === 'document'
        ? (remapId(documentIdMap, comment.target_id) ?? comment.target_id)
        : comment.target_type === 'artifact'
          ? (remapId(artifactIdMap, comment.target_id) ?? comment.target_id)
          : comment.target_id;
    statements.push(
      root.insert(comments).values({
        id: randomUUID(),
        projectId,
        targetType: comment.target_type,
        targetId,
        passage: comment.passage,
        anchor: null,
        body: comment.body,
        resolved: comment.resolved,
        createdAt: new Date(comment.created_at),
      }),
    );
  }

  for (const agentRun of data.agent_runs) {
    const newRunId = remapId(agentRunIdMap, agentRun.id) ?? agentRun.id;
    statements.push(
      root.insert(agentRuns).values({
        id: newRunId,
        projectId,
        status: agentRun.status,
        label: agentRun.label,
        startedAt: new Date(agentRun.started_at),
        completedAt: agentRun.completed_at ? new Date(agentRun.completed_at) : null,
      }),
    );
    for (const event of agentRun.events) {
      statements.push(
        root.insert(agentRunEvents).values({
          id: randomUUID(),
          runId: newRunId,
          message: event.message,
          createdAt: new Date(event.created_at),
        }),
      );
    }
  }

  for (const file of data.files ?? []) {
    // Content-addressed id (sha256). PK is (project_id, id) — same bytes in
    // different orgs/projects never collide; skip if this project already has the hash.
    statements.push(
      root
        .insert(files)
        .values({
          id: file.id,
          projectId,
          filename: file.filename,
          mime: file.mime,
          size: file.size,
          bytes: file.bytes_base64 ? Buffer.from(file.bytes_base64, 'base64') : null,
          externalUrl: file.external_url,
          createdAt: file.created_at,
        })
        .onConflictDoNothing({ target: [files.projectId, files.id] }),
    );
  }

  for (const artifact of data.artifacts ?? []) {
    statements.push(
      root.insert(artifacts).values({
        id: remapId(artifactIdMap, artifact.id) ?? artifact.id,
        projectId,
        title: artifact.title,
        kind: artifact.kind,
        content: artifact.content,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  await root.batch(asNonEmptyBatch(statements));
  return { projectId };
}

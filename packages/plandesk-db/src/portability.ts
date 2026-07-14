import { randomUUID } from 'node:crypto';
import { withTransaction, type Db, type DbClient } from './client.js';
import { createAgentRunEvent } from './repositories/agent-run-events.js';
import { createAgentRun } from './repositories/agent-runs.js';
import { createDocument } from './repositories/documents.js';
import { createEdge } from './repositories/edges.js';
import { createArtifact, listArtifactsByProject } from './repositories/artifacts.js';
import { createFile, listFilesByProject } from './repositories/files.js';
import { createFolder, listFolders } from './repositories/folders.js';
import { createNote } from './repositories/notes.js';
import { createGoal, getOrCreateDefaultGoal, listGoals } from './repositories/goals.js';
import { createProject, getProject, updateProject } from './repositories/projects.js';
import { createTag, listTags, listTagsByTaskForProject, setTaskTags } from './repositories/tags.js';
import { createComment, listCommentsByProject } from './repositories/comments.js';
import { createTask } from './repositories/tasks.js';
import { listAgentRunEvents } from './repositories/agent-run-events.js';
import { listAgentRuns } from './repositories/agent-runs.js';
import { listDocuments } from './repositories/documents.js';
import { listEdges } from './repositories/edges.js';
import { listNotes } from './repositories/notes.js';
import { listTasks } from './repositories/tasks.js';
import type {
  AgentRunStatus,
  ArtifactKind,
  CommentTargetType,
  GoalStatus,
  TaskStatus,
} from './schema.js';

export const PLANDESK_EXPORT_VERSION = 'plandesk-export-v1' as const;

export type PlandeskExportV1Project = {
  name: string;
  description: string | null;
  canvas_layout: string | null;
};

export type PlandeskExportV1Goal = {
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

export type PlandeskExportV1Task = {
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

export type PlandeskExportV1Tag = {
  id: string;
  name: string;
  color: string | null;
};

export type PlandeskExportV1Edge = {
  id: string;
  from_task_id: string;
  to_task_id: string;
  label: string | null;
  arrow_direction: string | null;
  style: string | null;
};

export type PlandeskExportV1Folder = {
  id: string;
  name: string;
  parent_folder_id: string | null;
};

export type PlandeskExportV1Document = {
  id: string;
  title: string;
  body: string | null;
  status_line: string | null;
  parent_id: string | null;
  // Optional for backward compatibility with exports written before folders existed.
  folder_id?: string | null;
  linked_task_id: string | null;
};

export type PlandeskExportV1Note = {
  id: string;
  title: string;
  body: string | null;
};

export type PlandeskExportV1Comment = {
  id: string;
  target_type: CommentTargetType;
  target_id: string;
  passage: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
};

export type PlandeskExportV1DocumentComment = {
  id: string;
  document_id: string;
  passage: string | null;
  body: string;
  resolved: boolean;
  created_at?: string;
};

export type PlandeskExportV1Artifact = {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  created_at?: string;
  updated_at?: string;
};

export type PlandeskExportV1File = {
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

export type PlandeskExportV1AgentRunEvent = {
  message: string;
  created_at: string;
};

export type PlandeskExportV1AgentRun = {
  id: string;
  status: AgentRunStatus;
  label: string | null;
  started_at: string;
  completed_at: string | null;
  events: PlandeskExportV1AgentRunEvent[];
};

export type PlandeskExportV1 = {
  version: typeof PLANDESK_EXPORT_VERSION;
  project: PlandeskExportV1Project;
  goals: PlandeskExportV1Goal[];
  tasks: PlandeskExportV1Task[];
  tags: PlandeskExportV1Tag[];
  edges: PlandeskExportV1Edge[];
  folders: PlandeskExportV1Folder[];
  documents: PlandeskExportV1Document[];
  notes: PlandeskExportV1Note[];
  comments: PlandeskExportV1Comment[];
  agent_runs: PlandeskExportV1AgentRun[];
  files: PlandeskExportV1File[];
  artifacts: PlandeskExportV1Artifact[];
};

export type PlandeskExportInput = {
  version: string;
  project: PlandeskExportV1Project;
  tasks: PlandeskExportV1Task[];
  // Optional for backward compatibility with exports written before goals existed.
  goals?: PlandeskExportV1Goal[];
  // Optional for backward compatibility with exports written before tags existed.
  tags?: PlandeskExportV1Tag[];
  edges: PlandeskExportV1Edge[];
  // Optional for backward compatibility with exports written before folders existed.
  folders?: PlandeskExportV1Folder[];
  documents: PlandeskExportV1Document[];
  // Optional for backward compatibility with exports written before notes existed.
  notes?: PlandeskExportV1Note[];
  // Optional for backward compatibility with exports written before comments existed.
  comments?: PlandeskExportV1Comment[];
  // Legacy shape from exports written before polymorphic comments.
  document_comments?: PlandeskExportV1DocumentComment[];
  agent_runs: PlandeskExportV1AgentRun[];
  // Optional for backward compatibility with exports written before files existed.
  files?: PlandeskExportV1File[];
  // Optional for backward compatibility with exports written before artifacts existed.
  artifacts?: PlandeskExportV1Artifact[];
};

export class InvalidExportVersionError extends Error {
  constructor(version: string) {
    super(`Unsupported export version: ${version}. Expected ${PLANDESK_EXPORT_VERSION}.`);
    this.name = 'InvalidExportVersionError';
  }
}

function sortDocumentsForImport(documents: PlandeskExportV1Document[]): PlandeskExportV1Document[] {
  const remaining = [...documents];
  const sorted: PlandeskExportV1Document[] = [];
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

function sortFoldersForImport(folders: PlandeskExportV1Folder[]): PlandeskExportV1Folder[] {
  const remaining = [...folders];
  const sorted: PlandeskExportV1Folder[] = [];
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

export async function exportProject(
  db: DbClient,
  projectId: string,
): Promise<PlandeskExportV1 | undefined> {
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

export async function importProject(
  db: DbClient,
  data: PlandeskExportInput,
): Promise<{ projectId: string }> {
  if (data.version !== PLANDESK_EXPORT_VERSION) {
    throw new InvalidExportVersionError(data.version);
  }

  // Same-connection BEGIN/COMMIT via withTransaction — not db.transaction().
  // libsql's interactive transaction opens a second connection; with bare
  // :memory: that second connection is an empty database.
  const run = async (tx: DbClient): Promise<{ projectId: string }> => {
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

    const project = await createProject(tx, {
      name: data.project.name,
      description: data.project.description,
    });
    if (data.project.canvas_layout !== null) {
      await updateProject(tx, project.id, { canvasLayout: data.project.canvas_layout });
    }

    for (const goal of data.goals ?? []) {
      await createGoal(tx, {
        id: remapId(goalIdMap, goal.id) ?? goal.id,
        projectId: project.id,
        objective: goal.objective,
        status: goal.status,
        verificationSurface: goal.verification_surface,
        constraints: goal.constraints,
        boundaries: goal.boundaries,
        iterationPolicy: goal.iteration_policy,
        stopCondition: goal.stop_condition,
        budget: goal.budget,
        lastVerification: goal.last_verification ?? null,
      });
    }

    const defaultGoal = await getOrCreateDefaultGoal(tx, project.id);

    for (const task of data.tasks) {
      // A task from a pre-goals export (or referencing an unknown goal) falls
      // back to the project's default goal.
      const goalId =
        (task.goal_id !== undefined ? goalIdMap.get(task.goal_id) : undefined) ?? defaultGoal.id;
      await createTask(tx, {
        id: remapId(taskIdMap, task.id) ?? task.id,
        projectId: project.id,
        goalId,
        label: task.label,
        status: task.status,
        description: task.description,
        x: task.x,
        y: task.y,
        assignee: task.assignee,
        dueDate: task.due_date ? new Date(task.due_date) : null,
      });
    }

    for (const tag of data.tags ?? []) {
      await createTag(tx, {
        id: remapId(tagIdMap, tag.id) ?? tag.id,
        projectId: project.id,
        name: tag.name,
        color: tag.color,
      });
    }

    for (const task of data.tasks) {
      const tagIds = task.tag_ids ?? [];
      if (tagIds.length === 0) {
        continue;
      }
      await setTaskTags(
        tx,
        remapId(taskIdMap, task.id) ?? task.id,
        tagIds.map((tagId) => remapId(tagIdMap, tagId) ?? tagId),
      );
    }

    for (const edge of data.edges) {
      await createEdge(tx, {
        id: remapId(edgeIdMap, edge.id) ?? edge.id,
        projectId: project.id,
        fromTaskId: remapId(taskIdMap, edge.from_task_id) ?? edge.from_task_id,
        toTaskId: remapId(taskIdMap, edge.to_task_id) ?? edge.to_task_id,
        label: edge.label,
        arrowDirection: edge.arrow_direction,
        style: edge.style,
      });
    }

    for (const folder of sortFoldersForImport(data.folders ?? [])) {
      await createFolder(tx, {
        id: remapId(folderIdMap, folder.id) ?? folder.id,
        projectId: project.id,
        name: folder.name,
        parentFolderId: remapId(folderIdMap, folder.parent_folder_id),
      });
    }

    for (const document of sortDocumentsForImport(data.documents)) {
      await createDocument(tx, {
        id: remapId(documentIdMap, document.id) ?? document.id,
        projectId: project.id,
        title: document.title,
        body: document.body,
        statusLine: document.status_line,
        parentId: remapId(documentIdMap, document.parent_id),
        folderId: remapId(folderIdMap, document.folder_id ?? null),
        linkedTaskId: remapId(taskIdMap, document.linked_task_id),
      });
    }

    for (const note of data.notes ?? []) {
      await createNote(tx, {
        projectId: project.id,
        title: note.title,
        body: note.body,
      });
    }

    const commentEntries: PlandeskExportV1Comment[] = [
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
      await createComment(tx, {
        projectId: project.id,
        targetType: comment.target_type,
        targetId,
        passage: comment.passage,
        body: comment.body,
        resolved: comment.resolved,
        createdAt: new Date(comment.created_at),
        id: randomUUID(),
      });
    }

    for (const agentRun of data.agent_runs) {
      const newRunId = remapId(agentRunIdMap, agentRun.id) ?? agentRun.id;
      await createAgentRun(tx, {
        id: newRunId,
        projectId: project.id,
        status: agentRun.status,
        label: agentRun.label,
        startedAt: new Date(agentRun.started_at),
        completedAt: agentRun.completed_at ? new Date(agentRun.completed_at) : null,
      });
      for (const event of agentRun.events) {
        await createAgentRunEvent(tx, {
          runId: newRunId,
          message: event.message,
          createdAt: new Date(event.created_at),
        });
      }
    }

    for (const file of data.files ?? []) {
      await createFile(tx, {
        // Content-addressed: id stays the source hash, no remap needed.
        id: file.id,
        projectId: project.id,
        filename: file.filename,
        mime: file.mime,
        size: file.size,
        bytes: file.bytes_base64 ? Buffer.from(file.bytes_base64, 'base64') : null,
        externalUrl: file.external_url,
        createdAt: file.created_at,
      });
    }

    for (const artifact of data.artifacts ?? []) {
      await createArtifact(tx, {
        id: remapId(artifactIdMap, artifact.id) ?? artifact.id,
        projectId: project.id,
        title: artifact.title,
        kind: artifact.kind,
        content: artifact.content,
      });
    }

    return { projectId: project.id };
  };

  // DbClient may already be a nested transaction handle; only outer Db has $client.
  if ('$client' in db) {
    return withTransaction(db as Db, run);
  }
  return run(db);
}

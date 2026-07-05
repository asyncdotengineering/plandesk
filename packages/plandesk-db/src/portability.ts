import { randomUUID } from 'node:crypto';
import type { DbClient } from './client.js';
import { createAgentRunEvent } from './repositories/agent-run-events.js';
import { createAgentRun } from './repositories/agent-runs.js';
import { createDocument } from './repositories/documents.js';
import { createEdge } from './repositories/edges.js';
import { createFolder, listFolders } from './repositories/folders.js';
import { createNote } from './repositories/notes.js';
import { createGoal, getOrCreateDefaultGoal, listGoals } from './repositories/goals.js';
import { createProject, getProject, updateProject } from './repositories/projects.js';
import { createTag, listTags, listTagsByTaskForProject, setTaskTags } from './repositories/tags.js';
import { createTask } from './repositories/tasks.js';
import { listAgentRunEvents } from './repositories/agent-run-events.js';
import { listAgentRuns } from './repositories/agent-runs.js';
import { listDocuments } from './repositories/documents.js';
import { listEdges } from './repositories/edges.js';
import { listNotes } from './repositories/notes.js';
import { listTasks } from './repositories/tasks.js';
import type { AgentRunStatus, GoalStatus, TaskStatus } from './schema.js';

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
  goal_id: string;
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
  agent_runs: PlandeskExportV1AgentRun[];
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
  agent_runs: PlandeskExportV1AgentRun[];
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

export function exportProject(db: DbClient, projectId: string): PlandeskExportV1 | undefined {
  const project = getProject(db, projectId);
  if (!project) {
    return undefined;
  }

  const projectGoals = listGoals(db, projectId);
  const tasks = listTasks(db, projectId);
  const tags = listTags(db, projectId);
  const tagsByTask = listTagsByTaskForProject(db, projectId);
  const edges = listEdges(db, projectId);
  const folders = listFolders(db, projectId);
  const documents = listDocuments(db, projectId);
  const notes = listNotes(db, projectId);
  const runs = listAgentRuns(db, projectId);

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
    agent_runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      label: run.label,
      started_at: run.startedAt.toISOString(),
      completed_at: run.completedAt?.toISOString() ?? null,
      events: listAgentRunEvents(db, run.id).map((event) => ({
        message: event.message,
        created_at: event.createdAt.toISOString(),
      })),
    })),
  };
}

export function importProject(db: DbClient, data: PlandeskExportInput): { projectId: string } {
  if (data.version !== PLANDESK_EXPORT_VERSION) {
    throw new InvalidExportVersionError(data.version);
  }

  return db.transaction((tx) => {
    const taskIdMap = new Map<string, string>();
    const goalIdMap = new Map<string, string>();
    const tagIdMap = new Map<string, string>();
    const edgeIdMap = new Map<string, string>();
    const folderIdMap = new Map<string, string>();
    const documentIdMap = new Map<string, string>();
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
    for (const run of data.agent_runs) {
      agentRunIdMap.set(run.id, randomUUID());
    }

    const project = createProject(tx, {
      name: data.project.name,
      description: data.project.description,
    });
    if (data.project.canvas_layout !== null) {
      updateProject(tx, project.id, { canvasLayout: data.project.canvas_layout });
    }

    for (const goal of data.goals ?? []) {
      createGoal(tx, {
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
      });
    }

    const defaultGoal = getOrCreateDefaultGoal(tx, project.id);

    for (const task of data.tasks) {
      const goalId =
        task.goal_id !== undefined
          ? (remapId(goalIdMap, task.goal_id) ?? defaultGoal.id)
          : defaultGoal.id;
      createTask(tx, {
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
      createTag(tx, {
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
      setTaskTags(
        tx,
        remapId(taskIdMap, task.id) ?? task.id,
        tagIds.map((tagId) => remapId(tagIdMap, tagId) ?? tagId),
      );
    }

    for (const edge of data.edges) {
      createEdge(tx, {
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
      createFolder(tx, {
        id: remapId(folderIdMap, folder.id) ?? folder.id,
        projectId: project.id,
        name: folder.name,
        parentFolderId: remapId(folderIdMap, folder.parent_folder_id),
      });
    }

    for (const document of sortDocumentsForImport(data.documents)) {
      createDocument(tx, {
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
      createNote(tx, {
        projectId: project.id,
        title: note.title,
        body: note.body,
      });
    }

    for (const run of data.agent_runs) {
      const newRunId = remapId(agentRunIdMap, run.id) ?? run.id;
      createAgentRun(tx, {
        id: newRunId,
        projectId: project.id,
        status: run.status,
        label: run.label,
        startedAt: new Date(run.started_at),
        completedAt: run.completed_at ? new Date(run.completed_at) : null,
      });
      for (const event of run.events) {
        createAgentRunEvent(tx, {
          runId: newRunId,
          message: event.message,
          createdAt: new Date(event.created_at),
        });
      }
    }

    return { projectId: project.id };
  });
}

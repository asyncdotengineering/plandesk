import type { Document, Edge, Project, Task, TaskStatus } from '@plandesk/db';
import { taskStatuses } from '@plandesk/db';

export type TaskStatusSummary = Record<TaskStatus, number>;

export function emptyTaskStatusSummary(): TaskStatusSummary {
  return Object.fromEntries(taskStatuses.map((status) => [status, 0])) as TaskStatusSummary;
}

export function serializeProject(project: Project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString(),
  };
}

export function serializeProjectDetail(project: Project, summary: TaskStatusSummary) {
  return {
    ...serializeProject(project),
    summary,
  };
}

export function serializeTask(task: Task) {
  return {
    id: task.id,
    project_id: task.projectId,
    label: task.label,
    status: task.status,
    description: task.description,
    x: task.x,
    y: task.y,
    assignee: task.assignee,
    due_date: task.dueDate?.toISOString() ?? null,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
  };
}

export type SerializedDocument = {
  id: string;
  project_id: string;
  title: string;
  body: string | null;
  status_line: string | null;
  parent_id: string | null;
  linked_task_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SerializedDocumentTree = SerializedDocument & {
  children: SerializedDocumentTree[];
};

export function serializeDocument(document: Document): SerializedDocument {
  return {
    id: document.id,
    project_id: document.projectId,
    title: document.title,
    body: document.body,
    status_line: document.statusLine,
    parent_id: document.parentId,
    linked_task_id: document.linkedTaskId,
    created_at: document.createdAt.toISOString(),
    updated_at: document.updatedAt.toISOString(),
  };
}

export function buildDocumentTree(documents: Document[]): SerializedDocumentTree[] {
  const nodes = new Map<string, SerializedDocumentTree>();
  for (const document of documents) {
    nodes.set(document.id, { ...serializeDocument(document), children: [] });
  }

  const roots: SerializedDocumentTree[] = [];
  for (const document of documents) {
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
}

export function serializeEdge(edge: Edge) {
  return {
    id: edge.id,
    project_id: edge.projectId,
    from_task_id: edge.fromTaskId,
    to_task_id: edge.toTaskId,
    label: edge.label,
    arrow_direction: edge.arrowDirection,
    style: edge.style,
    created_at: edge.createdAt.toISOString(),
  };
}

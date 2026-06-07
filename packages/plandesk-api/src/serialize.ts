import type { Edge, Project, Task, TaskStatus } from '@plandesk/db';
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

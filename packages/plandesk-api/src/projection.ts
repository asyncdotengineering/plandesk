import {
  getProject,
  listDocuments,
  listEdges,
  listTasks,
  parseSharePermissions,
  parseSharePolicy,
  type Db,
  type Share,
} from '@plandesk/db';

export type SharePolicy = {
  tasks: 'all' | string[];
  documentIds: string[];
  fields: { assignee?: boolean; description?: boolean };
};

export type ClientViewTask = {
  id: string;
  label: string;
  status: string;
  due_date: string | null;
  x: number;
  y: number;
  description?: string | null;
  assignee?: string | null;
};

export type ClientView = {
  project: { id: string; name: string; description: string | null; updated_at: string };
  tasks: ClientViewTask[];
  edges: Array<{ id: string; from: string; to: string; label: string | null }>;
  documents: Array<{ id: string; title: string; body_html: string | null; updated_at: string }>;
  progress: Record<string, number>;
  share: {
    audience_name: string;
    permissions: { read: boolean; submit: boolean };
    expires_at: string | null;
  };
};

function buildProgress(tasks: ClientViewTask[]): Record<string, number> {
  const progress: Record<string, number> = {};
  for (const task of tasks) {
    progress[task.status] = (progress[task.status] ?? 0) + 1;
  }
  return progress;
}

export function buildClientView(db: Db, projectId: string, share: Share): ClientView | undefined {
  const project = getProject(db, projectId);
  if (!project) {
    return undefined;
  }

  const policy = parseSharePolicy(share);
  const permissions = parseSharePermissions(share);
  const allTasks = listTasks(db, projectId);

  const sharedTasks: ClientViewTask[] = [];
  for (const task of allTasks) {
    const included =
      policy.tasks === 'all' || (Array.isArray(policy.tasks) && policy.tasks.includes(task.id));
    if (!included) {
      continue;
    }

    const viewTask: ClientViewTask = {
      id: task.id,
      label: task.label,
      status: task.status,
      due_date: task.dueDate?.toISOString() ?? null,
      x: task.x,
      y: task.y,
    };

    if (policy.fields.description) {
      viewTask.description = task.description;
    }
    if (policy.fields.assignee) {
      viewTask.assignee = task.assignee;
    }

    sharedTasks.push(viewTask);
  }

  const sharedTaskIds = new Set(sharedTasks.map((task) => task.id));
  const sharedEdges = listEdges(db, projectId)
    .filter((edge) => sharedTaskIds.has(edge.fromTaskId) && sharedTaskIds.has(edge.toTaskId))
    .map((edge) => ({
      id: edge.id,
      from: edge.fromTaskId,
      to: edge.toTaskId,
      label: edge.label,
    }));

  const documentIdSet = new Set(policy.documentIds);
  const sharedDocuments = listDocuments(db, projectId)
    .filter((doc) => documentIdSet.has(doc.id))
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      body_html: doc.body,
      updated_at: doc.updatedAt.toISOString(),
    }));

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      updated_at: project.updatedAt.toISOString(),
    },
    tasks: sharedTasks,
    edges: sharedEdges,
    documents: sharedDocuments,
    progress: buildProgress(sharedTasks),
    share: {
      audience_name: share.audienceName,
      permissions,
      expires_at: share.expiresAt?.toISOString() ?? null,
    },
  };
}

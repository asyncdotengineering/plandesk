export const taskStatuses = ['scope', 'todo', 'in_progress', 'done', 'backlog'] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const edgeLabels = [
  'blocks',
  'depends_on',
  'unblocks',
  'feeds',
  'clarifies',
  'enables',
  'supports',
] as const;
export type EdgeLabel = (typeof edgeLabels)[number];
export const DEFAULT_EDGE_LABEL: EdgeLabel = 'depends_on';

export type TaskStatusSummary = Record<TaskStatus, number>;

export type SerializedProject = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type SerializedProjectDetail = SerializedProject & {
  summary: TaskStatusSummary;
};

export type SerializedTask = {
  id: string;
  project_id: string;
  label: string;
  status: TaskStatus;
  description: string | null;
  x: number;
  y: number;
  assignee: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

export type SerializedEdge = {
  id: string;
  project_id: string;
  from_task_id: string;
  to_task_id: string;
  label: string | null;
  arrow_direction: string | null;
  style: string | null;
  created_at: string;
};

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

export type CanvasResponse = {
  nodes: SerializedTask[];
  edges: SerializedEdge[];
  layout: unknown;
};

export type PutCanvasInput = {
  nodes: Array<{ id?: string; x: number; y: number; label?: string }>;
  edges: Array<{
    id?: string;
    from_task_id: string;
    to_task_id: string;
    label?: string | null;
    arrow_direction?: string | null;
    style?: string | null;
  }>;
  layout?: unknown;
};

export type CreateProjectInput = {
  name: string;
  description?: string | null;
};

export type CreateTaskInput = {
  label: string;
  status?: TaskStatus;
  description?: string | null;
  x?: number;
  y?: number;
  assignee?: string | null;
  due_date?: string | null;
};

export type PatchTaskInput = {
  status?: TaskStatus;
  label?: string;
  description?: string | null;
  x?: number;
  y?: number;
  assignee?: string | null;
  due_date?: string | null;
};

export type PatchProjectInput = {
  name?: string;
  description?: string | null;
};

export type CreateDocumentInput = {
  title: string;
  body?: string | null;
  status_line?: string | null;
  parent_id?: string | null;
  linked_task_id?: string | null;
};

export type PatchDocumentInput = {
  title?: string;
  body?: string | null;
  status_line?: string | null;
  parent_id?: string | null;
  linked_task_id?: string | null;
};

export type SerializedComment = {
  id: string;
  document_id: string;
  passage: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
};

export type CreateCommentInput = { body: string; passage?: string | null };
export type PatchCommentInput = { body?: string; resolved?: boolean };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`API error ${String(status)}: ${body}`);
    this.name = 'ApiError';
  }
}

const BASE = '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function listProjects(): Promise<SerializedProject[]> {
  return request('/projects');
}

export function createProject(input: CreateProjectInput): Promise<SerializedProject> {
  return request('/projects', { method: 'POST', body: JSON.stringify(input) });
}

export function getProject(id: string): Promise<SerializedProjectDetail> {
  return request(`/projects/${id}`);
}

export function listTasks(
  projectId: string,
  filter: { status?: TaskStatus } = {},
): Promise<SerializedTask[]> {
  const params = new URLSearchParams();
  if (filter.status !== undefined) {
    params.set('status', filter.status);
  }
  const query = params.toString();
  return request(`/projects/${projectId}/tasks${query ? `?${query}` : ''}`);
}

export function createTask(projectId: string, input: CreateTaskInput): Promise<SerializedTask> {
  return request(`/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function patchTask(id: string, input: PatchTaskInput): Promise<SerializedTask> {
  return request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteTask(id: string): Promise<void> {
  return request(`/tasks/${id}`, { method: 'DELETE' });
}

export function patchProject(id: string, input: PatchProjectInput): Promise<SerializedProject> {
  return request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteProject(id: string): Promise<void> {
  return request(`/projects/${id}`, { method: 'DELETE' });
}

export function getCanvas(projectId: string): Promise<CanvasResponse> {
  return request(`/projects/${projectId}/canvas`);
}

export function putCanvas(projectId: string, input: PutCanvasInput): Promise<CanvasResponse> {
  return request(`/projects/${projectId}/canvas`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function listDocuments(projectId: string): Promise<SerializedDocumentTree[]> {
  return request(`/projects/${projectId}/documents`);
}

export function createDocument(
  projectId: string,
  input: CreateDocumentInput,
): Promise<SerializedDocument> {
  return request(`/projects/${projectId}/documents`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getDocument(id: string): Promise<SerializedDocument> {
  return request(`/documents/${id}`);
}

export function patchDocument(id: string, input: PatchDocumentInput): Promise<SerializedDocument> {
  return request(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteDocument(id: string): Promise<void> {
  return request(`/documents/${id}`, { method: 'DELETE' });
}

export function listDocumentComments(
  documentId: string,
  opts?: { includeResolved?: boolean },
): Promise<SerializedComment[]> {
  const params = new URLSearchParams();
  if (opts?.includeResolved === true) {
    params.set('include_resolved', 'true');
  }
  const query = params.toString();
  return request(`/documents/${documentId}/comments${query ? `?${query}` : ''}`);
}

export function createComment(
  documentId: string,
  input: CreateCommentInput,
): Promise<SerializedComment> {
  return request(`/documents/${documentId}/comments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function patchComment(id: string, input: PatchCommentInput): Promise<SerializedComment> {
  return request(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteComment(id: string): Promise<void> {
  return request(`/comments/${id}`, { method: 'DELETE' });
}

export function deleteEdge(projectId: string, edgeId: string): Promise<void> {
  return request(`/projects/${projectId}/edges/${edgeId}`, { method: 'DELETE' });
}

export function getTaskDocument(taskId: string): Promise<SerializedDocument> {
  return request(`/tasks/${taskId}/document`);
}

export type SerializedMcpToken = {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
};

export type CreateMcpTokenResponse = SerializedMcpToken & {
  token: string;
};

export function listMcpTokens(): Promise<SerializedMcpToken[]> {
  return request('/mcp-tokens');
}

export function createMcpToken(name: string): Promise<CreateMcpTokenResponse> {
  return request('/mcp-tokens', { method: 'POST', body: JSON.stringify({ name }) });
}

export function revokeMcpToken(id: string): Promise<void> {
  return request(`/mcp-tokens/${id}`, { method: 'DELETE' });
}

export type SerializedAgentRunEvent = {
  id: string;
  message: string;
  created_at: string;
};

export type SerializedAgentRun = {
  id: string;
  project_id: string;
  status: 'running' | 'completed' | 'failed';
  label: string | null;
  started_at: string;
  completed_at: string | null;
  events: SerializedAgentRunEvent[];
};

export function listAgentRuns(projectId: string): Promise<SerializedAgentRun[]> {
  return request(`/projects/${projectId}/agent-runs`);
}

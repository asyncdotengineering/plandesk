// One definition, imported — not mirrored. `@plandesk/db/vocabulary` is a
// browser-safe subpath holding nothing but these enums, so the bundle gets the
// same constants the database orders by. A local copy would agree today and
// drift later, ordering the UI differently from the data.
// Imported *and* re-exported: `export … from` alone re-exports without binding
// the names locally, and SerializedTask below refers to TaskPriority in this
// module's own scope.
import type { SavedViewConfig } from '@plandesk/db/saved-view-config';
import {
  taskStatuses,
  taskPriorities,
  taskPriorityOrder,
  linkEntityTypes,
  taskEdgeLabels,
  documentEdgeLabels,
  edgeLabels,
  DEFAULT_EDGE_LABEL,
  isTaskEdgeLabel,
  isDocumentEdgeLabel,
  type TaskStatus,
  type TaskPriority,
  type LinkEntityType,
  type TaskEdgeLabel,
  type DocumentEdgeLabel,
  type EdgeLabel,
} from '@plandesk/db/vocabulary';

export {
  taskStatuses,
  taskPriorities,
  taskPriorityOrder,
  linkEntityTypes,
  taskEdgeLabels,
  documentEdgeLabels,
  edgeLabels,
  DEFAULT_EDGE_LABEL,
  isTaskEdgeLabel,
  isDocumentEdgeLabel,
};
export type { TaskStatus, TaskPriority, LinkEntityType, TaskEdgeLabel, DocumentEdgeLabel, EdgeLabel };
export type { SavedViewConfig };

export type SerializedView = {
  id: string;
  project_id: string;
  name: string;
  config: SavedViewConfig;
  position: number;
  created_at: string;
  updated_at: string;
};

export type CreateViewInput = {
  name: string;
  config: SavedViewConfig;
  position?: number;
};

export type PatchViewInput = {
  name?: string;
  config?: SavedViewConfig;
  position?: number;
};

// `edgeLabels` is every label the database accepts; `taskEdgeLabels` and
// `documentEdgeLabels` are the two halves. All three come from the one
// definition — this module used to declare the halves locally, which is how the
// canvas came to reject labels the database happily stores.
export const DEFAULT_DOCUMENT_EDGE_LABEL: DocumentEdgeLabel = 'documents';

export type TaskStatusSummary = Record<TaskStatus, number>;

/** Mirrors the org role ladder the API enforces (low → high). */
export const orgRoles = ['viewer', 'commenter', 'editor', 'manager', 'owner'] as const;
export type OrgRole = (typeof orgRoles)[number];

export type SerializedProject = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string | null;
  overview_document_id: string | null;
  repo_url: string | null;
  folder_path: string | null;
  /** The workspace (better-auth team) the project belongs to. */
  workspace_id: string;
  created_at: string;
  updated_at: string;
};

export type SerializedProjectDetail = SerializedProject & {
  summary: TaskStatusSummary;
};

export type SerializedTag = {
  id: string;
  project_id: string;
  name: string;
  color: string | null;
  created_at: string;
};

export type SerializedTask = {
  id: string;
  project_id: string;
  goal_id: string;
  label: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  lane?: string | null;
  severity?: string | null;
  description: string | null;
  x: number;
  y: number;
  assignee: string | null;
  due_date: string | null;
  commit_refs: string[];
  created_at: string;
  updated_at: string;
  // Present on task endpoints; canvas nodes omit it.
  tags?: SerializedTag[];
  // Derived on list: unfinished prerequisite task ids from sequencing edges.
  blocked?: boolean;
  waiting_on?: string[];
};

export type SerializedEdge = {
  id: string;
  project_id: string;
  from_type: LinkEntityType;
  from_id: string;
  to_type: LinkEntityType;
  to_id: string;
  label: string | null;
  arrow_direction: string | null;
  style: string | null;
  created_at: string;
};

/** One graph neighbour of a document (or a task, via the backlinks read path). */
export type SerializedEntityLink = {
  type: LinkEntityType;
  id: string;
  title: string;
  label: string | null;
  edge_id: string;
};

export type SerializedDocument = {
  id: string;
  project_id: string;
  title: string;
  body: string | null;
  status_line: string | null;
  parent_id: string | null;
  folder_id: string | null;
  /** Outgoing edges from this document. */
  links: SerializedEntityLink[];
  /** Incoming edges to this document. */
  backlinks: SerializedEntityLink[];
  created_at: string;
  updated_at: string;
};

export type SerializedFolder = {
  id: string;
  project_id: string;
  name: string;
  parent_folder_id: string | null;
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
  owner_id?: string | null;
  repo_url?: string | null;
  folder_path?: string | null;
  /** Workspace to create the project in; defaults to the org's default workspace. */
  workspace_id?: string;
};

export type CreateTaskInput = {
  label: string;
  status?: TaskStatus;
  priority?: TaskPriority | null;
  description?: string | null;
  x?: number;
  y?: number;
  assignee?: string | null;
  due_date?: string | null;
  // Goal this task belongs to; omit to attach to the project default goal.
  goal_id?: string;
  // Sets the task's tags by name; unknown names are auto-created.
  tags?: string[];
};

export type PatchTaskInput = {
  status?: TaskStatus;
  priority?: TaskPriority | null;
  label?: string;
  description?: string | null;
  x?: number;
  y?: number;
  assignee?: string | null;
  due_date?: string | null;
  // Replaces the task's FULL tag set by name; unknown names are auto-created.
  tags?: string[];
  // Replaces the FULL commit_refs array; null clears. Omit to leave unchanged.
  commit_refs?: string[] | null;
};

export type CreateTagInput = {
  name: string;
  color?: string | null;
};

export type PatchTagInput = {
  name?: string;
  color?: string | null;
};

export type PatchProjectInput = {
  name?: string;
  description?: string | null;
  owner_id?: string | null;
  overview_document_id?: string | null;
  repo_url?: string | null;
  folder_path?: string | null;
  /** Move the project to another workspace (owner-gated on the server). */
  workspace_id?: string;
};

export type CreateDocumentInput = {
  title: string;
  body?: string | null;
  status_line?: string | null;
  parent_id?: string | null;
  folder_id?: string | null;
};

export type PatchDocumentInput = {
  title?: string;
  body?: string | null;
  status_line?: string | null;
  parent_id?: string | null;
  folder_id?: string | null;
};

export type CreateEdgeInput = {
  from_type: LinkEntityType;
  from_id: string;
  to_type: LinkEntityType;
  to_id: string;
  label?: string | null;
  style?: string | null;
  arrow_direction?: string | null;
};

export type CreateFolderInput = {
  name: string;
  parent_folder_id?: string | null;
};

export type PatchFolderInput = {
  name?: string;
  parent_folder_id?: string | null;
};

export type SerializedNote = {
  id: string;
  project_id: string;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
};

/** Summary row from GET /projects/:id/artifacts — enough for the link picker. */
export type SerializedArtifactSummary = {
  id: string;
  title: string;
  kind: 'markdown' | 'html';
  updated_at: string;
};

/** Full artifact from GET /artifacts/:id or nested under a prototype. */
export type SerializedArtifact = {
  id: string;
  project_id: string;
  title: string;
  kind: 'markdown' | 'html';
  content: string;
  prototype_id: string | null;
  x: number | null;
  y: number | null;
  revision_id: string;
  created_at: string;
  updated_at: string;
};

export type SerializedPrototype = {
  id: string;
  project_id: string;
  name: string;
  viewport_width: number;
  viewport_height: number;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SerializedPrototypeLink = {
  id: string;
  project_id: string;
  from_artifact_id: string;
  to_artifact_id: string | null;
  raw_target: string;
};

export type SerializedPrototypeBoundaryLink = {
  direction: 'exit' | 'arrive';
  link_id: string;
  local_artifact_id: string;
  foreign_artifact_id: string;
  foreign_title: string;
  foreign_prototype_id: string;
  foreign_prototype_name: string;
  raw_target: string;
};

export type FlowCoverage = {
  parseable: boolean;
  parse_error: string | null;
  planned: string[];
  built: string[];
  missing: string[];
  unplanned: string[];
  states_unverified: { screen: string; states: string[] }[];
  unplanned_note: string | null;
};

export type SerializedPrototypeWithScreens = SerializedPrototype & {
  screens: SerializedArtifact[];
  links: SerializedPrototypeLink[];
  boundary_links: SerializedPrototypeBoundaryLink[];
  coverage: FlowCoverage;
};

export type PatchArtifactInput = {
  title?: string;
  kind?: 'markdown' | 'html';
  content?: string;
  prototype_id?: string | null;
  x?: number | null;
  y?: number | null;
};

export type CreateNoteInput = {
  title: string;
  body?: string | null;
};

export type PatchNoteInput = {
  title?: string;
  body?: string | null;
};

export type SerializedComment = {
  id: string;
  document_id: string | null;
  target_type?: string;
  target_id?: string;
  passage: string | null;
  anchor: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
};

export type CommentTargetType = 'document' | 'task' | 'note' | 'submission' | 'artifact';
export type CommentTarget =
  | { type: 'document' | 'task' | 'note' | 'submission'; id: string }
  | { type: 'artifact'; id: string; projectId: string }
  | { type: 'portal-artifact'; id: string; shareToken: string; sessionToken: string };

export type CreateCommentInput = {
  body: string;
  passage?: string | null;
  anchor?: string | null;
};
export type PatchCommentInput = { body?: string; resolved?: boolean };

function commentCollectionPath(target: CommentTarget): string {
  if (target.type === 'artifact') {
    return `/projects/${target.projectId}/artifact-comments`;
  }
  if (target.type === 'portal-artifact') {
    return `/share/${encodeURIComponent(target.shareToken)}/artifact-comments`;
  }
  return `/${target.type}s/${target.id}/comments`;
}

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
  // The session cookie is HttpOnly, so it only rides along when we opt in.
  const response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
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

export type SearchResults = {
  documents: Array<{ id: string; project_id: string; title: string }>;
  tasks: Array<{ id: string; project_id: string; label: string }>;
  notes: Array<{ id: string; project_id: string; title: string }>;
};

export function searchWorkspace(
  query: string,
  opts: { projectId?: string; workspaceId?: string; limit?: number } = {},
): Promise<SearchResults> {
  const params = new URLSearchParams({ q: query });
  if (opts.projectId !== undefined) {
    params.set('project_id', opts.projectId);
  }
  if (opts.workspaceId !== undefined) {
    params.set('workspace_id', opts.workspaceId);
  }
  if (opts.limit !== undefined) {
    params.set('limit', String(opts.limit));
  }
  const headers = new Headers();
  if (opts.workspaceId !== undefined) {
    headers.set('x-plandesk-workspace-id', opts.workspaceId);
  }
  return request(`/search?${params.toString()}`, { headers });
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

export type ExportFormat = 'csv' | 'xlsx';

/**
 * Download a list-view report. The server re-runs the view query; the client
 * sends view state, not rows.
 */
export async function exportProjectView(
  projectId: string,
  input: { format: ExportFormat; view: SavedViewConfig },
): Promise<{ blob: Blob; filename: string }> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const response = await fetch(`${BASE}/projects/${projectId}/export`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `export.${input.format}`;
  return { blob: await response.blob(), filename };
}

export function listProjectViews(projectId: string): Promise<SerializedView[]> {
  return request(`/projects/${projectId}/views`);
}

export function createProjectView(
  projectId: string,
  input: CreateViewInput,
): Promise<SerializedView> {
  return request(`/projects/${projectId}/views`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function patchView(id: string, input: PatchViewInput): Promise<SerializedView> {
  return request(`/views/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteView(id: string): Promise<void> {
  return request(`/views/${id}`, { method: 'DELETE' });
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

/** Target kinds that carry content history (authored fields only). */
export type RevisionTargetType = 'task' | 'document' | 'artifact';

/** Metadata-only list row — no snapshot (panel opens cheaply). */
export type SerializedRevisionMeta = {
  id: string;
  author: string;
  changed_fields: string[];
  created_at: string;
};

export type SerializedRevision = SerializedRevisionMeta & {
  target_type: RevisionTargetType;
  target_id: string;
  snapshot: Record<string, unknown>;
};

export type RevisionDiffHunk = {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: string[];
};

export type RevisionFieldDiff = {
  field: string;
  hunks: RevisionDiffHunk[];
};

export function listRevisions(
  projectId: string,
  targetType: RevisionTargetType,
  targetId: string,
): Promise<SerializedRevisionMeta[]> {
  const params = new URLSearchParams({
    target_type: targetType,
    target_id: targetId,
  });
  return request(`/projects/${projectId}/revisions?${params.toString()}`);
}

export function getRevision(id: string): Promise<SerializedRevision> {
  return request(`/revisions/${id}`);
}

/** Server-side Markdown-projection diff. Pass `current` to compare against the live row. */
export function diffRevision(id: string, against: string): Promise<RevisionFieldDiff[]> {
  const params = new URLSearchParams({ against });
  return request(`/revisions/${id}/diff?${params.toString()}`);
}

/** Restore versioned fields through the ordinary update path; returns the live entity. */
export function restoreRevision(id: string): Promise<SerializedTask | SerializedDocument> {
  return request(`/revisions/${id}/restore`, { method: 'POST' });
}

export type ShareTtl = '24h' | '7d' | 'never';

export type ShareLinkResult = {
  url: string;
  markdown_url: string;
  expires_at: string | null;
};

export function createTaskShare(
  id: string,
  expires: ShareTtl,
  submit = false,
): Promise<ShareLinkResult> {
  return request(`/tasks/${id}/share`, {
    method: 'POST',
    body: JSON.stringify({ expires, submit }),
  });
}

export function createDocumentShare(
  id: string,
  expires: ShareTtl,
  submit = false,
): Promise<ShareLinkResult> {
  return request(`/documents/${id}/share`, {
    method: 'POST',
    body: JSON.stringify({ expires, submit }),
  });
}

export function createPrototypeShare(
  id: string,
  expires: ShareTtl,
  submit = false,
): Promise<ShareLinkResult> {
  return request(`/prototypes/${id}/share`, {
    method: 'POST',
    body: JSON.stringify({ expires, submit }),
  });
}

export type WorkspaceShareInput = {
  audience_name: string;
  mode?: 'invite' | 'public';
  submit?: boolean;
  invited_emails?: string[];
};

export type WorkspaceShareResult = {
  url: string;
  token: string;
};

/** Share an entire workspace (all its projects) with a client via the portal. */
export function createWorkspaceShare(
  workspaceId: string,
  input: WorkspaceShareInput,
): Promise<WorkspaceShareResult> {
  return request(`/workspaces/${workspaceId}/share`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listTags(projectId: string): Promise<SerializedTag[]> {
  return request(`/projects/${projectId}/tags`);
}

export function createTag(projectId: string, input: CreateTagInput): Promise<SerializedTag> {
  return request(`/projects/${projectId}/tags`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Renaming propagates to every task carrying the tag (single tag row).
export function patchTag(id: string, input: PatchTagInput): Promise<SerializedTag> {
  return request(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

// Deleting a tag removes it from all its tasks (cascade on the join table).
export function deleteTag(id: string): Promise<void> {
  return request(`/tags/${id}`, { method: 'DELETE' });
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

export type ConvertBulletsResult = {
  created: SerializedTask[];
  skipped: string[];
};

/** Create scope tasks from selected document bullet labels; body is unchanged. */
export function convertDocumentBullets(
  id: string,
  labels: string[],
): Promise<ConvertBulletsResult> {
  return request(`/documents/${id}/convert-bullets`, {
    method: 'POST',
    body: JSON.stringify({ labels }),
  });
}

export type UploadedFile = {
  id: string;
  url: string;
  filename: string;
  mime: string;
  size: number;
};

export function uploadFile(
  projectId: string,
  input: { filename: string; mime: string; content_base64: string },
): Promise<UploadedFile> {
  return request(`/projects/${projectId}/files`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listFolders(projectId: string): Promise<SerializedFolder[]> {
  return request(`/projects/${projectId}/folders`);
}

export function createFolder(
  projectId: string,
  input: CreateFolderInput,
): Promise<SerializedFolder> {
  return request(`/projects/${projectId}/folders`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function patchFolder(id: string, input: PatchFolderInput): Promise<SerializedFolder> {
  return request(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteFolder(id: string): Promise<void> {
  return request(`/folders/${id}`, { method: 'DELETE' });
}

export function listNotes(projectId: string): Promise<SerializedNote[]> {
  return request(`/projects/${projectId}/notes`);
}

export function listArtifacts(projectId: string): Promise<SerializedArtifactSummary[]> {
  return request(`/projects/${projectId}/artifacts`);
}

export function listPrototypes(projectId: string): Promise<SerializedPrototype[]> {
  return request(`/projects/${projectId}/prototypes`);
}

export function getPrototype(id: string): Promise<SerializedPrototypeWithScreens> {
  return request(`/prototypes/${id}`);
}

export function getArtifact(id: string): Promise<SerializedArtifact> {
  return request(`/artifacts/${id}`);
}

export function patchArtifact(id: string, input: PatchArtifactInput): Promise<SerializedArtifact> {
  return request(`/artifacts/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function moveScreen(id: string, prototypeId: string): Promise<SerializedArtifact> {
  return request(`/artifacts/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ prototype_id: prototypeId }),
  });
}

export function copyScreen(id: string, prototypeId: string): Promise<SerializedArtifact> {
  return request(`/artifacts/${id}/copy`, {
    method: 'POST',
    body: JSON.stringify({ prototype_id: prototypeId }),
  });
}

export function createNote(projectId: string, input: CreateNoteInput): Promise<SerializedNote> {
  return request(`/projects/${projectId}/notes`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getNote(id: string): Promise<SerializedNote> {
  return request(`/notes/${id}`);
}

export function patchNote(id: string, input: PatchNoteInput): Promise<SerializedNote> {
  return request(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteNote(id: string): Promise<void> {
  return request(`/notes/${id}`, { method: 'DELETE' });
}

export function listComments(
  target: CommentTarget,
  opts?: { includeResolved?: boolean },
): Promise<SerializedComment[]> {
  const params = new URLSearchParams();
  if (opts?.includeResolved === true) {
    params.set('include_resolved', 'true');
  }
  if (target.type === 'artifact' || target.type === 'portal-artifact') {
    params.set('artifact_id', target.id);
  }
  const query = params.toString();
  if (target.type === 'portal-artifact') {
    return requestPortalArtifactComments(
      `${commentCollectionPath(target)}${query ? `?${query}` : ''}`,
      target.sessionToken,
    );
  }
  return request(`${commentCollectionPath(target)}${query ? `?${query}` : ''}`);
}

export function createComment(
  target: CommentTarget,
  input: CreateCommentInput,
): Promise<SerializedComment> {
  const body =
    target.type === 'artifact' || target.type === 'portal-artifact'
      ? { artifact_id: target.id, ...input }
      : input;
  if (target.type === 'portal-artifact') {
    return requestPortalArtifactComments(commentCollectionPath(target), target.sessionToken, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  return request(commentCollectionPath(target), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function requestPortalArtifactComments<T>(
  path: string,
  sessionToken: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${sessionToken}`);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return response.json() as Promise<T>;
}

export function patchComment(id: string, input: PatchCommentInput): Promise<SerializedComment> {
  return request(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteComment(id: string): Promise<void> {
  return request(`/comments/${id}`, { method: 'DELETE' });
}

export function createEdge(projectId: string, input: CreateEdgeInput): Promise<SerializedEdge> {
  return request(`/projects/${projectId}/edges`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteEdge(projectId: string, edgeId: string): Promise<void> {
  return request(`/projects/${projectId}/edges/${edgeId}`, { method: 'DELETE' });
}

export function listTaskBacklinks(taskId: string): Promise<SerializedEntityLink[]> {
  return request(`/tasks/${taskId}/backlinks`);
}

export function getTaskDocument(taskId: string): Promise<SerializedDocument> {
  return request(`/tasks/${taskId}/document`);
}

/** Session-minted org-wide owner key for `plandesk login` (BA4b-2). Shown once. */
export type CreateCliTokenResponse = {
  token: string;
  org_id: string;
  org_name: string;
};

export function createCliToken(name?: string): Promise<CreateCliTokenResponse> {
  return request('/auth/cli-token', {
    method: 'POST',
    body: JSON.stringify(name === undefined ? {} : { name }),
  });
}

/** Invite roles the dashboard may mint (owner bootstrap is CLI-only). */
export const inviteRoles = ['admin', 'member'] as const;
export type InviteRole = (typeof inviteRoles)[number];

export type SerializedOrgMember = {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
};

export type ListOrgMembersResponse = {
  members: SerializedOrgMember[];
};

export type CreateInvitationResponse = {
  invitationId: string;
  claimUrl: string;
};

export function listOrgMembers(orgId: string): Promise<ListOrgMembersResponse> {
  return request(`/orgs/${orgId}/members`);
}

export function createOrgInvitation(
  orgId: string,
  input: { email: string; role: InviteRole; teamId: string },
): Promise<CreateInvitationResponse> {
  return request(`/orgs/${orgId}/invitations`, {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      role: input.role,
      team_id: input.teamId,
    }),
  });
}

/** Invitation claim page: preview (org/workspace/role/email) + accept. */
export type InvitationPreview = {
  organizationId: string;
  organizationName: string;
  /** Workspace (team) the invitee will join; null only for legacy rows. */
  workspaceId: string | null;
  workspaceName: string;
  role: string;
  email: string;
  status: string;
  expiresAt: string;
};

export function fetchInvitation(invitationId: string): Promise<InvitationPreview> {
  return request(`/invitations/${invitationId}`);
}

export type AcceptInvitationResponse = {
  invitationId: string;
  organizationId: string;
  role: string;
  userId: string;
  /** Workspace (team) the invitee joined; null for legacy team-less invites. */
  teamId: string | null;
};

export function acceptInvitation(invitationId: string): Promise<AcceptInvitationResponse> {
  return request(`/invitations/${invitationId}/accept`, { method: 'POST' });
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

export const submissionStatuses = ['pending', 'accepted', 'rejected'] as const;
export type SubmissionStatus = (typeof submissionStatuses)[number];

export type SerializedSubmission = {
  id: string;
  project_id: string;
  hosted_share_id: string;
  participant_name: string;
  title: string;
  body: string | null;
  severity: string | null;
  task_ref: string | null;
  status: SubmissionStatus;
  created_at: string;
  pulled_at: string;
};

export type TriageSubmissionInput = {
  action: 'accept' | 'reject';
  as_task?: { label?: string; description?: string | null };
  // Reserved for merge-into; not yet honored by the server (see api's
  // submissions route) — accepted here so the UI wiring doesn't need to
  // change once the server supports it.
  link_task_id?: string;
};

export function listSubmissions(
  projectId: string,
  status: SubmissionStatus = 'pending',
): Promise<SerializedSubmission[]> {
  return request(`/projects/${projectId}/submissions?status=${status}`);
}

export function triageSubmission(
  id: string,
  input: TriageSubmissionInput,
): Promise<SerializedSubmission> {
  return request(`/submissions/${id}/triage`, { method: 'POST', body: JSON.stringify(input) });
}

export const goalStatuses = ['active', 'paused', 'complete', 'blocked'] as const;
export type GoalStatus = (typeof goalStatuses)[number];

export type SerializedLastVerification = {
  at: string;
  green: boolean;
  kind: string | null;
  detail?: string;
};

export type SerializedGoal = {
  id: string;
  project_id: string;
  name: string | null;
  objective: string;
  status: GoalStatus;
  verification_surface: string | null;
  constraints: string | null;
  boundaries: string | null;
  iteration_policy: string | null;
  stop_condition: string | null;
  budget: string | null;
  last_verification: SerializedLastVerification | null;
  created_at: string;
  updated_at: string;
};

export type SerializedGoalDetail = SerializedGoal & {
  cycle_tasks: SerializedTask[];
};

export type CreateGoalInput = {
  name?: string | null;
  objective: string;
  verification_surface?: string | null;
  constraints?: string | null;
  boundaries?: string | null;
  iteration_policy?: string | null;
  stop_condition?: string | null;
  budget?: string | null;
};

export type PatchGoalInput = {
  name?: string | null;
  objective?: string;
  verification_surface?: string | null;
  constraints?: string | null;
  boundaries?: string | null;
  iteration_policy?: string | null;
  stop_condition?: string | null;
  budget?: string | null;
};

export type VerificationEvidence =
  | { kind: 'gate_command'; exit_code: number; stdout?: string; stderr?: string }
  | { kind: 'acceptance_checklist'; checked: string[] }
  | { kind: 'human_sign_off'; approved_by: string };

export function listGoals(projectId: string): Promise<SerializedGoal[]> {
  return request(`/projects/${projectId}/goals`);
}

export function getGoal(goalId: string): Promise<SerializedGoalDetail> {
  return request(`/goals/${goalId}`);
}

export function createGoal(projectId: string, input: CreateGoalInput): Promise<SerializedGoal> {
  return request(`/projects/${projectId}/goals`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function patchGoal(goalId: string, input: PatchGoalInput): Promise<SerializedGoal> {
  return request(`/goals/${goalId}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function pauseGoal(goalId: string): Promise<SerializedGoal> {
  return request(`/goals/${goalId}/pause`, { method: 'POST' });
}

export function resumeGoal(goalId: string): Promise<SerializedGoal> {
  return request(`/goals/${goalId}/resume`, { method: 'POST' });
}

export function completeGoal(
  goalId: string,
  evidence?: VerificationEvidence,
): Promise<SerializedGoal> {
  return request(`/goals/${goalId}/complete`, {
    method: 'POST',
    body: JSON.stringify(evidence !== undefined ? { evidence } : {}),
  });
}

export type AuthKind = 'session' | 'token' | 'loopback' | 'apikey';

export type SerializedAuthSession = {
  kind: AuthKind;
  user_ref: string | null;
  role: OrgRole;
  org: { id: string; name: string } | null;
  orgs: Array<{ id: string; name: string; role: string }>;
  /** The active workspace (better-auth team) for the nav switcher + project filter. */
  active_workspace: { id: string; name: string } | null;
  /** Workspaces (better-auth teams) in the active org. */
  workspaces: Array<{ id: string; name: string }>;
};

export type SerializedAuthMethods = {
  /** Always token/paste after BA7-1a (device flow removed). */
  method: 'token';
  githubEnabled: boolean;
};

/**
 * Who the caller is. Throws ApiError(401) when there is no session — that is
 * the dashboard's cue to show sign-in rather than an error.
 */
export function getAuthSession(): Promise<SerializedAuthSession> {
  return request('/auth/session');
}

/** Persist the browser's active organization through Better Auth. */
export async function setActiveOrganization(organizationId: string): Promise<void> {
  const response = await fetch('/api/auth/organization/set-active', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
}

/**
 * A workspace is Plan Desk's name for a Better Auth team. These helpers talk to
 * the better-auth organization/team endpoints directly (mounted at
 * `/api/auth/organization/*`), exactly like `setActiveOrganization` above.
 */
export type Workspace = {
  id: string;
  name: string;
};

export type WorkspaceMember = {
  id: string;
  teamId: string;
  userId: string;
  createdAt: string;
};

async function postTeamEndpoint(path: string, body: unknown): Promise<Response> {
  const response = await fetch(`/api/auth/organization/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return response;
}

/** The active org id from the session (works for loopback + hosted). */
async function activeOrgId(): Promise<string | undefined> {
  const session = await request<{ org: { id: string } | null }>('/auth/session');
  return session.org?.id ?? undefined;
}

/**
 * Persist the browser's active workspace. better-auth's set-active-team needs a
 * real session; a LOCAL loopback caller has none, so a 401 there is expected and
 * harmless (loopback's active workspace is resolved server-side). Swallow it.
 */
export async function setActiveWorkspace(teamId: string): Promise<void> {
  try {
    await postTeamEndpoint('set-active-team', { teamId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return;
    throw error;
  }
}

/**
 * List the active org's workspaces via the plandesk REST endpoint, which handles
 * loopback owner + session + owner keys (better-auth list-teams is session-only
 * and 401s on a local loopback board).
 */
export async function listWorkspaces(): Promise<Workspace[]> {
  const orgId = await activeOrgId();
  if (orgId === undefined) return [];
  const body = await request<{ workspaces: Workspace[] }>(
    `/orgs/${encodeURIComponent(orgId)}/workspaces`,
  );
  return body.workspaces;
}

/** Create a workspace in the active org via the plandesk REST endpoint (loopback-ok). */
export async function createWorkspace(name: string): Promise<Workspace> {
  const orgId = await activeOrgId();
  if (orgId === undefined) throw new ApiError(400, 'No active organization');
  return request<Workspace>(`/orgs/${encodeURIComponent(orgId)}/workspaces`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** Rename a workspace (better-auth team). */
export async function renameWorkspace(teamId: string, name: string): Promise<Workspace> {
  const response = await postTeamEndpoint('update-team', { teamId, data: { name } });
  const team = (await response.json()) as { id: string; name: string } | null;
  if (team === null) {
    throw new ApiError(404, 'workspace not found');
  }
  return { id: team.id, name: team.name };
}

/** Delete a workspace (better-auth team). */
export async function deleteWorkspace(teamId: string): Promise<void> {
  await postTeamEndpoint('remove-team', { teamId });
}

/** List the members of a workspace (better-auth team). */
export async function listWorkspaceMembers(teamId: string): Promise<WorkspaceMember[]> {
  const params = new URLSearchParams({ teamId });
  const response = await fetch(`/api/auth/organization/list-team-members?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  const members = (await response.json()) as Array<{
    id: string;
    teamId: string;
    userId: string;
    createdAt: string;
  }>;
  return members.map((member) => ({
    id: member.id,
    teamId: member.teamId,
    userId: member.userId,
    createdAt: member.createdAt,
  }));
}

/** Add an org member to a workspace (better-auth team). */
export async function addWorkspaceMember(teamId: string, userId: string): Promise<void> {
  await postTeamEndpoint('add-team-member', { teamId, userId });
}

/** Remove a member from a workspace (better-auth team). */
export async function removeWorkspaceMember(teamId: string, userId: string): Promise<void> {
  await postTeamEndpoint('remove-team-member', { teamId, userId });
}

/** Move a project to another workspace (owner-gated on the server). */
export function moveProject(projectId: string, workspaceId: string): Promise<SerializedProject> {
  return request(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
}

/** Whether this instance offers GitHub sign-in, or token entry only (REQ-20). */
export function getAuthMethods(): Promise<SerializedAuthMethods> {
  return request('/auth/methods');
}

/** better-auth sign-out (BA7-1a; hand-rolled /auth/logout is gone). */
export async function logout(): Promise<{ ok: boolean }> {
  const res = await fetch('/api/auth/sign-out', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }
  return { ok: true };
}

/**
 * better-auth social sign-in (BA4c). POST → `{ url, redirect }` → browser leaves
 * the SPA for GitHub. Mounted at `/api/auth/*`, not under `/api/v1`.
 */
export const BETTER_AUTH_GITHUB_SIGN_IN_PATH = '/api/auth/sign-in/social';

export type SocialSignInResponse = {
  url: string;
  redirect: boolean;
};

/**
 * Start GitHub OAuth via better-auth. Returns the authorize URL the browser
 * must navigate to (caller assigns `window.location`).
 */
export async function startGithubSignIn(callbackURL = '/'): Promise<SocialSignInResponse> {
  const response = await fetch(BETTER_AUTH_GITHUB_SIGN_IN_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ provider: 'github', callbackURL }),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('url' in body) ||
    typeof body.url !== 'string' ||
    body.url.length === 0
  ) {
    throw new Error('better-auth sign-in/social did not return a url');
  }
  return {
    url: body.url,
    redirect: 'redirect' in body && body.redirect === true,
  };
}

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
  prototypes?: ClientViewPrototype[];
  progress: Record<string, number>;
  share: {
    audience_name: string;
    permissions: { read: boolean; submit: boolean };
    expires_at: string | null;
  };
};

export type ClientViewPrototype = {
  id: string;
  name: string;
  viewport_width: number;
  viewport_height: number;
  screens: Array<{
    id: string;
    title: string;
    kind: string;
    content: string;
    x: number | null;
    y: number | null;
    revision_id: string;
  }>;
  links: Array<{
    id: string;
    from_artifact_id: string;
    to_artifact_id: string | null;
    raw_target: string;
  }>;
};

export type WorkspaceClientView = {
  kind: 'workspace';
  workspace: { id: string; name: string };
  projects: Array<{ id: string; name: string; view: ClientView }>;
  share: {
    audience_name: string;
    permissions: { read: boolean; submit: boolean };
    expires_at: string | null;
  };
};

export type AnyClientView = ClientView | WorkspaceClientView;

export type JoinShareResult = {
  session_token: string;
  participant: { id: string; name: string };
  share: {
    audience_name: string;
    permissions: { read: boolean; submit: boolean };
  };
};

type PortalViewResponse = (ClientView | WorkspaceClientView) & {
  audience_name?: string;
  permissions?: { read: boolean; submit: boolean };
};

/** API base for portal join/meta/view/submissions (plandesk-api). Empty = same origin. */
const API_BASE = import.meta.env.VITE_API_URL ?? '';

function portalSessionKey(shareToken: string): string {
  return `plandesk_portal_session_${shareToken}`;
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export class PortalUnauthorizedError extends Error {
  constructor() {
    super('This share link is invalid, expired, or has been revoked.');
    this.name = 'PortalUnauthorizedError';
  }
}

export class PortalNotReadyError extends Error {
  constructor() {
    super('This project has not been published to the portal yet.');
    this.name = 'PortalNotReadyError';
  }
}

export class PortalJoinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalJoinError';
  }
}

export class PortalEmailNotInvitedError extends Error {
  constructor() {
    super("That email isn't on the invite list for this share.");
    this.name = 'PortalEmailNotInvitedError';
  }
}

export type PortalSubmission = {
  id: string;
  title: string;
  severity: string | null;
  status: string;
  created_at: string;
};

export class PortalSubmitForbiddenError extends Error {
  constructor() {
    super('This share does not allow submitting issues.');
    this.name = 'PortalSubmitForbiddenError';
  }
}

export class PortalRateLimitedError extends Error {
  constructor() {
    super("You're sending these too fast — try again in a moment.");
    this.name = 'PortalRateLimitedError';
  }
}

export class PortalSubmitFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalSubmitFieldError';
  }
}

export type ShareMeta = {
  audience_name: string;
  mode: 'invite' | 'public';
};

export function loadPortalSession(shareToken: string): string | null {
  if (!isBrowserStorageAvailable()) {
    return null;
  }
  return window.localStorage.getItem(portalSessionKey(shareToken));
}

export function savePortalSession(shareToken: string, token: string): void {
  if (!isBrowserStorageAvailable()) {
    return;
  }
  window.localStorage.setItem(portalSessionKey(shareToken), token);
}

export function clearPortalSession(shareToken: string): void {
  if (!isBrowserStorageAvailable()) {
    return;
  }
  window.localStorage.removeItem(portalSessionKey(shareToken));
}

function isWorkspaceClientView(raw: PortalViewResponse): raw is WorkspaceClientView & {
  audience_name?: string;
  permissions?: { read: boolean; submit: boolean };
} {
  return 'kind' in raw && (raw as { kind?: string }).kind === 'workspace';
}

function normalizePortalResponse(raw: PortalViewResponse): AnyClientView {
  if (isWorkspaceClientView(raw)) {
    return {
      kind: 'workspace',
      workspace: raw.workspace,
      projects: raw.projects,
      share: raw.share,
    };
  }
  const projectView = raw;
  const audienceName = projectView.audience_name ?? projectView.share.audience_name;
  const permissions = projectView.permissions ?? projectView.share.permissions;

  return {
    project: projectView.project,
    tasks: projectView.tasks,
    edges: projectView.edges,
    documents: projectView.documents,
    prototypes: projectView.prototypes,
    progress: projectView.progress,
    share: {
      audience_name: audienceName,
      permissions,
      expires_at: projectView.share.expires_at,
    },
  };
}

export async function fetchShareMeta(shareToken: string): Promise<ShareMeta> {
  const response = await fetch(`${API_BASE}/api/v1/share/${encodeURIComponent(shareToken)}/meta`);

  if (response.status === 401 || response.status === 404) {
    throw new PortalUnauthorizedError();
  }

  if (!response.ok) {
    throw new Error(`Portal error ${String(response.status)}: ${await response.text()}`);
  }

  return (await response.json()) as ShareMeta;
}

export async function joinShare(
  shareToken: string,
  input: { name: string; email?: string },
): Promise<JoinShareResult> {
  const response = await fetch(`${API_BASE}/api/v1/share/${encodeURIComponent(shareToken)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (response.status === 401) {
    throw new PortalUnauthorizedError();
  }

  if (response.status === 400) {
    const body = (await response.json()) as { error?: string };
    if (body.error === 'name_required') {
      throw new PortalJoinError('Name is required.');
    }
    throw new PortalJoinError('Unable to join. Please check your details and try again.');
  }

  if (response.status === 403) {
    const body = (await response.json()) as { error?: string };
    if (body.error === 'email_not_invited') {
      throw new PortalEmailNotInvitedError();
    }
    throw new PortalJoinError('Unable to join. Please check your details and try again.');
  }

  if (!response.ok) {
    throw new Error(`Portal error ${String(response.status)}: ${await response.text()}`);
  }

  return (await response.json()) as JoinShareResult;
}

export async function fetchClientView(
  shareToken: string,
  sessionToken: string,
): Promise<AnyClientView> {
  // View is guest-session-gated: join mints the token; without it the API 401s.
  const response = await fetch(`${API_BASE}/api/v1/share/${encodeURIComponent(shareToken)}/view`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });

  if (response.status === 401) {
    throw new PortalUnauthorizedError();
  }

  if (response.status === 404) {
    throw new PortalNotReadyError();
  }

  if (!response.ok) {
    throw new Error(`Portal error ${String(response.status)}: ${await response.text()}`);
  }

  const raw = (await response.json()) as PortalViewResponse;
  return normalizePortalResponse(raw);
}

export async function submitIssue(
  shareToken: string,
  sessionToken: string,
  input: {
    title: string;
    body?: string;
    severity?: string;
    task_ref?: string;
    project_id?: string;
  },
): Promise<PortalSubmission> {
  const response = await fetch(
    `${API_BASE}/api/v1/share/${encodeURIComponent(shareToken)}/submissions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(input),
    },
  );

  if (response.status === 401) {
    throw new PortalUnauthorizedError();
  }

  if (response.status === 403) {
    throw new PortalSubmitForbiddenError();
  }

  if (response.status === 429) {
    throw new PortalRateLimitedError();
  }

  if (response.status === 400) {
    const body = (await response.json()) as { error?: string };
    if (body.error === 'title_required') {
      throw new PortalSubmitFieldError('Title is required.');
    }
    if (body.error === 'project_required') {
      throw new PortalSubmitFieldError('Please choose a project for this issue.');
    }
    throw new PortalSubmitFieldError('Unable to submit. Please check your details and try again.');
  }

  if (!response.ok) {
    throw new Error(`Portal error ${String(response.status)}: ${await response.text()}`);
  }

  const body = (await response.json()) as { submission: PortalSubmission };
  return body.submission;
}

export async function listMySubmissions(
  shareToken: string,
  sessionToken: string,
): Promise<PortalSubmission[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/share/${encodeURIComponent(shareToken)}/submissions`,
    {
      headers: { Authorization: `Bearer ${sessionToken}` },
    },
  );

  if (response.status === 401) {
    throw new PortalUnauthorizedError();
  }

  if (!response.ok) {
    throw new Error(`Portal error ${String(response.status)}: ${await response.text()}`);
  }

  return (await response.json()) as PortalSubmission[];
}

export type PortalSerializedComment = {
  id: string;
  body: string;
  passage: string | null;
  anchor: string | null;
  resolved: boolean;
  created_at: string;
};

export async function listPortalArtifactComments(
  shareToken: string,
  sessionToken: string,
  artifactId: string,
): Promise<PortalSerializedComment[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/share/${encodeURIComponent(shareToken)}/artifact-comments?artifact_id=${encodeURIComponent(artifactId)}`,
    { headers: { Authorization: `Bearer ${sessionToken}` } },
  );
  if (response.status === 401) {
    throw new PortalUnauthorizedError();
  }
  if (!response.ok) {
    throw new Error(`Portal error ${String(response.status)}: ${await response.text()}`);
  }
  return (await response.json()) as PortalSerializedComment[];
}

export async function createPortalArtifactComment(
  shareToken: string,
  sessionToken: string,
  input: {
    artifact_id: string;
    body: string;
    passage?: string | null;
    anchor?: string | null;
  },
): Promise<PortalSerializedComment> {
  const response = await fetch(
    `${API_BASE}/api/v1/share/${encodeURIComponent(shareToken)}/artifact-comments`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(input),
    },
  );
  if (response.status === 401) {
    throw new PortalUnauthorizedError();
  }
  if (response.status === 403) {
    throw new PortalSubmitForbiddenError();
  }
  if (!response.ok) {
    throw new Error(`Portal error ${String(response.status)}: ${await response.text()}`);
  }
  return (await response.json()) as PortalSerializedComment;
}

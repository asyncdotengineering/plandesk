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

export type JoinShareResult = {
  session_token: string;
  participant: { id: string; name: string };
  share: {
    audience_name: string;
    permissions: { read: boolean; submit: boolean };
  };
};

type PortalViewResponse = ClientView & {
  audience_name?: string;
  permissions?: { read: boolean; submit: boolean };
};

const SYNC_BASE = import.meta.env.VITE_SYNC_URL ?? '';

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

function normalizePortalResponse(raw: PortalViewResponse): ClientView {
  const audienceName = raw.audience_name ?? raw.share.audience_name;
  const permissions = raw.permissions ?? raw.share.permissions;

  return {
    project: raw.project,
    tasks: raw.tasks,
    edges: raw.edges,
    documents: raw.documents,
    progress: raw.progress,
    share: {
      audience_name: audienceName,
      permissions,
      expires_at: raw.share.expires_at,
    },
  };
}

export async function fetchShareMeta(shareToken: string): Promise<ShareMeta> {
  const response = await fetch(
    `${SYNC_BASE}/api/portal/v1/shares/${encodeURIComponent(shareToken)}/meta`,
  );

  if (response.status === 401) {
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
  const response = await fetch(
    `${SYNC_BASE}/api/portal/v1/shares/${encodeURIComponent(shareToken)}/join`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );

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
): Promise<ClientView> {
  const response = await fetch(
    `${SYNC_BASE}/api/portal/v1/shares/${encodeURIComponent(shareToken)}/view`,
    {
      headers: { Authorization: `Bearer ${sessionToken}` },
    },
  );

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

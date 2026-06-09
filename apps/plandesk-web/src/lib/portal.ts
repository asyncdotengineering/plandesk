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

type PortalViewResponse = ClientView & {
  audience_name?: string;
  permissions?: { read: boolean; submit: boolean };
};

const SYNC_BASE = import.meta.env.VITE_SYNC_URL ?? '';

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

export async function fetchClientView(shareToken: string): Promise<ClientView> {
  const response = await fetch(
    `${SYNC_BASE}/api/portal/v1/shares/${encodeURIComponent(shareToken)}/view`,
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

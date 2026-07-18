import {
  countRecentSubmissionsByParticipant,
  createGuestSession,
  createGuestSubmission,
  createShare as dbCreateShare,
  getDocument,
  getGuestSessionById,
  getProject,
  getProjectInOrg,
  getShare as dbGetShare,
  getShareByTokenHashRaw,
  getTask,
  hashShareToken,
  listDocuments,
  listShares as dbListShares,
  listSubmissionsByShareAndParticipant,
  parseSharePermissions,
  parseSharePolicy,
  revokeShare as dbRevokeShare,
  type Db,
  type Share,
  type ShareMode,
  type SharePermissions,
} from '@plandesk/db';
import { getAuthContext, tryGetAuthContext } from '../auth-context.js';
import type { BetterAuthInstance } from '../better-auth.js';
import { getTeamInOrg } from '../identity.js';
import {
  buildClientView,
  buildWorkspaceClientView,
  type ClientView,
  type SharePolicy,
  type WorkspaceClientView,
} from '../projection.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

const GUEST_SUBMIT_RATE_LIMIT = 10;
const GUEST_SUBMIT_RATE_WINDOW_MS = 60_000;

export class InvalidShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidShareError';
  }
}

export type ShareServiceDeps = OrgScopedDeps & {
  db: Db;
  /** better-auth instance for workspace (team) validation on workspace shares. */
  auth?: BetterAuthInstance;
};

export type SerializedShare = {
  id: string;
  project_id: string | null;
  workspace_id: string | null;
  audience_name: string;
  mode: ShareMode;
  permissions: SharePermissions;
  policy: SharePolicy;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

const DEFAULT_POLICY: SharePolicy = { tasks: 'all', documentIds: [], fields: {} };
const DEFAULT_PERMISSIONS: SharePermissions = { read: true, submit: false };

export function serializeShare(share: Share): SerializedShare {
  return {
    id: share.id,
    project_id: share.projectId,
    workspace_id: share.workspaceId,
    audience_name: share.audienceName,
    mode: share.mode,
    permissions: parseSharePermissions(share),
    policy: parseSharePolicy(share),
    expires_at: share.expiresAt?.toISOString() ?? null,
    revoked_at: share.revokedAt?.toISOString() ?? null,
    created_at: share.createdAt.toISOString(),
  };
}

export type CreateShareInput = {
  audienceName: string;
  mode: ShareMode;
  permissions?: SharePermissions;
  policy?: SharePolicy;
  invitedEmails?: string[];
  expiresAt?: Date;
};

export type CreateWorkspaceShareInput = {
  audienceName: string;
  mode: ShareMode;
  permissions?: SharePermissions;
  policy?: SharePolicy;
  invitedEmails?: string[];
  expiresAt?: Date;
};

export type WorkspaceShareResult = {
  share: SerializedShare;
  token: string;
  url: string;
};

const RESOURCE_SHARE_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export type ShareResourceRef =
  | { kind: 'task'; id: string }
  | { kind: 'document'; id: string };

export type CreateResourceShareInput = {
  resource: ShareResourceRef;
  // undefined -> default 24h; null -> never expires.
  expiresAt?: Date | null;
};

export type ResourceShareResult = {
  token: string;
  url: string;
  markdownUrl: string;
  expiresAt: string | null;
};

export type ResourceMarkdownResult =
  | { status: 'ok'; markdown: string }
  | { status: 'not_found' }
  | { status: 'gone' };

export type ShareMetaResult =
  | { status: 'ok'; audienceName: string; mode: ShareMode }
  | { status: 'not_found' };

export type JoinShareInput = {
  name: string;
  email?: string;
};

export type JoinShareResult =
  | {
      status: 'ok';
      sessionToken: string;
      participant: { id: string; name: string };
      share: { audienceName: string; permissions: SharePermissions };
    }
  | { status: 'unauthorized' }
  | { status: 'name_required' }
  | { status: 'email_not_invited' };

export type GuestSubmission = {
  id: string;
  title: string;
  severity: string | null;
  status: string;
  created_at: string;
};

export type SubmitIssueInput = {
  title: string;
  body?: string;
  severity?: string;
  task_ref?: string;
  /** Target project for a workspace share (ignored for project shares). */
  project_id?: string;
};

export type SubmitIssueResult =
  | { status: 'ok'; submission: GuestSubmission }
  | { status: 'unauthorized' }
  | { status: 'submit_not_permitted' }
  | { status: 'title_required' }
  | { status: 'project_required' }
  | { status: 'rate_limited' };

export type ListMySubmissionsResult =
  | { status: 'ok'; submissions: GuestSubmission[] }
  | { status: 'unauthorized' };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseInvitedEmails(raw: string | null): string[] {
  if (raw === null || raw === '') {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((value): value is string => typeof value === 'string').map(normalizeEmail);
}

function isEmailInvited(share: Share, email: string | undefined): boolean {
  if (email === undefined || email.trim() === '') {
    return false;
  }
  return parseInvitedEmails(share.invitedEmails).includes(normalizeEmail(email));
}

function isShareLive(share: Share, now: Date = new Date()): boolean {
  if (share.revokedAt !== null) {
    return false;
  }
  if (share.expiresAt !== null && share.expiresAt <= now) {
    return false;
  }
  return true;
}

// Does this share belong to this guest's scope? Share id must match, and the
// scoping column (projectId for a project share, workspaceId for a workspace
// share) must match the guest context. Fail-closed on any mismatch.
function shareMatchesGuest(
  share: Share,
  auth: { shareId: string; projectId?: string; workspaceId?: string },
): boolean {
  if (share.id !== auth.shareId) {
    return false;
  }
  if (share.workspaceId !== null) {
    return auth.workspaceId === share.workspaceId;
  }
  return share.projectId === auth.projectId;
}

// The rich-text editor stores document/comment bodies as HTML; this is a
// deliberately small converter for that constrained, known markup (not
// arbitrary HTML) rather than pulling in a DOM/HTML-parsing dependency.
function getAttr(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return match?.[1];
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function isRelativeUrl(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

function toAbsoluteUrl(url: string, origin: string): string {
  return isRelativeUrl(url) ? `${origin}${url}` : url;
}

function htmlToMarkdown(html: string, origin: string, images: string[]): string {
  let out = html;

  out = out.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
    const src = getAttr(attrs, 'src');
    if (src === undefined) {
      return '';
    }
    const abs = toAbsoluteUrl(src, origin);
    images.push(abs);
    return `![${getAttr(attrs, 'alt') ?? ''}](${abs})`;
  });

  out = out.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
    const href = getAttr(attrs, 'href');
    return href === undefined
      ? stripTags(inner)
      : `[${stripTags(inner)}](${toAbsoluteUrl(href, origin)})`;
  });

  out = out.replace(
    /<pre\b[^>]*>(?:\s*<code\b[^>]*>)?([\s\S]*?)(?:<\/code>\s*)?<\/pre>/gi,
    (_m, code: string) => `\n\`\`\`\n${decodeHtmlEntities(stripTags(code))}\n\`\`\`\n`,
  );

  out = out.replace(
    /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (_m, _tag: string, inner: string) => `**${stripTags(inner)}**`,
  );
  out = out.replace(
    /<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (_m, _tag: string, inner: string) => `*${stripTags(inner)}*`,
  );
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => `\`${stripTags(inner)}\``);

  out = out.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_m, level: string, inner: string) => `\n${'#'.repeat(Number(level))} ${stripTags(inner).trim()}\n`,
  );

  out = out.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
    const lines = stripTags(inner)
      .trim()
      .split('\n')
      .map((line) => `> ${line.trim()}`);
    return `\n${lines.join('\n')}\n`;
  });

  out = out.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner: string) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(
      (match) => `- ${stripTags(match[1] ?? '').trim()}`,
    );
    return `\n${items.join('\n')}\n`;
  });
  out = out.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(
      (match, i) => `${String(i + 1)}. ${stripTags(match[1] ?? '').trim()}`,
    );
    return `\n${items.join('\n')}\n`;
  });

  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner: string) => `\n${inner.trim()}\n`);

  out = decodeHtmlEntities(stripTags(out));

  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// Task descriptions are plain markdown text (not HTML) — only the relative
// refs need absolutizing, both `![alt](url)` and `[text](url)` forms.
function rewriteMarkdownRefs(text: string, origin: string, images: string[]): string {
  return text.replace(
    /(!?)\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g,
    (_m, bang: string, label: string, url: string, rest: string) => {
      const abs = toAbsoluteUrl(url, origin);
      if (bang === '!') {
        images.push(abs);
      }
      return `${bang}[${label}](${abs}${rest})`;
    },
  );
}

const AGENT_PREAMBLE =
  '> Agent context. Read every section AND fetch every image URL below with an image tool — the images (screenshots, annotated diagrams) carry details not in the text.';

function buildShareMarkdown(view: ClientView, policy: SharePolicy, origin: string): string {
  const images: string[] = [];
  const sections: string[] = [AGENT_PREAMBLE, ''];

  const soleTaskId = Array.isArray(policy.tasks) && policy.tasks.length === 1 ? policy.tasks[0] : undefined;
  const task = soleTaskId !== undefined ? view.tasks.find((t) => t.id === soleTaskId) : undefined;

  if (task) {
    sections.push(`# ${task.label}`, `Status: ${task.status}`, '');
    if (task.description) {
      sections.push(rewriteMarkdownRefs(task.description, origin, images), '');
    }
    for (const doc of view.documents) {
      sections.push(`## Linked document: ${doc.title}`, '');
      sections.push(htmlToMarkdown(doc.body_html ?? '', origin, images), '');
    }
  } else if (view.documents[0]) {
    const doc = view.documents[0];
    sections.push(`# ${doc.title}`, '');
    sections.push(htmlToMarkdown(doc.body_html ?? '', origin, images), '');
  }

  const uniqueImages = [...new Set(images)];
  if (uniqueImages.length > 0) {
    sections.push('## Images in this context', '');
    sections.push(...uniqueImages.map((url) => `- ${url}`));
  }

  return `${sections.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function createShareService(deps: ShareServiceDeps) {
  const { db } = deps;

  return {
    async createShare(
      projectId: string,
      input: CreateShareInput,
    ): Promise<{ share: SerializedShare; token: string } | undefined> {
      assertPermission(deps, 'document', 'create');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      if (input.audienceName.trim() === '') {
        throw new InvalidShareError('Share audience name must not be empty');
      }

      const { share, token } = await dbCreateShare(db, {
        projectId,
        audienceName: input.audienceName,
        mode: input.mode,
        permissions: input.permissions ?? DEFAULT_PERMISSIONS,
        policy: input.policy ?? DEFAULT_POLICY,
        invitedEmails: input.invitedEmails,
        expiresAt: input.expiresAt,
      });

      return { share: serializeShare(share), token };
    },

    // Share an entire workspace: the portal then shows every project in it.
    // Validates the workspace (team) belongs to the caller's org via getTeamInOrg;
    // fail-closed (undefined → 404) when the workspace is unknown or cross-org,
    // or when better-auth is not configured (workspace shares need team lookup).
    async createWorkspaceShare(
      workspaceId: string,
      input: CreateWorkspaceShareInput,
      origin: string,
    ): Promise<WorkspaceShareResult | undefined> {
      assertPermission(deps, 'document', 'create');
      if (deps.auth === undefined) {
        return undefined;
      }
      // A workspace-scoped key may only share its own workspace; a different
      // workspace id is a 404 even when it lives in the same org.
      const ctx = tryGetAuthContext();
      const scopedWorkspaceId =
        ctx?.kind === 'apikey' || ctx?.kind === 'loopback' ? ctx.workspaceId : undefined;
      if (scopedWorkspaceId !== undefined && scopedWorkspaceId !== workspaceId) {
        return undefined;
      }
      // A session member may only publish a workspace they belong to (a
      // teamMember row in this org); a workspace outside that set is a 404
      // even within the same org. Owner/admin bypass by role.
      if (
        ctx?.kind === 'session' &&
        ctx.role === 'member' &&
        !ctx.memberWorkspaceIds.includes(workspaceId)
      ) {
        return undefined;
      }
      const team = await getTeamInOrg(deps.auth, workspaceId, resolveOrgId(deps));
      if (team === undefined) {
        return undefined;
      }

      if (input.audienceName.trim() === '') {
        throw new InvalidShareError('Share audience name must not be empty');
      }

      const { share, token } = await dbCreateShare(db, {
        workspaceId: team.id,
        audienceName: input.audienceName,
        mode: input.mode,
        permissions: input.permissions ?? DEFAULT_PERMISSIONS,
        policy: input.policy ?? DEFAULT_POLICY,
        invitedEmails: input.invitedEmails,
        expiresAt: input.expiresAt,
      });

      return {
        share: serializeShare(share),
        token,
        url: `${origin}/p/${token}`,
      };
    },

    async listShares(projectId: string): Promise<SerializedShare[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return (await dbListShares(db, projectId)).map(serializeShare);
    },

    async revokeShare(id: string): Promise<boolean> {
      assertPermission(deps, 'document', 'delete');
      const existing = await dbGetShare(db, id);
      if (!existing) {
        return false;
      }
      // Workspace share: validate the workspace is in the caller's org (or
      // fail-closed when better-auth is unavailable to confirm it).
      if (existing.workspaceId !== null) {
        if (deps.auth === undefined) {
          return false;
        }
        const team = await getTeamInOrg(deps.auth, existing.workspaceId, resolveOrgId(deps));
        if (team === undefined) {
          return false;
        }
        return (await dbRevokeShare(db, id)) !== undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId!, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return false;
        }
        throw error;
      }
      return (await dbRevokeShare(db, id)) !== undefined;
    },

    async buildClientView(projectId: string, shareId: string): Promise<ClientView | undefined> {
      const share = await dbGetShare(db, shareId);
      if (!share || share.projectId !== projectId) {
        return undefined;
      }
      return buildClientView(db, projectId, share);
    },

    async createResourceShare(
      input: CreateResourceShareInput,
      origin: string,
    ): Promise<ResourceShareResult | undefined> {
      assertPermission(deps, 'document', 'create');
      let projectId: string;
      let policy: SharePolicy;
      let audienceName: string;

      if (input.resource.kind === 'task') {
        const task = await getTask(db, input.resource.id);
        if (!task) {
          return undefined;
        }
        projectId = task.projectId;
        const linkedDocumentIds = (await listDocuments(db, projectId))
          .filter((doc) => doc.linkedTaskId === task.id)
          .map((doc) => doc.id);
        policy = {
          tasks: [task.id],
          documentIds: linkedDocumentIds,
          fields: { description: true, assignee: true },
        };
        audienceName = `Agent link: ${task.label}`;
      } else {
        const document = await getDocument(db, input.resource.id);
        if (!document) {
          return undefined;
        }
        projectId = document.projectId;
        policy = { tasks: [], documentIds: [document.id], fields: {} };
        audienceName = `Agent link: ${document.title}`;
      }

      // Cross-org chokepoint: the resolved resource's project must be in the
      // caller's org (an org-B key sharing an org-A resource → 404, no leak).
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      const expiresAt =
        input.expiresAt === null
          ? null
          : (input.expiresAt ?? new Date(Date.now() + RESOURCE_SHARE_DEFAULT_TTL_MS));

      const { share, token } = await dbCreateShare(db, {
        projectId,
        audienceName,
        mode: 'public',
        permissions: DEFAULT_PERMISSIONS,
        policy,
        expiresAt,
      });

      return {
        token,
        url: `${origin}/p/${token}`,
        markdownUrl: `${origin}/api/v1/share/${token}.md`,
        expiresAt: share.expiresAt?.toISOString() ?? null,
      };
    },

    async getResourceMarkdown(token: string, origin: string): Promise<ResourceMarkdownResult> {
      const share = await getShareByTokenHashRaw(db, hashShareToken(token));
      if (!share) {
        return { status: 'not_found' };
      }

      const now = new Date();
      if (share.revokedAt !== null || (share.expiresAt !== null && share.expiresAt <= now)) {
        return { status: 'gone' };
      }

      // Workspace shares have no single-project agent markdown link.
      if (share.projectId === null) {
        return { status: 'not_found' };
      }

      const view = await buildClientView(db, share.projectId, share);
      if (!view) {
        return { status: 'not_found' };
      }

      return { status: 'ok', markdown: buildShareMarkdown(view, parseSharePolicy(share), origin) };
    },

    // Portal meta for the join gate UI. Live shares only; unknown/revoked/expired → not_found.
    async getShareMeta(token: string): Promise<ShareMetaResult> {
      const share = await getShareByTokenHashRaw(db, hashShareToken(token));
      if (!share || !isShareLive(share)) {
        return { status: 'not_found' };
      }
      return { status: 'ok', audienceName: share.audienceName, mode: share.mode };
    },

    // Named join: mints a guest session scoped to this share. invite mode requires
    // an allow-listed email (sync-server semantics: 403 email_not_invited).
    async joinShare(token: string, input: JoinShareInput): Promise<JoinShareResult> {
      const share = await getShareByTokenHashRaw(db, hashShareToken(token));
      if (!share || !isShareLive(share)) {
        return { status: 'unauthorized' };
      }

      const name = input.name.trim();
      if (name === '') {
        return { status: 'name_required' };
      }

      if (share.mode === 'invite' && !isEmailInvited(share, input.email)) {
        return { status: 'email_not_invited' };
      }

      const { guest, token: sessionToken } = await createGuestSession(db, {
        shareId: share.id,
        // Bind the guest to the share's scope: a workspace share binds by
        // workspaceId (projectId null); a project share binds by projectId.
        ...(share.workspaceId !== null
          ? { workspaceId: share.workspaceId }
          : { projectId: share.projectId! }),
        name,
        email: input.email?.trim() || undefined,
      });

      return {
        status: 'ok',
        sessionToken,
        participant: { id: guest.id, name: guest.name },
        share: {
          audienceName: share.audienceName,
          permissions: parseSharePermissions(share),
        },
      };
    },

    // Guest-gated portal view: middleware has already verified the guest session
    // matches this share token. The view is COMPUTED live (not a snapshot). Every
    // failure shape collapses to undefined → uniform 404. Guest context has no
    // orgId; the projection reads only the share's scope (one project OR one
    // workspace's project set).
    async getClientView(
      token: string,
    ): Promise<ClientView | WorkspaceClientView | undefined> {
      const auth = getAuthContext();
      if (auth.kind !== 'guest') {
        return undefined;
      }

      const share = await getShareByTokenHashRaw(db, hashShareToken(token));
      if (!share || !isShareLive(share)) {
        return undefined;
      }
      if (share.id !== auth.shareId) {
        return undefined;
      }

      if (share.workspaceId !== null) {
        if (auth.workspaceId !== share.workspaceId) {
          return undefined;
        }
        return buildWorkspaceClientView(db, share.workspaceId, share);
      }

      if (share.projectId !== auth.projectId) {
        return undefined;
      }
      return buildClientView(db, share.projectId!, share);
    },

    // Guest moderated inbox: write a pending share_submissions row the owner
    // lists/triages on the same server (no cross-server hop).
    async submitIssue(token: string, input: SubmitIssueInput): Promise<SubmitIssueResult> {
      const auth = getAuthContext();
      if (auth.kind !== 'guest') {
        return { status: 'unauthorized' };
      }

      const share = await getShareByTokenHashRaw(db, hashShareToken(token));
      if (!share || !isShareLive(share)) {
        return { status: 'unauthorized' };
      }
      if (share.id !== auth.shareId) {
        return { status: 'unauthorized' };
      }

      // Resolve the target project this submission lands against, and enforce
      // the guest's scope. A project share is bound to share.projectId; a
      // workspace share requires an explicit project_id AND that the project
      // belongs to the shared workspace (fail-closed otherwise).
      let targetProjectId: string;
      if (share.workspaceId !== null) {
        if (auth.workspaceId !== share.workspaceId) {
          return { status: 'unauthorized' };
        }
        const requestedProjectId = input.project_id?.trim();
        if (requestedProjectId === undefined || requestedProjectId === '') {
          return { status: 'project_required' };
        }
        const project = await getProject(db, requestedProjectId);
        if (project === undefined || project.workspaceId !== share.workspaceId) {
          return { status: 'unauthorized' };
        }
        targetProjectId = project.id;
      } else {
        if (share.projectId !== auth.projectId) {
          return { status: 'unauthorized' };
        }
        targetProjectId = share.projectId!;
      }

      const permissions = parseSharePermissions(share);
      if (permissions.submit !== true) {
        return { status: 'submit_not_permitted' };
      }

      const title = input.title.trim();
      if (title === '') {
        return { status: 'title_required' };
      }

      const guest = await getGuestSessionById(db, auth.guestSessionId);
      if (guest === undefined || guest.shareId !== share.id) {
        return { status: 'unauthorized' };
      }

      const recent = await countRecentSubmissionsByParticipant(db, {
        hostedShareId: share.id,
        participantName: guest.name,
        since: new Date(Date.now() - GUEST_SUBMIT_RATE_WINDOW_MS),
      });
      if (recent >= GUEST_SUBMIT_RATE_LIMIT) {
        return { status: 'rate_limited' };
      }

      const bodyText = input.body?.trim() === '' ? null : (input.body?.trim() ?? null);
      const severity = input.severity?.trim() === '' ? null : (input.severity?.trim() ?? null);
      const taskRef = input.task_ref?.trim() === '' ? null : (input.task_ref?.trim() ?? null);

      const row = await createGuestSubmission(db, {
        projectId: targetProjectId,
        hostedShareId: share.id,
        participantName: guest.name,
        title,
        body: bodyText,
        severity,
        taskRef,
      });

      return {
        status: 'ok',
        submission: {
          id: row.id,
          title: row.title,
          severity: row.severity,
          status: row.status,
          created_at: row.createdAt.toISOString(),
        },
      };
    },

    async listMySubmissions(token: string): Promise<ListMySubmissionsResult> {
      const auth = getAuthContext();
      if (auth.kind !== 'guest') {
        return { status: 'unauthorized' };
      }

      const share = await getShareByTokenHashRaw(db, hashShareToken(token));
      if (!share || !isShareLive(share)) {
        return { status: 'unauthorized' };
      }
      if (!shareMatchesGuest(share, auth)) {
        return { status: 'unauthorized' };
      }

      const guest = await getGuestSessionById(db, auth.guestSessionId);
      if (guest === undefined || guest.shareId !== share.id) {
        return { status: 'unauthorized' };
      }

      const rows = await listSubmissionsByShareAndParticipant(db, {
        hostedShareId: share.id,
        participantName: guest.name,
      });

      return {
        status: 'ok',
        submissions: rows.map((row) => ({
          id: row.id,
          title: row.title,
          severity: row.severity,
          status: row.status,
          created_at: row.createdAt.toISOString(),
        })),
      };
    },
  };
}

export type ShareService = ReturnType<typeof createShareService>;

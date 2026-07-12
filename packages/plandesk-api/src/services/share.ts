import {
  createShare as dbCreateShare,
  getDocument,
  getProject,
  getShare as dbGetShare,
  getShareByTokenHashRaw,
  getTask,
  hashShareToken,
  listDocuments,
  listShares as dbListShares,
  parseSharePermissions,
  parseSharePolicy,
  revokeShare as dbRevokeShare,
  type Db,
  type Share,
  type ShareMode,
  type SharePermissions,
} from '@plandesk/db';
import type { EventBus } from '../events.js';
import { buildClientView, type ClientView, type SharePolicy } from '../projection.js';

export class InvalidShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidShareError';
  }
}

export type ShareServiceDeps = {
  db: Db;
  eventBus: EventBus;
};

export type SerializedShare = {
  id: string;
  project_id: string;
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
    createShare(
      projectId: string,
      input: CreateShareInput,
    ): { share: SerializedShare; token: string } | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      if (input.audienceName.trim() === '') {
        throw new InvalidShareError('Share audience name must not be empty');
      }

      const { share, token } = dbCreateShare(db, {
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

    listShares(projectId: string): SerializedShare[] | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }
      return dbListShares(db, projectId).map(serializeShare);
    },

    revokeShare(id: string): boolean {
      return dbRevokeShare(db, id) !== undefined;
    },

    buildClientView(projectId: string, shareId: string): ClientView | undefined {
      const share = dbGetShare(db, shareId);
      if (!share || share.projectId !== projectId) {
        return undefined;
      }
      return buildClientView(db, projectId, share);
    },

    createResourceShare(
      input: CreateResourceShareInput,
      origin: string,
    ): ResourceShareResult | undefined {
      let projectId: string;
      let policy: SharePolicy;
      let audienceName: string;

      if (input.resource.kind === 'task') {
        const task = getTask(db, input.resource.id);
        if (!task) {
          return undefined;
        }
        projectId = task.projectId;
        const linkedDocumentIds = listDocuments(db, projectId)
          .filter((doc) => doc.linkedTaskId === task.id)
          .map((doc) => doc.id);
        policy = {
          tasks: [task.id],
          documentIds: linkedDocumentIds,
          fields: { description: true, assignee: true },
        };
        audienceName = `Agent link: ${task.label}`;
      } else {
        const document = getDocument(db, input.resource.id);
        if (!document) {
          return undefined;
        }
        projectId = document.projectId;
        policy = { tasks: [], documentIds: [document.id], fields: {} };
        audienceName = `Agent link: ${document.title}`;
      }

      const expiresAt =
        input.expiresAt === null
          ? null
          : (input.expiresAt ?? new Date(Date.now() + RESOURCE_SHARE_DEFAULT_TTL_MS));

      const { share, token } = dbCreateShare(db, {
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

    getResourceMarkdown(token: string, origin: string): ResourceMarkdownResult {
      const share = getShareByTokenHashRaw(db, hashShareToken(token));
      if (!share) {
        return { status: 'not_found' };
      }

      const now = new Date();
      if (share.revokedAt !== null || (share.expiresAt !== null && share.expiresAt <= now)) {
        return { status: 'gone' };
      }

      const view = buildClientView(db, share.projectId, share);
      if (!view) {
        return { status: 'not_found' };
      }

      return { status: 'ok', markdown: buildShareMarkdown(view, parseSharePolicy(share), origin) };
    },
  };
}

export type ShareService = ReturnType<typeof createShareService>;

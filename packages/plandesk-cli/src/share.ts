import type { Db } from '@plandesk/db';
import { ensureDefaultOrg } from '@plandesk/db';
import { createServices } from '@plandesk/api';
import { resolveProjectId } from './sync.js';

export type ShareCreateOptions = {
  repoDir: string;
  projectId?: string;
  audienceName: string;
  public: boolean;
  invite?: string;
  expires?: string;
  allowSubmit: boolean;
};

export type ShareCreateResult = {
  audienceName: string;
  mode: 'invite' | 'public';
  shareId: string;
  token: string;
  expiresAt: string | null;
};

export class InvalidShareArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidShareArgsError';
  }
}

const EXPIRES_PATTERN = /^(\d+)([hdw])$/;
const UNIT_MS: Record<string, number> = { h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function parseExpires(raw: string | undefined): Date | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = EXPIRES_PATTERN.exec(raw.trim());
  if (match === null) {
    throw new InvalidShareArgsError(
      `Invalid --expires "${raw}". Use <n>h, <n>d, or <n>w (e.g. 30d).`,
    );
  }
  const amount = Number.parseInt(match[1] ?? '', 10);
  const unitMs = UNIT_MS[match[2] ?? ''];
  if (amount <= 0 || unitMs === undefined) {
    throw new InvalidShareArgsError(
      `Invalid --expires "${raw}". Use <n>h, <n>d, or <n>w (e.g. 30d).`,
    );
  }
  return new Date(Date.now() + amount * unitMs);
}

export async function runShareCreate(
  db: Db,
  options: ShareCreateOptions,
): Promise<ShareCreateResult> {
  const projectId = resolveProjectId({ repoDir: options.repoDir, projectId: options.projectId });
  const expiresAt = parseExpires(options.expires);
  const invitedEmails =
    options.invite !== undefined
      ? options.invite
          .split(',')
          .map((email) => email.trim())
          .filter((email) => email !== '')
      : undefined;
  const mode = options.public ? 'public' : 'invite';

  const org = await ensureDefaultOrg(db);
  const { shareService } = createServices({ db, orgId: org.id });
  const created = await shareService.createShare(projectId, {
    audienceName: options.audienceName,
    mode,
    permissions: options.allowSubmit ? { read: true, submit: true } : undefined,
    invitedEmails,
    expiresAt,
  });
  if (created === undefined) {
    throw new InvalidShareArgsError(`Project ${projectId} not found.`);
  }

  return {
    audienceName: created.share.audience_name,
    mode,
    shareId: created.share.id,
    token: created.token,
    expiresAt: created.share.expires_at,
  };
}

export function formatShareCreateSummary(result: ShareCreateResult): string {
  const lines = [
    `Share created for "${result.audienceName}" (${result.mode}).`,
    `  share id:  ${result.shareId}`,
    `  token:     ${result.token}`,
    `  link:      <your-portal-url>/p/${result.token}`,
  ];
  if (result.expiresAt !== null) {
    lines.push(`  expires:   ${result.expiresAt}`);
  }
  lines.push(
    '',
    'The token is shown once — only its hash is stored, so copy it now.',
    "Run `plandesk push` to upload this share's projection to the sync server.",
    '',
  );
  return lines.join('\n');
}

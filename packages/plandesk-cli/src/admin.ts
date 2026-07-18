import {
  createBetterAuth,
  ensureLocalBetterAuthOrganization,
  mintOwnerInvitation,
  runBetterAuthMigrations,
} from '@plandesk/api';
import type { Db } from '@plandesk/db';
import { ensureLocalBetterAuthSecret } from './init.js';

export type AdminInviteOwnerOptions = {
  email: string;
  /**
   * Local workspace dir. Required when `secret` is omitted (local path mints
   * or loads ~/.plandesk better-auth secret). Unused when `secret` is set.
   */
  dataDir?: string;
  /** Override claim-link base (defaults to http://127.0.0.1). */
  baseURL?: string;
  /**
   * Explicit better-auth secret (hosted / remote bootstrap). When set, this
   * secret is used instead of `ensureLocalBetterAuthSecret`, and better-auth
   * migrations are not run (operator runs `plandesk migrate`).
   */
  secret?: string;
};

export type AdminInviteOwnerResult = {
  invitationId: string;
  claimUrl: string;
  email: string;
};

export class AdminInviteOwnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminInviteOwnerError';
  }
}

/**
 * Shell-authority first-owner bootstrap (REQ-3 / BA3c; remote: beta.3 REQ-4).
 * Reuses better-auth createInvitation via a shell owner session — no GitHub, no mailer.
 */
export async function runAdminInviteOwner(
  db: Db,
  options: AdminInviteOwnerOptions,
): Promise<AdminInviteOwnerResult> {
  const email = options.email.trim().toLowerCase();
  if (email === '' || !email.includes('@')) {
    throw new AdminInviteOwnerError('email is required (e.g. --email founder@example.com)');
  }

  const remoteSecret = options.secret?.trim();
  let secret: string;
  if (remoteSecret !== undefined && remoteSecret !== '') {
    secret = remoteSecret;
  } else {
    if (options.dataDir === undefined || options.dataDir.trim() === '') {
      throw new AdminInviteOwnerError(
        'dataDir is required for local invite-owner (or pass --secret / PLANDESK_BETTER_AUTH_SECRET for remote)',
      );
    }
    secret = ensureLocalBetterAuthSecret(options.dataDir);
  }

  const baseURL = options.baseURL ?? 'http://127.0.0.1';
  const auth = createBetterAuth({
    client: db.$client,
    secret,
    baseURL,
  });
  if (auth === undefined) {
    throw new AdminInviteOwnerError('better-auth is not configured (missing session secret)');
  }

  // Local path migrates BA tables; remote operators run `plandesk migrate` first.
  if (remoteSecret === undefined || remoteSecret === '') {
    await runBetterAuthMigrations(auth);
  }

  let org: { id: string };
  try {
    org = await ensureLocalBetterAuthOrganization(db, auth);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AdminInviteOwnerError(
      `Organization or better-auth tables missing. Run \`plandesk migrate\` first. (${detail})`,
    );
  }

  try {
    const minted = await mintOwnerInvitation(auth, {
      email,
      organizationId: org.id,
      baseURL,
    });

    return {
      invitationId: minted.invitationId,
      claimUrl: minted.claimUrl,
      email,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (
      detail.toLowerCase().includes('no such table') ||
      detail.toLowerCase().includes('does not exist') ||
      detail.toLowerCase().includes('SQLITE_ERROR')
    ) {
      throw new AdminInviteOwnerError(
        `Organization or better-auth tables missing. Run \`plandesk migrate\` first. (${detail})`,
      );
    }
    throw err;
  }
}

export function formatAdminInviteOwnerSummary(result: AdminInviteOwnerResult): string {
  return [
    `Owner invitation created for ${result.email}.`,
    `  invitation id: ${result.invitationId}`,
    `  claim link:    ${result.claimUrl}`,
    `Deliver the claim link by hand (no email is sent).`,
  ].join('\n');
}

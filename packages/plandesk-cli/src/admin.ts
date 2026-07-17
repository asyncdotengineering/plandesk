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
  dataDir: string;
  /** Override claim-link base (defaults to http://127.0.0.1). */
  baseURL?: string;
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
 * Shell-authority first-owner bootstrap (REQ-3 / BA3c).
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

  const secret = ensureLocalBetterAuthSecret(options.dataDir);
  const baseURL = options.baseURL ?? 'http://127.0.0.1';
  const auth = createBetterAuth({
    client: db.$client,
    secret,
    baseURL,
  });
  if (auth === undefined) {
    throw new AdminInviteOwnerError('better-auth is not configured (missing session secret)');
  }
  await runBetterAuthMigrations(auth);
  const org = await ensureLocalBetterAuthOrganization(db, auth);

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
}

export function formatAdminInviteOwnerSummary(result: AdminInviteOwnerResult): string {
  return [
    `Owner invitation created for ${result.email}.`,
    `  invitation id: ${result.invitationId}`,
    `  claim link:    ${result.claimUrl}`,
    `Deliver the claim link by hand (no email is sent).`,
  ].join('\n');
}

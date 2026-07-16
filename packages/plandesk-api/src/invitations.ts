/**
 * better-auth organization invitations (BA3c).
 *
 * createInvitation / acceptInvitation / removeMember require session headers
 * (orgSessionMiddleware). Plugin methods are not on the erased Auth type —
 * call via runtime-validated Reflect, same pattern as agent-keys.ts.
 */
import { makeSignature } from 'better-auth/crypto';
import type { BetterAuthInstance } from './better-auth.js';

export const INVITATION_ROLES = ['owner', 'admin', 'member'] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

export function isInvitationRole(value: string): value is InvitationRole {
  return (INVITATION_ROLES as readonly string[]).includes(value);
}

export function invitationClaimUrl(baseURL: string, invitationId: string): string {
  const base = baseURL.replace(/\/$/, '');
  return `${base}/invite/${invitationId}`;
}

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  inviterId: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
};

type AcceptResult = {
  invitation: InvitationRow;
  member: { id: string; organizationId: string; userId: string; role: string };
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MemberRow = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

type SessionRow = {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const SHELL_EMAIL = 'shell@plandesk.local';
const SHELL_NAME = 'Plan Desk shell';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** better-auth APIError shape (runtime; not imported — version-stable fields only). */
export type AuthApiErrorShape = {
  statusCode: number;
  status: string;
  message: string;
};

export function isAuthApiError(err: unknown): err is AuthApiErrorShape {
  if (!isRecord(err)) return false;
  return (
    typeof err.statusCode === 'number' &&
    typeof err.status === 'string' &&
    typeof err.message === 'string'
  );
}

async function callPluginApi(
  auth: BetterAuthInstance,
  method: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const api: object = auth.api;
  if (!(method in api)) {
    throw new Error(`better-auth ${method} is not available`);
  }
  const fn = Reflect.get(api, method);
  if (typeof fn !== 'function') {
    throw new Error(`better-auth ${method} is not a function`);
  }
  return fn.call(api, args);
}

function parseInvitation(raw: unknown): InvitationRow {
  if (!isRecord(raw) || typeof raw.id !== 'string') {
    throw new Error('createInvitation did not return an invitation id');
  }
  return {
    id: raw.id,
    email: typeof raw.email === 'string' ? raw.email : '',
    role: typeof raw.role === 'string' ? raw.role : '',
    organizationId: typeof raw.organizationId === 'string' ? raw.organizationId : '',
    inviterId: typeof raw.inviterId === 'string' ? raw.inviterId : '',
    status: typeof raw.status === 'string' ? raw.status : '',
    expiresAt: raw.expiresAt instanceof Date ? raw.expiresAt : new Date(String(raw.expiresAt ?? '')),
    createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(String(raw.createdAt ?? '')),
  };
}

/**
 * Create an invitation using the caller's better-auth session (Cookie headers).
 * No mailer: sendInvitationEmail is unset; caller delivers claimUrl by hand.
 */
export async function createOrganizationInvitation(
  auth: BetterAuthInstance,
  opts: {
    email: string;
    role: InvitationRole;
    organizationId: string;
    headers: Headers;
    baseURL: string;
  },
): Promise<{ invitationId: string; claimUrl: string; invitation: InvitationRow }> {
  const raw = await callPluginApi(auth, 'createInvitation', {
    body: {
      email: opts.email.trim().toLowerCase(),
      role: opts.role,
      organizationId: opts.organizationId,
    },
    headers: opts.headers,
  });
  const invitation = parseInvitation(raw);
  return {
    invitationId: invitation.id,
    claimUrl: invitationClaimUrl(opts.baseURL, invitation.id),
    invitation,
  };
}

/**
 * Accept a pending invitation as the signed-in better-auth user (email must match).
 * Single-use CAS: a second accept fails (maps to 410 at the route).
 */
export async function acceptOrganizationInvitation(
  auth: BetterAuthInstance,
  opts: { invitationId: string; headers: Headers },
): Promise<AcceptResult> {
  const raw = await callPluginApi(auth, 'acceptInvitation', {
    body: { invitationId: opts.invitationId },
    headers: opts.headers,
  });
  if (!isRecord(raw) || !isRecord(raw.invitation) || !isRecord(raw.member)) {
    throw new Error('acceptInvitation did not return invitation + member');
  }
  const invitation = parseInvitation(raw.invitation);
  const member = raw.member;
  if (
    typeof member.id !== 'string' ||
    typeof member.organizationId !== 'string' ||
    typeof member.userId !== 'string' ||
    typeof member.role !== 'string'
  ) {
    throw new Error('acceptInvitation member shape invalid');
  }
  return {
    invitation,
    member: {
      id: member.id,
      organizationId: member.organizationId,
      userId: member.userId,
      role: member.role,
    },
  };
}

/**
 * Remove a member via better-auth (enforces ≥1 owner). Used by tests / future routes.
 */
export async function removeOrganizationMember(
  auth: BetterAuthInstance,
  opts: { memberIdOrEmail: string; organizationId: string; headers: Headers },
): Promise<unknown> {
  return callPluginApi(auth, 'removeMember', {
    body: {
      memberIdOrEmail: opts.memberIdOrEmail,
      organizationId: opts.organizationId,
    },
    headers: opts.headers,
  });
}

/**
 * Update a member role via better-auth (enforces ≥1 owner on demote).
 */
export async function updateOrganizationMemberRole(
  auth: BetterAuthInstance,
  opts: {
    memberId: string;
    role: InvitationRole;
    organizationId: string;
    headers: Headers;
  },
): Promise<unknown> {
  return callPluginApi(auth, 'updateMemberRole', {
    body: {
      memberId: opts.memberId,
      role: opts.role,
      organizationId: opts.organizationId,
    },
    headers: opts.headers,
  });
}

/** Mint a signed better-auth session cookie header for an existing user. */
export async function mintSessionCookieHeader(
  auth: BetterAuthInstance,
  userId: string,
): Promise<Headers> {
  const adapter = (await auth.$context).adapter;
  const ctx = await auth.$context;
  const now = new Date();
  const token = `ba-sess-shell-${userId}-${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await adapter.create<SessionRow>({
    model: 'session',
    data: {
      userId,
      token,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    },
  });
  const signed = `${token}.${await makeSignature(token, ctx.secret)}`;
  const headers = new Headers();
  headers.set('cookie', `${ctx.authCookies.sessionToken.name}=${signed}`);
  return headers;
}

/**
 * Ensure a shell inviter user exists as owner of organizationId (REQ-3 bootstrap).
 * Shell authority owns the DB — no interactive session required from the operator.
 */
export async function ensureShellOwner(
  auth: BetterAuthInstance,
  organizationId: string,
): Promise<{ userId: string; headers: Headers }> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();

  let user = await adapter.findOne<UserRow>({
    model: 'user',
    where: [{ field: 'email', value: SHELL_EMAIL }],
  });
  if (user === null) {
    user = await adapter.create<UserRow>({
      model: 'user',
      data: {
        name: SHELL_NAME,
        email: SHELL_EMAIL,
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  const existing = await adapter.findMany<MemberRow>({
    model: 'member',
    where: [
      { field: 'userId', value: user.id },
      { field: 'organizationId', value: organizationId },
    ],
  });
  if (existing.length === 0) {
    await adapter.create<MemberRow>({
      model: 'member',
      data: {
        organizationId,
        userId: user.id,
        role: 'owner',
        createdAt: now,
      },
    });
  }

  const headers = await mintSessionCookieHeader(auth, user.id);
  return { userId: user.id, headers };
}

/**
 * Shell-side owner invitation for `plandesk admin invite-owner` (no GitHub, no mailer).
 */
export async function mintOwnerInvitation(
  auth: BetterAuthInstance,
  opts: { email: string; organizationId: string; baseURL: string },
): Promise<{ invitationId: string; claimUrl: string }> {
  const { headers } = await ensureShellOwner(auth, opts.organizationId);
  const created = await createOrganizationInvitation(auth, {
    email: opts.email,
    role: 'owner',
    organizationId: opts.organizationId,
    headers,
    baseURL: opts.baseURL,
  });
  return { invitationId: created.invitationId, claimUrl: created.claimUrl };
}

import type { OrgRole } from '@plandesk/db';
import { intersectPermissions } from './access-control.js';
import type { BetterAuthInstance } from './better-auth.js';
import { orgRoleToPermissionSet, type PermissionSet } from './permissions.js';

const workActions = ['read', 'create', 'update', 'delete'] as const;

/** Key profile stored in better-auth metadata. Absent/unknown → agent (BA4b-1). */
export type ApiKeyKind = 'agent' | 'owner';

/**
 * Default agent grant: work resources full + project create.
 * member / organization / apiKey are never granted at mint (escalation closed).
 */
export const DEFAULT_AGENT_KEY_PERMISSIONS: PermissionSet = {
  task: workActions,
  document: workActions,
  edge: workActions,
  goal: workActions,
  comment: workActions,
  agent_run: workActions,
  project: ['create'],
  member: [],
  organization: [],
  apiKey: [],
};

/** Full owner permission set — default grant for org-wide owner keys (BA4b-1). */
export const DEFAULT_OWNER_KEY_PERMISSIONS: PermissionSet = orgRoleToPermissionSet('owner');

/** Always stripped from agent-key effective perms — a key must never mint keys
 * or create/rename workspaces (team), regardless of custom permissions. */
export const AGENT_FORBIDDEN_RESOURCES = ['apiKey', 'team'] as const;

/**
 * Live-role ceiling at verify time (BA5 + BA4b-1):
 * effective = intersect(keyPermissions, liveMemberRole);
 * agent profile: then strip AGENT_FORBIDDEN_RESOURCES (apiKey).
 * owner profile: retain apiKey if both key and live role still grant it.
 * No live role (member removed) → empty set.
 */
export function applyAgentKeyPermissionCeiling(
  keyPermissions: Record<string, readonly string[]> | null | undefined,
  liveRole: OrgRole | undefined,
  kind: ApiKeyKind = 'agent',
): PermissionSet {
  const keyPerms: Record<string, readonly string[]> = keyPermissions ?? {};
  const rolePerms: Record<string, readonly string[]> =
    liveRole === undefined ? {} : orgRoleToPermissionSet(liveRole);
  const effective = intersectPermissions(keyPerms, rolePerms);
  if (kind === 'agent') {
    for (const resource of AGENT_FORBIDDEN_RESOURCES) {
      Reflect.deleteProperty(effective, resource);
    }
  }
  return effective;
}

function compactPermissions(permissions: PermissionSet): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(permissions)) {
    if (actions.length > 0) {
      out[resource] = [...actions];
    }
  }
  return out;
}

export type VerifiedApiKey = {
  valid: boolean;
  referenceId: string;
  permissions: Record<string, string[]> | null;
  metadata: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePermissions(value: unknown): Record<string, string[]> | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const out: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(value)) {
    if (
      Array.isArray(actions) &&
      actions.every((action): action is string => typeof action === 'string')
    ) {
      out[resource] = actions;
    }
  }
  return out;
}

/**
 * Call better-auth verifyApiKey without relying on erased plugin types on Auth.
 * Runtime-validates the result shape so TypeScript stays cast-free.
 */
export async function verifyBetterAuthApiKey(
  auth: BetterAuthInstance,
  key: string,
): Promise<VerifiedApiKey | undefined> {
  const api: object = auth.api;
  if (!('verifyApiKey' in api)) {
    return undefined;
  }
  const verify = Reflect.get(api, 'verifyApiKey');
  if (typeof verify !== 'function') {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = await verify.call(api, { body: { key } });
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || typeof raw.valid !== 'boolean') {
    return undefined;
  }
  if (!raw.valid) {
    return undefined;
  }
  const keyBody = raw.key;
  if (!isRecord(keyBody) || typeof keyBody.referenceId !== 'string') {
    return undefined;
  }
  return {
    valid: true,
    referenceId: keyBody.referenceId,
    permissions: parsePermissions(keyBody.permissions),
    metadata: keyBody.metadata ?? null,
  };
}

type MintedKeyResult = {
  id: string;
  key: string;
  name: string | null;
  permissions: Record<string, string[]> | null;
};

/**
 * Shared better-auth createApiKey call (agent + owner mint paths).
 */
async function mintBetterAuthApiKey(input: {
  auth: BetterAuthInstance;
  userId: string;
  name: string;
  permissions: Record<string, string[]>;
  metadata: Record<string, string>;
}): Promise<MintedKeyResult> {
  const api: object = input.auth.api;
  if (!('createApiKey' in api)) {
    throw new Error('better-auth api-key plugin is not mounted');
  }
  const create = Reflect.get(api, 'createApiKey');
  if (typeof create !== 'function') {
    throw new Error('better-auth createApiKey is not available');
  }
  const raw: unknown = await create.call(api, {
    body: {
      userId: input.userId,
      name: input.name,
      permissions: input.permissions,
      metadata: input.metadata,
      rateLimitEnabled: false,
    },
  });
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.key !== 'string') {
    throw new Error('createApiKey did not return id/key');
  }
  if (raw.key.length === 0) {
    throw new Error('createApiKey did not return a key');
  }
  return {
    id: raw.id,
    key: raw.key,
    name: typeof raw.name === 'string' ? raw.name : null,
    permissions: parsePermissions(raw.permissions),
  };
}

export type CreateScopedAgentKeyInput = {
  auth: BetterAuthInstance;
  userId: string;
  orgId: string;
  projectId: string;
  permissions?: PermissionSet;
  name?: string;
};

export type CreatedScopedAgentKey = {
  id: string;
  key: string;
  name: string | null;
  permissions: Record<string, string[]> | null;
  metadata: { projectId: string; orgId: string };
};

/**
 * Server-side mint for a project-scoped agent key.
 * Call only after the caller is a session-authenticated owner (route enforces).
 * Metadata has no `kind` (or may omit it) — resolver treats absent as agent.
 */
export async function createScopedAgentKey(
  input: CreateScopedAgentKeyInput,
): Promise<CreatedScopedAgentKey> {
  const permissions = compactPermissions(
    input.permissions ?? DEFAULT_AGENT_KEY_PERMISSIONS,
  );
  const metadata = { projectId: input.projectId, orgId: input.orgId };
  const minted = await mintBetterAuthApiKey({
    auth: input.auth,
    userId: input.userId,
    name: input.name ?? 'agent',
    permissions,
    metadata,
  });
  return {
    ...minted,
    metadata,
  };
}

export type CreateWorkspaceScopedAgentKeyInput = {
  auth: BetterAuthInstance;
  userId: string;
  orgId: string;
  teamId: string;
  permissions?: PermissionSet;
  name?: string;
};

export type CreatedWorkspaceScopedAgentKey = {
  id: string;
  key: string;
  name: string | null;
  permissions: Record<string, string[]> | null;
  metadata: { orgId: string; teamId: string };
};

/**
 * Server-side mint for a workspace-scoped agent key.
 * Metadata is `{ orgId, teamId }` — no `kind` so resolver treats absent as agent.
 */
export async function createWorkspaceScopedAgentKey(
  input: CreateWorkspaceScopedAgentKeyInput,
): Promise<CreatedWorkspaceScopedAgentKey> {
  const permissions = compactPermissions(
    input.permissions ?? DEFAULT_AGENT_KEY_PERMISSIONS,
  );
  const metadata = { orgId: input.orgId, teamId: input.teamId };
  const minted = await mintBetterAuthApiKey({
    auth: input.auth,
    userId: input.userId,
    name: input.name ?? 'agent',
    permissions,
    metadata,
  });
  return {
    ...minted,
    metadata,
  };
}

export type CreateOrgOwnerKeyInput = {
  auth: BetterAuthInstance;
  userId: string;
  orgId: string;
  permissions?: PermissionSet;
  name?: string;
};

export type CreatedOrgOwnerKey = {
  id: string;
  key: string;
  name: string | null;
  permissions: Record<string, string[]> | null;
  metadata: { orgId: string; kind: 'owner' };
};

/**
 * Server-side mint for an org-wide owner key (BA4b-1).
 * No projectId in metadata → org-wide reach. kind: 'owner' retains apiKey
 * after the live-role ceiling (still intersected with live role).
 */
export async function createOrgOwnerKey(
  input: CreateOrgOwnerKeyInput,
): Promise<CreatedOrgOwnerKey> {
  const permissions = compactPermissions(
    input.permissions ?? DEFAULT_OWNER_KEY_PERMISSIONS,
  );
  const metadata = { orgId: input.orgId, kind: 'owner' as const };
  const minted = await mintBetterAuthApiKey({
    auth: input.auth,
    userId: input.userId,
    name: input.name ?? 'owner',
    permissions,
    metadata,
  });
  return {
    ...minted,
    metadata,
  };
}

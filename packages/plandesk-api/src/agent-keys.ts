import type { OrgRole } from '@plandesk/db';
import { intersectPermissions } from './access-control.js';
import type { BetterAuthInstance } from './better-auth.js';
import { orgRoleToPermissionSet, type PermissionSet } from './permissions.js';

const workActions = ['read', 'create', 'update', 'delete'] as const;

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

/** Always stripped from agent-key effective perms — a key must never mint keys. */
export const AGENT_FORBIDDEN_RESOURCES = ['apiKey'] as const;

/**
 * Live-role ceiling at verify time (BA5):
 * effective = intersect(keyPermissions, liveMemberRole) minus apiKey.
 * No live role (member removed) → empty set.
 */
export function applyAgentKeyPermissionCeiling(
  keyPermissions: Record<string, readonly string[]> | null | undefined,
  liveRole: OrgRole | undefined,
): PermissionSet {
  const keyPerms: Record<string, readonly string[]> = keyPermissions ?? {};
  const rolePerms: Record<string, readonly string[]> =
    liveRole === undefined ? {} : orgRoleToPermissionSet(liveRole);
  const effective = intersectPermissions(keyPerms, rolePerms);
  for (const resource of AGENT_FORBIDDEN_RESOURCES) {
    delete effective[resource];
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
  if (raw.valid !== true) {
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
 */
export async function createScopedAgentKey(
  input: CreateScopedAgentKeyInput,
): Promise<CreatedScopedAgentKey> {
  const permissions = compactPermissions(
    input.permissions ?? DEFAULT_AGENT_KEY_PERMISSIONS,
  );
  const metadata = { projectId: input.projectId, orgId: input.orgId };
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
      name: input.name ?? 'agent',
      permissions,
      metadata,
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
    metadata,
  };
}

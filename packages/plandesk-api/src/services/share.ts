import {
  createShare as dbCreateShare,
  getProject,
  getShare as dbGetShare,
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
  };
}

export type ShareService = ReturnType<typeof createShareService>;

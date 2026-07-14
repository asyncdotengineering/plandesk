import {
  createToken as dbCreateToken,
  listTokens as dbListTokens,
  revokeToken as dbRevokeToken,
  type Db,
} from '@plandesk/db';
import { serializeToken } from '../serialize.js';
import { resolveOrgId, type OrgScopedDeps } from './org-scope.js';

export type TokenServiceDeps = OrgScopedDeps & {
  db: Db;
};

export function createTokenService(deps: TokenServiceDeps) {
  const { db } = deps;

  return {
    async create(name: string) {
      const orgId = resolveOrgId(deps);
      const result = await dbCreateToken(db, { name, orgId });
      return {
        id: result.id,
        name: result.name,
        token: result.token,
      };
    },

    async list() {
      const orgId = resolveOrgId(deps);
      return (await dbListTokens(db, orgId)).map(serializeToken);
    },

    async revoke(id: string) {
      const orgId = resolveOrgId(deps);
      const revoked = await dbRevokeToken(db, id, orgId);
      if (!revoked) {
        return undefined;
      }
      return serializeToken(revoked);
    },
  };
}

export type TokenService = ReturnType<typeof createTokenService>;

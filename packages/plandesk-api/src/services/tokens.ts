import {
  createToken as dbCreateToken,
  listTokens as dbListTokens,
  revokeToken as dbRevokeToken,
  type Db,
} from '@plandesk/db';
import { serializeToken } from '../serialize.js';

export type TokenServiceDeps = {
  db: Db;
};

export function createTokenService(deps: TokenServiceDeps) {
  const { db } = deps;

  return {
    async create(name: string) {
      const result = await dbCreateToken(db, { name });
      return {
        id: result.id,
        name: result.name,
        token: result.token,
      };
    },

    async list() {
      return (await dbListTokens(db)).map(serializeToken);
    },

    async revoke(id: string) {
      const revoked = await dbRevokeToken(db, id);
      if (!revoked) {
        return undefined;
      }
      return serializeToken(revoked);
    },
  };
}

export type TokenService = ReturnType<typeof createTokenService>;

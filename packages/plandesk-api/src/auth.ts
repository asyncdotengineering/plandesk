import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

const BASIC_PREFIX = 'Basic ';
const BASIC_USER = 'plandesk';

function decodeBasicAuth(header: string): Buffer | undefined {
  if (!header.startsWith(BASIC_PREFIX)) {
    return undefined;
  }
  try {
    return Buffer.from(header.slice(BASIC_PREFIX.length), 'base64');
  } catch {
    return undefined;
  }
}

function credentialsMatch(provided: Buffer, expected: Buffer): boolean {
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

export function createAuthMiddleware(password: string): MiddlewareHandler {
  const expected = Buffer.from(`${BASIC_USER}:${password}`, 'utf8');

  return async (c, next) => {
    if (c.req.path.startsWith('/mcp')) {
      await next();
      return;
    }

    const decoded = decodeBasicAuth(c.req.header('Authorization') ?? '');
    if (decoded === undefined || !credentialsMatch(decoded, expected)) {
      return c.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': 'Basic realm="Plan Desk"',
      });
    }

    await next();
  };
}

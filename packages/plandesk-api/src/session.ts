import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';

/** Portal guest session after named join (share-scoped; no org membership). */
export const GUEST_SESSION_COOKIE = 'plandesk_guest';

export function readGuestSessionCookie(c: Context): string | undefined {
  const raw = getCookie(c, GUEST_SESSION_COOKIE);
  return raw !== undefined && raw.length > 0 ? raw : undefined;
}

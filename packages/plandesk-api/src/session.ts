import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

/** Browser session cookie minted by the GitHub OAuth redirect flow. */
export const SESSION_COOKIE = 'plandesk_session';

/** Short-lived CSRF cookie holding the `state` we sent to GitHub. */
export const OAUTH_STATE_COOKIE = 'plandesk_oauth_state';

/** The OAuth round trip is seconds; give it minutes, not hours. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export function readSessionCookie(c: Context): string | undefined {
  const raw = getCookie(c, SESSION_COOKIE);
  return raw !== undefined && raw.length > 0 ? raw : undefined;
}

/**
 * HttpOnly so script cannot read it, Secure so it never crosses plain HTTP,
 * SameSite=Lax so a cross-site POST cannot ride it while the post-OAuth
 * top-level GET redirect still arrives with the cookie attached.
 */
export function setSessionCookie(c: Context, token: string, expiresAt: Date): void {
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });
}

export function setOAuthStateCookie(c: Context, state: string): void {
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
}

export function readOAuthStateCookie(c: Context): string | undefined {
  const raw = getCookie(c, OAUTH_STATE_COOKIE);
  return raw !== undefined && raw.length > 0 ? raw : undefined;
}

export function clearOAuthStateCookie(c: Context): void {
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });
}

import { isLoopbackBind } from './auth.js';

/**
 * The origin for a URL Plan Desk hands to someone else — a share link, an
 * artifact frame's CSP. One owner, so a link and the page it opens can never
 * disagree about where the server lives.
 *
 * Prefers `PLANDESK_BASE_URL` when set (deployment-configured, not
 * attacker-controllable). Otherwise uses the request URL's origin.
 *
 * Host-header hazard: when `PLANDESK_BASE_URL` is unset, the request origin
 * derives from `Host`. A poisoned Host would name an attacker origin. Hosted
 * deployments already require `PLANDESK_BASE_URL` for better-auth; local
 * loopback serves are not remotely reachable.
 */
export function resolvePublicOrigin(
  requestUrl: string,
  envBaseUrl: string | undefined = typeof process !== 'undefined'
    ? process.env.PLANDESK_BASE_URL
    : undefined,
): string {
  const fromEnv = envBaseUrl?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv.replace(/\/$/, '');
  }
  return new URL(requestUrl).origin;
}

/** Who can open a URL on this origin: only this host, or the wider network. */
export type Reach = 'this_machine' | 'network';

export function reachOf(origin: string): Reach {
  return isLoopbackBind(new URL(origin).hostname) ? 'this_machine' : 'network';
}

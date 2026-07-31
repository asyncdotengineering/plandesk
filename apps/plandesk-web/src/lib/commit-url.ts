/**
 * Build a host-known commit URL from a project's repo remote and a SHA.
 * Returns null when the host's commit URL shape is unknown — callers render
 * plain text rather than guessing a dead link.
 */

const SCP_STYLE = /^([^@\s/:]+)@([^@\s:]+):(.+)$/;

const KNOWN_COMMIT_HOSTS = new Set(['github.com', 'gitlab.com']);

/** Normalise https/http/ssh/git and scp-style remotes to an https origin+path. */
function normalizeRepoHttpBase(repoUrl: string): { host: string; pathname: string } | null {
  let url: URL;
  if (!repoUrl.includes('://') && SCP_STYLE.test(repoUrl)) {
    const match = SCP_STYLE.exec(repoUrl);
    if (match === null) {
      return null;
    }
    const host = match[2];
    const path = match[3];
    if (host === undefined || path === undefined) {
      return null;
    }
    try {
      url = new URL(`https://${host}/${path}`);
    } catch {
      return null;
    }
  } else {
    try {
      url = new URL(repoUrl);
    } catch {
      return null;
    }
  }

  // ssh://git@github.com/org/repo.git → host is github.com
  const host = url.hostname.toLowerCase();
  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('.git')) {
    pathname = pathname.slice(0, -4);
  }
  if (pathname === '' || pathname === '/') {
    return null;
  }
  return { host, pathname };
}

/**
 * null when the host's commit URL shape is unknown — render plain text, never a guess.
 */
export function commitUrl(repoUrl: string | null, sha: string): string | null {
  if (repoUrl === null || repoUrl === '') {
    return null;
  }
  const base = normalizeRepoHttpBase(repoUrl);
  if (base === null) {
    return null;
  }
  if (!KNOWN_COMMIT_HOSTS.has(base.host)) {
    return null;
  }
  return `https://${base.host}${base.pathname}/commit/${sha}`;
}

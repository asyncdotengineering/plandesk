/**
 * Shared validation for project repo binding fields.
 * Used by the HTTP route and MCP tool schemas — one policy, both boundaries.
 */

const ALLOWED_REPO_SCHEMES = new Set(['http:', 'https:', 'ssh:', 'git:']);

/**
 * scp-style remote: `user@host:path` (e.g. `git@github.com:org/repo.git`).
 * Must not contain `://` (those are scheme URLs handled separately).
 * User component must not contain `:` — otherwise `javascript:…@host:path`
 * takes this branch and never reaches the scheme allowlist.
 */
const SCP_STYLE_REPO = /^[^@\s/:]+@[^@\s:]+:[^@\s].*$/;

/**
 * Accept repository remotes: `https://`, `http://`, `ssh://`, `git://`, and
 * scp-style `user@host:path`. Reject every other scheme (including
 * `javascript:`, `data:`, `file:`, `vbscript:`).
 */
export function isValidRepoUrl(value: string): boolean {
  if (value.trim() === '') {
    return false;
  }
  if (!value.includes('://') && SCP_STYLE_REPO.test(value)) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return ALLOWED_REPO_SCHEMES.has(parsed.protocol);
}

/**
 * Path relative to the repo root: never absolute, never `..`, no empty
 * segments, no leading/trailing slashes. Rejects POSIX absolute, Windows
 * drive paths, and UNC forms.
 */
export function isValidFolderPath(value: string): boolean {
  if (value === '') {
    return false;
  }
  if (value.startsWith('/') || value.endsWith('/')) {
    return false;
  }
  // UNC: `\\server\share` or `//server/share`
  if (value.startsWith('\\\\') || value.startsWith('//')) {
    return false;
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.endsWith('/')) {
    return false;
  }
  // Every Windows drive prefix — absolute (`C:\…`) and drive-relative
  // (`C:..\secret`, `C:relative\path`). The latter escapes the repo root
  // under path.win32.resolve.
  if (/^[A-Za-z]:/.test(normalized)) {
    return false;
  }
  const segments = normalized.split('/');
  return segments.every((segment) => segment !== '' && segment !== '..');
}

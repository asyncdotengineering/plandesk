/**
 * Loopback-only filesystem intake for MCP byte tools.
 *
 * Rule 14: a caller-supplied path is a read primitive. Three gates stop
 * abuse: (1) loopback bind only, (2) path must resolve under the repo that
 * owns `.plandesk/`, (3) the subsequent create still asserts project org scope.
 */
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, basename, extname } from 'node:path';
import { isLoopbackBind } from '@plandesk/api';
import { toolInvalidArgument, type ToolResult } from './result.js';

export const FILE_PATH_REMOTE_ERROR =
  'file_path requires a local server; this one is remote — use content_base64';

export const FILE_PATH_REMOTE_ERROR_CONTENT =
  'file_path requires a local server; this one is remote — use content_base64';

/** Walk up from startDir for a `.plandesk/` directory (same as CLI). */
export function findPlandeskDir(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, '.plandesk');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Resolve `filePath` to an absolute path under the project root that owns
 * `.plandesk/`. Returns null on escape / missing binding — fail closed.
 *
 * **Containment is checked on real paths, never lexical ones.** `resolve()`
 * does not follow symlinks, so a link planted inside a project and pointing
 * anywhere on disk used to pass the check and return the target's bytes
 * (`/etc/passwd`, `~/.ssh/id_rsa`). An agent writes files into its repo as a
 * matter of course, so planting that link is not an obstacle for it.
 *
 * The order matters: realpath FIRST, then derive the project root from the
 * real location. Deriving the root from the pre-realpath path would let a link
 * borrow the authority of the directory it merely appears to sit in.
 *
 * The root is still allowed to come from the file's own location rather than
 * `cwd` — a workspace legitimately spans repos, and the server's cwd is not
 * necessarily the project being attached to.
 */
export function resolveProjectScopedPath(
  filePath: string,
  cwd: string = process.cwd(),
): string | null {
  const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);

  let realTarget: string;
  try {
    // The file need not exist yet; realpath the deepest existing ancestor so a
    // symlinked *parent* cannot smuggle the target out either.
    realTarget = existsSync(absolute)
      ? realpathSync(absolute)
      : join(realpathSync(dirname(absolute)), basename(absolute));
  } catch {
    return null;
  }

  // Derive the boundary from where the file REALLY is, not where it claims to be.
  const fromFile = findPlandeskDir(dirname(realTarget));
  const fromCwd = findPlandeskDir(cwd);
  const plandeskDir = fromFile ?? fromCwd;
  if (plandeskDir === undefined) {
    return null;
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(dirname(plandeskDir));
  } catch {
    return null;
  }

  const rel = relative(realRoot, realTarget);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }
  return realTarget;
}

export function assertLoopbackFilePath(bindHost: string): ToolResult | null {
  if (isLoopbackBind(bindHost)) {
    return null;
  }
  return toolInvalidArgument(FILE_PATH_REMOTE_ERROR);
}

export function readScopedFileBytes(
  filePath: string,
  bindHost: string,
  cwd?: string,
): { ok: true; bytes: Buffer; absolutePath: string } | { ok: false; error: ToolResult } {
  const remote = assertLoopbackFilePath(bindHost);
  if (remote !== null) {
    return { ok: false, error: remote };
  }
  const absolute = resolveProjectScopedPath(filePath, cwd);
  if (absolute === null) {
    return {
      ok: false,
      error: toolInvalidArgument('file_path must resolve inside the project directory'),
    };
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    return { ok: false, error: toolInvalidArgument('file_path does not exist or is not a file') };
  }
  return { ok: true, bytes: readFileSync(absolute), absolutePath: absolute };
}

export function mimeFromFilename(filename: string): string {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.md':
    case '.markdown':
      return 'text/markdown';
    default:
      return 'application/octet-stream';
  }
}

export function filenameFromPath(filePath: string): string {
  return basename(filePath);
}

/** Exactly one of `a` and `b` must be a non-empty string. */
export function xorPresent(a: string | undefined, b: string | undefined): boolean {
  const hasA = typeof a === 'string' && a.length > 0;
  const hasB = typeof b === 'string' && b.length > 0;
  return hasA !== hasB;
}

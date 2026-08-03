/**
 * Loopback-only filesystem intake for MCP byte tools.
 *
 * Rule 14: a caller-supplied path is a read primitive. Three gates stop
 * abuse: (1) loopback bind only, (2) path must resolve under a project root
 * registered in the bound workspace, (3) the subsequent create still asserts
 * project org scope.
 */
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, basename, extname } from 'node:path';
import { isLoopbackBind } from '@plandesk/api';
import { isValidRegisteredRepoRoot } from '@plandesk/db';
import { toolInvalidArgument, type ToolResult } from './result.js';

export const FILE_PATH_REMOTE_ERROR =
  'file_path requires a local server; this one is remote — use content_base64';

export const FILE_PATH_OUTSIDE_WORKSPACE_ERROR =
  'file_path must resolve under a project registered in this workspace; use content_base64';

export type WorkspaceRootsResolver = () => Promise<string[]>;

export const emptyWorkspaceRoots: WorkspaceRootsResolver = () => Promise.resolve([]);

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
 * Resolve `filePath` to an absolute path under one of the workspace's
 * registered project roots. Returns null on escape / missing binding — fail closed.
 *
 * **Containment is checked on real paths, never lexical ones.**
 */
export async function resolveProjectScopedPath(
  filePath: string,
  workspaceRoots: WorkspaceRootsResolver,
  cwd: string = process.cwd(),
): Promise<string | null> {
  const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);

  let realTarget: string;
  try {
    realTarget = existsSync(absolute)
      ? realpathSync(absolute)
      : join(realpathSync(dirname(absolute)), basename(absolute));
  } catch {
    return null;
  }

  const roots = await workspaceRoots();
  for (const root of roots) {
    if (!isValidRegisteredRepoRoot(root)) {
      continue;
    }
    let realRoot: string;
    try {
      realRoot = realpathSync(root);
    } catch {
      continue;
    }
    const rel = relative(realRoot, realTarget);
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      return realTarget;
    }
  }
  return null;
}

export function assertLoopbackFilePath(bindHost: string): ToolResult | null {
  if (isLoopbackBind(bindHost)) {
    return null;
  }
  return toolInvalidArgument(FILE_PATH_REMOTE_ERROR);
}

export type ScopedFilePathDeps = {
  cwd?: string;
  workspaceRoots: WorkspaceRootsResolver;
};

export async function readScopedFileBytes(
  filePath: string,
  bindHost: string,
  deps: ScopedFilePathDeps,
): Promise<{ ok: true; bytes: Buffer; absolutePath: string } | { ok: false; error: ToolResult }> {
  const remote = assertLoopbackFilePath(bindHost);
  if (remote !== null) {
    return { ok: false, error: remote };
  }
  const absolute = await resolveProjectScopedPath(
    filePath,
    deps.workspaceRoots,
    deps.cwd ?? process.cwd(),
  );
  if (absolute === null) {
    return {
      ok: false,
      error: toolInvalidArgument(FILE_PATH_OUTSIDE_WORKSPACE_ERROR),
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

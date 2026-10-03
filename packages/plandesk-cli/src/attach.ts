import { readFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { mimeFromFilename } from '@plandesk/api';
import { getBoundProjectId, resolvePlandeskBinding } from './connect-artifacts.js';
import { findLocalPlandeskDir } from './args.js';

export class AttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachError';
  }
}

export type PreparedUpload = {
  projectId: string;
  plandeskDir: string;
  /** Repo root: the directory holding `.plandesk/`. */
  root: string;
  absolute: string;
  base: string;
  headers: Record<string, string>;
};

/**
 * Shared preamble of `attach` and `push-artifact`: the repo's binding, its
 * bound project, a path gated to the repo root, and the request base + headers.
 * `fail` builds the calling command's error type.
 */
export function prepareUpload(
  repoDir: string,
  filePath: string,
  fail: (message: string) => Error,
): PreparedUpload {
  const binding = resolvePlandeskBinding(repoDir);
  if (binding === undefined) {
    throw fail('No Plan Desk binding in this repo — run `plandesk connect` first.');
  }
  const projectId = getBoundProjectId(binding.config);
  if (projectId === undefined) {
    throw fail('No project bound — run `plandesk connect --project <name>`.');
  }
  const plandeskDir = findLocalPlandeskDir(repoDir);
  if (plandeskDir === undefined) {
    throw fail('No .plandesk directory found.');
  }
  const root = resolve(plandeskDir, '..');
  const absolute = resolve(repoDir, filePath);
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw fail('file must be inside the project directory');
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (binding.token !== undefined) {
    headers.Authorization = `Bearer ${binding.token}`;
  }
  return { projectId, plandeskDir, root, absolute, base: binding.config.serverUrl, headers };
}

/**
 * `plandesk attach <file>` — read a local image and POST it via the existing
 * files API (base64 on the wire). Prints the returned URL.
 */
export async function runAttach(
  filePath: string,
  options: { repoDir: string } = { repoDir: process.cwd() },
): Promise<{ url: string; fileId: string }> {
  const { absolute, projectId, base, headers } = prepareUpload(
    options.repoDir,
    filePath,
    (message) => new AttachError(message),
  );

  let bytes: Buffer;
  try {
    bytes = readFileSync(absolute);
  } catch {
    throw new AttachError(`cannot read file: ${filePath}`);
  }

  const filename = basename(absolute);
  const mime = mimeFromFilename(filename);

  const res = await fetch(`${base}/api/v1/projects/${projectId}/files`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filename,
      mime,
      content_base64: bytes.toString('base64'),
    }),
  });
  if (!res.ok) {
    throw new AttachError(`upload failed: ${String(res.status)} ${await res.text()}`);
  }
  const body = (await res.json()) as { id: string; url: string };
  return { fileId: body.id, url: body.url.startsWith('http') ? body.url : `${base}${body.url}` };
}

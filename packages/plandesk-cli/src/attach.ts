import { readFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import {
  getBoundProjectId,
  normalizeServerUrl,
  resolvePlandeskBinding,
} from './connect-artifacts.js';
import { findLocalPlandeskDir } from './args.js';

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function assertUnderProjectRoot(root: string, absolute: string): void {
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AttachError('file must be inside the project directory');
  }
}

export class AttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachError';
  }
}

/**
 * `plandesk attach <file>` — read a local image and POST it via the existing
 * files API (base64 on the wire). Prints the returned URL.
 */
export async function runAttach(
  filePath: string,
  options: { repoDir: string } = { repoDir: process.cwd() },
): Promise<{ url: string; fileId: string }> {
  const binding = resolvePlandeskBinding(options.repoDir);
  if (binding === undefined) {
    throw new AttachError('No Plan Desk binding in this repo — run `plandesk connect` first.');
  }
  const projectId = getBoundProjectId(binding.config);
  if (projectId === undefined) {
    throw new AttachError('No project bound — run `plandesk connect --project <name>`.');
  }

  const plandeskDir = findLocalPlandeskDir(options.repoDir);
  if (plandeskDir === undefined) {
    throw new AttachError('No .plandesk directory found.');
  }
  const root = resolve(plandeskDir, '..');
  const absolute = resolve(options.repoDir, filePath);
  assertUnderProjectRoot(root, absolute);

  let bytes: Buffer;
  try {
    bytes = readFileSync(absolute);
  } catch {
    throw new AttachError(`cannot read file: ${filePath}`);
  }

  const filename = basename(absolute);
  const mime = mimeFromFilename(filename);
  const base = normalizeServerUrl(binding.config.serverUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (binding.token !== undefined) {
    headers.Authorization = `Bearer ${binding.token}`;
  }

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

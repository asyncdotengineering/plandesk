import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  getBoundProjectId,
  normalizeServerUrl,
  resolvePlandeskBinding,
} from './connect-artifacts.js';
import { findLocalPlandeskDir } from './args.js';

const ARTIFACT_SENTINEL_RE = /<!--\s*plandesk-artifact:([0-9a-f-]{36})\s*-->/i;
const PUSH_MAP = 'artifact-pushes.json';

type PushMap = Record<
  string,
  {
    artifactId: string;
    basedOnRevisionId: string | null;
  }
>;

export class PushArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushArtifactError';
  }
}

function assertUnderProjectRoot(root: string, absolute: string): void {
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new PushArtifactError('file must be inside the project directory');
  }
}

function readPushMap(plandeskDir: string): PushMap {
  const path = join(plandeskDir, PUSH_MAP);
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PushMap;
  } catch {
    return {};
  }
}

function writePushMap(plandeskDir: string, map: PushMap): void {
  if (!existsSync(plandeskDir)) {
    mkdirSync(plandeskDir, { recursive: true });
  }
  writeFileSync(join(plandeskDir, PUSH_MAP), `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

function ensureSentinel(content: string, artifactId: string): string {
  if (ARTIFACT_SENTINEL_RE.test(content)) {
    return content.replace(ARTIFACT_SENTINEL_RE, `<!-- plandesk-artifact:${artifactId} -->`);
  }
  if (/<!doctype html>/i.test(content)) {
    return content.replace(
      /<!doctype html>/i,
      (m) => `${m}\n<!-- plandesk-artifact:${artifactId} -->`,
    );
  }
  return `<!-- plandesk-artifact:${artifactId} -->\n${content}`;
}

function mapKey(root: string, absolute: string): string {
  return relative(root, absolute).split('\\').join('/');
}

type ApiHeaders = Record<string, string>;

async function apiJson(
  url: string,
  headers: ApiHeaders,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const mergedHeaders: ApiHeaders = { ...headers };
  if (init?.headers !== undefined) {
    const extra = new Headers(init.headers);
    extra.forEach((value, key) => {
      mergedHeaders[key] = value;
    });
  }
  const res = await fetch(url, { ...init, headers: mergedHeaders });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: res.status, body: text };
  }
}

function asRecord(body: unknown): Record<string, unknown> | null {
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return null;
}

/**
 * `plandesk push-artifact <file> [--prototype <name>] [--force]`
 */
export async function runPushArtifact(
  filePath: string,
  options: {
    repoDir: string;
    prototypeName?: string;
    force?: boolean;
  },
): Promise<{ url: string; artifactId: string; created: boolean; forced: boolean }> {
  const binding = resolvePlandeskBinding(options.repoDir);
  if (binding === undefined) {
    throw new PushArtifactError(
      'No Plan Desk binding in this repo — run `plandesk connect` first.',
    );
  }
  const projectId = getBoundProjectId(binding.config);
  if (projectId === undefined) {
    throw new PushArtifactError('No project bound — run `plandesk connect --project <name>`.');
  }

  const plandeskDir = findLocalPlandeskDir(options.repoDir);
  if (plandeskDir === undefined) {
    throw new PushArtifactError('No .plandesk directory found.');
  }
  const root = resolve(plandeskDir, '..');
  const absolute = resolve(options.repoDir, filePath);
  assertUnderProjectRoot(root, absolute);

  const content = readFileSync(absolute, 'utf8');
  const titleFromFile = basename(absolute).replace(/\.(html?|md|markdown)$/i, '');
  const kind = /\.html?$/i.test(absolute) ? 'html' : 'markdown';

  const base = normalizeServerUrl(binding.config.serverUrl);
  const headers: ApiHeaders = { 'Content-Type': 'application/json' };
  if (binding.token !== undefined) {
    headers.Authorization = `Bearer ${binding.token}`;
  }

  let prototypeId: string | undefined;
  const prototypeName = options.prototypeName?.trim();
  if (prototypeName !== undefined && prototypeName !== '') {
    if (kind !== 'html') {
      throw new PushArtifactError('--prototype requires an HTML file');
    }
    const list = await apiJson(`${base}/api/v1/projects/${projectId}/prototypes`, headers);
    if (list.status !== 200 || !Array.isArray(list.body)) {
      throw new PushArtifactError(`failed to list prototypes: ${String(list.status)}`);
    }
    const existing = (list.body as Array<{ id: string; name: string }>).find(
      (p) => p.name.toLowerCase() === prototypeName.toLowerCase(),
    );
    if (existing !== undefined) {
      prototypeId = existing.id;
    } else {
      const createdProto = await apiJson(
        `${base}/api/v1/projects/${projectId}/prototypes`,
        headers,
        {
          method: 'POST',
          body: JSON.stringify({
            name: prototypeName,
            viewport_width: 390,
            viewport_height: 844,
          }),
        },
      );
      const createdBody = asRecord(createdProto.body);
      if (
        createdProto.status !== 201 ||
        createdBody === null ||
        typeof createdBody.id !== 'string'
      ) {
        throw new PushArtifactError(`failed to create prototype: ${String(createdProto.status)}`);
      }
      prototypeId = createdBody.id;
    }
  }

  const map = readPushMap(plandeskDir);
  const key = mapKey(root, absolute);
  const sentinelMatch = content.match(ARTIFACT_SENTINEL_RE);
  const knownId = sentinelMatch?.[1] ?? map[key]?.artifactId;
  const basedOn = map[key]?.basedOnRevisionId ?? null;
  let forced = false;

  if (knownId !== undefined) {
    const current = await apiJson(`${base}/api/v1/artifacts/${knownId}`, headers);
    const currentBody = asRecord(current.body);
    if (
      current.status === 200 &&
      currentBody !== null &&
      typeof currentBody.revision_id === 'string'
    ) {
      const rev = currentBody.revision_id;
      if (basedOn !== null && basedOn !== rev) {
        if (options.force !== true) {
          throw new PushArtifactError(
            `board has changed since your last push (${rev}); yours is based on ${basedOn}`,
          );
        }
        forced = true;
      }
      const withSentinel = ensureSentinel(content, knownId);
      const patched = await apiJson(`${base}/api/v1/artifacts/${knownId}`, headers, {
        method: 'PATCH',
        body: JSON.stringify({
          content: withSentinel,
          ...(prototypeId !== undefined ? { prototype_id: prototypeId } : {}),
        }),
      });
      const patchedBody = asRecord(patched.body);
      if (
        patched.status !== 200 ||
        patchedBody === null ||
        typeof patchedBody.revision_id !== 'string'
      ) {
        throw new PushArtifactError(`update failed: ${String(patched.status)}`);
      }
      writeFileSync(absolute, withSentinel, 'utf8');
      map[key] = { artifactId: knownId, basedOnRevisionId: patchedBody.revision_id };
      writePushMap(plandeskDir, map);
      return {
        url: `${base}/api/v1/artifacts/${knownId}`,
        artifactId: knownId,
        created: false,
        forced,
      };
    }
  }

  const created = await apiJson(`${base}/api/v1/projects/${projectId}/artifacts`, headers, {
    method: 'POST',
    body: JSON.stringify({
      title: titleFromFile,
      kind,
      content,
      ...(prototypeId !== undefined ? { prototype_id: prototypeId } : {}),
    }),
  });
  const createdBody = asRecord(created.body);
  if (created.status !== 201 || createdBody === null || typeof createdBody.id !== 'string') {
    throw new PushArtifactError(`create failed: ${String(created.status)}`);
  }
  const newId = createdBody.id;
  const withSentinel = ensureSentinel(content, newId);
  const patched = await apiJson(`${base}/api/v1/artifacts/${newId}`, headers, {
    method: 'PATCH',
    body: JSON.stringify({ content: withSentinel }),
  });
  const patchedBody = asRecord(patched.body);
  if (
    patched.status !== 200 ||
    patchedBody === null ||
    typeof patchedBody.revision_id !== 'string'
  ) {
    throw new PushArtifactError(`failed to write artifact sentinel: ${String(patched.status)}`);
  }
  writeFileSync(absolute, withSentinel, 'utf8');
  map[key] = { artifactId: newId, basedOnRevisionId: patchedBody.revision_id };
  writePushMap(plandeskDir, map);
  return {
    url: `${base}/api/v1/artifacts/${newId}`,
    artifactId: newId,
    created: true,
    forced: false,
  };
}

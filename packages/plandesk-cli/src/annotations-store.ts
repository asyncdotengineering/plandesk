import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type ArtifactAnnotation = {
  id: string;
  passage: string | null;
  anchor: string | null;
  body: string;
  resolved: boolean;
  createdAt: string;
};

export type AnnotationStore = {
  path: string;
  contentHash: string;
  annotations: ArtifactAnnotation[];
};

const DEFAULT_STORE_DIR = join(homedir(), '.plandesk', 'annotations');

/** Return the SHA-256 hex digest of artifact content. */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Return the sidecar path associated with an absolute artifact path. */
export function annotationStorePath(absPath: string, storeDir = DEFAULT_STORE_DIR): string {
  const filename = `${createHash('sha256').update(absPath).digest('hex')}.json`;
  return join(resolve(storeDir), filename);
}

function readStore(absPath: string, storeDir?: string): AnnotationStore | undefined {
  const path = annotationStorePath(absPath, storeDir);
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as AnnotationStore;
}

function writeStore(store: AnnotationStore, storeDir?: string): void {
  const path = annotationStorePath(store.path, storeDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export function listAnnotations(absPath: string, storeDir?: string): ArtifactAnnotation[] {
  return readStore(absPath, storeDir)?.annotations ?? [];
}

export function addAnnotation(
  absPath: string,
  content: string,
  input: { passage?: string | null; anchor?: string | null; body: string },
  storeDir?: string,
): ArtifactAnnotation {
  if (input.body.trim().length === 0) {
    throw new Error('Annotation body must not be empty or whitespace');
  }

  const annotation: ArtifactAnnotation = {
    id: randomUUID(),
    passage: input.passage ?? null,
    anchor: input.anchor ?? null,
    body: input.body,
    resolved: false,
    createdAt: new Date().toISOString(),
  };
  const existing = readStore(absPath, storeDir);
  writeStore(
    {
      path: absPath,
      contentHash: computeContentHash(content),
      annotations: [...(existing?.annotations ?? []), annotation],
    },
    storeDir,
  );
  return annotation;
}

export function resolveAnnotation(absPath: string, id: string, storeDir?: string): boolean {
  const store = readStore(absPath, storeDir);
  if (!store) {
    return false;
  }
  const annotation = store.annotations.find((candidate) => candidate.id === id);
  if (!annotation) {
    return false;
  }
  annotation.resolved = true;
  writeStore(store, storeDir);
  return true;
}

export function isStale(absPath: string, currentContent: string, storeDir?: string): boolean {
  const store = readStore(absPath, storeDir);
  return store !== undefined && store.contentHash !== computeContentHash(currentContent);
}

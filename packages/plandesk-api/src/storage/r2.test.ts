import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDb,
  createProject,
  createProjectInDefaultOrg,
  DEFAULT_ORG_ID,
  migrate,
  type Db,
} from '@plandesk/db';
import { createApp } from '../server.js';
import { createServices } from '../services/index.js';
import { runWithAuthContext } from '../auth-context.js';
import { orgRoleToPermissionSet } from '../permissions.js';
import { parseJson } from '../test-helpers.js';
import { createR2Adapter, type R2BucketLike } from './r2.js';

type Stored = {
  body: Uint8Array;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

/** In-memory R2Bucket; `keys()` exposes what was written for assertions. */
function createFakeR2Bucket(): R2BucketLike & { keys(): string[] } {
  const store = new Map<string, Stored>();

  return {
    keys() {
      return [...store.keys()];
    },
    async put(key, value, options) {
      let body: Uint8Array;
      if (value === null) {
        body = new Uint8Array();
      } else if (typeof value === 'string') {
        body = new TextEncoder().encode(value);
      } else if (value instanceof ArrayBuffer) {
        body = new Uint8Array(value);
      } else if (ArrayBuffer.isView(value)) {
        body = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      } else {
        body = new Uint8Array(await value.arrayBuffer());
      }
      store.set(key, {
        body: new Uint8Array(body),
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
      });
      return undefined;
    },
    async get(key) {
      const entry = store.get(key);
      if (entry === undefined) {
        return null;
      }
      const copy = entry.body.slice();
      return {
        arrayBuffer: async (): Promise<ArrayBuffer> =>
          copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer,
        httpMetadata: entry.httpMetadata,
        customMetadata: entry.customMetadata,
      };
    },
    async head(key) {
      const entry = store.get(key);
      if (entry === undefined) {
        return null;
      }
      return { httpMetadata: entry.httpMetadata, customMetadata: entry.customMetadata };
    },
  };
}

async function freshDb(): Promise<Db> {
  const db = await createDb(':memory:');
  await migrate(db);
  return db;
}

type UploadedFileResponse = {
  id: string;
  url: string;
  filename: string;
  mime: string;
  size: number;
};

describe('createR2Adapter (REQ-1)', () => {
  it('uploads through the route (persists the files row) and serves the bytes back', async () => {
    const db = await freshDb();
    const bucket = createFakeR2Bucket();
    const services = createServices({ db, storage: createR2Adapter({ db, bucket }) });
    // Loopback bind → owner context at DEFAULT_ORG_ID, matching the hosted upload path.
    const app = createApp({ db, services, bindHost: '127.0.0.1' });

    const project = await createProjectInDefaultOrg(db, { name: 'R2 files' });
    const bytes = Buffer.from('fake-png-bytes', 'utf8');

    const createRes = await app.request(`/api/v1/projects/${project.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'shot.png',
        mime: 'image/png',
        content_base64: bytes.toString('base64'),
      }),
    });
    // Without the persisted files row this is a 500 ("did not persist file metadata").
    expect(createRes.status).toBe(201);
    const created = await parseJson<UploadedFileResponse>(createRes);
    expect(created.id).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(created.size).toBe(bytes.length);

    // Bytes are stored under the project-scoped key, never a bare content id.
    expect(bucket.keys()).toContain(`${project.id}/${created.id}`);
    expect(bucket.keys()).not.toContain(created.id);

    const getRes = await app.request(created.url);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/png');
    const body = Buffer.from(await getRes.arrayBuffer());
    expect(body).toEqual(bytes);
  });

  it('org-scopes resolve: another org cannot read the bytes by content id', async () => {
    const db = await freshDb();
    const bucket = createFakeR2Bucket();
    const adapter = createR2Adapter({ db, bucket });

    const otherOrgId = '00000000-0000-4000-8000-0000000000b2';
    const projectA = await createProjectInDefaultOrg(db, { name: 'Tenant A' });
    await createProject(db, {
      id: '00000000-0000-4000-8000-0000000000c3',
      orgId: otherOrgId,
      name: 'Tenant B',
    });

    const bytes = Buffer.from('tenant-a-secret', 'utf8');
    const ownerCtx = {
      kind: 'loopback' as const,
      orgId: DEFAULT_ORG_ID,
      role: 'owner' as const,
      permission: orgRoleToPermissionSet('owner'),
    };
    const put = await runWithAuthContext(ownerCtx, () =>
      adapter.put({ projectId: projectA.id, bytes, filename: 'a.txt', mime: 'text/plain' }),
    );

    // Owning org resolves the bytes.
    const mine = await runWithAuthContext(ownerCtx, () => adapter.resolve(put.id));
    expect(mine).not.toBeNull();
    if (mine === null || 'redirectUrl' in mine) {
      throw new Error('expected bytes for the owning org');
    }
    expect(Buffer.from(mine.bytes)).toEqual(bytes);
    expect(mine.mime).toBe('text/plain');

    // A different org gets null even though it knows the content id.
    const theirs = await runWithAuthContext(
      {
        kind: 'loopback' as const,
        orgId: otherOrgId,
        role: 'owner' as const,
        permission: orgRoleToPermissionSet('owner'),
      },
      () => adapter.resolve(put.id),
    );
    expect(theirs).toBeNull();

    // Unauthenticated / unknown / empty ids resolve to null.
    expect(await adapter.resolve(put.id)).toBeNull();
    expect(
      await runWithAuthContext(ownerCtx, () => adapter.resolve('deadbeef'.repeat(8))),
    ).toBeNull();
    expect(await runWithAuthContext(ownerCtx, () => adapter.resolve(''))).toBeNull();
  });
});

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { AwsClient } from 'aws4fetch';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  createFile,
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
import type { S3Config } from '../read-server-env.js';
import { StorageError } from './adapter.js';
import { createS3Adapter } from './s3.js';

async function freshDb(): Promise<Db> {
  const db = await createDb(':memory:');
  await migrate(db);
  return db;
}

const ownerCtx = {
  kind: 'loopback' as const,
  orgId: DEFAULT_ORG_ID,
  role: 'owner' as const,
  permission: orgRoleToPermissionSet('owner'),
};

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const sha256 = (bytes: Buffer) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');

type UploadedFileResponse = { id: string; url: string; size: number };

describe('createS3Adapter against a fake fetch', () => {
  const creds = { bucket: 'plans', accessKeyId: 'AKIDTEST', secretAccessKey: 'secret' };
  let requests: Request[];
  let reply: (req: Request) => Response;

  beforeAll(() => {
    vi.stubGlobal('fetch', (input: Request) => {
      requests.push(input.clone());
      return Promise.resolve(reply(input));
    });
  });
  afterAll(() => vi.unstubAllGlobals());
  afterEach(() => {
    requests = [];
  });
  requests = [];
  const nth = (i: number): Request => {
    const req = requests[i];
    if (req === undefined) throw new Error(`no request #${String(i)}`);
    return req;
  };

  it('PUTs path-style to {endpoint}/{bucket}/{projectId}/{sha256} with SigV4 and content-type', async () => {
    const db = await freshDb();
    const project = await createProjectInDefaultOrg(db, { name: 'S3 fake' });
    reply = () => new Response(null, { status: 200 });
    const adapter = createS3Adapter({
      db,
      config: { ...creds, region: 'us-east-1', endpoint: 'http://minio.test:9000/' },
    });

    const put = await adapter.put({
      projectId: project.id,
      bytes: PNG,
      filename: 'dot.png',
      mime: 'image/png',
    });

    expect(put).toEqual({ id: sha256(PNG), url: `/api/v1/files/${sha256(PNG)}` });
    expect(requests).toHaveLength(1);
    const req = nth(0);
    expect(req.method).toBe('PUT');
    expect(req.url).toBe(`http://minio.test:9000/plans/${project.id}/${sha256(PNG)}`);
    expect(req.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTEST\//);
    expect(req.headers.get('authorization')).toContain('/us-east-1/s3/aws4_request');
    expect(req.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await req.arrayBuffer())).toEqual(PNG);

    // resolve: a signed GET to the same key, served with the row's mime + filename.
    reply = () => new Response(new Uint8Array(PNG), { status: 200 });
    const got = await runWithAuthContext(ownerCtx, () => adapter.resolve(put.id));
    expect(got).toEqual({ bytes: PNG, mime: 'image/png', filename: 'dot.png' });
    const get = nth(1);
    expect(get.method).toBe('GET');
    expect(get.url).toBe(`http://minio.test:9000/plans/${project.id}/${sha256(PNG)}`);
    expect(get.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('targets https://s3.{region}.amazonaws.com/{bucket}/... when no endpoint is set', async () => {
    const db = await freshDb();
    const project = await createProjectInDefaultOrg(db, { name: 'S3 aws' });
    reply = () => new Response(null, { status: 200 });
    const adapter = createS3Adapter({ db, config: { ...creds, region: 'eu-west-2' } });

    await adapter.put({ projectId: project.id, bytes: PNG, filename: 'a.png', mime: 'image/png' });

    expect(nth(0).url).toBe(
      `https://s3.eu-west-2.amazonaws.com/plans/${project.id}/${sha256(PNG)}`,
    );
    expect(nth(0).headers.get('authorization')).toContain('/eu-west-2/s3/aws4_request');
  });

  it('throws StorageError with the status on a non-2xx PUT and records no file row', async () => {
    const db = await freshDb();
    const project = await createProjectInDefaultOrg(db, { name: 'S3 denied' });
    reply = () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
    const adapter = createS3Adapter({ db, config: { ...creds, region: 'us-east-1' } });

    const err = await adapter
      .put({ projectId: project.id, bytes: PNG, filename: 'a.png', mime: 'image/png' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).status).toBe(403);

    // No row: resolve finds nothing and never reaches the bucket.
    const before = requests.length;
    expect(await runWithAuthContext(ownerCtx, () => adapter.resolve(sha256(PNG)))).toBeNull();
    expect(requests).toHaveLength(before);
  });

  it('never signs a request outside {bucket}/{projectId}/ for a traversal-shaped file id', async () => {
    const db = await freshDb();
    const project = await createProjectInDefaultOrg(db, { name: 'S3 traversal' });
    const adapter = createS3Adapter({ db, config: { ...creds, region: 'us-east-1' } });
    reply = () => new Response(new Uint8Array(PNG), { status: 200 });
    // Imported rows carry ids verbatim; these would normalise to another
    // project's key, or (`..`) to the bucket root listing.
    for (const id of [`../victim-project/${sha256(PNG)}`, '..', '%2e%2e']) {
      await createFile(db, {
        id,
        projectId: project.id,
        filename: 'x.png',
        mime: 'image/png',
        size: PNG.length,
        bytes: null,
        externalUrl: null,
      });
      expect(await runWithAuthContext(ownerCtx, () => adapter.resolve(id))).toBeNull();
    }
    expect(requests).toHaveLength(0);
  });

  it('resolves to null when the bucket answers 404 for a known row', async () => {
    const db = await freshDb();
    const project = await createProjectInDefaultOrg(db, { name: 'S3 gone' });
    const adapter = createS3Adapter({ db, config: { ...creds, region: 'us-east-1' } });
    reply = () => new Response(null, { status: 200 });
    const put = await adapter.put({
      projectId: project.id,
      bytes: PNG,
      filename: 'a.png',
      mime: 'image/png',
    });

    reply = () => new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
    expect(await runWithAuthContext(ownerCtx, () => adapter.resolve(put.id))).toBeNull();
  });
});

// --- E2E against a real MinIO -------------------------------------------------

const dockerReady = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
// MinIO deleted minio/minio from Docker Hub (and locked quay.io) in 2026;
// Chainguard's free build is the same server binary as its entrypoint.
const MINIO_IMAGE = 'cgr.dev/chainguard/minio:latest';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      // 7526 is the owner's live board; never take it.
      srv.close(() => {
        resolve(port === 7526 ? freePort() : port);
      });
    });
  });
}

describe.skipIf(!dockerReady)(
  `createS3Adapter against MinIO in Docker${dockerReady ? '' : ' (skipped: docker daemon not reachable)'}`,
  () => {
    const name = `plandesk-s3-test-${randomBytes(4).toString('hex')}`;
    let endpoint: string;
    let config: S3Config;

    beforeAll(async () => {
      const port = await freePort();
      const user = `test${randomBytes(4).toString('hex')}`;
      const password = randomBytes(16).toString('hex');
      const run = spawnSync(
        'docker',
        [
          'run',
          '-d',
          '--rm',
          '--name',
          name,
          '-p',
          `127.0.0.1:${String(port)}:9000`,
          '-e',
          `MINIO_ROOT_USER=${user}`,
          '-e',
          `MINIO_ROOT_PASSWORD=${password}`,
          MINIO_IMAGE,
          'server',
          '/tmp/data',
        ],
        { encoding: 'utf8' },
      );
      if (run.status !== 0) throw new Error(`docker run minio failed: ${run.stderr}`);
      endpoint = `http://127.0.0.1:${String(port)}`;
      config = {
        bucket: 'plandesk-e2e',
        region: 'us-east-1',
        accessKeyId: user,
        secretAccessKey: password,
        endpoint,
      };

      const deadline = Date.now() + 60_000;
      for (;;) {
        const live = await fetch(`${endpoint}/minio/health/live`).catch(() => undefined);
        if (live?.ok) break;
        if (Date.now() > deadline) throw new Error('minio did not become live within 60s');
        await new Promise((r) => setTimeout(r, 250));
      }
      const client = new AwsClient({ ...config, service: 's3' });
      const made = await client.fetch(`${endpoint}/${config.bucket}`, { method: 'PUT' });
      if (!made.ok) throw new Error(`create bucket: ${String(made.status)} ${await made.text()}`);
    }, 120_000);

    afterAll(() => {
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    });

    it('uploads a PNG through the REST route, stores it under {projectId}/{sha256}, and serves the same bytes', async () => {
      const db = await freshDb();
      const adapter = createS3Adapter({ db, config });
      const services = createServices({ db, storage: adapter });
      const app = createApp({ db, services, bindHost: '127.0.0.1' });
      const project = await createProjectInDefaultOrg(db, { name: 'MinIO files' });

      const up = await app.request(`/api/v1/projects/${project.id}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'dot.png',
          mime: 'image/png',
          content_base64: PNG.toString('base64'),
        }),
      });
      expect(up.status).toBe(201);
      const created = await parseJson<UploadedFileResponse>(up);
      expect(created.id).toBe(sha256(PNG));
      expect(created.size).toBe(PNG.length);

      // The object really is in the bucket, at the project-scoped key.
      const client = new AwsClient({ ...config, service: 's3' });
      const raw = await client.fetch(`${endpoint}/${config.bucket}/${project.id}/${created.id}`);
      expect(raw.status).toBe(200);
      expect(Buffer.from(await raw.arrayBuffer())).toEqual(PNG);

      const down = await app.request(created.url);
      expect(down.status).toBe(200);
      expect(down.headers.get('Content-Type')).toBe('image/png');
      expect(Buffer.from(await down.arrayBuffer())).toEqual(PNG);
    });

    it('org-scopes resolve and maps a missing object to null', async () => {
      const db = await freshDb();
      const adapter = createS3Adapter({ db, config });
      const project = await createProjectInDefaultOrg(db, { name: 'MinIO scope' });
      const bytes = randomBytes(64);
      const put = await runWithAuthContext(ownerCtx, () =>
        adapter.put({ projectId: project.id, bytes, filename: 'x.bin', mime: 'application/x' }),
      );

      const other = { ...ownerCtx, orgId: '00000000-0000-4000-8000-0000000000b2' };
      expect(await runWithAuthContext(other, () => adapter.resolve(put.id))).toBeNull();
      expect(await adapter.resolve(put.id)).toBeNull();

      const client = new AwsClient({ ...config, service: 's3' });
      const del = await client.fetch(`${endpoint}/${config.bucket}/${project.id}/${put.id}`, {
        method: 'DELETE',
      });
      expect(del.ok).toBe(true);
      expect(await runWithAuthContext(ownerCtx, () => adapter.resolve(put.id))).toBeNull();
    });
  },
);

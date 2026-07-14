import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import { createFile, getFile, listFilesByProject } from './files.js';

function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('files repository', () => {
  let db: Db;
  let projectId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Files' })).id;
  });

  it('creates and retrieves a file by content-hash id', async () => {
    const bytes = Buffer.from('fake-png-bytes', 'utf8');
    const id = hashOf(bytes);
    const created = await createFile(db, {
      id,
      projectId,
      filename: 'shot.png',
      mime: 'image/png',
      size: bytes.length,
      bytes,
    });
    expect(created.id).toBe(id);
    expect(created.bytes).toEqual(bytes);

    const fetched = await getFile(db, projectId, id);
    expect(fetched?.filename).toBe('shot.png');
    expect(fetched?.mime).toBe('image/png');
    expect(fetched?.size).toBe(bytes.length);
    expect(fetched?.bytes).toEqual(bytes);
    expect(fetched?.externalUrl).toBeNull();
  });

  it('returns undefined for a missing file', async () => {
    expect(await getFile(db, projectId, 'deadbeef')).toBeUndefined();
  });

  it('upserts by id: re-creating the same content hash does not duplicate the row', async () => {
    const bytes = Buffer.from('same-bytes', 'utf8');
    const id = hashOf(bytes);
    const first = await createFile(db, {
      id,
      projectId,
      filename: 'first.png',
      mime: 'image/png',
      size: bytes.length,
      bytes,
    });
    const second = await createFile(db, {
      id,
      projectId,
      filename: 'second.png',
      mime: 'image/png',
      size: bytes.length,
      bytes,
    });
    expect(second.id).toBe(first.id);
    expect(second.filename).toBe('first.png');
    expect(await listFilesByProject(db, projectId)).toHaveLength(1);
  });

  it('stores an external-url file with null bytes', async () => {
    const id = hashOf(Buffer.from('external', 'utf8'));
    const created = await createFile(db, {
      id,
      projectId,
      filename: 'remote.png',
      mime: 'image/png',
      size: 42,
      externalUrl: 'https://cdn.example.com/remote.png',
    });
    expect(created.bytes).toBeNull();
    expect(created.externalUrl).toBe('https://cdn.example.com/remote.png');
  });

  it('lists files scoped to a project', async () => {
    const a = hashOf(Buffer.from('a', 'utf8'));
    const b = hashOf(Buffer.from('b', 'utf8'));
    await createFile(db, { id: a, projectId, filename: 'a.png', mime: 'image/png', size: 1 });
    await createFile(db, { id: b, projectId, filename: 'b.png', mime: 'image/png', size: 1 });
    const other = (await createProject(db, { name: 'Other' })).id;
    const c = hashOf(Buffer.from('c', 'utf8'));
    await createFile(db, { id: c, projectId: other, filename: 'c.png', mime: 'image/png', size: 1 });

    expect(await listFilesByProject(db, projectId)).toHaveLength(2);
    expect(await listFilesByProject(db, other)).toHaveLength(1);
  });
});

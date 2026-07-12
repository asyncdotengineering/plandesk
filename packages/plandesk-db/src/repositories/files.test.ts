import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
import { createFile, getFile, listFilesByProject } from './files.js';

function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('files repository', () => {
  const db = createDb(':memory:');
  let projectId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM files');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Files' }).id;
  });

  it('creates and retrieves a file by content-hash id', () => {
    const bytes = Buffer.from('fake-png-bytes', 'utf8');
    const id = hashOf(bytes);
    const created = createFile(db, {
      id,
      projectId,
      filename: 'shot.png',
      mime: 'image/png',
      size: bytes.length,
      bytes,
    });
    expect(created.id).toBe(id);
    expect(created.bytes).toEqual(bytes);

    const fetched = getFile(db, id);
    expect(fetched?.filename).toBe('shot.png');
    expect(fetched?.mime).toBe('image/png');
    expect(fetched?.size).toBe(bytes.length);
    expect(fetched?.bytes).toEqual(bytes);
    expect(fetched?.externalUrl).toBeNull();
  });

  it('returns undefined for a missing file', () => {
    expect(getFile(db, 'deadbeef')).toBeUndefined();
  });

  it('upserts by id: re-creating the same content hash does not duplicate the row', () => {
    const bytes = Buffer.from('same-bytes', 'utf8');
    const id = hashOf(bytes);
    const first = createFile(db, {
      id,
      projectId,
      filename: 'first.png',
      mime: 'image/png',
      size: bytes.length,
      bytes,
    });
    const second = createFile(db, {
      id,
      projectId,
      filename: 'second.png',
      mime: 'image/png',
      size: bytes.length,
      bytes,
    });
    expect(second.id).toBe(first.id);
    expect(second.filename).toBe('first.png');
    expect(listFilesByProject(db, projectId)).toHaveLength(1);
  });

  it('stores an external-url file with null bytes', () => {
    const id = hashOf(Buffer.from('external', 'utf8'));
    const created = createFile(db, {
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

  it('lists files scoped to a project', () => {
    const a = hashOf(Buffer.from('a', 'utf8'));
    const b = hashOf(Buffer.from('b', 'utf8'));
    createFile(db, { id: a, projectId, filename: 'a.png', mime: 'image/png', size: 1 });
    createFile(db, { id: b, projectId, filename: 'b.png', mime: 'image/png', size: 1 });
    const other = createProject(db, { name: 'Other' }).id;
    const c = hashOf(Buffer.from('c', 'utf8'));
    createFile(db, { id: c, projectId: other, filename: 'c.png', mime: 'image/png', size: 1 });

    expect(listFilesByProject(db, projectId)).toHaveLength(2);
    expect(listFilesByProject(db, other)).toHaveLength(1);
  });
});

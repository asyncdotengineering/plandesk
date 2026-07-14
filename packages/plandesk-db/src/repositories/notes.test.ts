import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import {
  createNote,
  deleteNote,
  deleteNotesByProjectId,
  getNote,
  getNoteByProjectAndId,
  listNotes,
  updateNote,
} from './notes.js';

describe('notes repository', () => {
  let db: Db;
  let projectId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Notes' })).id;
  });

  it('creates and retrieves a note', async () => {
    const created = await createNote(db, {
      projectId,
      title: 'Working note',
      body: '<p>scratch</p>',
    });
    const fetched = await getNote(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.title).toBe('Working note');
    expect(fetched?.body).toBe('<p>scratch</p>');
  });

  it('defaults body to null', async () => {
    const created = await createNote(db, { projectId, title: 'Titled only' });
    expect(created.body).toBeNull();
  });

  it('returns undefined for a missing note', async () => {
    expect(await getNote(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists notes for a project', async () => {
    await createNote(db, { projectId, title: 'One' });
    await createNote(db, { projectId, title: 'Two' });
    const other = (await createProject(db, { name: 'Other' })).id;
    await createNote(db, { projectId: other, title: 'Elsewhere' });
    expect(await listNotes(db, projectId)).toHaveLength(2);
  });

  it('scopes getNoteByProjectAndId to the project', async () => {
    const note = await createNote(db, { projectId, title: 'Scoped' });
    expect((await getNoteByProjectAndId(db, projectId, note.id))?.id).toBe(note.id);
    const other = (await createProject(db, { name: 'Other' })).id;
    expect(await getNoteByProjectAndId(db, other, note.id)).toBeUndefined();
  });

  it('updates a note and bumps updated_at', async () => {
    const created = await createNote(db, { projectId, title: 'Before', body: 'v1' });
    const updated = await updateNote(db, created.id, { title: 'After', body: 'v2' });
    expect(updated?.title).toBe('After');
    expect(updated?.body).toBe('v2');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('deletes a note', async () => {
    const created = await createNote(db, { projectId, title: 'Doomed' });
    expect(await deleteNote(db, created.id)).toBe(true);
    expect(await getNote(db, created.id)).toBeUndefined();
    expect(await deleteNote(db, created.id)).toBe(false);
  });

  it('deletes all notes for a project', async () => {
    await createNote(db, { projectId, title: 'One' });
    await createNote(db, { projectId, title: 'Two' });
    expect(await deleteNotesByProjectId(db, projectId)).toBe(2);
    expect(await listNotes(db, projectId)).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
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
  const db = createDb(':memory:');
  let projectId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM notes');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Notes' }).id;
  });

  it('creates and retrieves a note', () => {
    const created = createNote(db, {
      projectId,
      title: 'Working note',
      body: '<p>scratch</p>',
    });
    const fetched = getNote(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.title).toBe('Working note');
    expect(fetched?.body).toBe('<p>scratch</p>');
  });

  it('defaults body to null', () => {
    const created = createNote(db, { projectId, title: 'Titled only' });
    expect(created.body).toBeNull();
  });

  it('returns undefined for a missing note', () => {
    expect(getNote(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists notes for a project', () => {
    createNote(db, { projectId, title: 'One' });
    createNote(db, { projectId, title: 'Two' });
    const other = createProject(db, { name: 'Other' }).id;
    createNote(db, { projectId: other, title: 'Elsewhere' });
    expect(listNotes(db, projectId)).toHaveLength(2);
  });

  it('scopes getNoteByProjectAndId to the project', () => {
    const note = createNote(db, { projectId, title: 'Scoped' });
    expect(getNoteByProjectAndId(db, projectId, note.id)?.id).toBe(note.id);
    const other = createProject(db, { name: 'Other' }).id;
    expect(getNoteByProjectAndId(db, other, note.id)).toBeUndefined();
  });

  it('updates a note and bumps updated_at', () => {
    const created = createNote(db, { projectId, title: 'Before', body: 'v1' });
    const updated = updateNote(db, created.id, { title: 'After', body: 'v2' });
    expect(updated?.title).toBe('After');
    expect(updated?.body).toBe('v2');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('deletes a note', () => {
    const created = createNote(db, { projectId, title: 'Doomed' });
    expect(deleteNote(db, created.id)).toBe(true);
    expect(getNote(db, created.id)).toBeUndefined();
    expect(deleteNote(db, created.id)).toBe(false);
  });

  it('deletes all notes for a project', () => {
    createNote(db, { projectId, title: 'One' });
    createNote(db, { projectId, title: 'Two' });
    expect(deleteNotesByProjectId(db, projectId)).toBe(2);
    expect(listNotes(db, projectId)).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  getNote,
  migrate,
  type Db,
} from '@plandesk/db';
import { createNoteService, InvalidNoteError } from './notes.js';

describe('noteService', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Notes' });
    projectId = project.id;
    orgId = project.orgId;
  });

  function createService() {
    return createNoteService({ db, orgId });
  }

  it('creates a note', async () => {
    const note = await createService().create(projectId, { title: 'Note' });
    expect(note?.title).toBe('Note');
    if (note === undefined) {
      throw new Error('missing created note');
    }
    expect(await getNote(db, note.id)).toBeDefined();
  });

  it('updates and deletes a note', async () => {
    const service = createService();
    const note = await service.create(projectId, { title: 'Before' });
    expect(note).toBeDefined();
    if (!note) {
      return;
    }

    const updated = await service.update(note.id, { title: 'After' });
    expect(updated?.title).toBe('After');
    expect(await service.delete(note.id)).toBe(true);
    expect(await getNote(db, note.id)).toBeUndefined();
  });

  it('returns undefined when the project does not exist', async () => {
    expect(
      await createService().create('00000000-0000-4000-8000-000000009999', { title: 'Orphan' }),
    ).toBeUndefined();
  });

  it('throws InvalidNoteError on blank title', async () => {
    const service = createService();
    await expect(service.create(projectId, { title: '  ' })).rejects.toThrow(InvalidNoteError);
    const note = await service.create(projectId, { title: 'Valid' });
    expect(note).toBeDefined();
    if (!note) {
      return;
    }
    await expect(service.update(note.id, { title: '' })).rejects.toThrow(InvalidNoteError);
  });
});

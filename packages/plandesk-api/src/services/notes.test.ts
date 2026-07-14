import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, createProject, migrate , type Db} from '@plandesk/db';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createNoteService, InvalidNoteError } from './notes.js';

describe('noteService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
  const eventBus = createEventBus();
  let projectId = '';

  function createService() {
    return createNoteService({ db, eventBus });
  }

  beforeEach(async () => {
    await migrate(db);
    await db.$client.execute('DELETE FROM notes');
    await db.$client.execute('DELETE FROM projects');
    projectId = (await createProject(db, { name: 'Notes' })).id;
  });

  it('emits note_created on create', async () => {
    const events: PlankDeskEvent[] = [];
    const unsub = eventBus.subscribe((event) => events.push(event));
    const note = await createService().create(projectId, { title: 'Note' });
    unsub();
    expect(note?.title).toBe('Note');
    expect(events).toEqual([{ type: 'note_created', noteId: note?.id, projectId }]);
  });

  it('emits note_updated on update and delete', async () => {
    const service = createService();
    const note = await service.create(projectId, { title: 'Before' });
    expect(note).toBeDefined();
    if (!note) {
      return;
    }

    const events: PlankDeskEvent[] = [];
    const unsub = eventBus.subscribe((event) => events.push(event));
    await service.update(note.id, { title: 'After' });
    await service.delete(note.id);
    unsub();

    expect(events).toEqual([
      { type: 'note_updated', noteId: note.id, projectId },
      { type: 'note_updated', noteId: note.id, projectId },
    ]);
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

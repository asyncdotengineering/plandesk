import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, createProject, migrate } from '@plandesk/db';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createNoteService, InvalidNoteError } from './notes.js';

describe('noteService', () => {
  const db = createDb(':memory:');
  const eventBus = createEventBus();
  let projectId = '';

  function createService() {
    return createNoteService({ db, eventBus });
  }

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM notes');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Notes' }).id;
  });

  it('emits note_created on create', () => {
    const events: PlankDeskEvent[] = [];
    const unsub = eventBus.subscribe((event) => events.push(event));
    const note = createService().create(projectId, { title: 'Note' });
    unsub();
    expect(note?.title).toBe('Note');
    expect(events).toEqual([{ type: 'note_created', noteId: note?.id, projectId }]);
  });

  it('emits note_updated on update and delete', () => {
    const service = createService();
    const note = service.create(projectId, { title: 'Before' });
    expect(note).toBeDefined();
    if (!note) {
      return;
    }

    const events: PlankDeskEvent[] = [];
    const unsub = eventBus.subscribe((event) => events.push(event));
    service.update(note.id, { title: 'After' });
    service.delete(note.id);
    unsub();

    expect(events).toEqual([
      { type: 'note_updated', noteId: note.id, projectId },
      { type: 'note_updated', noteId: note.id, projectId },
    ]);
  });

  it('returns undefined when the project does not exist', () => {
    expect(
      createService().create('00000000-0000-4000-8000-000000009999', { title: 'Orphan' }),
    ).toBeUndefined();
  });

  it('throws InvalidNoteError on blank title', () => {
    const service = createService();
    expect(() => service.create(projectId, { title: '  ' })).toThrow(InvalidNoteError);
    const note = service.create(projectId, { title: 'Valid' });
    expect(note).toBeDefined();
    if (!note) {
      return;
    }
    expect(() => service.update(note.id, { title: '' })).toThrow(InvalidNoteError);
  });
});

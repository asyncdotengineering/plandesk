import type { NoteService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetNoteHandler(
  noteService: NoteService,
): (args: { note_id: string }) => ToolResult {
  return ({ note_id }) => {
    const note = noteService.get(note_id);
    if (!note) {
      return toolNotFound();
    }
    return toolSuccess('note', note);
  };
}

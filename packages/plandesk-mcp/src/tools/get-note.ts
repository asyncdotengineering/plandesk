import type { NoteService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetNoteHandler(
  noteService: NoteService,
): (args: { note_id: string }) => Promise<ToolResult> {
  return async ({ note_id }) => {
    const note = await noteService.get(note_id);
    if (!note) {
      return toolNotFound();
    }
    return toolSuccess('note', note);
  };
}

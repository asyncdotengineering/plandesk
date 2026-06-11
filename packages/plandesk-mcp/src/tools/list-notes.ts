import type { NoteService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListNotesHandler(
  noteService: NoteService,
): (args: { project_id: string }) => ToolResult {
  return ({ project_id }) => {
    const notes = noteService.list(project_id);
    if (!notes) {
      return toolNotFound();
    }
    return toolSuccess('notes', notes);
  };
}

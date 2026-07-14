import type { NoteService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListNotesHandler(
  noteService: NoteService,
): (args: { project_id: string }) => Promise<ToolResult> {
  return async ({ project_id }) => {
    const notes = await noteService.list(project_id);
    if (!notes) {
      return toolNotFound();
    }
    return toolSuccess('notes', notes);
  };
}

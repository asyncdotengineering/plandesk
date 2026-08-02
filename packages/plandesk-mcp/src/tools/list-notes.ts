import type { NoteService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListNotesHandler(
  noteService: NoteService,
): (args: { project_id: string; verbose?: boolean }) => Promise<ToolResult> {
  return async ({ project_id, verbose }) => {
    const notes = await noteService.list(project_id);
    if (!notes) {
      return toolNotFound();
    }
    if (verbose) {
      return toolSuccess('notes', notes);
    }
    return toolSuccess(
      'notes',
      notes.map((note) => {
        const { body, ...summary } = note;
        void body;
        return summary;
      }),
    );
  };
}

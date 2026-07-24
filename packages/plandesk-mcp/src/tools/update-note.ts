import type { NoteService } from '@plandesk/api';
import { InvalidNoteError } from '@plandesk/api';
import { ensureHtmlBody } from './markdown.js';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createUpdateNoteHandler(
  noteService: NoteService,
): (args: { note_id: string; title?: string; body?: string }) => Promise<ToolResult> {
  return async (args) => {
    try {
      const note = await noteService.update(args.note_id, {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.body !== undefined ? { body: ensureHtmlBody(args.body) } : {}),
      });
      if (!note) {
        return toolNotFound();
      }
      return toolSuccess('note', note);
    } catch (error) {
      if (error instanceof InvalidNoteError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}

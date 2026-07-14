import { Hono } from 'hono';
import { InvalidNoteError, type NoteService } from '../services/notes.js';
import { parsePaginationParams } from '../serialize.js';

type CreateNoteBody = {
  title?: string;
  body?: string | null;
};

type UpdateNoteBody = {
  title?: string;
  body?: string | null;
};

export function createNotesRouter(noteService: NoteService): Hono {
  const router = new Hono();

  router.get('/projects/:id/notes', async (c) => {
    const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
    if (pagination === 'invalid') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const notes = await noteService.list(c.req.param('id'), pagination);
    if (!notes) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(notes);
  });

  router.post('/projects/:id/notes', async (c) => {
    const body = await c.req.json<CreateNoteBody>();
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const note = await noteService.create(c.req.param('id'), {
        title: body.title,
        body: body.body,
      });

      if (!note) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(note, 201);
    } catch (error) {
      if (error instanceof InvalidNoteError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.get('/notes/:id', async (c) => {
    const note = await noteService.get(c.req.param('id'));
    if (!note) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(note);
  });

  router.patch('/notes/:id', async (c) => {
    const body = await c.req.json<UpdateNoteBody>();

    try {
      const note = await noteService.update(c.req.param('id'), {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
      });

      if (!note) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(note);
    } catch (error) {
      if (error instanceof InvalidNoteError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.delete('/notes/:id', async (c) => {
    const deleted = await noteService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  return router;
}

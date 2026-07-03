import { Hono } from 'hono';
import { InvalidFolderError, type FolderService } from '../services/folders.js';

type CreateFolderBody = {
  name?: string;
  parent_folder_id?: string | null;
};

type UpdateFolderBody = {
  name?: string;
  parent_folder_id?: string | null;
};

export function createFoldersRouter(folderService: FolderService): Hono {
  const router = new Hono();

  router.get('/projects/:id/folders', (c) => {
    const folders = folderService.list(c.req.param('id'));
    if (!folders) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(folders);
  });

  router.post('/projects/:id/folders', async (c) => {
    const body = await c.req.json<CreateFolderBody>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const folder = folderService.create(c.req.param('id'), {
        name: body.name,
        parentFolderId: body.parent_folder_id,
      });

      if (!folder) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(folder, 201);
    } catch (error) {
      if (error instanceof InvalidFolderError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.get('/folders/:id', (c) => {
    const folder = folderService.get(c.req.param('id'));
    if (!folder) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(folder);
  });

  router.patch('/folders/:id', async (c) => {
    const body = await c.req.json<UpdateFolderBody>();

    try {
      const folder = folderService.update(c.req.param('id'), {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.parent_folder_id !== undefined ? { parentFolderId: body.parent_folder_id } : {}),
      });

      if (!folder) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(folder);
    } catch (error) {
      if (error instanceof InvalidFolderError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.delete('/folders/:id', (c) => {
    const deleted = folderService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  return router;
}

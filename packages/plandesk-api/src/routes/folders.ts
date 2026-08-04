import { invalidArgument, invalidRequest } from './errors.js';
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

  router.get('/projects/:id/folders', async (c) => {
    const folders = await folderService.list(c.req.param('id'));
    if (!folders) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(folders);
  });

  router.post('/projects/:id/folders', async (c) => {
    const body = await c.req.json<CreateFolderBody>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return invalidArgument(c, 'name', 'name is required and must be a non-empty string');
    }

    try {
      const folder = await folderService.create(c.req.param('id'), {
        name: body.name,
        parentFolderId: body.parent_folder_id,
      });

      if (!folder) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(folder, 201);
    } catch (error) {
      if (error instanceof InvalidFolderError) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.get('/folders/:id', async (c) => {
    const folder = await folderService.get(c.req.param('id'));
    if (!folder) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(folder);
  });

  router.patch('/folders/:id', async (c) => {
    const body = await c.req.json<UpdateFolderBody>();

    try {
      const folder = await folderService.update(c.req.param('id'), {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.parent_folder_id !== undefined ? { parentFolderId: body.parent_folder_id } : {}),
      });

      if (!folder) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(folder);
    } catch (error) {
      if (error instanceof InvalidFolderError) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.delete('/folders/:id', async (c) => {
    const deleted = await folderService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  return router;
}

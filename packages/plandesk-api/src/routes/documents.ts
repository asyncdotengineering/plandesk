import { invalidArgument, invalidRequest } from './errors.js';
import { Hono } from 'hono';
import { InvalidDocumentError, type DocumentService } from '../services/documents.js';
import { parsePaginationParams } from '../serialize.js';

type CreateDocumentBody = {
  title?: string;
  body?: string | null;
  status_line?: string | null;
  parent_id?: string | null;
  folder_id?: string | null;
};

type UpdateDocumentBody = {
  title?: string;
  body?: string | null;
  status_line?: string | null;
  parent_id?: string | null;
  folder_id?: string | null;
};

export function createDocumentsRouter(documentService: DocumentService): Hono {
  const router = new Hono();

  router.get('/projects/:id/documents', async (c) => {
    const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
    if (pagination === 'invalid') {
      return invalidRequest(c, 'limit and offset must be non-negative integers');
    }
    const tree = await documentService.listTree(c.req.param('id'), pagination);
    if (!tree) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(tree);
  });

  router.post('/projects/:id/documents', async (c) => {
    const body = await c.req.json<CreateDocumentBody>();
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return invalidArgument(c, 'title', 'title is required and must be a non-empty string');
    }

    try {
      const document = await documentService.create(c.req.param('id'), {
        title: body.title,
        body: body.body,
        statusLine: body.status_line,
        parentId: body.parent_id,
        folderId: body.folder_id,
      });

      if (!document) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(document, 201);
    } catch (error) {
      if (error instanceof InvalidDocumentError) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.get('/documents/:id', async (c) => {
    const document = await documentService.get(c.req.param('id'));
    if (!document) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(document);
  });

  router.patch('/documents/:id', async (c) => {
    const body = await c.req.json<UpdateDocumentBody>();

    try {
      const document = await documentService.update(c.req.param('id'), {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.status_line !== undefined ? { statusLine: body.status_line } : {}),
        ...(body.parent_id !== undefined ? { parentId: body.parent_id } : {}),
        ...(body.folder_id !== undefined ? { folderId: body.folder_id } : {}),
      });

      if (!document) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(document);
    } catch (error) {
      if (error instanceof InvalidDocumentError) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.delete('/documents/:id', async (c) => {
    const deleted = await documentService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  router.get('/tasks/:id/document', async (c) => {
    const document = await documentService.getByTask(c.req.param('id'));
    if (!document) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(document);
  });

  router.post('/documents/:id/convert-bullets', async (c) => {
    const body = await c.req.json<{ labels?: unknown }>();
    if (
      !Array.isArray(body.labels) ||
      !body.labels.every((item): item is string => typeof item === 'string')
    ) {
      return invalidArgument(c, 'labels', 'labels must be an array');
    }

    const result = await documentService.convertBullets(c.req.param('id'), body.labels);
    if (!result) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(result, 201);
  });

  // To-side lookup: every entity pointing at this document.
  router.get('/documents/:id/backlinks', async (c) => {
    const backlinks = await documentService.listBacklinks('document', c.req.param('id'));
    if (!backlinks) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(backlinks);
  });

  // To-side lookup: every entity (typically documents) pointing at this task.
  router.get('/tasks/:id/backlinks', async (c) => {
    const backlinks = await documentService.listBacklinks('task', c.req.param('id'));
    if (!backlinks) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(backlinks);
  });

  return router;
}

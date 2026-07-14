import { Hono } from 'hono';
import { InvalidDocumentError, type DocumentService } from '../services/documents.js';
import { parsePaginationParams } from '../serialize.js';

type CreateDocumentBody = {
  title?: string;
  body?: string | null;
  status_line?: string | null;
  parent_id?: string | null;
  folder_id?: string | null;
  linked_task_id?: string | null;
  linkedTaskId?: string | null;
  linkedNodeId?: string | null;
};

type UpdateDocumentBody = {
  title?: string;
  body?: string | null;
  status_line?: string | null;
  parent_id?: string | null;
  folder_id?: string | null;
  linked_task_id?: string | null;
  linkedTaskId?: string | null;
  linkedNodeId?: string | null;
};

function resolveLinkedTaskId(body: {
  linked_task_id?: string | null;
  linkedTaskId?: string | null;
  linkedNodeId?: string | null;
}): string | null | undefined {
  if (body.linked_task_id !== undefined) {
    return body.linked_task_id;
  }
  if (body.linkedTaskId !== undefined) {
    return body.linkedTaskId;
  }
  if (body.linkedNodeId !== undefined) {
    return body.linkedNodeId;
  }
  return undefined;
}

export function createDocumentsRouter(documentService: DocumentService): Hono {
  const router = new Hono();

  router.get('/projects/:id/documents', async (c) => {
    const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
    if (pagination === 'invalid') {
      return c.json({ error: 'invalid_argument' }, 400);
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
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const document = await documentService.create(c.req.param('id'), {
        title: body.title,
        body: body.body,
        statusLine: body.status_line,
        parentId: body.parent_id,
        folderId: body.folder_id,
        linkedTaskId: resolveLinkedTaskId(body),
      });

      if (!document) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(document, 201);
    } catch (error) {
      if (error instanceof InvalidDocumentError) {
        return c.json({ error: 'invalid_argument' }, 400);
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
    const linkedTaskId = resolveLinkedTaskId(body);

    try {
      const document = await documentService.update(c.req.param('id'), {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.status_line !== undefined ? { statusLine: body.status_line } : {}),
        ...(body.parent_id !== undefined ? { parentId: body.parent_id } : {}),
        ...(body.folder_id !== undefined ? { folderId: body.folder_id } : {}),
        ...(linkedTaskId !== undefined ? { linkedTaskId } : {}),
      });

      if (!document) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(document);
    } catch (error) {
      if (error instanceof InvalidDocumentError) {
        return c.json({ error: 'invalid_argument' }, 400);
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

  return router;
}

import { Hono } from 'hono';
import type { FileService } from '../services/files.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type UploadFileBody = {
  filename?: string;
  mime?: string;
  content_base64?: string;
};

// Content-Disposition is a quoted-string (RFC 6266): escape backslash/quote
// and strip anything outside printable ASCII so a hostile filename (CRLF,
// control chars) can't break out of the header.
function sanitizeFilenameForHeader(filename: string): string {
  return filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

export function createFilesRouter(fileService: FileService): Hono {
  const router = new Hono();

  router.post('/projects/:id/files', async (c) => {
    const body = await c.req.json<UploadFileBody>();

    if (typeof body.filename !== 'string' || body.filename.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (typeof body.mime !== 'string' || body.mime.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (typeof body.content_base64 !== 'string' || body.content_base64.length === 0) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    const bytes = Buffer.from(body.content_base64, 'base64');
    if (bytes.length > MAX_FILE_BYTES) {
      return c.json({ error: 'file_too_large' }, 413);
    }

    const file = await fileService.create({
      projectId: c.req.param('id'),
      filename: body.filename,
      mime: body.mime,
      bytes,
    });

    if (!file) {
      return c.json({ error: 'not_found' }, 404);
    }

    return c.json(file, 201);
  });

  router.get('/files/:id', async (c) => {
    const resolved = await fileService.get(c.req.param('id'));
    if (!resolved) {
      return c.json({ error: 'not_found' }, 404);
    }

    if ('redirectUrl' in resolved) {
      return c.redirect(resolved.redirectUrl, 302);
    }

    const headers: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
    };

    // Only image/* is safe to render inline; every other mime (including
    // text/html) is forced to download so a user-uploaded file can never
    // execute as active content in the browser.
    if (resolved.mime.startsWith('image/')) {
      headers['Content-Type'] = resolved.mime;
    } else {
      headers['Content-Type'] = 'application/octet-stream';
      headers['Content-Disposition'] =
        `attachment; filename="${sanitizeFilenameForHeader(resolved.filename)}"`;
    }

    return c.body(new Uint8Array(resolved.bytes), 200, headers);
  });

  return router;
}

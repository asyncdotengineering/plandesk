import { invalidArgument } from './errors.js';
import { Hono } from 'hono';
import type { Db } from '@plandesk/db';
import { runWithAuthContext } from '../auth-context.js';
import { orgRoleToPermissionSet } from '../permissions.js';
import type { FileService } from '../services/files.js';
import {
  fileAuthorizedByCredential,
  verifyFrameCredential,
} from '../services/frame-credential.js';
import type { StorageAdapter } from '../storage/adapter.js';

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

function fileResponseHeaders(
  mime: string,
  filename: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
  };

  // Only image/* is safe to render inline; every other mime (including
  // text/html) is forced to download so a user-uploaded file can never
  // execute as active content in the browser.
  if (mime.startsWith('image/')) {
    headers['Content-Type'] = mime;
  } else {
    headers['Content-Type'] = 'application/octet-stream';
    headers['Content-Disposition'] =
      `attachment; filename="${sanitizeFilenameForHeader(filename)}"`;
  }
  return headers;
}

export type FilesRouterDeps = {
  db: Db;
  storage: StorageAdapter;
};

export function createFilesRouter(fileService: FileService, deps: FilesRouterDeps): Hono {
  const { db, storage } = deps;
  const router = new Hono();

  router.post('/projects/:id/files', async (c) => {
    const body = await c.req.json<UploadFileBody>();

    if (typeof body.filename !== 'string' || body.filename.trim() === '') {
      return invalidArgument(c, 'filename', 'filename is required and must be a non-empty string');
    }
    if (typeof body.mime !== 'string' || body.mime.trim() === '') {
      return invalidArgument(c, 'mime', 'mime is required and must be a non-empty string');
    }
    if (typeof body.content_base64 !== 'string' || body.content_base64.length === 0) {
      return invalidArgument(c, 'content_base64', 'content_base64 must be a string');
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

  /**
   * Serve a file. Authenticated org members use the session path; opaque-origin
   * frames and portal guests pass `?token=` (share or render). One verification
   * point — verifyFrameCredential. Cross-project / cross-org ids 404.
   */
  router.get('/files/:id', async (c) => {
    const fileId = c.req.param('id');
    const rawToken = c.req.query('token');

    if (typeof rawToken === 'string' && rawToken.trim() !== '') {
      const credential = await verifyFrameCredential(db, rawToken);
      if (!credential) {
        return c.json({ error: 'not_found' }, 404);
      }
      const authorized = await fileAuthorizedByCredential(db, credential, fileId);
      if (!authorized) {
        return c.json({ error: 'not_found' }, 404);
      }
      // Local/S3/R2 adapters resolve via getFileInOrg, which needs AuthContext.
      // Token path skipped org middleware — bind a read-only loopback context
      // scoped to the credential's org so storage cannot cross tenants.
      const resolved = await runWithAuthContext(
        {
          kind: 'loopback',
          orgId: credential.orgId,
          role: 'owner',
          permission: orgRoleToPermissionSet('owner'),
        },
        () => storage.resolve(fileId),
      );
      if (!resolved) {
        return c.json({ error: 'not_found' }, 404);
      }
      if ('redirectUrl' in resolved) {
        return c.redirect(resolved.redirectUrl, 302);
      }
      return c.body(
        new Uint8Array(resolved.bytes),
        200,
        fileResponseHeaders(resolved.mime, resolved.filename),
      );
    }

    const resolved = await fileService.get(fileId);
    if (!resolved) {
      return c.json({ error: 'not_found' }, 404);
    }

    if ('redirectUrl' in resolved) {
      return c.redirect(resolved.redirectUrl, 302);
    }

    return c.body(
      new Uint8Array(resolved.bytes),
      200,
      fileResponseHeaders(resolved.mime, resolved.filename),
    );
  });

  return router;
}

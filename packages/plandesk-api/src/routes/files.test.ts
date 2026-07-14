import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProject } from '@plandesk/db';
import { createTestApp, parseJson } from '../test-helpers.js';

type UploadedFileResponse = {
  id: string;
  url: string;
  filename: string;
  mime: string;
  size: number;
};

describe('files routes', () => {
  it('uploads a file and serves it back with an image content-type', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Files' });

    const bytes = Buffer.from('fake-png-bytes', 'utf8');
    const contentBase64 = bytes.toString('base64');

    const createRes = await app.request(`/api/v1/projects/${project.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'shot.png', mime: 'image/png', content_base64: contentBase64 }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<UploadedFileResponse>(createRes);
    expect(created.id).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(created.url).toBe(`/api/v1/files/${created.id}`);
    expect(created.filename).toBe('shot.png');
    expect(created.mime).toBe('image/png');
    expect(created.size).toBe(bytes.length);

    const getRes = await app.request(created.url);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/png');
    expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(getRes.headers.get('Content-Disposition')).toBeNull();
    const body = Buffer.from(await getRes.arrayBuffer());
    expect(body).toEqual(bytes);
  });

  it('serves a non-image mime as an attachment download, never inline', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Docs upload' });

    const bytes = Buffer.from('<script>alert(1)</script>', 'utf8');
    const createRes = await app.request(`/api/v1/projects/${project.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'evil.html',
        mime: 'text/html',
        content_base64: bytes.toString('base64'),
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<UploadedFileResponse>(createRes);

    const getRes = await app.request(created.url);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(getRes.headers.get('Content-Disposition')).toBe('attachment; filename="evil.html"');
    expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sanitizes a hostile filename in Content-Disposition', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Hostile filename' });

    const bytes = Buffer.from('payload', 'utf8');
    const createRes = await app.request(`/api/v1/projects/${project.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'evil".pdf\r\nX-Injected: yes',
        mime: 'application/pdf',
        content_base64: bytes.toString('base64'),
      }),
    });
    const created = await parseJson<UploadedFileResponse>(createRes);

    const getRes = await app.request(created.url);
    expect(getRes.headers.get('X-Injected')).toBeNull();
    expect(getRes.headers.get('Content-Disposition')).toBe(
      'attachment; filename="evil\\".pdf__X-Injected: yes"',
    );
  });

  it('rejects a payload larger than 10MB with 413', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Too big' });

    const bytes = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const res = await app.request(`/api/v1/projects/${project.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'big.bin',
        mime: 'application/octet-stream',
        content_base64: bytes.toString('base64'),
      }),
    });
    expect(res.status).toBe(413);
  });

  it('rejects a missing mime with 400', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'No mime' });

    const res = await app.request(`/api/v1/projects/${project.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'shot.png', content_base64: 'aGVsbG8=' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown project on upload and an unknown file on get', async () => {
    const { app } = await createTestApp();

    const uploadRes = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/files',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'x.png',
          mime: 'image/png',
          content_base64: 'aGVsbG8=',
        }),
      },
    );
    expect(uploadRes.status).toBe(404);

    const getRes = await app.request('/api/v1/files/deadbeef');
    expect(getRes.status).toBe(404);
  });

  it('dedups identical bytes uploaded twice: same id, first filename wins', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Dedup' });
    const bytes = Buffer.from('same-content', 'utf8');
    const contentBase64 = bytes.toString('base64');

    const firstRes = await app.request(`/api/v1/projects/${project.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'first.png', mime: 'image/png', content_base64: contentBase64 }),
    });
    const first = await parseJson<UploadedFileResponse>(firstRes);

    const secondRes = await app.request(`/api/v1/projects/${project.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'second.png',
        mime: 'image/png',
        content_base64: contentBase64,
      }),
    });
    expect(secondRes.status).toBe(201);
    const second = await parseJson<UploadedFileResponse>(secondRes);

    expect(second.id).toBe(first.id);
    expect(second.filename).toBe('first.png');

    const countRow = (await db.$client.execute('SELECT COUNT(*) AS count FROM files')).rows[0];
    expect(Number(countRow?.['count'])).toBe(1);
  });
});

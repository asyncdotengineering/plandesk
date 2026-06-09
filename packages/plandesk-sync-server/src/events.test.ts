import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSyncToken, hashToken } from './auth.js';
import { createSyncServer } from './app.js';
import { createSyncDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { createShareNotifier } from './notifier.js';

type PortalEvent = {
  type: 'projection_updated';
};

function generateShareToken(): string {
  return `plandesk_share_${randomBytes(32).toString('base64url')}`;
}

function parseSseChunk(chunk: string): PortalEvent[] {
  const events: PortalEvent[] = [];
  for (const part of chunk.split('\n\n')) {
    for (const line of part.split('\n')) {
      if (line.startsWith('data: ')) {
        events.push(JSON.parse(line.slice(6)) as PortalEvent);
      }
    }
  }
  return events;
}

const sampleView = {
  project: { global_id: 'gid-1', name: 'Portal Project', updated_at: '2026-01-01T00:00:00.000Z' },
  tasks: [{ id: 't1', label: 'Task', status: 'todo', position: 0 }],
  edges: [],
  documents: [],
  progress: { todo: 1, in_progress: 0, done: 0 },
};

async function createTestApp() {
  const db = createSyncDb(':memory:');
  await migrate(db);
  const { token: syncToken } = await createSyncToken(db, { label: 'test' });
  const notifier = createShareNotifier();
  const app = createSyncServer({ db, notifier });
  return { app, db, syncToken, notifier };
}

async function pushProjection(
  app: ReturnType<typeof createSyncServer>,
  syncToken: string,
  shareToken: string,
  view: unknown = sampleView,
  version = 1,
) {
  return app.request('/api/sync/v1/projects/gid-1/projection', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${syncToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      share: {
        token_hash: hashToken(shareToken),
        audience_name: 'Acme Corp',
        mode: 'public',
        permissions: { read: true, submit: false },
        expires_at: null,
      },
      version,
      view,
    }),
  });
}

describe('GET /api/portal/v1/shares/:token/events', () => {
  it('receives projection_updated within 500 ms of PUT projection', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, shareToken);

    const received: PortalEvent[] = [];
    const ac = new AbortController();

    const res = await app.request(`/api/portal/v1/shares/${shareToken}/events`, {
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = res.body;
    if (body === null) {
      throw new Error('expected SSE body');
    }

    const reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    let buffer = '';

    const readLoop = (async () => {
      let streamOpen = true;
      while (streamOpen) {
        const chunk = await reader.read();
        if (chunk.done) {
          streamOpen = false;
          continue;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          received.push(...parseSseChunk(part));
        }
      }
      if (buffer.length > 0) {
        received.push(...parseSseChunk(buffer));
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const pushStart = Date.now();
    const updatedView = { ...sampleView, progress: { todo: 0, in_progress: 1, done: 0 } };
    const putRes = await pushProjection(app, syncToken, shareToken, updatedView, 2);
    expect(putRes.status).toBe(200);

    while (received.length === 0 && Date.now() - pushStart < 500) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toEqual({ type: 'projection_updated' });
    expect(Date.now() - pushStart).toBeLessThan(500);

    ac.abort();
    await readLoop;
  });

  it('returns 401 for invalid share token', async () => {
    const { app } = await createTestApp();
    const res = await app.request(`/api/portal/v1/shares/${generateShareToken()}/events`);
    expect(res.status).toBe(401);
  });

  it('unsubscribes on disconnect without leaking listeners', async () => {
    const { app, syncToken, notifier } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, shareToken);

    const ac = new AbortController();
    const res = await app.request(`/api/portal/v1/shares/${shareToken}/events`, {
      signal: ac.signal,
    });
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(notifier.subscriberCount()).toBe(1);

    ac.abort();
    if (res.body) {
      await res.body.cancel();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(notifier.subscriberCount()).toBe(0);
  });
});

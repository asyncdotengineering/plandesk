import { describe, expect, it } from 'vitest';
import { createTask, createProject } from '@plandesk/db';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createTestApp, parseJson, type TaskResponse } from '../test-helpers.js';

function parseSseChunk(chunk: string): PlankDeskEvent[] {
  const events: PlankDeskEvent[] = [];
  for (const part of chunk.split('\n\n')) {
    for (const line of part.split('\n')) {
      if (line.startsWith('data: ')) {
        events.push(JSON.parse(line.slice(6)) as PlankDeskEvent);
      }
    }
  }
  return events;
}

describe('events routes', () => {
  it('test:sse_task_update receives task_updated within 500 ms of PATCH', async () => {
    const eventBus = createEventBus();
    const { app, db } = createTestApp({ eventBus });
    const projectId = createProject(db, { name: 'SSE' }).id;
    const task = createTask(db, { projectId, label: 'Task', status: 'todo' });

    const received: PlankDeskEvent[] = [];
    const ac = new AbortController();

    const res = await app.request('/api/v1/events', { signal: ac.signal });
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

    const patchStart = Date.now();
    const patchRes = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(patchRes.status).toBe(200);
    await parseJson<TaskResponse>(patchRes);

    while (
      !received.some((event) => event.type === 'task_updated') &&
      Date.now() - patchStart < 500
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(received.some((event) => event.type === 'task_updated')).toBe(true);
    const taskUpdated = received.find((event) => event.type === 'task_updated');
    expect(taskUpdated).toEqual({
      type: 'task_updated',
      taskId: task.id,
      projectId,
    });
    expect(Date.now() - patchStart).toBeLessThan(500);

    ac.abort();
    await readLoop;
  });

  it('unsubscribes on disconnect without leaking listeners', async () => {
    const eventBus = createEventBus();
    const { app } = createTestApp({ eventBus });
    const ac = new AbortController();

    const res = await app.request('/api/v1/events', { signal: ac.signal });
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(eventBus.subscriberCount()).toBe(1);

    ac.abort();
    if (res.body) {
      await res.body.cancel();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(eventBus.subscriberCount()).toBe(0);
  });
});

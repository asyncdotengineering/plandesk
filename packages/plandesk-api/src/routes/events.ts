import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { EventBus } from '../events.js';

export function createEventsRouter(eventBus: EventBus): Hono {
  const router = new Hono();

  router.get('/events', (c) => {
    return streamSSE(c, async (stream) => {
      let active = true;
      const unsub = eventBus.subscribe((event) => {
        void stream.writeSSE({ data: JSON.stringify(event) });
      });

      const cleanup = () => {
        if (!active) {
          return;
        }
        active = false;
        unsub();
      };

      c.req.raw.signal.addEventListener('abort', cleanup, { once: true });
      stream.onAbort(cleanup);

      await new Promise<void>((resolve) => {
        if (c.req.raw.signal.aborted) {
          cleanup();
          resolve();
          return;
        }
        c.req.raw.signal.addEventListener(
          'abort',
          () => {
            cleanup();
            resolve();
          },
          { once: true },
        );
      });
    });
  });

  return router;
}

import { describe, expect, it, vi } from 'vitest';
import { createEventBus, type PlankDeskEvent } from './events.js';

describe('createEventBus', () => {
  it('delivers events to subscribers', async () => {
    const bus = createEventBus();
    const received: PlankDeskEvent[] = [];
    const unsub = bus.subscribe((event) => {
      received.push(event);
    });

    bus.emit({ type: 'task_updated', taskId: 't1', projectId: 'p1' });
    expect(received).toEqual([{ type: 'task_updated', taskId: 't1', projectId: 'p1' }]);

    unsub();
    bus.emit({ type: 'canvas_updated', projectId: 'p1' });
    expect(received).toHaveLength(1);
  });

  it('unsubscribes and does not leak listeners', async () => {
    const bus = createEventBus();
    const listener = vi.fn();
    const unsub = bus.subscribe(listener);

    expect(bus.subscriberCount()).toBe(1);
    unsub();
    expect(bus.subscriberCount()).toBe(0);

    bus.emit({ type: 'document_created', documentId: 'd1', projectId: 'p1' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('fans out to multiple subscribers', async () => {
    const bus = createEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);

    bus.emit({ type: 'canvas_updated', projectId: 'p1' });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});

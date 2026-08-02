import { describe, expect, it } from 'vitest';
import { createFrameRegistry, listenFrameMessages } from './frame-registry.js';

describe('frame registry', () => {
  it('resolves a registered iframe contentWindow', () => {
    const registry = createFrameRegistry();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    // jsdom: contentWindow exists after append
    registry.register(iframe, 'art-1');
    expect(registry.resolve(iframe.contentWindow)).toBe('art-1');
    expect(registry.size()).toBe(1);
    registry.unregister(iframe);
    expect(registry.resolve(iframe.contentWindow)).toBeUndefined();
    iframe.remove();
  });

  it('drops messages from unregistered sources', () => {
    const registry = createFrameRegistry();
    const accepted: string[] = [];
    const stop = listenFrameMessages(
      registry,
      () => {},
      (id) => {
        accepted.push(id);
      },
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { kind: 'plandesk:ready' },
        source: window,
      }),
    );
    expect(accepted).toEqual([]);

    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    registry.register(iframe, 'art-2');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { kind: 'plandesk:ready' },
        source: iframe.contentWindow,
      }),
    );
    expect(accepted).toEqual(['art-2']);

    stop();
    iframe.remove();
  });
});

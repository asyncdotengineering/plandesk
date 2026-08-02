/**
 * Frame registry: maps iframe elements to artifact ids and validates inbound
 * postMessage traffic by `event.source` (never origin — opaque frames report
 * `"null"`).
 */

export type FrameMessageHandler = (artifactId: string, data: unknown) => void;

export type FrameRegistry = {
  register: (iframe: HTMLIFrameElement, artifactId: string) => void;
  unregister: (iframe: HTMLIFrameElement) => void;
  /** Returns the artifact id when the source is registered; otherwise undefined. */
  resolve: (source: MessageEventSource | null) => string | undefined;
  size: () => number;
};

export function createFrameRegistry(): FrameRegistry {
  const frames = new Map<HTMLIFrameElement, string>();

  return {
    register(iframe, artifactId) {
      frames.set(iframe, artifactId);
    },
    unregister(iframe) {
      frames.delete(iframe);
    },
    resolve(source) {
      if (source === null) {
        return undefined;
      }
      for (const [iframe, artifactId] of frames) {
        if (iframe.contentWindow === source) {
          return artifactId;
        }
      }
      return undefined;
    },
    size() {
      return frames.size;
    },
  };
}

/**
 * Install a window message listener that drops unregistered sources.
 * Returns an unsubscribe function.
 */
export function listenFrameMessages(
  registry: FrameRegistry,
  onMessage: FrameMessageHandler,
  /** Optional sink for harness assertions (accepted messages only). */
  onAccepted?: (artifactId: string, data: unknown) => void,
): () => void {
  const handler = (event: MessageEvent) => {
    const artifactId = registry.resolve(event.source);
    if (artifactId === undefined) {
      return;
    }
    onAccepted?.(artifactId, event.data);
    onMessage(artifactId, event.data);
  };
  window.addEventListener('message', handler);
  return () => {
    window.removeEventListener('message', handler);
  };
}

type ShareNotifyListener = () => void;

export type ShareNotifier = {
  subscribe(shareId: string, listener: ShareNotifyListener): () => void;
  notify(shareId: string): void;
  subscriberCount(shareId?: string): number;
};

// TODO(scale): cross-instance bus (Redis/DO) for multi-replica
export function createShareNotifier(): ShareNotifier {
  const listeners = new Map<string, Set<ShareNotifyListener>>();

  return {
    subscribe(shareId, listener) {
      let set = listeners.get(shareId);
      if (set === undefined) {
        set = new Set();
        listeners.set(shareId, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) {
          listeners.delete(shareId);
        }
      };
    },

    notify(shareId) {
      const set = listeners.get(shareId);
      if (set === undefined) {
        return;
      }
      for (const listener of set) {
        listener();
      }
    },

    subscriberCount(shareId?: string) {
      if (shareId !== undefined) {
        return listeners.get(shareId)?.size ?? 0;
      }
      let count = 0;
      for (const set of listeners.values()) {
        count += set.size;
      }
      return count;
    },
  };
}

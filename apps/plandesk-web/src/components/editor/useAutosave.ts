import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

type UseAutosaveOptions<T> = {
  // Builds the payload to persist from the caller's latest state. Read live
  // values here — it is invoked at flush time, not when a change is queued.
  buildInput: () => T;
  onSave: (input: T) => void | Promise<void>;
  // Save this long after the last change (a typing pause). 1s is the sweet
  // spot: long enough to batch a burst of keystrokes into one write, short
  // enough that a pause reliably persists.
  delay?: number;
  // Force a save once changes have been pending at least this long, so a user
  // who types continuously without ever pausing still gets periodic saves.
  maxWait?: number;
};

// Debounced auto-save with an exit-flush guarantee. The debounce is a batching
// optimization; durability comes from flushing on navigation-away, tab-close,
// and ⌘S. Only fires when there are genuine unsaved changes.
export function useAutosave<T>({
  buildInput,
  onSave,
  delay = 1000,
  maxWait = 5000,
}: UseAutosaveOptions<T>) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const dirtyRef = useRef(false);
  // Monotonic edit counter — lets a completed save tell whether a fresh edit
  // landed while it was in flight (a boolean would be narrowed by the compiler
  // across the await and read as "always clean").
  const changeGenRef = useRef(0);
  const firstPendingAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest closures so a queued timer or an unmount never fires a
  // stale snapshot or a stale save handler.
  const buildInputRef = useRef(buildInput);
  const onSaveRef = useRef(onSave);
  buildInputRef.current = buildInput;
  onSaveRef.current = onSave;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const flush = useCallback(async () => {
    clearTimer();
    if (!dirtyRef.current) {
      return;
    }
    const input = buildInputRef.current();
    const savedGen = changeGenRef.current;
    dirtyRef.current = false;
    firstPendingAtRef.current = null;
    setStatus('saving');
    try {
      await onSaveRef.current(input);
      // Only claim "saved" if no fresh edit landed while the save was in flight.
      if (changeGenRef.current === savedGen) {
        setStatus('saved');
      }
    } catch {
      // Keep it dirty so the next change (or the exit-flush) retries.
      dirtyRef.current = true;
      setStatus('error');
    }
  }, []);

  const notifyChange = useCallback(() => {
    dirtyRef.current = true;
    changeGenRef.current += 1;
    setStatus('unsaved');
    const now = Date.now();
    firstPendingAtRef.current ??= now;
    const waited = now - firstPendingAtRef.current;
    clearTimer();
    if (waited >= maxWait) {
      void flush();
    } else {
      timerRef.current = setTimeout(() => void flush(), Math.min(delay, maxWait - waited));
    }
  }, [delay, maxWait, flush]);

  // Return to a clean baseline — call when a different record loads.
  const reset = useCallback(() => {
    clearTimer();
    dirtyRef.current = false;
    firstPendingAtRef.current = null;
    setStatus('saved');
  }, []);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (dirtyRef.current) {
        void flush();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘S / Ctrl+S — force a save and suppress the browser's "save page" dialog.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flush();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('keydown', onKeyDown);
      // Unmounting (route change) with unsaved edits — persist immediately. The
      // mutation lives on the query client and completes after we unmount.
      clearTimer();
      if (dirtyRef.current) {
        const input = buildInputRef.current();
        dirtyRef.current = false;
        void Promise.resolve(onSaveRef.current(input)).catch(() => undefined);
      }
    };
  }, [flush]);

  return { status, notifyChange, flushNow: flush, reset };
}

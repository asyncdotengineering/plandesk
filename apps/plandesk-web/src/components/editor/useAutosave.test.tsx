import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave.js';

// Advance timers and flush the promise microtask the async flush awaits.
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('coalesces a burst of edits into a single save after the debounce', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    let value = 'a';
    const { result } = renderHook(() =>
      useAutosave({ buildInput: () => value, onSave, delay: 1000 }),
    );

    act(() => {
      value = 'ab';
      result.current.notifyChange();
    });
    await tick(400);
    act(() => {
      value = 'abc';
      result.current.notifyChange();
    });
    await tick(400);
    act(() => {
      value = 'abcd';
      result.current.notifyChange();
    });

    // Still within the debounce window — nothing written yet.
    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.status).toBe('unsaved');

    await tick(1000);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('abcd');
    expect(result.current.status).toBe('saved');
  });

  it('forces a save at maxWait even when the user never pauses', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    let value = 0;
    const { result } = renderHook(() =>
      useAutosave({ buildInput: () => value, onSave, delay: 1000, maxWait: 2000 }),
    );

    // Edit every 500ms so the 1s debounce never elapses on its own.
    for (let i = 1; i <= 5; i += 1) {
      act(() => {
        value = i;
        result.current.notifyChange();
      });
      await tick(500);
    }

    // maxWait must have forced at least one save mid-stream.
    expect(onSave).toHaveBeenCalled();
  });

  it('flushes an unsaved edit immediately on unmount', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    let value = 'x';
    const { result, unmount } = renderHook(() =>
      useAutosave({ buildInput: () => value, onSave, delay: 1000 }),
    );

    act(() => {
      value = 'xy';
      result.current.notifyChange();
    });
    expect(onSave).not.toHaveBeenCalled();

    unmount();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('xy');
  });

  it('never saves when nothing changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useAutosave({ buildInput: () => 'unchanged', onSave }),
    );

    await tick(5000);
    unmount();

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.status).toBe('saved');
  });

  it('surfaces an error and stays dirty when the save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('network'));
    let value = 'p';
    const { result } = renderHook(() =>
      useAutosave({ buildInput: () => value, onSave, delay: 1000 }),
    );

    act(() => {
      value = 'pq';
      result.current.notifyChange();
    });
    await tick(1000);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');

    // A follow-up edit retries.
    act(() => {
      value = 'pqr';
      result.current.notifyChange();
    });
    onSave.mockResolvedValueOnce(undefined);
    await tick(1000);

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith('pqr');
  });
});

import { useSyncExternalStore } from 'react';

/**
 * Client-side active workspace. A LOCAL (loopback) board has no session row to
 * persist an active team, so the server can't remember which workspace the user
 * picked — every read would fall back to a server-computed default. This
 * localStorage-backed override lets the browser drive the active workspace, so
 * switching works on a local board (and stays consistent on a hosted one, where
 * it mirrors the server-side set-active-team).
 */
const STORAGE_KEY = 'plandesk.activeWorkspaceId';
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let override: string | null = read();

export function setActiveWorkspaceOverride(id: string | null): void {
  override = id;
  try {
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    // No localStorage (private mode) — keep the in-memory value for this session.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function useActiveWorkspaceOverride(): string | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => override,
    () => override,
  );
}

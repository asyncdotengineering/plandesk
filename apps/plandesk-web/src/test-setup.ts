import { afterEach } from 'vitest';
import { setActiveWorkspaceOverride } from './lib/active-workspace.js';

// The active-workspace override is a module-level singleton (persists in
// localStorage). Reset it between tests so a switch in one test never leaks the
// active workspace into the next.
afterEach(() => {
  setActiveWorkspaceOverride(null);
});

// jsdom does not implement window.matchMedia. The app-wide sonner <Toaster/>
// (mounted in __root) reads it for theme detection, so any test that renders
// the root route needs this polyfill.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

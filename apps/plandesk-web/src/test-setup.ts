import { afterEach } from 'vitest';
import { setActiveWorkspaceOverride } from './lib/active-workspace.js';

// The active-workspace override is a module-level singleton (persists in
// localStorage). Reset it between tests so a switch in one test never leaks the
// active workspace into the next.
afterEach(() => {
  setActiveWorkspaceOverride(null);
});

// jsdom does not implement window.matchMedia. The app-wide sonner <Toaster/>
// (mounted in __root) reads it for theme detection, and useBreakpoint reads it
// to pick a layout regime, so any test that renders the root route needs this.
//
// Width queries answer against jsdom's own window.innerWidth (1024 by default)
// rather than a flat false. A stub that always said "no match" would report
// every test as a phone and quietly move the whole suite onto the drawer
// layout, which is not what these tests were written against.
const MIN_WIDTH_QUERY = /^\(min-width:\s*(\d+)px\)$/;

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => {
    const minWidth = MIN_WIDTH_QUERY.exec(query);
    const matches = minWidth === null ? false : window.innerWidth >= Number(minWidth[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
}

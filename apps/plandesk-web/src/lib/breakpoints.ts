import { useSyncExternalStore } from 'react';

/**
 * The three layout regimes, named once.
 *
 * The thresholds are Tailwind v4's own `md` and `lg` defaults on purpose: most
 * responsive work here is a `md:`/`lg:` utility, and a hook that disagreed with
 * the utilities by even a pixel would put the drawer and the sidebar on screen
 * at the same time.
 *
 * Reach for this hook ONLY where behaviour changes — rendering a `Sheet`
 * instead of a rail is a different component tree. Anything that is purely
 * styling stays a Tailwind utility, which costs no re-render and is correct on
 * the first paint.
 */
export type Breakpoint = 'phone' | 'tablet' | 'desktop';

export const BREAKPOINT_MIN_WIDTH = {
  phone: 0,
  tablet: 768,
  desktop: 1024,
} as const satisfies Record<Breakpoint, number>;

const TABLET_QUERY = `(min-width: ${String(BREAKPOINT_MIN_WIDTH.tablet)}px)`;
const DESKTOP_QUERY = `(min-width: ${String(BREAKPOINT_MIN_WIDTH.desktop)}px)`;

export function breakpointFor(width: number): Breakpoint {
  if (width >= BREAKPOINT_MIN_WIDTH.desktop) {
    return 'desktop';
  }
  if (width >= BREAKPOINT_MIN_WIDTH.tablet) {
    return 'tablet';
  }
  return 'phone';
}

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) {
    return () => undefined;
  }
  const lists = [window.matchMedia(TABLET_QUERY), window.matchMedia(DESKTOP_QUERY)];
  for (const list of lists) {
    list.addEventListener('change', onChange);
  }
  return () => {
    for (const list of lists) {
      list.removeEventListener('change', onChange);
    }
  };
}

/**
 * Desktop is the fallback when `matchMedia` is missing. It is the layout the
 * app has always shipped, so an environment that cannot answer the question
 * gets the behaviour it had before this hook existed.
 */
function getSnapshot(): Breakpoint {
  if (!hasMatchMedia()) {
    return 'desktop';
  }
  if (window.matchMedia(DESKTOP_QUERY).matches) {
    return 'desktop';
  }
  if (window.matchMedia(TABLET_QUERY).matches) {
    return 'tablet';
  }
  return 'phone';
}

function getServerSnapshot(): Breakpoint {
  return 'desktop';
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useIsMobile(): boolean {
  return useBreakpoint() === 'phone';
}

/** Phone and tablet both collapse the shell and move side rails into sheets. */
export function useIsTouchLayout(): boolean {
  return useBreakpoint() !== 'desktop';
}

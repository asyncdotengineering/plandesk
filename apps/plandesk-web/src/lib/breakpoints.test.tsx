import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BREAKPOINT_MIN_WIDTH,
  breakpointFor,
  useBreakpoint,
  useIsMobile,
  useIsTouchLayout,
} from './breakpoints.js';

/**
 * A controllable matchMedia: every list it hands out answers against one width
 * and re-evaluates when that width changes, so a test can drive a real resize
 * rather than assert against a frozen stub.
 */
function installMatchMedia(initialWidth: number): {
  setWidth: (width: number) => void;
  listenerCount: () => number;
  restore: () => void;
} {
  const original = window.matchMedia;
  const lists = new Set<{ query: string; listeners: Set<() => void>; current: MediaQueryList }>();
  let width = initialWidth;

  const evaluate = (query: string): boolean => {
    const min = /^\(min-width:\s*(\d+)px\)$/.exec(query);
    return min === null ? false : width >= Number(min[1]);
  };

  window.matchMedia = (query: string): MediaQueryList => {
    const listeners = new Set<() => void>();
    const list = {
      get matches() {
        return evaluate(query);
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_: string, handler: () => void) => listeners.add(handler),
      removeEventListener: (_: string, handler: () => void) => listeners.delete(handler),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    lists.add({ query, listeners, current: list });
    return list;
  };

  return {
    setWidth: (next: number) => {
      const before = new Map([...lists].map((entry) => [entry, entry.current.matches]));
      width = next;
      for (const entry of lists) {
        if (before.get(entry) !== entry.current.matches) {
          for (const handler of entry.listeners) {
            handler();
          }
        }
      }
    },
    listenerCount: () => [...lists].reduce((total, entry) => total + entry.listeners.size, 0),
    restore: () => {
      window.matchMedia = original;
    },
  };
}

function Probe() {
  return (
    <div>
      <span data-testid="breakpoint">{useBreakpoint()}</span>
      <span data-testid="mobile">{String(useIsMobile())}</span>
      <span data-testid="touch">{String(useIsTouchLayout())}</span>
    </div>
  );
}

let media: ReturnType<typeof installMatchMedia> | null = null;

// vitest runs without `globals`, so RTL's auto-cleanup never registers.
afterEach(() => {
  cleanup();
  media?.restore();
  media = null;
});

describe('breakpointFor', () => {
  it('names each regime at its own floor', () => {
    expect(breakpointFor(0)).toBe('phone');
    expect(breakpointFor(BREAKPOINT_MIN_WIDTH.tablet)).toBe('tablet');
    expect(breakpointFor(BREAKPOINT_MIN_WIDTH.desktop)).toBe('desktop');
  });

  // The boundaries are the whole point: one pixel out and the hook disagrees
  // with the Tailwind utilities, putting the drawer and the sidebar on screen
  // together.
  it('switches regime exactly on the Tailwind boundary', () => {
    expect(breakpointFor(767)).toBe('phone');
    expect(breakpointFor(768)).toBe('tablet');
    expect(breakpointFor(1023)).toBe('tablet');
    expect(breakpointFor(1024)).toBe('desktop');
  });

  it('mirrors the Tailwind md and lg defaults', () => {
    expect(BREAKPOINT_MIN_WIDTH.tablet).toBe(768);
    expect(BREAKPOINT_MIN_WIDTH.desktop).toBe(1024);
  });
});

describe('useBreakpoint', () => {
  it.each([
    [390, 'phone', 'true', 'true'],
    [834, 'tablet', 'false', 'true'],
    [1440, 'desktop', 'false', 'false'],
  ])('reports %ipx as %s', (width, expected, mobile, touch) => {
    media = installMatchMedia(width);
    render(<Probe />);
    expect(screen.getByTestId('breakpoint').textContent).toBe(expected);
    expect(screen.getByTestId('mobile').textContent).toBe(mobile);
    expect(screen.getByTestId('touch').textContent).toBe(touch);
  });

  it('re-renders when the viewport crosses a boundary', () => {
    media = installMatchMedia(1440);
    render(<Probe />);
    expect(screen.getByTestId('breakpoint').textContent).toBe('desktop');

    act(() => {
      media?.setWidth(390);
    });
    expect(screen.getByTestId('breakpoint').textContent).toBe('phone');

    act(() => {
      media?.setWidth(834);
    });
    expect(screen.getByTestId('breakpoint').textContent).toBe('tablet');
  });

  it('releases its listeners on unmount', () => {
    media = installMatchMedia(390);
    const { unmount } = render(<Probe />);
    expect(media.listenerCount()).toBeGreaterThan(0);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('falls back to desktop when matchMedia is unavailable', () => {
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing the API the hook probes for
    delete window.matchMedia;
    try {
      render(<Probe />);
      expect(screen.getByTestId('breakpoint').textContent).toBe('desktop');
    } finally {
      window.matchMedia = original;
    }
  });
});

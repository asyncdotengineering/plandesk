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

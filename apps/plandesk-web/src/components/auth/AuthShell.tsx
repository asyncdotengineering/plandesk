import type { ReactNode } from 'react';

/** The node-graph mark + wordmark, matching the marketing site. */
export function BrandMark() {
  return (
    <div className="flex flex-col items-center gap-3">
      <svg
        width="46"
        height="46"
        viewBox="0 0 32 32"
        fill="none"
        role="img"
        aria-label="Plan Desk"
      >
        <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#0a0a0a" />
        <path d="M11.5 12.5 20.5 19.5" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        <circle cx="11" cy="12" r="3.4" fill="#ffffff" />
        <circle cx="21" cy="20" r="3.4" fill="#ffffff" />
      </svg>
      <span className="text-base font-semibold tracking-tight text-foreground">Plan Desk</span>
    </div>
  );
}

/**
 * Full-viewport, centered, on-brand frame for the unauthenticated surfaces
 * (sign-in + invite claim). The faint dot grid nods to the flow canvas without
 * competing with the card; both surfaces share it so first-touch feels like one
 * product.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--border-strong) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse 62% 52% at 50% 42%, #000 0%, transparent 76%)',
          WebkitMaskImage: 'radial-gradient(ellipse 62% 52% at 50% 42%, #000 0%, transparent 76%)',
          opacity: 0.55,
        }}
      />
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-7">
        <BrandMark />
        {children}
      </div>
    </div>
  );
}

/** GitHub glyph for the primary CTA (recognition at the OAuth moment). */
export function GithubGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className="shrink-0"
    >
      <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.98 3.23 9.2 7.71 10.69.56.1.77-.24.77-.54 0-.27-.01-1.15-.02-2.09-3.14.68-3.8-1.34-3.8-1.34-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 .17 2.63-.66 3.27-1.26-1.7-.19-3.48-.85-3.48-3.79 0-.84.3-1.52.79-2.06-.08-.19-.34-.97.08-2.02 0 0 .64-.21 2.1.78a7.3 7.3 0 0 1 3.83 0c1.46-.99 2.1-.78 2.1-.78.42 1.05.16 1.83.08 2.02.49.54.79 1.22.79 2.06 0 2.95-1.79 3.6-3.5 3.79.28.24.52.71.52 1.44 0 1.04-.01 1.88-.01 2.13 0 .3.2.65.78.54a11.26 11.26 0 0 0 7.7-10.69C23.25 5.48 18.27.5 12 .5Z" />
    </svg>
  );
}

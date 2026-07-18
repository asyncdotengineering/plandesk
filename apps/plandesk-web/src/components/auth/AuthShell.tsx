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

/** GitHub Octocat glyph for the primary CTA (recognition at the OAuth moment). */
export function GithubGlyph() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      aria-hidden
      className="shrink-0"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

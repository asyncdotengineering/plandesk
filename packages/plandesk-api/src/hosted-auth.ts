/**
 * Hosted (Workers / Vercel) better-auth wiring.
 * Local `serve` uses sessionSecret + auto-generated local secret; edge entries
 * require an explicit PLANDESK_BETTER_AUTH_SECRET so a misdeploy fails loud
 * instead of 401-ing every request on a non-loopback bind.
 */

export type HostedAuthEnv = {
  PLANDESK_BETTER_AUTH_SECRET?: string;
  PLANDESK_BASE_URL?: string;
};

export const MISSING_BETTER_AUTH_SECRET_MESSAGE =
  'Hosted Plan Desk requires PLANDESK_BETTER_AUTH_SECRET. ' +
  'Set it via `wrangler secret put PLANDESK_BETTER_AUTH_SECRET` (Workers) or the platform env (Vercel). ' +
  'Without it every request would 401 on a non-loopback bind.';

export const MISSING_BASE_URL_MESSAGE =
  'Hosted Plan Desk requires PLANDESK_BASE_URL (public origin, e.g. https://plandesk-api.example.workers.dev) ' +
  'when the request origin is not available at construction time.';

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * Resolve better-auth config for a hosted (non-loopback) entry.
 * Throws a clear Error when the secret is missing — callers return 500, not silent 401.
 * baseURL prefers PLANDESK_BASE_URL; falls back to requestOrigin (Workers per-request).
 */
export function resolveHostedBetterAuth(
  env: HostedAuthEnv,
  requestOrigin?: string,
): { secret: string; baseURL: string } {
  if (!present(env.PLANDESK_BETTER_AUTH_SECRET)) {
    throw new Error(MISSING_BETTER_AUTH_SECRET_MESSAGE);
  }

  const fromEnv = present(env.PLANDESK_BASE_URL) ? env.PLANDESK_BASE_URL.trim() : undefined;
  const fromRequest =
    requestOrigin !== undefined && requestOrigin.trim() !== ''
      ? requestOrigin.trim().replace(/\/$/, '')
      : undefined;
  const baseURL = fromEnv ?? fromRequest;
  if (baseURL === undefined) {
    throw new Error(MISSING_BASE_URL_MESSAGE);
  }

  return {
    secret: env.PLANDESK_BETTER_AUTH_SECRET.trim(),
    baseURL: baseURL.replace(/\/$/, ''),
  };
}

export function hostedMisconfigResponse(err: unknown): Response | undefined {
  if (!(err instanceof Error)) return undefined;
  if (
    err.message !== MISSING_BETTER_AUTH_SECRET_MESSAGE &&
    err.message !== MISSING_BASE_URL_MESSAGE
  ) {
    return undefined;
  }
  return new Response(JSON.stringify({ error: 'misconfigured', message: err.message }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

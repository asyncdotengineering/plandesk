/**
 * GitHub OAuth for the browser redirect flow.
 *
 * The server is a *confidential* client: the secret lives here and never ships
 * to a device, which is exactly what the redirect flow is designed for. (The
 * CLI uses device flow instead because a published npm binary is a public
 * client and could not hold a secret.)
 *
 * GitHub is optional everywhere. Self-hosters run the same binary with no
 * client id/secret and never register an app (REQ-20).
 */

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';

/**
 * The slice of fetch this module uses. Declared rather than `typeof fetch`:
 * the ambient global signature varies by runtime (the Workers types widen it),
 * and pinning our own keeps the injected test double honestly typed.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GithubConfig = {
  clientId: string;
  clientSecret: string;
  /** Absolute callback URL registered with the GitHub app. */
  callbackUrl: string;
  /** Where to land the browser once the cookie is set. Defaults to '/'. */
  dashboardUrl?: string;
  /** Injectable for tests — never call the network in a test. */
  fetch?: FetchLike;
};

/** Identity we keep. The access token is deliberately discarded after this. */
export type GithubIdentity = {
  /** GitHub's numeric account id — stable across renames. */
  id: number;
  login: string;
  name: string | null;
};

export class GithubOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubOAuthError';
  }
}

export type GithubDeviceStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
};

export type GithubDevicePoll =
  | { status: 'pending'; slowDown?: true }
  | { status: 'expired' }
  | { status: 'success'; identity: GithubIdentity };

export type GithubEnv = {
  PLANDESK_GITHUB_CLIENT_ID?: string;
  PLANDESK_GITHUB_CLIENT_SECRET?: string;
  PLANDESK_GITHUB_CALLBACK_URL?: string;
  PLANDESK_DASHBOARD_URL?: string;
};

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * Read the GitHub app from the environment. Every runtime entry uses this, so
 * "is GitHub sign-in on?" has exactly one answer everywhere.
 *
 * No client id/secret → undefined → the instance runs without GitHub sign-in.
 * That is the supported self-host path, not a degraded one (REQ-20).
 *
 * A half-configured app throws instead of silently disabling: someone who set
 * a client id meant to turn this on and should be told what is missing.
 */
export function githubConfigFromEnv(env: GithubEnv): GithubConfig | undefined {
  const clientId = env.PLANDESK_GITHUB_CLIENT_ID;
  const clientSecret = env.PLANDESK_GITHUB_CLIENT_SECRET;
  const callbackUrl = env.PLANDESK_GITHUB_CALLBACK_URL;

  if (!present(clientId) && !present(clientSecret) && !present(callbackUrl)) {
    return undefined;
  }
  if (!present(clientId) || !present(clientSecret) || !present(callbackUrl)) {
    throw new Error(
      'GitHub sign-in needs PLANDESK_GITHUB_CLIENT_ID, PLANDESK_GITHUB_CLIENT_SECRET and ' +
        'PLANDESK_GITHUB_CALLBACK_URL together. Unset all three to run without GitHub sign-in.',
    );
  }

  return {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    callbackUrl: callbackUrl.trim(),
    dashboardUrl: present(env.PLANDESK_DASHBOARD_URL) ? env.PLANDESK_DASHBOARD_URL.trim() : '/',
  };
}

/** `github:<numeric id>` — never the login, which a rename would orphan. */
export function userRefFromGithubId(id: number): string {
  return `github:${String(id)}`;
}

export function authorizeUrl(config: GithubConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.callbackUrl);
  url.searchParams.set('state', state);
  // Identity only: we never write to the user's GitHub account.
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

async function exchangeCodeForToken(config: GithubConfig, code: string): Promise<string> {
  const doFetch = config.fetch ?? fetch;
  const response = await doFetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      // Confidential client: the secret stays server-side.
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    }),
  });

  if (!response.ok) {
    throw new GithubOAuthError(`token exchange failed with status ${String(response.status)}`);
  }

  const body = (await response.json()) as { access_token?: unknown; error?: unknown };
  if (typeof body.error === 'string') {
    throw new GithubOAuthError(`token exchange rejected: ${body.error}`);
  }
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new GithubOAuthError('token exchange returned no access_token');
  }
  return body.access_token;
}

async function fetchIdentity(config: GithubConfig, accessToken: string): Promise<GithubIdentity> {
  const doFetch = config.fetch ?? fetch;
  const response = await doFetch(USER_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'plandesk',
    },
  });

  if (!response.ok) {
    throw new GithubOAuthError(`user lookup failed with status ${String(response.status)}`);
  }

  const body = (await response.json()) as { id?: unknown; login?: unknown; name?: unknown };
  if (typeof body.id !== 'number' || typeof body.login !== 'string') {
    throw new GithubOAuthError('user lookup returned no id/login');
  }
  return {
    id: body.id,
    login: body.login,
    name: typeof body.name === 'string' ? body.name : null,
  };
}

export async function startDeviceFlow(config: GithubConfig): Promise<GithubDeviceStart> {
  const doFetch = config.fetch ?? fetch;
  const response = await doFetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.clientId, scope: 'read:user' }),
  });
  if (!response.ok) throw new GithubOAuthError(`device start failed with status ${String(response.status)}`);
  const body = (await response.json()) as Record<string, unknown>;
  if (typeof body.device_code !== 'string' || typeof body.user_code !== 'string' ||
      typeof body.verification_uri !== 'string' || typeof body.expires_in !== 'number') {
    throw new GithubOAuthError('device start returned an invalid response');
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    interval: typeof body.interval === 'number' ? body.interval : 5,
    expiresIn: body.expires_in,
  };
}

export async function pollDeviceFlow(config: GithubConfig, deviceCode: string): Promise<GithubDevicePoll> {
  const doFetch = config.fetch ?? fetch;
  const response = await doFetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  if (!response.ok) throw new GithubOAuthError(`device poll failed with status ${String(response.status)}`);
  const body = (await response.json()) as { access_token?: unknown; error?: unknown };
  if (body.error === 'authorization_pending') return { status: 'pending' };
  // RFC 8628 §3.5: slow_down carries no new interval — the client MUST add 5s to
  // whatever it is currently waiting, "for this and all subsequent requests".
  // Only the client knows that number, so pass the signal, never a value: a
  // literal interval here would reset a backed-off client instead of raising it.
  if (body.error === 'slow_down') return { status: 'pending', slowDown: true };
  if (body.error === 'expired_token') return { status: 'expired' };
  if (typeof body.access_token !== 'string' || body.access_token === '') {
    throw new GithubOAuthError('device poll returned no access_token');
  }
  return { status: 'success', identity: await fetchIdentity(config, body.access_token) };
}

/**
 * Exchange the callback code for the caller's identity.
 * The access token is used once, here, and then dropped: storing it would make
 * Plan Desk a breach target for no product benefit.
 */
export async function resolveGithubIdentity(
  config: GithubConfig,
  code: string,
): Promise<GithubIdentity> {
  const accessToken = await exchangeCodeForToken(config, code);
  return fetchIdentity(config, accessToken);
}

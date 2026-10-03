/**
 * GitHub sign-in configuration. better-auth's social provider owns the OAuth
 * exchange; this module only decides, from the environment, whether GitHub
 * sign-in is on. GitHub is optional (REQ-20).
 */

export type GithubConfig = {
  clientId: string;
  clientSecret: string;
  /** Absolute callback URL registered with the GitHub app. */
  callbackUrl: string;
  /** Where to land the browser once the cookie is set. Defaults to '/'. */
  dashboardUrl?: string;
};

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

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readCliConfig, removeCliConfig, writeCliConfig, type CliConfig } from './config.js';

type LoginDeps = {
  fetch?: typeof fetch;
  home?: string;
  out?: NodeJS.WritableStream;
  input?: NodeJS.ReadableStream;
};

function serverUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

async function requestJson<T>(fetcher: typeof fetch, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, init);
  if (!response.ok) throw new Error(`Plan Desk request failed (${String(response.status)})`);
  return (await response.json()) as T;
}

/** Paste an owner API key from the dashboard (BA4b-2). Device flow is gone. */
export async function runLogin(server: string, deps: LoginDeps = {}): Promise<CliConfig> {
  const fetcher = deps.fetch ?? fetch;
  const output = deps.out ?? stdout;
  const base = serverUrl(server);

  const rl = createInterface({ input: deps.input ?? stdin, output });
  const token = await rl.question('Plan Desk token: ');
  rl.close();
  if (token.trim() === '') throw new Error('A Plan Desk token is required.');

  const session = await requestJson<{ org?: { id?: unknown } }>(
    fetcher,
    `${base}/api/v1/auth/session`,
    {
      headers: { Authorization: `Bearer ${token.trim()}` },
    },
  );
  const orgId = session.org?.id;
  if (typeof orgId !== 'string' || orgId === '')
    throw new Error('The Plan Desk token has no organization.');

  const config: CliConfig = { server: base, token: token.trim(), orgId };
  writeCliConfig(config, deps.home);
  output.write(`Logged in to ${config.server}${config.orgId === '' ? '' : ` (${config.orgId})`}\n`);
  return config;
}

export function runLogout(home?: string): void {
  removeCliConfig(home);
}

export function runWhoami(home?: string): CliConfig {
  const config = readCliConfig(home);
  if (config === undefined) throw new Error('Not logged in. Run plandesk login.');
  return config;
}

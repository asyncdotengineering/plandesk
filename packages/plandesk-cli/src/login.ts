import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readCliConfig, removeCliConfig, writeCliConfig, type CliConfig } from './config.js';

type Methods = { method: 'device' | 'token' };
type Start = { auth_id: string; user_code: string; verification_uri: string; interval: number; expires_in: number };
type Poll = { status?: 'pending' | 'expired'; slow_down?: boolean; token?: string; org_id?: string; org_name?: string; login?: string };
type LoginDeps = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; home?: string; out?: NodeJS.WritableStream; input?: NodeJS.ReadableStream };

function serverUrl(value: string): string { return value.replace(/\/+$/, ''); }

async function requestJson<T>(fetcher: typeof fetch, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, init);
  if (!response.ok) throw new Error(`Plan Desk request failed (${String(response.status)})`);
  return (await response.json()) as T;
}

export async function runLogin(server: string, deps: LoginDeps = {}): Promise<CliConfig> {
  const fetcher = deps.fetch ?? fetch;
  const output = deps.out ?? stdout;
  const base = serverUrl(server);
  const methods = await requestJson<Methods>(fetcher, `${base}/api/v1/auth/methods`);
  let config: CliConfig;
  if (methods.method === 'device') {
    const start = await requestJson<Start>(fetcher, `${base}/api/v1/auth/device/start`, { method: 'POST' });
    output.write(`Open ${start.verification_uri} and enter ${start.user_code}\n`);
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let interval = start.interval;
    for (;;) {
      const result = await requestJson<Poll>(fetcher, `${base}/api/v1/auth/device/poll`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth_id: start.auth_id }),
      });
      if (result.token !== undefined && result.org_id !== undefined && result.org_name !== undefined && result.login !== undefined) {
        config = { server: base, token: result.token, orgId: result.org_id };
        break;
      }
      if (result.status === 'expired') throw new Error('GitHub device login expired; run plandesk login again.');
      // RFC 8628 §3.5: the 5s increase is cumulative and sticks for every later
      // poll, so raise our own interval rather than reading one off the response.
      if (result.slow_down === true) interval += 5;
      await sleep(interval * 1000);
    }
  } else {
    const rl = createInterface({ input: deps.input ?? stdin, output });
    const token = await rl.question('Plan Desk token: ');
    rl.close();
    if (token.trim() === '') throw new Error('A Plan Desk token is required.');
    const session = await requestJson<{ org?: { id?: unknown } }>(fetcher, `${base}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${token.trim()}` },
    });
    const orgId = session.org?.id;
    if (typeof orgId !== 'string' || orgId === '') throw new Error('The Plan Desk token has no organization.');
    config = { server: base, token: token.trim(), orgId };
  }
  writeCliConfig(config, deps.home);
  output.write(`Logged in to ${config.server}${config.orgId === '' ? '' : ` (${config.orgId})`}\n`);
  return config;
}

export function runLogout(home?: string): void { removeCliConfig(home); }

export function runWhoami(home?: string): CliConfig {
  const config = readCliConfig(home);
  if (config === undefined) throw new Error('Not logged in. Run plandesk login.');
  return config;
}

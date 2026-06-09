const DOCS_BASE_ENV = 'PLANDESK_DOCS_URL';
const DEFAULT_DOCS_BASE = 'https://plandesk.asyncdot.com';

export type DeployTarget = {
  name: string;
  store: string;
  summary: string;
};

export const DEPLOY_TARGETS: DeployTarget[] = [
  {
    name: 'cloudflare',
    store: 'Workers + D1',
    summary: 'Edge sync server on Cloudflare Workers + D1, portal on Cloudflare Pages.',
  },
  {
    name: 'fly',
    store: 'Node + libSQL volume',
    summary: 'Sync server on Fly.io — single machine, auto-stop, SQLite on a volume.',
  },
  {
    name: 'docker',
    store: 'Node + libSQL',
    summary: 'Sync server as a Docker container on any host, SQLite on a mounted volume.',
  },
];

export class DeploySpecUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploySpecUnavailableError';
  }
}

function docsBase(): string {
  const fromEnv = process.env[DOCS_BASE_ENV];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv.trim().replace(/\/$/, '');
  }
  return DEFAULT_DOCS_BASE;
}

export function deploySpecUrl(target: string): string {
  return `${docsBase()}/deploy/${target}.md`;
}

export function isKnownTarget(target: string): boolean {
  return DEPLOY_TARGETS.some((t) => t.name === target);
}

export function formatDeployIndex(): string {
  const lines = ['plandesk deploy <target>', '', 'Available deploy guides:'];
  for (const target of DEPLOY_TARGETS) {
    lines.push(`  ${target.name}  (${target.store}) — ${target.summary}`);
    lines.push(`    ${deploySpecUrl(target.name)}`);
  }
  const first = DEPLOY_TARGETS[0]?.name ?? 'cloudflare';
  lines.push(
    '',
    'Print a guide for your coding agent to run:',
    `  plandesk deploy ${first} | claude        (or | codex, | cursor-agent)`,
    'Or read it yourself:',
    `  plandesk deploy ${first}`,
    '',
  );
  return lines.join('\n');
}

export function formatUnknownTarget(target: string): string {
  const names = DEPLOY_TARGETS.map((t) => t.name).join(', ');
  return [
    `Unknown deploy target: ${target}`,
    '',
    `Available targets: ${names}`,
    'Run `plandesk deploy` to list deploy guides.',
    '',
  ].join('\n');
}

export function formatPipeTip(target: string): string {
  return [
    '',
    'Tip: pipe this guide to your coding agent to run it for you:',
    `  plandesk deploy ${target} | claude        (or | codex, | cursor-agent)`,
    '',
  ].join('\n');
}

export async function fetchDeploySpec(target: string): Promise<string> {
  const url = deploySpecUrl(target);
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new DeploySpecUnavailableError(
      `Couldn't reach the deploy registry. Open ${url} directly and follow it.`,
    );
  }
  if (!response.ok) {
    throw new DeploySpecUnavailableError(
      `Deploy guide for "${target}" is unavailable (${String(response.status)}). Open ${url} directly.`,
    );
  }
  return response.text();
}

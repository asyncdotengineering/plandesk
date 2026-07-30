import { randomUUID } from 'node:crypto';
import { createDb, DEFAULT_ORG_ID, migrate, type Db } from '@plandesk/db';
import type { Hono } from 'hono';
import type { BetterAuthInstance } from './better-auth.js';
import { createApp } from './server.js';
import type { GithubConfig } from './github.js';
import { createBetterAuth, runBetterAuthMigrations } from './better-auth.js';
import { ensureLocalBetterAuthOrganization } from './identity.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

export async function createTestApp(opts?: {
  authPassword?: string;
  bindHost?: string;
  github?: GithubConfig;
  dataDir?: string;
}): Promise<{
  app: Hono;
  db: Db;
  orgId: string;
}> {
  const db = await createDb(':memory:');
  await migrate(db);
  const auth = createBetterAuth({
    client: db.$client,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
  });
  if (auth !== undefined) {
    await runBetterAuthMigrations(auth);
    await ensureLocalBetterAuthOrganization(db, auth);
  }
  return {
    app: createApp({
      db,
      authPassword: opts?.authPassword,
      bindHost: opts?.bindHost ?? '127.0.0.1',
      github: opts?.github,
      betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
      dataDir: opts?.dataDir,
    }),
    db,
    orgId: DEFAULT_ORG_ID,
  };
}

export async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function readStringCell(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${column} to be a string`);
  }
  return value;
}

type ProjectResponse = {
  id: string;
  name: string;
  description: string | null;
  repo_url: string | null;
  folder_path: string | null;
  workspace_id: string;
  created_at: string;
  updated_at: string;
};

type ProjectDetailResponse = ProjectResponse & {
  summary: Record<string, number>;
};

type TaskResponse = {
  id: string;
  project_id: string;
  label: string;
  status: string;
  description: string | null;
  x: number;
  y: number;
  assignee: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

export type { ProjectResponse, ProjectDetailResponse, TaskResponse };

export type BaOrg = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
};

/** Create a better-auth organization row (test fixture). */
export async function createBaOrg(
  auth: BetterAuthInstance,
  input: { name: string; id?: string; slug?: string },
): Promise<BaOrg> {
  const adapter = (await auth.$context).adapter;
  const id = input.id ?? randomUUID();
  const derivedSlug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const slug = input.slug ?? (derivedSlug.length > 0 ? derivedSlug : `org-${id.slice(0, 8)}`);
  const data = {
    id,
    name: input.name,
    slug,
    createdAt: new Date(),
  };
  return adapter.create<BaOrg>({
    model: 'organization',
    data,
    forceAllowId: true,
  });
}

export async function listBaOrgs(auth: BetterAuthInstance): Promise<BaOrg[]> {
  const adapter = (await auth.$context).adapter;
  return adapter.findMany<BaOrg>({ model: 'organization' });
}

export async function getBaOrg(
  auth: BetterAuthInstance,
  id: string,
): Promise<BaOrg | undefined> {
  const adapter = (await auth.$context).adapter;
  const org = await adapter.findOne<BaOrg>({
    model: 'organization',
    where: [{ field: 'id', value: id }],
  });
  return org ?? undefined;
}

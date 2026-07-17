import { createDb, DEFAULT_ORG_ID, migrate, type Db } from '@plandesk/db';
import type { Hono } from 'hono';
import { createApp } from './server.js';
import type { GithubConfig } from './github.js';

export async function createTestApp(opts?: {
  authPassword?: string;
  bindHost?: string;
  github?: GithubConfig;
}): Promise<{
  app: Hono;
  db: Db;
  orgId: string;
}> {
  const db = await createDb(':memory:');
  await migrate(db);
  return {
    app: createApp({
      db,
      authPassword: opts?.authPassword,
      bindHost: opts?.bindHost ?? '127.0.0.1',
      github: opts?.github,
    }),
    db,
    orgId: DEFAULT_ORG_ID,
  };
}

export async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

type ProjectResponse = {
  id: string;
  name: string;
  description: string | null;
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

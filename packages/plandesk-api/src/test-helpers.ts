import { createDb, migrate, type Db } from '@plandesk/db';
import type { Hono } from 'hono';
import { createApp } from './server.js';

export function createTestApp(): { app: Hono; db: Db } {
  const db = createDb(':memory:');
  migrate(db);
  return { app: createApp({ db }), db };
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

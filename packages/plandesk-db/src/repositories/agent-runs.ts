import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { agentRuns, type AgentRunStatus } from '../schema.js';

export type AgentRun = typeof agentRuns.$inferSelect;

export type NewAgentRun = {
  projectId: string;
  label?: string | null;
  id?: string;
  status?: AgentRunStatus;
  startedAt?: Date;
  completedAt?: Date | null;
};

export type AgentRunStatusUpdate = {
  status: AgentRunStatus;
  completedAt?: Date | null;
};

export type ListAgentRunsOptions = {
  limit?: number;
  offset?: number;
};

export async function listAgentRuns(
  db: DbClient,
  projectId: string,
  options?: ListAgentRunsOptions,
): Promise<AgentRun[]> {
  let query = db.select().from(agentRuns).where(eq(agentRuns.projectId, projectId)).$dynamic();
  if (options?.limit !== undefined) {
    query = query.limit(options.limit);
  }
  if (options?.offset !== undefined) {
    query = query.offset(options.offset);
  }
  return query.all();
}

export async function deleteAgentRun(db: DbClient, id: string): Promise<boolean> {
  const result = await db.delete(agentRuns).where(eq(agentRuns.id, id)).run();
  return result.rowsAffected > 0;
}

export async function createAgentRun(db: DbClient, input: NewAgentRun): Promise<AgentRun> {
  const id = input.id ?? randomUUID();
  const now = new Date();
  const rows = await db
    .insert(agentRuns)
    .values({
      id,
      projectId: input.projectId,
      status: input.status ?? 'running',
      label: input.label ?? null,
      startedAt: input.startedAt ?? now,
      completedAt: input.completedAt ?? null,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create agent run');
  }
  return row;
}

export async function getAgentRun(db: DbClient, id: string): Promise<AgentRun | undefined> {
  return db.select().from(agentRuns).where(eq(agentRuns.id, id)).get();
}

export async function updateAgentRunStatus(
  db: DbClient,
  id: string,
  input: AgentRunStatusUpdate,
): Promise<AgentRun | undefined> {
  const rows = await db
    .update(agentRuns)
    .set({
      status: input.status,
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
    })
    .where(eq(agentRuns.id, id))
    .returning()
    .all();
  return rows[0];
}

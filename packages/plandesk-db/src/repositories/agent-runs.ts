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

export function listAgentRuns(db: DbClient, projectId: string): AgentRun[] {
  return db.select().from(agentRuns).where(eq(agentRuns.projectId, projectId)).all();
}

export function createAgentRun(db: DbClient, input: NewAgentRun): AgentRun {
  const id = input.id ?? randomUUID();
  const now = new Date();
  const rows = db
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

export function getAgentRun(db: DbClient, id: string): AgentRun | undefined {
  return db.select().from(agentRuns).where(eq(agentRuns.id, id)).get();
}

export function updateAgentRunStatus(
  db: DbClient,
  id: string,
  input: AgentRunStatusUpdate,
): AgentRun | undefined {
  const rows = db
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

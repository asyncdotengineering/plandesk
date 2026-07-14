import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { agentRunEvents } from '../schema.js';

export type AgentRunEvent = typeof agentRunEvents.$inferSelect;

export type NewAgentRunEvent = {
  runId: string;
  message: string;
  id?: string;
  createdAt?: Date;
};

export async function createAgentRunEvent(
  db: DbClient,
  input: NewAgentRunEvent,
): Promise<AgentRunEvent> {
  const id = input.id ?? randomUUID();
  const now = new Date();
  const rows = await db
    .insert(agentRunEvents)
    .values({
      id,
      runId: input.runId,
      message: input.message,
      createdAt: input.createdAt ?? now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create agent run event');
  }
  return row;
}

export async function listAgentRunEvents(db: DbClient, runId: string): Promise<AgentRunEvent[]> {
  return db.select().from(agentRunEvents).where(eq(agentRunEvents.runId, runId)).all();
}

export async function deleteAgentRunEventsByRunId(db: DbClient, runId: string): Promise<number> {
  const result = await db.delete(agentRunEvents).where(eq(agentRunEvents.runId, runId)).run();
  return result.rowsAffected;
}

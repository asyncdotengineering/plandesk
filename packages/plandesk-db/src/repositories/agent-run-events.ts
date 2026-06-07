import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { agentRunEvents } from '../schema.js';

export type AgentRunEvent = typeof agentRunEvents.$inferSelect;

export type NewAgentRunEvent = {
  runId: string;
  message: string;
  id?: string;
};

export function createAgentRunEvent(db: DbClient, input: NewAgentRunEvent): AgentRunEvent {
  const id = input.id ?? randomUUID();
  const now = new Date();
  const rows = db
    .insert(agentRunEvents)
    .values({
      id,
      runId: input.runId,
      message: input.message,
      createdAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create agent run event');
  }
  return row;
}

export function listAgentRunEvents(db: DbClient, runId: string): AgentRunEvent[] {
  return db.select().from(agentRunEvents).where(eq(agentRunEvents.runId, runId)).all();
}

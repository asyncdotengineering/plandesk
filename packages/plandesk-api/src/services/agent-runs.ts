import {
  createAgentRun,
  createAgentRunEvent,
  getAgentRun,
  getProject,
  listAgentRunEvents,
  listAgentRuns,
  updateAgentRunStatus,
  type AgentRunStatus,
  type Db,
} from '@plandesk/db';
import type { EventBus } from '../events.js';
import { serializeAgentRun, serializeAgentRunEvent, type PaginationParams } from '../serialize.js';

export type AgentRunServiceDeps = {
  db: Db;
  eventBus: EventBus;
};

export class InvalidAgentRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAgentRunError';
  }
}

const terminalStatuses = new Set<AgentRunStatus>(['completed', 'failed']);

export function createAgentRunService(deps: AgentRunServiceDeps) {
  const { db, eventBus } = deps;

  return {
    async listForProject(projectId: string, pagination: PaginationParams = {}) {
      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const runs = (await listAgentRuns(db, projectId, pagination)).slice().sort((a, b) => {
        const timeDiff = b.startedAt.getTime() - a.startedAt.getTime();
        if (timeDiff !== 0) {
          return timeDiff;
        }
        return b.id.localeCompare(a.id);
      });

      return Promise.all(
        runs.map(async (run) => {
          const serialized = serializeAgentRun(run);
          const events = (await listAgentRunEvents(db, run.id)).map((event) => {
            const serializedEvent = serializeAgentRunEvent(event);
            return {
              id: serializedEvent.id,
              message: serializedEvent.message,
              created_at: serializedEvent.created_at,
            };
          });
          return { ...serialized, events };
        }),
      );
    },

    async start(projectId: string, label?: string | null) {
      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const run = await createAgentRun(db, { projectId, label });
      eventBus.emit({
        type: 'agent_run_started',
        runId: run.id,
        projectId,
      });

      return serializeAgentRun(run);
    },

    async recordProgress(runId: string, message: string) {
      const run = await getAgentRun(db, runId);
      if (!run) {
        return undefined;
      }

      if (terminalStatuses.has(run.status)) {
        throw new InvalidAgentRunError('Agent run is already complete');
      }

      const event = await createAgentRunEvent(db, { runId, message });
      eventBus.emit({
        type: 'agent_run_progress',
        runId,
        projectId: run.projectId,
      });

      return serializeAgentRunEvent(event);
    },

    async complete(runId: string, status: 'completed' | 'failed') {
      const run = await getAgentRun(db, runId);
      if (!run) {
        return undefined;
      }

      if (terminalStatuses.has(run.status)) {
        throw new InvalidAgentRunError('Agent run is already complete');
      }

      const updated = await updateAgentRunStatus(db, runId, {
        status,
        completedAt: new Date(),
      });
      if (!updated) {
        return undefined;
      }

      eventBus.emit({
        type: 'agent_run_completed',
        runId,
        projectId: run.projectId,
      });

      return serializeAgentRun(updated);
    },
  };
}

export type AgentRunService = ReturnType<typeof createAgentRunService>;

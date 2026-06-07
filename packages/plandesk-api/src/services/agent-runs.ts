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
import { serializeAgentRun, serializeAgentRunEvent } from '../serialize.js';

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
    listForProject(projectId: string) {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const runs = listAgentRuns(db, projectId)
        .slice()
        .sort((a, b) => {
          const timeDiff = b.startedAt.getTime() - a.startedAt.getTime();
          if (timeDiff !== 0) {
            return timeDiff;
          }
          return b.id.localeCompare(a.id);
        });

      return runs.map((run) => {
        const serialized = serializeAgentRun(run);
        const events = listAgentRunEvents(db, run.id).map((event) => {
          const serialized = serializeAgentRunEvent(event);
          return {
            id: serialized.id,
            message: serialized.message,
            created_at: serialized.created_at,
          };
        });
        return { ...serialized, events };
      });
    },

    start(projectId: string, label?: string | null) {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const run = createAgentRun(db, { projectId, label });
      eventBus.emit({
        type: 'agent_run_started',
        runId: run.id,
        projectId,
      });

      return serializeAgentRun(run);
    },

    recordProgress(runId: string, message: string) {
      const run = getAgentRun(db, runId);
      if (!run) {
        return undefined;
      }

      if (terminalStatuses.has(run.status)) {
        throw new InvalidAgentRunError('Agent run is already complete');
      }

      const event = createAgentRunEvent(db, { runId, message });
      eventBus.emit({
        type: 'agent_run_progress',
        runId,
        projectId: run.projectId,
      });

      return serializeAgentRunEvent(event);
    },

    complete(runId: string, status: 'completed' | 'failed') {
      const run = getAgentRun(db, runId);
      if (!run) {
        return undefined;
      }

      if (terminalStatuses.has(run.status)) {
        throw new InvalidAgentRunError('Agent run is already complete');
      }

      const updated = updateAgentRunStatus(db, runId, {
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

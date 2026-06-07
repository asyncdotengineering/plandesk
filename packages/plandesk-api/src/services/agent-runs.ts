import {
  createAgentRun,
  createAgentRunEvent,
  getAgentRun,
  getProject,
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

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
import { serializeAgentRun, serializeAgentRunEvent, type PaginationParams } from '../serialize.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type AgentRunServiceDeps = OrgScopedDeps & {
  db: Db;
};

export class InvalidAgentRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAgentRunError';
  }
}

const terminalStatuses = new Set<AgentRunStatus>(['completed', 'failed']);

export function createAgentRunService(deps: AgentRunServiceDeps) {
  const { db } = deps;

  return {
    async listForProject(projectId: string, pagination: PaginationParams = {}) {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
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
      assertPermission(deps, 'agent_run', 'create');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      const run = await createAgentRun(db, { projectId, label });

      return serializeAgentRun(run);
    },

    async recordProgress(runId: string, message: string) {
      assertPermission(deps, 'agent_run', 'update');
      const run = await getAgentRun(db, runId);
      if (!run) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, run.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      if (terminalStatuses.has(run.status)) {
        throw new InvalidAgentRunError('Agent run is already complete');
      }

      const event = await createAgentRunEvent(db, { runId, message });

      return serializeAgentRunEvent(event);
    },

    async complete(runId: string, status: 'completed' | 'failed') {
      assertPermission(deps, 'agent_run', 'update');
      const run = await getAgentRun(db, runId);
      if (!run) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, run.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
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

      return serializeAgentRun(updated);
    },
  };
}

export type AgentRunService = ReturnType<typeof createAgentRunService>;

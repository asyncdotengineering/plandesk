import type { Db } from '@plandesk/db';
import { createEventBus, type EventBus } from '../events.js';
import { createCanvasService, type CanvasService } from './canvas.js';
import { createDocumentService, type DocumentService } from './documents.js';
import { createProjectService, type ProjectService } from './projects.js';
import { createAgentRunService, type AgentRunService } from './agent-runs.js';
import { createTaskService, type TaskService } from './tasks.js';
import { createTokenService, type TokenService } from './tokens.js';

export type ServicesDeps = {
  db: Db;
  eventBus?: EventBus;
};

export type Services = {
  eventBus: EventBus;
  projectService: ProjectService;
  taskService: TaskService;
  canvasService: CanvasService;
  documentService: DocumentService;
  agentRunService: AgentRunService;
  tokenService: TokenService;
};

export function createServices(deps: ServicesDeps): Services {
  const eventBus = deps.eventBus ?? createEventBus();
  const projectService = createProjectService({ db: deps.db });
  const taskService = createTaskService({ db: deps.db, eventBus });
  const canvasService = createCanvasService({ db: deps.db, eventBus });
  const documentService = createDocumentService({ db: deps.db, eventBus });
  const agentRunService = createAgentRunService({ db: deps.db, eventBus });
  const tokenService = createTokenService({ db: deps.db });

  return {
    eventBus,
    projectService,
    taskService,
    canvasService,
    documentService,
    agentRunService,
    tokenService,
  };
}

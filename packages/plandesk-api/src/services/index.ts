import type { Db } from '@plandesk/db';
import { createEventBus, type EventBus } from '../events.js';
import { createCanvasService, type CanvasService } from './canvas.js';
import { createCommentService, type CommentService } from './comments.js';
import { createDocumentService, type DocumentService } from './documents.js';
import { createProjectService, type ProjectService } from './projects.js';
import { createAgentRunService, type AgentRunService } from './agent-runs.js';
import { createTaskService, type TaskService } from './tasks.js';
import { createTokenService, type TokenService } from './tokens.js';
import { createShareService, type ShareService } from './share.js';
import { createSyncService, type SyncService } from './sync.js';

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
  commentService: CommentService;
  agentRunService: AgentRunService;
  tokenService: TokenService;
  shareService: ShareService;
  syncService: SyncService;
};

export function createServices(deps: ServicesDeps): Services {
  const eventBus = deps.eventBus ?? createEventBus();
  const projectService = createProjectService({ db: deps.db, eventBus });
  const taskService = createTaskService({ db: deps.db, eventBus });
  const canvasService = createCanvasService({ db: deps.db, eventBus });
  const documentService = createDocumentService({ db: deps.db, eventBus });
  const commentService = createCommentService({ db: deps.db, eventBus });
  const agentRunService = createAgentRunService({ db: deps.db, eventBus });
  const tokenService = createTokenService({ db: deps.db });
  const shareService = createShareService({ db: deps.db, eventBus });
  const syncService = createSyncService({ db: deps.db, eventBus, taskService, shareService });

  return {
    eventBus,
    projectService,
    taskService,
    canvasService,
    documentService,
    commentService,
    agentRunService,
    tokenService,
    shareService,
    syncService,
  };
}

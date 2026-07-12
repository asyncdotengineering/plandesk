import type { Db } from '@plandesk/db';
import { createEventBus, type EventBus } from '../events.js';
import { createStorageAdapter, type StorageAdapter } from '../storage/index.js';
import { createCanvasService, type CanvasService } from './canvas.js';
import { createCommentService, type CommentService } from './comments.js';
import { createDocumentService, type DocumentService } from './documents.js';
import { createArtifactService, type ArtifactService } from './artifacts.js';
import { createFileService, type FileService } from './files.js';
import { createFolderService, type FolderService } from './folders.js';
import { createNoteService, type NoteService } from './notes.js';
import { createProjectService, type ProjectService } from './projects.js';
import { createAgentRunService, type AgentRunService } from './agent-runs.js';
import { createTagService, type TagService } from './tags.js';
import { createGoalService, type GoalService } from './goals.js';
import { createTaskService, type TaskService } from './tasks.js';
import { createTokenService, type TokenService } from './tokens.js';
import { createShareService, type ShareService } from './share.js';
import { createSyncService, type SyncService } from './sync.js';

export type ServicesDeps = {
  db: Db;
  eventBus?: EventBus;
  storage?: StorageAdapter;
};

export type Services = {
  eventBus: EventBus;
  projectService: ProjectService;
  goalService: GoalService;
  taskService: TaskService;
  tagService: TagService;
  canvasService: CanvasService;
  documentService: DocumentService;
  folderService: FolderService;
  noteService: NoteService;
  commentService: CommentService;
  agentRunService: AgentRunService;
  tokenService: TokenService;
  shareService: ShareService;
  syncService: SyncService;
  fileService: FileService;
  artifactService: ArtifactService;
};

export function createServices(deps: ServicesDeps): Services {
  const eventBus = deps.eventBus ?? createEventBus();
  const storage = deps.storage ?? createStorageAdapter({ db: deps.db });
  const projectService = createProjectService({ db: deps.db, eventBus });
  const goalService = createGoalService({ db: deps.db, eventBus });
  const taskService = createTaskService({ db: deps.db, eventBus });
  const tagService = createTagService({ db: deps.db, eventBus });
  const canvasService = createCanvasService({ db: deps.db, eventBus });
  const documentService = createDocumentService({ db: deps.db, eventBus });
  const folderService = createFolderService({ db: deps.db, eventBus });
  const noteService = createNoteService({ db: deps.db, eventBus });
  const commentService = createCommentService({ db: deps.db, eventBus });
  const agentRunService = createAgentRunService({ db: deps.db, eventBus });
  const tokenService = createTokenService({ db: deps.db });
  const shareService = createShareService({ db: deps.db, eventBus });
  const syncService = createSyncService({ db: deps.db, eventBus, taskService, shareService });
  const fileService = createFileService({ db: deps.db, storage });
  const artifactService = createArtifactService({ db: deps.db, eventBus });

  return {
    eventBus,
    projectService,
    goalService,
    taskService,
    tagService,
    canvasService,
    documentService,
    folderService,
    noteService,
    commentService,
    agentRunService,
    tokenService,
    shareService,
    syncService,
    fileService,
    artifactService,
  };
}

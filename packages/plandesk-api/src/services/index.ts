import type { Db } from '@plandesk/db';
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
  storage?: StorageAdapter;
  /** Fixed org scope for unit tests; production request path uses auth context. */
  orgId?: string;
};

export type Services = {
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
  const scoped = { db: deps.db, orgId: deps.orgId };
  const storage = deps.storage ?? createStorageAdapter({ db: deps.db });
  const projectService = createProjectService(scoped);
  const goalService = createGoalService(scoped);
  const taskService = createTaskService(scoped);
  const tagService = createTagService(scoped);
  const canvasService = createCanvasService(scoped);
  const documentService = createDocumentService(scoped);
  const folderService = createFolderService(scoped);
  const noteService = createNoteService(scoped);
  const commentService = createCommentService(scoped);
  const agentRunService = createAgentRunService(scoped);
  const tokenService = createTokenService(scoped);
  const shareService = createShareService(scoped);
  const syncService = createSyncService({ ...scoped, taskService });
  const fileService = createFileService({ ...scoped, storage });
  const artifactService = createArtifactService(scoped);

  return {
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

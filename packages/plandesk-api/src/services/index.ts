import type { Db } from '@plandesk/db';
import type { BetterAuthInstance } from '../better-auth.js';
import { createStorageAdapter, type StorageAdapter } from '../storage/index.js';
import { createCanvasService, type CanvasService } from './canvas.js';
import { createCommentService, type CommentService } from './comments.js';
import { createDocumentService, type DocumentService } from './documents.js';
import { createArtifactService, type ArtifactService } from './artifacts.js';
import { createFileService, type FileService } from './files.js';
import { createFolderService, type FolderService } from './folders.js';
import { createNoteService, type NoteService } from './notes.js';
import { createProjectService, type ProjectService } from './projects.js';
import {
  createProjectExportService,
  type ProjectExportService,
} from './project-export.js';
import { createAgentRunService, type AgentRunService } from './agent-runs.js';
import { createTagService, type TagService } from './tags.js';
import { createGoalService, type GoalService } from './goals.js';
import { createTaskService, type TaskService } from './tasks.js';
import { createViewService, type ViewService } from './views.js';
import { createShareService, type ShareService } from './share.js';
import { createSyncService, type SyncService } from './sync.js';
import { createRevisionService, type RevisionService } from './revisions.js';
import { maxRevisionsFromEnv } from './revision-capture.js';

export type ServicesDeps = {
  db: Db;
  storage?: StorageAdapter;
  /** Fixed org scope for unit tests; production request path uses auth context. */
  orgId?: string;
  /** better-auth instance for workspace resolution (project creation). */
  auth?: BetterAuthInstance;
  /**
   * Revision retention cap. Omit to read `PLANDESK_MAX_REVISIONS` (fail-fast on
   * invalid values). Pass `null` to force unlimited regardless of env.
   */
  maxRevisions?: number | null;
};

export type Services = {
  projectService: ProjectService;
  goalService: GoalService;
  taskService: TaskService;
  tagService: TagService;
  viewService: ViewService;
  projectExportService: ProjectExportService;
  canvasService: CanvasService;
  documentService: DocumentService;
  folderService: FolderService;
  noteService: NoteService;
  commentService: CommentService;
  agentRunService: AgentRunService;
  shareService: ShareService;
  syncService: SyncService;
  fileService: FileService;
  artifactService: ArtifactService;
  revisionService: RevisionService;
};

export function createServices(deps: ServicesDeps): Services {
  const maxRevisions =
    deps.maxRevisions !== undefined ? deps.maxRevisions : maxRevisionsFromEnv(process.env);
  const scoped = { db: deps.db, orgId: deps.orgId, auth: deps.auth };
  const versioned = { ...scoped, maxRevisions };
  const storage = deps.storage ?? createStorageAdapter({ db: deps.db });
  const projectService = createProjectService(scoped);
  const goalService = createGoalService(scoped);
  const taskService = createTaskService(versioned);
  const tagService = createTagService(scoped);
  const viewService = createViewService(scoped);
  const projectExportService = createProjectExportService({
    ...scoped,
    projectService,
    taskService,
  });
  const canvasService = createCanvasService(scoped);
  const documentService = createDocumentService(versioned);
  const folderService = createFolderService(scoped);
  const noteService = createNoteService(scoped);
  const commentService = createCommentService(scoped);
  const agentRunService = createAgentRunService(scoped);
  const shareService = createShareService(scoped);
  const syncService = createSyncService({ ...scoped, taskService });
  const fileService = createFileService({ ...scoped, storage });
  const artifactService = createArtifactService(scoped);
  const revisionService = createRevisionService({
    ...scoped,
    taskService,
    documentService,
  });

  return {
    projectService,
    goalService,
    taskService,
    tagService,
    viewService,
    projectExportService,
    canvasService,
    documentService,
    folderService,
    noteService,
    commentService,
    agentRunService,
    shareService,
    syncService,
    fileService,
    artifactService,
    revisionService,
  };
}

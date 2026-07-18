import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { liveQueryOptions } from './events.js';
import { authSessionKey, workspacesKey } from './auth.js';
import {
  completeGoal,
  createCliToken,
  createOrgInvitation,
  createWorkspace,
  createComment,
  createDocument,
  createFolder,
  createGoal,
  createNote,
  createProject,
  createTag,
  createTask,
  deleteWorkspace,
  getGoal,
  deleteComment,
  deleteDocument,
  deleteEdge,
  deleteFolder,
  deleteNote,
  deleteProject,
  deleteTag,
  deleteTask,
  getCanvas,
  getDocument,
  getNote,
  getProject,
  getTaskDocument,
  listAgentRuns,
  listOrgMembers,
  listComments,
  listDocuments,
  listFolders,
  listGoals,
  listNotes,
  listProjects,
  listSubmissions,
  listTags,
  listTasks,
  listWorkspaceMembers,
  addWorkspaceMember,
  removeWorkspaceMember,
  moveProject,
  pauseGoal,
  patchComment,
  patchGoal,
  patchDocument,
  patchFolder,
  patchNote,
  patchProject,
  patchTag,
  patchTask,
  putCanvas,
  renameWorkspace,
  resumeGoal,
  triageSubmission,
  type CommentTarget,
  type CommentTargetType,
  type CreateCommentInput,
  type InviteRole,
  type CreateGoalInput,
  type CreateDocumentInput,
  type CreateFolderInput,
  type CreateNoteInput,
  type CreateProjectInput,
  type CreateTagInput,
  type CreateTaskInput,
  type PatchCommentInput,
  type PatchDocumentInput,
  type PatchGoalInput,
  type PatchFolderInput,
  type PatchNoteInput,
  type PatchProjectInput,
  type PatchTagInput,
  type PatchTaskInput,
  type PutCanvasInput,
  type SubmissionStatus,
  type TaskStatus,
  type TriageSubmissionInput,
  type VerificationEvidence,
} from './api.js';

export const queryKeys = {
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  tasksRoot: (projectId: string) => ['projects', projectId, 'tasks'] as const,
  tasks: (projectId: string, status?: TaskStatus) =>
    ['projects', projectId, 'tasks', status ?? 'all'] as const,
  tags: (projectId: string) => ['projects', projectId, 'tags'] as const,
  canvas: (projectId: string) => ['projects', projectId, 'canvas'] as const,
  documents: (projectId: string) => ['projects', projectId, 'documents'] as const,
  document: (id: string) => ['documents', id] as const,
  folders: (projectId: string) => ['projects', projectId, 'folders'] as const,
  notes: (projectId: string) => ['projects', projectId, 'notes'] as const,
  note: (id: string) => ['notes', id] as const,
  comments: (targetType: CommentTargetType, targetId: string) =>
    [`${targetType}s`, targetId, 'comments'] as const,
  taskDocument: (taskId: string) => ['tasks', taskId, 'document'] as const,

  agentRuns: (projectId: string) => ['projects', projectId, 'agent-runs'] as const,
  submissions: (projectId: string, status?: SubmissionStatus) =>
    ['projects', projectId, 'submissions', status ?? 'pending'] as const,
  goals: (projectId: string) => ['projects', projectId, 'goals'] as const,
  goal: (goalId: string) => ['goals', goalId] as const,
  orgMembers: (orgId: string) => ['orgs', orgId, 'members'] as const,
  workspaceMembers: (teamId: string) => ['workspaces', teamId, 'members'] as const,
};

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: listProjects,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => createProject(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: queryKeys.project(id),
    queryFn: () => getProject(id),
    ...liveQueryOptions,
  });
}

export function useTasks(projectId: string, filter: { status?: TaskStatus } = {}) {
  return useQuery({
    queryKey: queryKeys.tasks(projectId, filter.status),
    queryFn: () => listTasks(projectId, filter),
    ...liveQueryOptions,
  });
}

function invalidateTaskQueries(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
  // Invalidate the tasks *prefix* (not `…/tasks/all`) so status-scoped lists
  // (backlog, scope) the inbox reads are refetched — React Query matches by prefix.
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasksRoot(projectId) });
  // task mutations can auto-create tags by name
  void queryClient.invalidateQueries({ queryKey: queryKeys.tags(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.canvas(projectId) });
}

export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(projectId, input),
    onSuccess: () => {
      invalidateTaskQueries(queryClient, projectId);
    },
  });
}

export function usePatchTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchTaskInput }) => patchTask(id, input),
    onSuccess: (task) => {
      invalidateTaskQueries(queryClient, task.project_id);
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) => deleteTask(id),
    onSuccess: (_result, { projectId }) => {
      invalidateTaskQueries(queryClient, projectId);
    },
  });
}

export function useTags(projectId: string) {
  return useQuery({
    queryKey: queryKeys.tags(projectId),
    queryFn: () => listTags(projectId),
    ...liveQueryOptions,
  });
}

function invalidateTagQueries(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.tags(projectId) });
  // renames/deletes change the tag chips embedded in task payloads
  // Invalidate the tasks *prefix* (not `…/tasks/all`) so status-scoped lists
  // (backlog, scope) the inbox reads are refetched — React Query matches by prefix.
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasksRoot(projectId) });
}

export function useCreateTag(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTagInput) => createTag(projectId, input),
    onSuccess: () => {
      invalidateTagQueries(queryClient, projectId);
    },
  });
}

export function usePatchTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchTagInput }) => patchTag(id, input),
    onSuccess: (tag) => {
      invalidateTagQueries(queryClient, tag.project_id);
    },
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) => deleteTag(id),
    onSuccess: (_result, { projectId }) => {
      invalidateTagQueries(queryClient, projectId);
    },
  });
}

export function usePatchProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchProjectInput }) =>
      patchProject(id, input),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}

export function useCanvas(projectId: string) {
  return useQuery({
    queryKey: queryKeys.canvas(projectId),
    queryFn: () => getCanvas(projectId),
    ...liveQueryOptions,
  });
}

export function usePutCanvas(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PutCanvasInput) => putCanvas(projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.canvas(projectId) });
    },
  });
}

export function useDocuments(projectId: string) {
  return useQuery({
    queryKey: queryKeys.documents(projectId),
    queryFn: () => listDocuments(projectId),
    ...liveQueryOptions,
  });
}

export function useCreateDocument(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDocumentInput) => createDocument(projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId) });
    },
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: queryKeys.document(id),
    queryFn: () => getDocument(id),
    ...liveQueryOptions,
  });
}

export function usePatchDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchDocumentInput }) =>
      patchDocument(id, input),
    onSuccess: (document) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.document(document.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents(document.project_id) });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) => deleteDocument(id),
    onSuccess: (_result, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId) });
    },
  });
}

export function useFolders(projectId: string) {
  return useQuery({
    queryKey: queryKeys.folders(projectId),
    queryFn: () => listFolders(projectId),
    ...liveQueryOptions,
  });
}

function invalidateFolderQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.folders(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId) });
}

export function useCreateFolder(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFolderInput) => createFolder(projectId, input),
    onSuccess: () => {
      invalidateFolderQueries(queryClient, projectId);
    },
  });
}

export function usePatchFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchFolderInput }) => patchFolder(id, input),
    onSuccess: (folder) => {
      invalidateFolderQueries(queryClient, folder.project_id);
    },
  });
}

export function useDeleteFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) => deleteFolder(id),
    onSuccess: (_result, { projectId }) => {
      invalidateFolderQueries(queryClient, projectId);
    },
  });
}

export function useNotes(projectId: string) {
  return useQuery({
    queryKey: queryKeys.notes(projectId),
    queryFn: () => listNotes(projectId),
    ...liveQueryOptions,
  });
}

export function useCreateNote(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNoteInput) => createNote(projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes(projectId) });
    },
  });
}

export function useNote(id: string) {
  return useQuery({
    queryKey: queryKeys.note(id),
    queryFn: () => getNote(id),
    ...liveQueryOptions,
  });
}

export function usePatchNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchNoteInput }) => patchNote(id, input),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.note(note.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes(note.project_id) });
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) => deleteNote(id),
    onSuccess: (_result, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes(projectId) });
    },
  });
}

export function useComments(target: CommentTarget) {
  return useQuery({
    queryKey: queryKeys.comments(target.type, target.id),
    queryFn: () => listComments(target, { includeResolved: true }),
    ...liveQueryOptions,
  });
}

export function useCreateComment(target: CommentTarget) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) => createComment(target, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(target.type, target.id) });
    },
  });
}

export function usePatchComment(target: CommentTarget) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchCommentInput }) =>
      patchComment(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(target.type, target.id) });
    },
  });
}

export function useDeleteComment(target: CommentTarget) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(target.type, target.id) });
    },
  });
}

export function useDeleteEdge(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (edgeId: string) => deleteEdge(projectId, edgeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.canvas(projectId) });
    },
  });
}

export function useTaskDocument(taskId: string) {
  return useQuery({
    queryKey: queryKeys.taskDocument(taskId),
    queryFn: () => getTaskDocument(taskId),
    ...liveQueryOptions,
  });
}

export function useCreateCliToken() {
  return useMutation({
    mutationFn: (name?: string) => createCliToken(name),
  });
}

export function useOrgMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orgMembers(orgId ?? ''),
    queryFn: () => listOrgMembers(orgId as string),
    enabled: orgId !== undefined && orgId.length > 0,
  });
}

export function useCreateOrgInvitation(orgId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: InviteRole }) => {
      if (orgId === undefined || orgId.length === 0) {
        return Promise.reject(new Error('No active organization'));
      }
      return createOrgInvitation(orgId, input);
    },
    onSuccess: () => {
      if (orgId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.orgMembers(orgId) });
      }
    },
  });
}

export function useAgentRuns(projectId: string) {
  return useQuery({
    queryKey: queryKeys.agentRuns(projectId),
    queryFn: () => listAgentRuns(projectId),
    ...liveQueryOptions,
  });
}

export function useSubmissions(projectId: string, status: SubmissionStatus = 'pending') {
  return useQuery({
    queryKey: queryKeys.submissions(projectId, status),
    queryFn: () => listSubmissions(projectId, status),
  });
}

export function useTriageSubmission(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TriageSubmissionInput }) =>
      triageSubmission(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.submissions(projectId) });
      // accepting creates a new `scope` task
      invalidateTaskQueries(queryClient, projectId);
    },
  });
}

function invalidateGoalQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  goalId: string,
  includeTasks = false,
) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.goals(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.goal(goalId) });
  if (includeTasks) {
    invalidateTaskQueries(queryClient, projectId);
  }
}

export function useGoals(projectId: string) {
  return useQuery({
    queryKey: queryKeys.goals(projectId),
    queryFn: () => listGoals(projectId),
    ...liveQueryOptions,
  });
}

export function useGoal(goalId: string) {
  return useQuery({
    queryKey: queryKeys.goal(goalId),
    queryFn: () => getGoal(goalId),
    enabled: goalId !== '',
    ...liveQueryOptions,
  });
}

export function useCreateGoal(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGoalInput) => createGoal(projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals(projectId) });
    },
  });
}

export function usePatchGoal(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchGoalInput }) => patchGoal(id, input),
    onSuccess: (goal) => {
      invalidateGoalQueries(queryClient, projectId, goal.id);
    },
  });
}

export function usePauseGoal(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) => pauseGoal(goalId),
    onSuccess: (goal) => {
      invalidateGoalQueries(queryClient, projectId, goal.id);
    },
  });
}

export function useResumeGoal(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) => resumeGoal(goalId),
    onSuccess: (goal) => {
      invalidateGoalQueries(queryClient, projectId, goal.id);
    },
  });
}

export function useCompleteGoal(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, evidence }: { goalId: string; evidence?: VerificationEvidence }) =>
      completeGoal(goalId, evidence),
    onSuccess: (goal) => {
      invalidateGoalQueries(queryClient, projectId, goal.id, true);
    },
  });
}

// Workspace CRUD + member management + move-project. Workspace = better-auth
// team; CRUD/membership goes through better-auth, move-project through PATCH
// /projects/:id. All mutating hooks refresh the workspaces list AND the session
// (the session caches workspaces + active_workspace for the nav switcher).

function invalidateWorkspaceCaches(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: workspacesKey });
  void queryClient.invalidateQueries({ queryKey: authSessionKey });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createWorkspace(name),
    onSuccess: () => {
      invalidateWorkspaceCaches(queryClient);
    },
  });
}

export function useRenameWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, name }: { teamId: string; name: string }) =>
      renameWorkspace(teamId, name),
    onSuccess: () => {
      invalidateWorkspaceCaches(queryClient);
    },
  });
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => deleteWorkspace(teamId),
    onSuccess: () => {
      invalidateWorkspaceCaches(queryClient);
    },
  });
}

export function useWorkspaceMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workspaceMembers(teamId ?? ''),
    queryFn: () => listWorkspaceMembers(teamId as string),
    enabled: teamId !== undefined && teamId.length > 0,
  });
}

export function useAddWorkspaceMember(teamId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => {
      if (teamId === undefined) {
        return Promise.reject(new Error('No active workspace'));
      }
      return addWorkspaceMember(teamId, userId);
    },
    onSuccess: () => {
      if (teamId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceMembers(teamId) });
      }
    },
  });
}

export function useRemoveWorkspaceMember(teamId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => {
      if (teamId === undefined) {
        return Promise.reject(new Error('No active workspace'));
      }
      return removeWorkspaceMember(teamId, userId);
    },
    onSuccess: () => {
      if (teamId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceMembers(teamId) });
      }
    },
  });
}

export function useMoveProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, workspaceId }: { projectId: string; workspaceId: string }) =>
      moveProject(projectId, workspaceId),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) });
    },
  });
}

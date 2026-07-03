import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createComment,
  createDocument,
  createMcpToken,
  createNote,
  createProject,
  createTag,
  createTask,
  deleteComment,
  deleteDocument,
  deleteEdge,
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
  listDocumentComments,
  listDocuments,
  listMcpTokens,
  listNotes,
  listProjects,
  listTags,
  listTasks,
  patchComment,
  patchDocument,
  patchNote,
  patchProject,
  patchTag,
  patchTask,
  putCanvas,
  revokeMcpToken,
  type CreateCommentInput,
  type CreateDocumentInput,
  type CreateNoteInput,
  type CreateProjectInput,
  type CreateTagInput,
  type CreateTaskInput,
  type PatchCommentInput,
  type PatchDocumentInput,
  type PatchNoteInput,
  type PatchProjectInput,
  type PatchTagInput,
  type PatchTaskInput,
  type PutCanvasInput,
  type TaskStatus,
} from './api.js';

export const queryKeys = {
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  tasks: (projectId: string, status?: TaskStatus) =>
    ['projects', projectId, 'tasks', status ?? 'all'] as const,
  tags: (projectId: string) => ['projects', projectId, 'tags'] as const,
  canvas: (projectId: string) => ['projects', projectId, 'canvas'] as const,
  documents: (projectId: string) => ['projects', projectId, 'documents'] as const,
  document: (id: string) => ['documents', id] as const,
  notes: (projectId: string) => ['projects', projectId, 'notes'] as const,
  note: (id: string) => ['notes', id] as const,
  documentComments: (documentId: string) => ['documents', documentId, 'comments'] as const,
  taskDocument: (taskId: string) => ['tasks', taskId, 'document'] as const,
  mcpTokens: ['mcp-tokens'] as const,
  agentRuns: (projectId: string) => ['projects', projectId, 'agent-runs'] as const,
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
  });
}

export function useTasks(projectId: string, filter: { status?: TaskStatus } = {}) {
  return useQuery({
    queryKey: queryKeys.tasks(projectId, filter.status),
    queryFn: () => listTasks(projectId, filter),
  });
}

function invalidateTaskQueries(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(projectId) });
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
  });
}

function invalidateTagQueries(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.tags(projectId) });
  // renames/deletes change the tag chips embedded in task payloads
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(projectId) });
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

export function useNotes(projectId: string) {
  return useQuery({
    queryKey: queryKeys.notes(projectId),
    queryFn: () => listNotes(projectId),
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

export function useDocumentComments(documentId: string) {
  return useQuery({
    queryKey: queryKeys.documentComments(documentId),
    queryFn: () => listDocumentComments(documentId, { includeResolved: true }),
  });
}

export function useCreateComment(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) => createComment(documentId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentComments(documentId) });
    },
  });
}

export function usePatchComment(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchCommentInput }) =>
      patchComment(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentComments(documentId) });
    },
  });
}

export function useDeleteComment(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentComments(documentId) });
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
  });
}

export function useMcpTokens() {
  return useQuery({
    queryKey: queryKeys.mcpTokens,
    queryFn: listMcpTokens,
  });
}

export function useCreateMcpToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createMcpToken(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcpTokens });
    },
  });
}

export function useRevokeMcpToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeMcpToken(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcpTokens });
    },
  });
}

export function useAgentRuns(projectId: string) {
  return useQuery({
    queryKey: queryKeys.agentRuns(projectId),
    queryFn: () => listAgentRuns(projectId),
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDocument,
  createMcpToken,
  createProject,
  getCanvas,
  getDocument,
  getProject,
  getTaskDocument,
  listDocuments,
  listMcpTokens,
  listProjects,
  listTasks,
  patchDocument,
  patchTask,
  putCanvas,
  revokeMcpToken,
  type CreateDocumentInput,
  type CreateProjectInput,
  type PatchDocumentInput,
  type PatchTaskInput,
  type PutCanvasInput,
  type TaskStatus,
} from './api.js';

export const queryKeys = {
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  tasks: (projectId: string, status?: TaskStatus) =>
    ['projects', projectId, 'tasks', status ?? 'all'] as const,
  canvas: (projectId: string) => ['projects', projectId, 'canvas'] as const,
  documents: (projectId: string) => ['projects', projectId, 'documents'] as const,
  document: (id: string) => ['documents', id] as const,
  taskDocument: (taskId: string) => ['tasks', taskId, 'document'] as const,
  mcpTokens: ['mcp-tokens'] as const,
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

export function usePatchTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchTaskInput }) => patchTask(id, input),
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(task.project_id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(task.project_id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.canvas(task.project_id) });
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

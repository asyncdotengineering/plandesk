import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db, DbClient } from './client.js';
import { isValidCommitRefs, normalizeCommitRefs } from './commit-refs.js';
import type { PlandeskExportInput } from './portability.js';
import type { ManifestImportEntry } from './portability-export-manifest.js';
import {
  agentRunEvents,
  agentRuns,
  artifacts,
  comments,
  DEFAULT_ORG_ID,
  DEFAULT_WORKSPACE_ID,
  documents,
  edges,
  files,
  folders,
  goals,
  notes,
  projects,
  prototypes,
  tags,
  taskTags,
  tasks,
  views,
  linkEntityTypes,
  type LinkEntityType,
} from './schema.js';
import { parseSavedViewConfig, stringifySavedViewConfig } from './saved-view-config.js';
import type {
  PlandeskExportComment,
  PlandeskExportDocument,
  PlandeskExportFolder,
} from './portability.js';

export type ImportContext = {
  root: Db;
  data: PlandeskExportInput;
  projectId: string;
  orgId: string;
  workspaceId: string;
  now: Date;
  taskIdMap: Map<string, string>;
  goalIdMap: Map<string, string>;
  tagIdMap: Map<string, string>;
  edgeIdMap: Map<string, string>;
  folderIdMap: Map<string, string>;
  prototypeIdMap: Map<string, string>;
  documentIdMap: Map<string, string>;
  artifactIdMap: Map<string, string>;
  agentRunIdMap: Map<string, string>;
  defaultGoalId: string;
  statements: BatchItem<'sqlite'>[];
};

export type ImportManifestHandler = {
  order: number;
  preallocateIds?: (ctx: ImportContext) => void;
  emit: (ctx: ImportContext) => void;
};

export function requireRootDb(db: DbClient): Db {
  if (!('$client' in db)) {
    throw new Error('importProject requires a root Db handle (db.batch)');
  }
  return db;
}

export function asNonEmptyBatch(
  statements: BatchItem<'sqlite'>[],
): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] {
  const first = statements[0];
  if (first === undefined) {
    throw new Error('import batch is empty');
  }
  return [first, ...statements.slice(1)];
}

export function remapId(idMap: Map<string, string>, oldId: string | null): string | null {
  if (oldId === null) {
    return null;
  }
  const mapped = idMap.get(oldId);
  if (!mapped) {
    throw new Error(`Missing ID remap for ${oldId}`);
  }
  return mapped;
}

export function commitRefsForImport(value: string[] | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isValidCommitRefs(value)) {
    return null;
  }
  return JSON.stringify(normalizeCommitRefs(value));
}

export function toLinkEntityType(value: string | null | undefined): LinkEntityType | null {
  if (value === null || value === undefined) {
    return null;
  }
  return (linkEntityTypes as readonly string[]).includes(value) ? (value as LinkEntityType) : null;
}

export function legacyDocumentPrimaryTaskId(document: PlandeskExportDocument): string | null {
  const raw = (document as PlandeskExportDocument & Record<string, unknown>)[
    ['linked', 'task', 'id'].join('_')
  ];
  return typeof raw === 'string' ? raw : null;
}

export function remapEndpointId(
  type: string | null | undefined,
  id: string | null | undefined,
  taskIdMap: Map<string, string>,
  documentIdMap: Map<string, string>,
  artifactIdMap: Map<string, string>,
  prototypeIdMap: Map<string, string>,
): string | null | undefined {
  if (type === undefined || type === null || id === undefined || id === null) {
    return undefined;
  }
  if (type === 'document') {
    return remapId(documentIdMap, id);
  }
  if (type === 'artifact') {
    return remapId(artifactIdMap, id);
  }
  if (type === 'prototype') {
    return remapId(prototypeIdMap, id);
  }
  return remapId(taskIdMap, id);
}

export function sortDocumentsForImport(
  documents: PlandeskExportDocument[],
): PlandeskExportDocument[] {
  const remaining = [...documents];
  const sorted: PlandeskExportDocument[] = [];
  const created = new Set<string>();

  while (remaining.length > 0) {
    let progress = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const document = remaining[i];
      if (!document) {
        continue;
      }
      if (document.parent_id === null || created.has(document.parent_id)) {
        sorted.push(document);
        created.add(document.id);
        remaining.splice(i, 1);
        progress = true;
      }
    }
    if (!progress) {
      throw new Error('Document parent cycle or missing parent in export');
    }
  }

  return sorted;
}

export function sortFoldersForImport(folders: PlandeskExportFolder[]): PlandeskExportFolder[] {
  const remaining = [...folders];
  const sorted: PlandeskExportFolder[] = [];
  const created = new Set<string>();

  while (remaining.length > 0) {
    let progress = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const folder = remaining[i];
      if (!folder) {
        continue;
      }
      if (folder.parent_folder_id === null || created.has(folder.parent_folder_id)) {
        sorted.push(folder);
        created.add(folder.id);
        remaining.splice(i, 1);
        progress = true;
      }
    }
    if (!progress) {
      throw new Error('Folder parent cycle or missing parent in export');
    }
  }

  return sorted;
}

export function preallocateTaskIds(ctx: ImportContext): void {
  for (const task of ctx.data.tasks) {
    ctx.taskIdMap.set(task.id, randomUUID());
  }
}

export function preallocateGoalIds(ctx: ImportContext): void {
  for (const goal of ctx.data.goals ?? []) {
    ctx.goalIdMap.set(goal.id, randomUUID());
  }
}

export function preallocateTagIds(ctx: ImportContext): void {
  for (const tag of ctx.data.tags ?? []) {
    ctx.tagIdMap.set(tag.id, randomUUID());
  }
}

export function preallocateEdgeIds(ctx: ImportContext): void {
  for (const edge of ctx.data.edges) {
    ctx.edgeIdMap.set(edge.id, randomUUID());
  }
}

export function preallocateFolderIds(ctx: ImportContext): void {
  for (const folder of ctx.data.folders ?? []) {
    ctx.folderIdMap.set(folder.id, randomUUID());
  }
}

export function preallocatePrototypeIds(ctx: ImportContext): void {
  for (const prototype of ctx.data.prototypes ?? []) {
    ctx.prototypeIdMap.set(prototype.id, randomUUID());
  }
}

export function preallocateDocumentIds(ctx: ImportContext): void {
  for (const document of ctx.data.documents) {
    ctx.documentIdMap.set(document.id, randomUUID());
  }
}

export function preallocateArtifactIds(ctx: ImportContext): void {
  for (const artifact of ctx.data.artifacts ?? []) {
    ctx.artifactIdMap.set(artifact.id, randomUUID());
  }
}

export function preallocateAgentRunIds(ctx: ImportContext): void {
  for (const run of ctx.data.agent_runs) {
    ctx.agentRunIdMap.set(run.id, randomUUID());
  }
}

export function emitProjectImport(ctx: ImportContext): void {
  ctx.statements.push(
    ctx.root.insert(projects).values({
      id: ctx.projectId,
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId,
      name: ctx.data.project.name,
      description: ctx.data.project.description,
      ownerId: ctx.data.project.owner_id ?? null,
      // Overview pin is applied after documents exist — see emitProjectOverviewLink.
      overviewDocumentId: null,
      repoUrl: ctx.data.project.repo_url ?? null,
      folderPath: ctx.data.project.folder_path ?? null,
      canvasLayout: ctx.data.project.canvas_layout,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    }),
  );
}

/** Link the remapped overview document after documents have been inserted. */
export function emitProjectOverviewLink(ctx: ImportContext): void {
  const overviewExportId = ctx.data.project.overview_document_id;
  if (overviewExportId === undefined || overviewExportId === null) {
    return;
  }
  const remapped = remapId(ctx.documentIdMap, overviewExportId);
  if (remapped === null) {
    throw new Error(
      `overview_document_id ${overviewExportId} is not present in the export documents collection`,
    );
  }
  ctx.statements.push(
    ctx.root
      .update(projects)
      .set({ overviewDocumentId: remapped, updatedAt: ctx.now })
      .where(eq(projects.id, ctx.projectId)),
  );
}

export function emitGoalsImport(ctx: ImportContext): void {
  const exportGoals = ctx.data.goals ?? [];
  if (exportGoals.length === 0) {
    ctx.statements.push(
      ctx.root.insert(goals).values({
        id: ctx.defaultGoalId,
        projectId: ctx.projectId,
        objective: 'General',
        status: 'active',
        verificationSurface: null,
        constraints: null,
        boundaries: null,
        iterationPolicy: null,
        stopCondition: null,
        budget: null,
        lastVerification: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    );
    return;
  }

  for (const goal of exportGoals) {
    ctx.statements.push(
      ctx.root.insert(goals).values({
        id: remapId(ctx.goalIdMap, goal.id) ?? goal.id,
        projectId: ctx.projectId,
        name: goal.name ?? null,
        objective: goal.objective,
        status: goal.status,
        verificationSurface: goal.verification_surface,
        constraints: goal.constraints,
        boundaries: goal.boundaries,
        iterationPolicy: goal.iteration_policy,
        stopCondition: goal.stop_condition,
        budget: goal.budget,
        lastVerification: goal.last_verification ?? null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    );
  }
}

export function emitTasksImport(ctx: ImportContext): void {
  for (const task of ctx.data.tasks) {
    const goalId =
      (task.goal_id !== undefined ? ctx.goalIdMap.get(task.goal_id) : undefined) ??
      ctx.defaultGoalId;
    const commitRefsColumn = commitRefsForImport(task.commit_refs);
    ctx.statements.push(
      ctx.root.insert(tasks).values({
        id: remapId(ctx.taskIdMap, task.id) ?? task.id,
        projectId: ctx.projectId,
        goalId,
        label: task.label,
        status: task.status,
        kind: task.kind ?? 'build',
        priority: task.priority ?? null,
        lane: task.lane ?? null,
        severity: task.severity ?? null,
        description: task.description,
        x: task.x,
        y: task.y,
        assignee: task.assignee,
        dueDate: task.due_date ? new Date(task.due_date) : null,
        commitRefs: commitRefsColumn,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    );
  }
}

export function emitTagsImport(ctx: ImportContext): void {
  for (const tag of ctx.data.tags ?? []) {
    ctx.statements.push(
      ctx.root.insert(tags).values({
        id: remapId(ctx.tagIdMap, tag.id) ?? tag.id,
        projectId: ctx.projectId,
        name: tag.name,
        color: tag.color,
        createdAt: ctx.now,
      }),
    );
  }
}

export function emitTaskTagsImport(ctx: ImportContext): void {
  for (const task of ctx.data.tasks) {
    const tagIds = task.tag_ids ?? [];
    if (tagIds.length === 0) {
      continue;
    }
    const taskId = remapId(ctx.taskIdMap, task.id) ?? task.id;
    const unique = [...new Set(tagIds.map((tagId) => remapId(ctx.tagIdMap, tagId) ?? tagId))];
    if (unique.length === 0) {
      continue;
    }
    ctx.statements.push(
      ctx.root.insert(taskTags).values(unique.map((tagId) => ({ taskId, tagId }))),
    );
  }
}

export function emitEdgesImport(ctx: ImportContext): void {
  for (const edge of ctx.data.edges) {
    const fromType = toLinkEntityType(
      edge.from_type ??
        (edge.from_task_id === null || edge.from_task_id === undefined ? null : 'task'),
    );
    const toType = toLinkEntityType(
      edge.to_type ?? (edge.to_task_id === null || edge.to_task_id === undefined ? null : 'task'),
    );
    const fromId =
      remapEndpointId(
        edge.from_type,
        edge.from_id,
        ctx.taskIdMap,
        ctx.documentIdMap,
        ctx.artifactIdMap,
        ctx.prototypeIdMap,
      ) ?? remapId(ctx.taskIdMap, edge.from_task_id ?? null);
    const toId =
      remapEndpointId(
        edge.to_type,
        edge.to_id,
        ctx.taskIdMap,
        ctx.documentIdMap,
        ctx.artifactIdMap,
        ctx.prototypeIdMap,
      ) ?? remapId(ctx.taskIdMap, edge.to_task_id ?? null);
    if (fromType === null || toType === null || fromId === null || toId === null) {
      continue;
    }
    ctx.statements.push(
      ctx.root.insert(edges).values({
        id: remapId(ctx.edgeIdMap, edge.id) ?? edge.id,
        projectId: ctx.projectId,
        fromType,
        fromId,
        toType,
        toId,
        label: edge.label,
        arrowDirection: edge.arrow_direction,
        style: edge.style,
        createdAt: ctx.now,
      }),
    );
  }
}

export function emitFoldersImport(ctx: ImportContext): void {
  for (const folder of sortFoldersForImport(ctx.data.folders ?? [])) {
    ctx.statements.push(
      ctx.root.insert(folders).values({
        id: remapId(ctx.folderIdMap, folder.id) ?? folder.id,
        projectId: ctx.projectId,
        name: folder.name,
        parentFolderId: remapId(ctx.folderIdMap, folder.parent_folder_id),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    );
  }
}

export function emitPrototypesImport(ctx: ImportContext): void {
  for (const prototype of ctx.data.prototypes ?? []) {
    ctx.statements.push(
      ctx.root.insert(prototypes).values({
        id: remapId(ctx.prototypeIdMap, prototype.id) ?? prototype.id,
        projectId: ctx.projectId,
        name: prototype.name,
        viewportWidth: prototype.viewport_width,
        viewportHeight: prototype.viewport_height,
        folderId: remapId(ctx.folderIdMap, prototype.folder_id ?? null),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    );
  }
}

export function emitDocumentsImport(ctx: ImportContext): void {
  for (const document of sortDocumentsForImport(ctx.data.documents)) {
    ctx.statements.push(
      ctx.root.insert(documents).values({
        id: remapId(ctx.documentIdMap, document.id) ?? document.id,
        projectId: ctx.projectId,
        title: document.title,
        body: document.body,
        statusLine: document.status_line,
        parentId: remapId(ctx.documentIdMap, document.parent_id),
        folderId: remapId(ctx.folderIdMap, document.folder_id ?? null),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    );
  }

  const existingDocTaskLinks = new Set(
    ctx.data.edges
      .filter(
        (edge) =>
          (edge.from_type === 'document' || edge.from_type === undefined) &&
          (edge.to_type === 'task' || edge.to_type === undefined),
      )
      .map((edge) => `${edge.from_id ?? ''}->${edge.to_id ?? edge.to_task_id ?? ''}`),
  );
  for (const document of ctx.data.documents) {
    const legacyTaskId = legacyDocumentPrimaryTaskId(document);
    if (legacyTaskId === null) {
      continue;
    }
    const docId = remapId(ctx.documentIdMap, document.id) ?? document.id;
    const taskId = remapId(ctx.taskIdMap, legacyTaskId) ?? legacyTaskId;
    if (existingDocTaskLinks.has(`${document.id}->${legacyTaskId}`)) {
      continue;
    }
    ctx.statements.push(
      ctx.root.insert(edges).values({
        id: randomUUID(),
        projectId: ctx.projectId,
        fromType: 'document',
        fromId: docId,
        toType: 'task',
        toId: taskId,
        label: 'documents',
        arrowDirection: null,
        style: null,
        createdAt: ctx.now,
      }),
    );
  }

  // Projects are inserted before documents; apply the overview pin now that
  // document rows (and their remapped ids) exist.
  emitProjectOverviewLink(ctx);
}

export function emitNotesImport(ctx: ImportContext): void {
  for (const note of ctx.data.notes ?? []) {
    ctx.statements.push(
      ctx.root.insert(notes).values({
        id: randomUUID(),
        projectId: ctx.projectId,
        title: note.title,
        body: note.body,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    );
  }
}

export function emitViewsImport(ctx: ImportContext): void {
  for (const view of ctx.data.views ?? []) {
    const config = parseSavedViewConfig(view.config);
    ctx.statements.push(
      ctx.root.insert(views).values({
        id: randomUUID(),
        projectId: ctx.projectId,
        name: view.name,
        config: stringifySavedViewConfig(config),
        position: view.position,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    );
  }
}

export function emitCommentsImport(ctx: ImportContext): void {
  const commentEntries: PlandeskExportComment[] = [
    ...(ctx.data.comments ?? []),
    ...(ctx.data.document_comments ?? []).map((legacy) => ({
      id: legacy.id,
      target_type: 'document' as const,
      target_id: legacy.document_id,
      passage: legacy.passage,
      body: legacy.body,
      resolved: legacy.resolved,
      created_at: legacy.created_at ?? new Date().toISOString(),
    })),
  ];

  for (const comment of commentEntries) {
    const targetId =
      comment.target_type === 'document'
        ? (remapId(ctx.documentIdMap, comment.target_id) ?? comment.target_id)
        : comment.target_type === 'artifact'
          ? (remapId(ctx.artifactIdMap, comment.target_id) ?? comment.target_id)
          : comment.target_id;
    ctx.statements.push(
      ctx.root.insert(comments).values({
        id: randomUUID(),
        projectId: ctx.projectId,
        targetType: comment.target_type,
        targetId,
        passage: comment.passage,
        anchor: comment.anchor ?? null,
        body: comment.body,
        resolved: comment.resolved,
        createdAt: new Date(comment.created_at),
      }),
    );
  }
}

export function emitAgentRunsImport(ctx: ImportContext): void {
  for (const agentRun of ctx.data.agent_runs) {
    const newRunId = remapId(ctx.agentRunIdMap, agentRun.id) ?? agentRun.id;
    ctx.statements.push(
      ctx.root.insert(agentRuns).values({
        id: newRunId,
        projectId: ctx.projectId,
        status: agentRun.status,
        label: agentRun.label,
        startedAt: new Date(agentRun.started_at),
        completedAt: agentRun.completed_at ? new Date(agentRun.completed_at) : null,
      }),
    );
  }
}

export function emitAgentRunEventsImport(ctx: ImportContext): void {
  for (const agentRun of ctx.data.agent_runs) {
    const newRunId = remapId(ctx.agentRunIdMap, agentRun.id) ?? agentRun.id;
    for (const event of agentRun.events) {
      ctx.statements.push(
        ctx.root.insert(agentRunEvents).values({
          id: randomUUID(),
          runId: newRunId,
          message: event.message,
          createdAt: new Date(event.created_at),
        }),
      );
    }
  }
}

export function emitFilesImport(ctx: ImportContext): void {
  for (const file of ctx.data.files ?? []) {
    ctx.statements.push(
      ctx.root
        .insert(files)
        .values({
          id: file.id,
          projectId: ctx.projectId,
          filename: file.filename,
          mime: file.mime,
          size: file.size,
          bytes: file.bytes_base64 ? Buffer.from(file.bytes_base64, 'base64') : null,
          externalUrl: file.external_url,
          createdAt: file.created_at,
        })
        .onConflictDoNothing({ target: [files.projectId, files.id] }),
    );
  }
}

export function emitArtifactsImport(ctx: ImportContext): void {
  for (const artifact of ctx.data.artifacts ?? []) {
    ctx.statements.push(
      ctx.root.insert(artifacts).values({
        id: remapId(ctx.artifactIdMap, artifact.id) ?? artifact.id,
        projectId: ctx.projectId,
        title: artifact.title,
        kind: artifact.kind,
        content: artifact.content,
        prototypeId: remapId(ctx.prototypeIdMap, artifact.prototype_id ?? null),
        x: artifact.x ?? null,
        y: artifact.y ?? null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    );
  }
}

export function resolveDefaultGoalId(ctx: ImportContext): string {
  const exportGoals = ctx.data.goals ?? [];
  if (exportGoals.length === 0) {
    return randomUUID();
  }
  const firstGoal = exportGoals[0];
  if (firstGoal === undefined) {
    throw new Error('export goals unexpectedly empty');
  }
  return remapId(ctx.goalIdMap, firstGoal.id) ?? firstGoal.id;
}

export async function runImportFromManifest(
  db: DbClient,
  data: PlandeskExportInput,
  manifestEntries: ManifestImportEntry[],
  options?: { orgId?: string; workspaceId?: string },
): Promise<{ projectId: string }> {
  const root = requireRootDb(db);
  const projectId = randomUUID();
  const now = new Date();

  const ctx: ImportContext = {
    root,
    data,
    projectId,
    orgId: options?.orgId ?? DEFAULT_ORG_ID,
    workspaceId: options?.workspaceId ?? DEFAULT_WORKSPACE_ID,
    now,
    taskIdMap: new Map(),
    goalIdMap: new Map(),
    tagIdMap: new Map(),
    edgeIdMap: new Map(),
    folderIdMap: new Map(),
    prototypeIdMap: new Map(),
    documentIdMap: new Map(),
    artifactIdMap: new Map(),
    agentRunIdMap: new Map(),
    defaultGoalId: '',
    statements: [],
  };

  for (const { import: handler } of manifestEntries) {
    handler.preallocateIds?.(ctx);
  }
  ctx.defaultGoalId = resolveDefaultGoalId(ctx);

  const sorted = [...manifestEntries].sort((a, b) => a.import.order - b.import.order);
  for (const { import: handler } of sorted) {
    handler.emit(ctx);
  }

  await root.batch(asNonEmptyBatch(ctx.statements));
  return { projectId };
}

import { createHash } from 'node:crypto';
import { getTableColumns } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client.js';
import { migrate } from './migrate.js';
import { exportProject, importProject, PLANDESK_EXPORT_TABLES, type PlandeskExport } from './portability.js';
import { createAgentRunEvent } from './repositories/agent-run-events.js';
import { createAgentRun, updateAgentRunStatus } from './repositories/agent-runs.js';
import { createArtifact } from './repositories/artifacts.js';
import { createComment } from './repositories/comments.js';
import { createDocument } from './repositories/documents.js';
import { createEdge } from './repositories/edges.js';
import { createFile } from './repositories/files.js';
import { createFolder } from './repositories/folders.js';
import { createGoal } from './repositories/goals.js';
import { createNote } from './repositories/notes.js';
import { updateProject } from './repositories/projects.js';
import { createTag, setTaskTags } from './repositories/tags.js';
import { createTask, updateTask } from './repositories/tasks.js';
import {
  agentRunEvents,
  agentRuns,
  artifacts,
  comments,
  documents,
  edges,
  files,
  folders,
  goals,
  notes,
  projects,
  tags,
  taskTags,
  tasks,
} from './schema.js';
import { createProjectInDefaultOrg as createProject } from './testing.js';

/**
 * Local schema handles for columns the guard inspects.
 * Table *names* must equal {@link PLANDESK_EXPORT_TABLES} — that production
 * constant is authoritative; this map only supplies drizzle table objects.
 */
const EXPORT_GRAPH_TABLES = {
  projects,
  goals,
  tasks,
  tags,
  task_tags: taskTags,
  edges,
  folders,
  documents,
  notes,
  comments,
  agent_runs: agentRuns,
  agent_run_events: agentRunEvents,
  files,
  artifacts,
} as const;

type ExportGraphTable = keyof typeof EXPORT_GRAPH_TABLES;

/**
 * Columns that intentionally do not round-trip through export/import.
 * Each entry needs a written reason — never a blanket skip.
 */
const EXPORT_COLUMN_EXCLUSIONS: Record<ExportGraphTable, Record<string, string>> = {
  projects: {
    id: 'Remapped on import; export creates a new project',
    org_id: 'Scoped by import options, not the export file',
    workspace_id: 'Scoped by import options, not the export file',
    created_at: 'Server-assigned on import',
    updated_at: 'Server-assigned on import',
  },
  goals: {
    id: 'Remapped on import',
    project_id: 'Implied by nesting under the imported project',
    created_at: 'Server-assigned on import (export writes them; import stamps now)',
    updated_at: 'Server-assigned on import (export writes them; import stamps now)',
  },
  tasks: {
    id: 'Remapped on import',
    project_id: 'Implied by nesting under the imported project',
    created_at: 'Server-assigned on import (export writes them; import stamps now)',
    updated_at: 'Server-assigned on import (export writes them; import stamps now)',
  },
  tags: {
    id: 'Remapped on import',
    project_id: 'Implied by nesting under the imported project',
    created_at: 'Server-assigned on import',
  },
  task_tags: {
    task_id:
      'Association serialised as task.tag_ids — no direct export type; membership asserted via tag round-trip',
    tag_id:
      'Association serialised as task.tag_ids — no direct export type; membership asserted via tag round-trip',
  },
  edges: {
    id: 'Remapped on import',
    project_id: 'Implied by nesting under the imported project',
    created_at: 'Server-assigned on import',
  },
  folders: {
    id: 'Remapped on import',
    project_id: 'Implied by nesting under the imported project',
    created_at: 'Server-assigned on import',
    updated_at: 'Server-assigned on import',
  },
  documents: {
    id: 'Remapped on import',
    project_id: 'Implied by nesting under the imported project',
    created_at: 'Server-assigned on import',
    updated_at: 'Server-assigned on import',
  },
  notes: {
    id: 'Remapped on import (content-only identity)',
    project_id: 'Implied by nesting under the imported project',
    created_at: 'Server-assigned on import',
    updated_at: 'Server-assigned on import',
  },
  comments: {
    id: 'Remapped on import',
    project_id: 'Implied by nesting under the imported project',
  },
  agent_runs: {
    id: 'Remapped on import',
    project_id: 'Implied by nesting under the imported project',
  },
  agent_run_events: {
    id: 'Remapped on import',
    run_id: 'Implied by nesting under the parent agent_run in the export',
  },
  files: {
    project_id: 'Implied by nesting under the imported project',
  },
  artifacts: {
    id: 'Remapped on import',
    project_id: 'Implied by nesting under the imported project',
    created_at: 'Server-assigned on import (export writes them; import stamps now)',
    updated_at: 'Server-assigned on import (export writes them; import stamps now)',
  },
};

/**
 * SQL columns the behavioural suite asserts round-trip for.
 * Must equal schema columns minus EXPORT_COLUMN_EXCLUSIONS for each table.
 * Values are verified via export→import→re-export (or tag membership), not by name presence alone.
 */
const ROUND_TRIPPED_COLUMNS: Record<ExportGraphTable, readonly string[]> = {
  projects: ['name', 'description', 'repo_url', 'folder_path', 'canvas_layout'],
  goals: [
    'objective',
    'status',
    'verification_surface',
    'constraints',
    'boundaries',
    'iteration_policy',
    'stop_condition',
    'budget',
    'last_verification',
  ],
  tasks: [
    'goal_id',
    'label',
    'status',
    'description',
    'x',
    'y',
    'assignee',
    'due_date',
    'commit_refs',
  ],
  tags: ['name', 'color'],
  // Membership covered by asserting task.tag_ids ↔ tag names after round-trip.
  task_tags: [],
  edges: ['from_type', 'from_id', 'to_type', 'to_id', 'label', 'arrow_direction', 'style'],
  folders: ['name', 'parent_folder_id'],
  documents: ['title', 'body', 'status_line', 'parent_id', 'folder_id'],
  notes: ['title', 'body'],
  comments: ['target_type', 'target_id', 'passage', 'anchor', 'body', 'resolved', 'created_at'],
  agent_runs: ['status', 'label', 'started_at', 'completed_at'],
  agent_run_events: ['message', 'created_at'],
  files: ['id', 'filename', 'mime', 'size', 'bytes', 'external_url', 'created_at'],
  artifacts: ['title', 'kind', 'content'],
};

/** Stable snapshot of portable values — remapped ids resolved to natural keys. */
type PortableSnapshot = {
  project: {
    name: string;
    description: string | null;
    repo_url: string | null | undefined;
    folder_path: string | null | undefined;
    canvas_layout: string | null;
  };
  goals: Array<{
    objective: string;
    status: string;
    verification_surface: string | null;
    constraints: string | null;
    boundaries: string | null;
    iteration_policy: string | null;
    stop_condition: string | null;
    budget: string | null;
    last_verification: string | null | undefined;
  }>;
  tasks: Array<{
    label: string;
    status: string;
    description: string | null;
    x: number;
    y: number;
    assignee: string | null;
    due_date: string | null;
    goal_objective: string;
    tag_names: string[];
    commit_refs: string[] | null | undefined;
  }>;
  tags: Array<{ name: string; color: string | null }>;
  edges: Array<{
    from_key: string;
    to_key: string;
    from_type: string | null | undefined;
    to_type: string | null | undefined;
    label: string | null;
    arrow_direction: string | null;
    style: string | null;
  }>;
  folders: Array<{ name: string; parent_name: string | null }>;
  documents: Array<{
    title: string;
    body: string | null;
    status_line: string | null;
    parent_title: string | null;
    folder_name: string | null;
  }>;
  notes: Array<{ title: string; body: string | null }>;
  comments: Array<{
    target_type: string;
    target_key: string;
    passage: string | null;
    anchor: string | null | undefined;
    body: string;
    resolved: boolean;
    created_at: string;
  }>;
  agent_runs: Array<{
    status: string;
    label: string | null;
    started_at: string;
    completed_at: string | null;
    events: Array<{ message: string; created_at: string }>;
  }>;
  files: Array<{
    id: string;
    filename: string;
    mime: string;
    size: number;
    bytes_base64: string | null;
    external_url: string | null;
    created_at: string;
  }>;
  artifacts: Array<{ title: string; kind: string; content: string }>;
};

function entityKey(
  type: string | null | undefined,
  id: string | null | undefined,
  taskLabelById: Map<string, string>,
  documentTitleById: Map<string, string>,
  artifactTitleById: Map<string, string>,
): string {
  if (id === null || id === undefined) {
    return '';
  }
  if (type === 'document') {
    return `document:${documentTitleById.get(id) ?? id}`;
  }
  if (type === 'artifact') {
    return `artifact:${artifactTitleById.get(id) ?? id}`;
  }
  if (type === 'task') {
    return `task:${taskLabelById.get(id) ?? id}`;
  }
  return `${type ?? 'unknown'}:${id}`;
}

function toPortableSnapshot(exported: PlandeskExport): PortableSnapshot {
  const taskLabelById = new Map(exported.tasks.map((task) => [task.id, task.label]));
  const goalObjectiveById = new Map(exported.goals.map((goal) => [goal.id, goal.objective]));
  const documentTitleById = new Map(exported.documents.map((doc) => [doc.id, doc.title]));
  const folderNameById = new Map(exported.folders.map((folder) => [folder.id, folder.name]));
  const tagNameById = new Map(exported.tags.map((tag) => [tag.id, tag.name]));
  const artifactTitleById = new Map(
    exported.artifacts.map((artifact) => [artifact.id, artifact.title]),
  );

  return {
    project: {
      name: exported.project.name,
      description: exported.project.description,
      repo_url: exported.project.repo_url ?? null,
      folder_path: exported.project.folder_path ?? null,
      canvas_layout: exported.project.canvas_layout,
    },
    goals: [...exported.goals]
      .sort((a, b) => a.objective.localeCompare(b.objective))
      .map((goal) => ({
        objective: goal.objective,
        status: goal.status,
        verification_surface: goal.verification_surface,
        constraints: goal.constraints,
        boundaries: goal.boundaries,
        iteration_policy: goal.iteration_policy,
        stop_condition: goal.stop_condition,
        budget: goal.budget,
        last_verification: goal.last_verification ?? null,
      })),
    tasks: [...exported.tasks]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((task) => ({
        label: task.label,
        status: task.status,
        description: task.description,
        x: task.x,
        y: task.y,
        assignee: task.assignee,
        due_date: task.due_date,
        goal_objective:
          task.goal_id === undefined ? '' : (goalObjectiveById.get(task.goal_id) ?? task.goal_id),
        tag_names: (task.tag_ids ?? []).map((id) => tagNameById.get(id) ?? id).sort(),
        commit_refs: task.commit_refs ?? null,
      })),
    tags: [...exported.tags]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tag) => ({ name: tag.name, color: tag.color })),
    edges: [...exported.edges]
      .map((edge) => ({
        from_key: entityKey(
          edge.from_type,
          edge.from_id,
          taskLabelById,
          documentTitleById,
          artifactTitleById,
        ),
        to_key: entityKey(
          edge.to_type,
          edge.to_id,
          taskLabelById,
          documentTitleById,
          artifactTitleById,
        ),
        from_type: edge.from_type,
        to_type: edge.to_type,
        label: edge.label,
        arrow_direction: edge.arrow_direction,
        style: edge.style,
      }))
      .sort((a, b) => {
        const from = a.from_key.localeCompare(b.from_key);
        return from !== 0 ? from : a.to_key.localeCompare(b.to_key);
      }),
    folders: [...exported.folders]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => ({
        name: folder.name,
        parent_name:
          folder.parent_folder_id === null
            ? null
            : (folderNameById.get(folder.parent_folder_id) ?? folder.parent_folder_id),
      })),
    documents: [...exported.documents]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((document) => ({
        title: document.title,
        body: document.body,
        status_line: document.status_line,
        parent_title:
          document.parent_id === null
            ? null
            : (documentTitleById.get(document.parent_id) ?? document.parent_id),
        folder_name:
          document.folder_id === null || document.folder_id === undefined
            ? null
            : (folderNameById.get(document.folder_id) ?? document.folder_id),
      })),
    notes: [...exported.notes]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((note) => ({ title: note.title, body: note.body })),
    comments: [...exported.comments]
      .sort((a, b) => a.body.localeCompare(b.body))
      .map((comment) => ({
        target_type: comment.target_type,
        target_key: entityKey(
          comment.target_type,
          comment.target_id,
          taskLabelById,
          documentTitleById,
          artifactTitleById,
        ),
        passage: comment.passage,
        anchor: comment.anchor ?? null,
        body: comment.body,
        resolved: comment.resolved,
        created_at: comment.created_at,
      })),
    agent_runs: [...exported.agent_runs]
      .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''))
      .map((run) => ({
        status: run.status,
        label: run.label,
        started_at: run.started_at,
        completed_at: run.completed_at,
        events: [...run.events]
          .sort((a, b) => a.message.localeCompare(b.message))
          .map((event) => ({ message: event.message, created_at: event.created_at })),
      })),
    files: [...exported.files]
      .sort((a, b) => a.filename.localeCompare(b.filename))
      .map((file) => ({
        id: file.id,
        filename: file.filename,
        mime: file.mime,
        size: file.size,
        bytes_base64: file.bytes_base64,
        external_url: file.external_url,
        created_at: file.created_at,
      })),
    artifacts: [...exported.artifacts]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((artifact) => ({
        title: artifact.title,
        kind: artifact.kind,
        content: artifact.content,
      })),
  };
}

/**
 * Seed a project that populates every non-excluded portable column with a
 * distinguishable, non-default value so a dropped mapping cannot hide behind nulls.
 */
async function buildFullyPopulatedProject(db: Db): Promise<string> {
  const project = await createProject(db, {
    name: 'Coverage Round-Trip Project',
    description: 'DISTINCT-project-description',
    repoUrl: 'https://example.com/org/coverage-repo.git',
    folderPath: 'packages/coverage-fixture',
  });
  await updateProject(db, project.id, { canvasLayout: '{"zoom":2.5,"pan":[11,22]}' });

  const goal = await createGoal(db, {
    projectId: project.id,
    objective: 'DISTINCT-goal-objective',
    status: 'paused',
    verificationSurface: 'DISTINCT-verification-surface',
    constraints: 'DISTINCT-constraints',
    boundaries: 'DISTINCT-boundaries',
    iterationPolicy: 'DISTINCT-iteration-policy',
    stopCondition: 'DISTINCT-stop-condition',
    budget: 'DISTINCT-budget',
    lastVerification: 'DISTINCT-last-verification',
  });

  const task = await createTask(db, {
    projectId: project.id,
    goalId: goal.id,
    label: 'DISTINCT-task-label',
    status: 'in_progress',
    description: 'DISTINCT-task-description',
    x: 42.5,
    y: -17.25,
    assignee: 'DISTINCT-assignee',
    dueDate: new Date('2031-04-15T12:30:00.000Z'),
  });
  await updateTask(db, task.id, {
    commitRefs: JSON.stringify(['abcdef1', '1234567890abcdef1234567890abcdef12345678']),
  });

  const tag = await createTag(db, {
    projectId: project.id,
    name: 'DISTINCT-tag-name',
    color: '#c0ffee',
  });
  await setTaskTags(db, task.id, [tag.id]);

  const parentFolder = await createFolder(db, {
    projectId: project.id,
    name: 'DISTINCT-parent-folder',
  });
  const childFolder = await createFolder(db, {
    projectId: project.id,
    name: 'DISTINCT-child-folder',
    parentFolderId: parentFolder.id,
  });

  const parentDoc = await createDocument(db, {
    projectId: project.id,
    title: 'DISTINCT-parent-doc',
    body: 'DISTINCT-parent-body',
    statusLine: 'Status: DISTINCT-parent-status',
    folderId: parentFolder.id,
  });
  const childDoc = await createDocument(db, {
    projectId: project.id,
    title: 'DISTINCT-child-doc',
    body: 'DISTINCT-child-body',
    statusLine: 'Status: DISTINCT-child-status',
    parentId: parentDoc.id,
    folderId: childFolder.id,
  });

  await createEdge(db, {
    projectId: project.id,
    fromType: 'document',
    fromId: childDoc.id,
    toType: 'task',
    toId: task.id,
    label: 'DISTINCT-edge-label',
    arrowDirection: 'both',
    style: 'dashed',
  });

  await createNote(db, {
    projectId: project.id,
    title: 'DISTINCT-note-title',
    body: 'DISTINCT-note-body',
  });

  const artifact = await createArtifact(db, {
    projectId: project.id,
    title: 'DISTINCT-artifact-title',
    kind: 'html',
    content: '<p>DISTINCT-artifact-content</p>',
  });

  await createComment(db, {
    projectId: project.id,
    targetType: 'document',
    targetId: parentDoc.id,
    body: 'DISTINCT-comment-body',
    passage: 'DISTINCT-passage',
    resolved: true,
    createdAt: new Date('2030-01-02T03:04:05.000Z'),
  });
  const distinctAnchor = JSON.stringify({
    type: 'TextQuoteSelector',
    exact: 'DISTINCT-anchor-exact',
    prefix: 'DISTINCT-anchor-prefix ',
    suffix: ' DISTINCT-anchor-suffix',
    start: 42,
    end: 61,
  });
  await createComment(db, {
    projectId: project.id,
    targetType: 'artifact',
    targetId: artifact.id,
    body: 'DISTINCT-artifact-comment',
    passage: 'DISTINCT-artifact-passage',
    anchor: distinctAnchor,
    createdAt: new Date('2030-02-03T04:05:06.000Z'),
  });

  const runStarted = new Date('2029-06-01T08:00:00.000Z');
  const runCompleted = new Date('2029-06-01T09:30:00.000Z');
  const run = await createAgentRun(db, {
    projectId: project.id,
    label: 'DISTINCT-agent-run-label',
    status: 'running',
    startedAt: runStarted,
  });
  await createAgentRunEvent(db, {
    runId: run.id,
    message: 'DISTINCT-agent-event-message',
    createdAt: new Date('2029-06-01T08:15:00.000Z'),
  });
  await updateAgentRunStatus(db, run.id, {
    status: 'completed',
    completedAt: runCompleted,
  });

  const blobBytes = Buffer.from('DISTINCT-file-bytes-content', 'utf8');
  const blobId = createHash('sha256').update(blobBytes).digest('hex');
  await createFile(db, {
    id: blobId,
    projectId: project.id,
    filename: 'DISTINCT-blob-file.bin',
    mime: 'application/octet-stream',
    size: blobBytes.length,
    bytes: blobBytes,
    createdAt: '2028-11-11T11:11:11.000Z',
  });

  const externalId = createHash('sha256').update('DISTINCT-external-file-marker').digest('hex');
  await createFile(db, {
    id: externalId,
    projectId: project.id,
    filename: 'DISTINCT-external-file.pdf',
    mime: 'application/pdf',
    size: 4096,
    bytes: null,
    externalUrl: 'https://cdn.example.com/DISTINCT-external-file.pdf',
    createdAt: '2028-12-12T12:12:12.000Z',
  });

  return project.id;
}

function sqlColumnNames(table: (typeof EXPORT_GRAPH_TABLES)[ExportGraphTable]): string[] {
  const raw: unknown = getTableColumns(table);
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('expected drizzle column map');
  }
  const names: string[] = [];
  for (const value of Object.values(raw)) {
    if (typeof value !== 'object' || value === null || !('name' in value)) {
      throw new Error('expected drizzle column with name');
    }
    const name = (value as { name: unknown }).name;
    if (typeof name !== 'string') {
      throw new Error('expected drizzle column.name to be a string');
    }
    names.push(name);
  }
  return names;
}

describe('portability export behavioural coverage', () => {
  it('guard exercises exactly the production export-table manifest', () => {
    const production = [...PLANDESK_EXPORT_TABLES].sort();
    const exercised = Object.keys(EXPORT_GRAPH_TABLES).sort();
    expect(exercised).toEqual(production);
    expect(Object.keys(ROUND_TRIPPED_COLUMNS).sort()).toEqual(production);
    expect(Object.keys(EXPORT_COLUMN_EXCLUSIONS).sort()).toEqual(production);
  });

  it('every schema column on an export-graph table is round-tripped or explicitly excluded', () => {
    const gaps: string[] = [];

    for (const [tableName, table] of Object.entries(EXPORT_GRAPH_TABLES) as Array<
      [ExportGraphTable, (typeof EXPORT_GRAPH_TABLES)[ExportGraphTable]]
    >) {
      const exclusions = EXPORT_COLUMN_EXCLUSIONS[tableName];
      const roundTripped = new Set(ROUND_TRIPPED_COLUMNS[tableName]);
      const schemaColumns = sqlColumnNames(table);
      for (const sqlName of schemaColumns) {
        if (roundTripped.has(sqlName)) {
          continue;
        }
        if (sqlName in exclusions) {
          continue;
        }
        gaps.push(`${tableName}.${sqlName}`);
      }

      for (const sqlName of roundTripped) {
        if (!schemaColumns.includes(sqlName)) {
          gaps.push(`${tableName}.${sqlName} (listed as round-tripped but absent from schema)`);
        }
        if (sqlName in exclusions) {
          gaps.push(`${tableName}.${sqlName} (both round-tripped and excluded)`);
        }
      }

      for (const [sqlName, reason] of Object.entries(exclusions)) {
        expect(
          reason.trim().length,
          `${tableName}.${sqlName} exclusion needs a written reason`,
        ).toBeGreaterThan(0);
        if (!schemaColumns.includes(sqlName)) {
          gaps.push(`${tableName}.${sqlName} (listed in exclusions but absent from schema)`);
        }
      }
    }

    expect(
      gaps,
      `Portability coverage gaps (add a round-trip assertion or an exclusion with a reason): ${gaps.join(', ')}`,
    ).toEqual([]);
  });

  describe('export → import → re-export round-trip', () => {
    let sourceSnapshot: PortableSnapshot;
    let targetSnapshot: PortableSnapshot;
    let exported: PlandeskExport;

    beforeEach(async () => {
      const sourceDb = await createDb(':memory:');
      await migrate(sourceDb);
      const sourceProjectId = await buildFullyPopulatedProject(sourceDb);
      const maybeExported = await exportProject(sourceDb, sourceProjectId);
      expect(maybeExported).toBeDefined();
      if (!maybeExported) {
        throw new Error('exportProject returned undefined');
      }
      exported = maybeExported;

      const targetDb = await createDb(':memory:');
      await migrate(targetDb);
      const { projectId: importedProjectId } = await importProject(targetDb, exported);
      const reExported = await exportProject(targetDb, importedProjectId);
      expect(reExported).toBeDefined();
      if (!reExported) {
        throw new Error('re-export returned undefined');
      }

      sourceSnapshot = toPortableSnapshot(exported);
      targetSnapshot = toPortableSnapshot(reExported);
    });

    it('projects columns round-trip', () => {
      expect(exported.project.description).toBe('DISTINCT-project-description');
      expect(exported.project.repo_url).toBe('https://example.com/org/coverage-repo.git');
      expect(exported.project.folder_path).toBe('packages/coverage-fixture');
      expect(exported.project.canvas_layout).toBe('{"zoom":2.5,"pan":[11,22]}');
      expect(targetSnapshot.project).toEqual(sourceSnapshot.project);
    });

    it('goals columns round-trip', () => {
      expect(exported.goals[0]).toMatchObject({
        objective: 'DISTINCT-goal-objective',
        status: 'paused',
        verification_surface: 'DISTINCT-verification-surface',
        constraints: 'DISTINCT-constraints',
        boundaries: 'DISTINCT-boundaries',
        iteration_policy: 'DISTINCT-iteration-policy',
        stop_condition: 'DISTINCT-stop-condition',
        budget: 'DISTINCT-budget',
        last_verification: 'DISTINCT-last-verification',
      });
      expect(targetSnapshot.goals).toEqual(sourceSnapshot.goals);
    });

    it('tasks columns round-trip', () => {
      expect(exported.tasks[0]).toMatchObject({
        label: 'DISTINCT-task-label',
        status: 'in_progress',
        description: 'DISTINCT-task-description',
        x: 42.5,
        y: -17.25,
        assignee: 'DISTINCT-assignee',
        due_date: '2031-04-15T12:30:00.000Z',
        commit_refs: ['abcdef1', '1234567890abcdef1234567890abcdef12345678'],
      });
      expect(targetSnapshot.tasks).toEqual(sourceSnapshot.tasks);
      expect(targetSnapshot.tasks[0]?.goal_objective).toBe('DISTINCT-goal-objective');
    });

    it('tags columns round-trip', () => {
      expect(exported.tags).toHaveLength(1);
      expect(exported.tags[0]?.name).toBe('DISTINCT-tag-name');
      expect(exported.tags[0]?.color).toBe('#c0ffee');
      expect(typeof exported.tags[0]?.id).toBe('string');
      expect(targetSnapshot.tags).toEqual(sourceSnapshot.tags);
    });

    it('task_tags membership round-trips via task.tag_ids', () => {
      expect(exported.tasks[0]?.tag_ids).toHaveLength(1);
      expect(targetSnapshot.tasks[0]?.tag_names).toEqual(['DISTINCT-tag-name']);
    });

    it('edges columns round-trip', () => {
      expect(exported.edges[0]).toMatchObject({
        from_type: 'document',
        to_type: 'task',
        label: 'DISTINCT-edge-label',
        arrow_direction: 'both',
        style: 'dashed',
      });
      expect(targetSnapshot.edges).toEqual(sourceSnapshot.edges);
    });

    it('folders columns round-trip', () => {
      expect(exported.folders).toHaveLength(2);
      expect(targetSnapshot.folders).toEqual(sourceSnapshot.folders);
      expect(targetSnapshot.folders.find((f) => f.name === 'DISTINCT-child-folder')?.parent_name).toBe(
        'DISTINCT-parent-folder',
      );
    });

    it('documents columns round-trip', () => {
      expect(exported.documents).toHaveLength(2);
      expect(targetSnapshot.documents).toEqual(sourceSnapshot.documents);
      expect(targetSnapshot.documents.find((d) => d.title === 'DISTINCT-child-doc')).toMatchObject({
        parent_title: 'DISTINCT-parent-doc',
        folder_name: 'DISTINCT-child-folder',
        body: 'DISTINCT-child-body',
        status_line: 'Status: DISTINCT-child-status',
      });
    });

    it('notes columns round-trip', () => {
      expect(exported.notes).toHaveLength(1);
      expect(exported.notes[0]?.title).toBe('DISTINCT-note-title');
      expect(exported.notes[0]?.body).toBe('DISTINCT-note-body');
      expect(typeof exported.notes[0]?.id).toBe('string');
      expect(targetSnapshot.notes).toEqual(sourceSnapshot.notes);
    });

    it('comments columns round-trip', () => {
      expect(exported.comments).toHaveLength(2);
      const annotated = exported.comments.find((c) => c.body === 'DISTINCT-artifact-comment');
      expect(annotated?.anchor).toBe(
        JSON.stringify({
          type: 'TextQuoteSelector',
          exact: 'DISTINCT-anchor-exact',
          prefix: 'DISTINCT-anchor-prefix ',
          suffix: ' DISTINCT-anchor-suffix',
          start: 42,
          end: 61,
        }),
      );
      expect(targetSnapshot.comments).toEqual(sourceSnapshot.comments);
      expect(targetSnapshot.comments.map((c) => c.created_at).sort()).toEqual([
        '2030-01-02T03:04:05.000Z',
        '2030-02-03T04:05:06.000Z',
      ]);
    });

    it('agent_runs columns round-trip', () => {
      expect(exported.agent_runs[0]).toMatchObject({
        label: 'DISTINCT-agent-run-label',
        status: 'completed',
        started_at: '2029-06-01T08:00:00.000Z',
        completed_at: '2029-06-01T09:30:00.000Z',
      });
      const withoutEvents = (runs: PortableSnapshot['agent_runs']) =>
        runs.map((run) => ({
          status: run.status,
          label: run.label,
          started_at: run.started_at,
          completed_at: run.completed_at,
        }));
      expect(withoutEvents(targetSnapshot.agent_runs)).toEqual(withoutEvents(sourceSnapshot.agent_runs));
    });

    it('agent_run_events columns round-trip', () => {
      expect(exported.agent_runs[0]?.events).toEqual([
        {
          message: 'DISTINCT-agent-event-message',
          created_at: '2029-06-01T08:15:00.000Z',
        },
      ]);
      expect(targetSnapshot.agent_runs[0]?.events).toEqual(sourceSnapshot.agent_runs[0]?.events);
    });

    it('files columns round-trip', () => {
      expect(exported.files).toHaveLength(2);
      expect(targetSnapshot.files).toEqual(sourceSnapshot.files);
      expect(targetSnapshot.files.find((f) => f.filename === 'DISTINCT-blob-file.bin')?.bytes_base64).toBe(
        Buffer.from('DISTINCT-file-bytes-content', 'utf8').toString('base64'),
      );
      expect(
        targetSnapshot.files.find((f) => f.filename === 'DISTINCT-external-file.pdf')?.external_url,
      ).toBe('https://cdn.example.com/DISTINCT-external-file.pdf');
    });

    it('artifacts columns round-trip', () => {
      expect(exported.artifacts[0]).toMatchObject({
        title: 'DISTINCT-artifact-title',
        kind: 'html',
        content: '<p>DISTINCT-artifact-content</p>',
      });
      expect(targetSnapshot.artifacts).toEqual(sourceSnapshot.artifacts);
    });
  });
});

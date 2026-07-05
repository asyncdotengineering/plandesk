import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrate } from './migrate.js';
import {
  exportProject,
  importProject,
  InvalidExportVersionError,
  PLANDESK_EXPORT_VERSION,
  type PlandeskExportV1,
} from './portability.js';
import { createAgentRunEvent } from './repositories/agent-run-events.js';
import { createAgentRun, updateAgentRunStatus } from './repositories/agent-runs.js';
import { createDocument } from './repositories/documents.js';
import { createEdge } from './repositories/edges.js';
import { createFolder } from './repositories/folders.js';
import { createNote } from './repositories/notes.js';
import { createProject, updateProject } from './repositories/projects.js';
import { createTag, setTaskTags } from './repositories/tags.js';
import { createTaskWithDefaultGoal as createTask } from './testing.js';

type ComparableExport = {
  project: PlandeskExportV1['project'];
  goals: Array<{
    objective: string;
    status: string;
    task_labels: string[];
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
  }>;
  tags: Array<{
    name: string;
    color: string | null;
  }>;
  edges: Array<{
    from_label: string;
    to_label: string;
    label: string | null;
    arrow_direction: string | null;
    style: string | null;
  }>;
  folders: Array<{
    name: string;
    parent_name: string | null;
  }>;
  documents: Array<{
    title: string;
    body: string | null;
    status_line: string | null;
    parent_title: string | null;
    folder_name: string | null;
    linked_task_label: string | null;
  }>;
  notes: Array<{
    title: string;
    body: string | null;
  }>;
  agent_runs: Array<{
    status: string;
    label: string | null;
    events: string[];
  }>;
};

function toComparable(exported: PlandeskExportV1): ComparableExport {
  const taskLabelById = new Map(exported.tasks.map((task) => [task.id, task.label]));
  const goalObjectiveById = new Map(exported.goals.map((goal) => [goal.id, goal.objective]));
  const documentTitleById = new Map(exported.documents.map((doc) => [doc.id, doc.title]));
  const folderNameById = new Map(exported.folders.map((folder) => [folder.id, folder.name]));
  const tagNameById = new Map(exported.tags.map((tag) => [tag.id, tag.name]));

  return {
    project: exported.project,
    goals: [...exported.goals]
      .sort((a, b) => a.objective.localeCompare(b.objective))
      .map((goal) => ({
        objective: goal.objective,
        status: goal.status,
        task_labels: exported.tasks
          .filter((task) => task.goal_id === goal.id)
          .map((task) => task.label)
          .sort(),
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
        // exportProject always writes goal_id; coerce for the optional import type.
        goal_objective:
          task.goal_id === undefined ? '' : (goalObjectiveById.get(task.goal_id) ?? task.goal_id),
        tag_names: (task.tag_ids ?? []).map((id) => tagNameById.get(id) ?? id).sort(),
      })),
    tags: [...exported.tags]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tag) => ({ name: tag.name, color: tag.color })),
    edges: [...exported.edges]
      .sort((a, b) => {
        const fromA = taskLabelById.get(a.from_task_id) ?? '';
        const fromB = taskLabelById.get(b.from_task_id) ?? '';
        if (fromA !== fromB) {
          return fromA.localeCompare(fromB);
        }
        const toA = taskLabelById.get(a.to_task_id) ?? '';
        const toB = taskLabelById.get(b.to_task_id) ?? '';
        return toA.localeCompare(toB);
      })
      .map((edge) => ({
        from_label: taskLabelById.get(edge.from_task_id) ?? edge.from_task_id,
        to_label: taskLabelById.get(edge.to_task_id) ?? edge.to_task_id,
        label: edge.label,
        arrow_direction: edge.arrow_direction,
        style: edge.style,
      })),
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
        linked_task_label:
          document.linked_task_id === null
            ? null
            : (taskLabelById.get(document.linked_task_id) ?? document.linked_task_id),
      })),
    notes: [...exported.notes]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((note) => ({
        title: note.title,
        body: note.body,
      })),
    agent_runs: [...exported.agent_runs].map((run) => ({
      status: run.status,
      label: run.label,
      events: run.events.map((event) => event.message),
    })),
  };
}

function buildFixtureProject(db: ReturnType<typeof createDb>): string {
  const project = createProject(db, {
    name: 'Export Fixture',
    description: 'Round-trip test project',
  });
  updateProject(db, project.id, { canvasLayout: '{"zoom":1.25}' });

  const design = createTask(db, {
    projectId: project.id,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    label: 'Design',
    status: 'in_progress',
    description: 'Design phase',
    x: 10,
    y: 20,
    assignee: 'alex',
    dueDate: new Date('2026-07-01T00:00:00.000Z'),
  });
  const build = createTask(db, {
    projectId: project.id,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    label: 'Build',
    status: 'todo',
    x: 100,
    y: 200,
  });

  const backend = createTag(db, { projectId: project.id, name: 'backend', color: '#2563eb' });
  const urgent = createTag(db, { projectId: project.id, name: 'urgent', color: null });
  setTaskTags(db, design.id, [backend.id, urgent.id]);
  setTaskTags(db, build.id, [backend.id]);

  createEdge(db, {
    projectId: project.id,
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    fromTaskId: design.id,
    toTaskId: build.id,
    label: 'blocks',
    arrowDirection: 'forward',
    style: 'solid',
  });
  createEdge(db, {
    projectId: project.id,
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    fromTaskId: build.id,
    toTaskId: design.id,
    label: 'feedback',
    arrowDirection: 'both',
    style: 'dashed',
  });

  const specsFolder = createFolder(db, {
    projectId: project.id,
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Specs',
  });
  const archiveFolder = createFolder(db, {
    projectId: project.id,
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Archive',
    parentFolderId: specsFolder.id,
  });

  const parentDoc = createDocument(db, {
    projectId: project.id,
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    title: 'Parent Spec',
    body: '# Parent',
    statusLine: 'Status: approved',
    folderId: specsFolder.id,
  });
  createDocument(db, {
    projectId: project.id,
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    title: 'Child Spec',
    body: '## Child section',
    statusLine: 'Status: draft',
    parentId: parentDoc.id,
    folderId: archiveFolder.id,
    linkedTaskId: design.id,
  });

  createNote(db, {
    projectId: project.id,
    title: 'Working notes',
    body: '<p>Remember to check the rate limits</p>',
  });
  createNote(db, {
    projectId: project.id,
    title: 'Open questions',
    body: null,
  });

  const run = createAgentRun(db, {
    projectId: project.id,
    id: '11111111-1111-4111-8111-111111111111',
    label: 'Sprint agent',
  });
  createAgentRunEvent(db, { runId: run.id, message: 'Starting analysis' });
  createAgentRunEvent(db, { runId: run.id, message: 'Applied task updates' });
  updateAgentRunStatus(db, run.id, {
    status: 'completed',
    completedAt: new Date('2026-06-07T12:00:00.000Z'),
  });

  return project.id;
}

describe('export/import portability', () => {
  const db = createDb(':memory:');

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM agent_run_events');
    db.$client.exec('DELETE FROM agent_runs');
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('UPDATE folders SET parent_folder_id = NULL');
    db.$client.exec('DELETE FROM folders');
    db.$client.exec('DELETE FROM notes');
    db.$client.exec('DELETE FROM task_tags');
    db.$client.exec('DELETE FROM tags');
    db.$client.exec('DELETE FROM edges');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM goals');
    db.$client.exec('DELETE FROM projects');
  });

  it('test:export_import round-trips project graph with remapped ids', () => {
    const sourceProjectId = buildFixtureProject(db);
    const exported = exportProject(db, sourceProjectId);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }
    expect(exported.version).toBe(PLANDESK_EXPORT_VERSION);

    const { projectId: importedProjectId } = importProject(db, exported);
    expect(importedProjectId).not.toBe(sourceProjectId);

    const reExported = exportProject(db, importedProjectId);
    expect(reExported).toBeDefined();
    if (!reExported) {
      return;
    }

    const sourceComparable = toComparable(exported);
    const importedComparable = toComparable(reExported);

    expect(importedComparable).toEqual(sourceComparable);
    expect(reExported.tasks).toHaveLength(exported.tasks.length);
    expect(reExported.goals).toHaveLength(exported.goals.length);
    expect(reExported.goals.length).toBeGreaterThan(0);
    expect(reExported.tags).toHaveLength(exported.tags.length);
    expect(reExported.tags).toHaveLength(2);
    expect(reExported.edges).toHaveLength(exported.edges.length);
    expect(reExported.folders).toHaveLength(exported.folders.length);
    expect(reExported.folders).toHaveLength(2);
    expect(reExported.documents).toHaveLength(exported.documents.length);
    expect(reExported.notes).toHaveLength(exported.notes.length);
    expect(reExported.notes).toHaveLength(2);
    expect(reExported.agent_runs).toHaveLength(exported.agent_runs.length);
    expect(reExported.agent_runs[0]?.events).toHaveLength(
      exported.agent_runs[0]?.events.length ?? 0,
    );

    const importedTaskIds = new Set(reExported.tasks.map((task) => task.id));
    const sourceTaskIds = new Set(exported.tasks.map((task) => task.id));
    for (const id of sourceTaskIds) {
      expect(importedTaskIds.has(id)).toBe(false);
    }
  });

  it('returns undefined when exporting an unknown project', () => {
    expect(exportProject(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('throws on unsupported export version', () => {
    const sourceProjectId = buildFixtureProject(db);
    const exported = exportProject(db, sourceProjectId);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }
    const badVersion = { ...exported, version: 'plandesk-export-v0' };

    expect(() => importProject(db, badVersion)).toThrow(InvalidExportVersionError);
    expect(() => importProject(db, badVersion)).toThrow(/Unsupported export version/);
  });
});

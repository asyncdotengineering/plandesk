import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
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
import { artifacts, goals, tasks } from './schema.js';
import { createProjectInDefaultOrg as createProject } from './testing.js';

/** Fixed timestamps so golden export JSON is byte-stable across runs. */
const FIXTURE_ROW_STAMPS = {
  goals: new Date('2028-01-01T00:00:00.000Z'),
  tasks: new Date('2028-01-02T00:00:00.000Z'),
  artifacts: new Date('2028-01-03T00:00:00.000Z'),
} as const;

/** Stable ids so export fixtures are byte-reproducible across runs. */
export const FIXTURE_EXPORT_IDS = {
  project: '00000000-0000-4000-8000-00000000f001',
  goal: '00000000-0000-4000-8000-00000000f002',
  task: '00000000-0000-4000-8000-00000000f003',
  tag: '00000000-0000-4000-8000-00000000f004',
  parentFolder: '00000000-0000-4000-8000-00000000f005',
  childFolder: '00000000-0000-4000-8000-00000000f006',
  parentDoc: '00000000-0000-4000-8000-00000000f007',
  childDoc: '00000000-0000-4000-8000-00000000f008',
  edge: '00000000-0000-4000-8000-00000000f009',
  note: '00000000-0000-4000-8000-00000000f00a',
  artifact: '00000000-0000-4000-8000-00000000f00b',
  docComment: '00000000-0000-4000-8000-00000000f00c',
  artifactComment: '00000000-0000-4000-8000-00000000f00d',
  agentRun: '00000000-0000-4000-8000-00000000f00e',
  agentRunEvent: '00000000-0000-4000-8000-00000000f00f',
} as const;

const BLOB_BYTES = Buffer.from('DISTINCT-file-bytes-content', 'utf8');
export const FIXTURE_BLOB_FILE_ID = createHash('sha256').update(BLOB_BYTES).digest('hex');
export const FIXTURE_EXTERNAL_FILE_ID = createHash('sha256')
  .update('DISTINCT-external-file-marker')
  .digest('hex');

/**
 * Seed a project that populates every non-excluded portable column with a
 * distinguishable, non-default value. Uses fixed ids for golden export fixtures.
 */
export async function seedDeterministicFullyPopulatedProject(db: Db): Promise<string> {
  const ids = FIXTURE_EXPORT_IDS;
  const project = await createProject(db, {
    id: ids.project,
    name: 'Coverage Round-Trip Project',
    description: 'DISTINCT-project-description',
    repoUrl: 'https://example.com/org/coverage-repo.git',
    folderPath: 'packages/coverage-fixture',
  });
  await updateProject(db, project.id, { canvasLayout: '{"zoom":2.5,"pan":[11,22]}' });

  const goal = await createGoal(db, {
    id: ids.goal,
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
  await db
    .update(goals)
    .set({
      createdAt: FIXTURE_ROW_STAMPS.goals,
      updatedAt: FIXTURE_ROW_STAMPS.goals,
    })
    .where(eq(goals.id, goal.id))
    .run();

  const task = await createTask(db, {
    id: ids.task,
    projectId: project.id,
    goalId: goal.id,
    label: 'DISTINCT-task-label',
    status: 'in_progress',
    kind: 'decision',
    priority: 'urgent',
    description: 'DISTINCT-task-description',
    x: 42.5,
    y: -17.25,
    assignee: 'DISTINCT-assignee',
    dueDate: new Date('2031-04-15T12:30:00.000Z'),
  });
  await updateTask(db, task.id, {
    commitRefs: JSON.stringify(['abcdef1', '1234567890abcdef1234567890abcdef12345678']),
  });
  await db
    .update(tasks)
    .set({
      createdAt: FIXTURE_ROW_STAMPS.tasks,
      updatedAt: FIXTURE_ROW_STAMPS.tasks,
    })
    .where(eq(tasks.id, task.id))
    .run();

  const tag = await createTag(db, {
    id: ids.tag,
    projectId: project.id,
    name: 'DISTINCT-tag-name',
    color: '#c0ffee',
  });
  await setTaskTags(db, task.id, [tag.id]);

  const parentFolder = await createFolder(db, {
    id: ids.parentFolder,
    projectId: project.id,
    name: 'DISTINCT-parent-folder',
  });
  const childFolder = await createFolder(db, {
    id: ids.childFolder,
    projectId: project.id,
    name: 'DISTINCT-child-folder',
    parentFolderId: parentFolder.id,
  });

  const parentDoc = await createDocument(db, {
    id: ids.parentDoc,
    projectId: project.id,
    title: 'DISTINCT-parent-doc',
    body: 'DISTINCT-parent-body',
    statusLine: 'Status: DISTINCT-parent-status',
    folderId: parentFolder.id,
  });
  const childDoc = await createDocument(db, {
    id: ids.childDoc,
    projectId: project.id,
    title: 'DISTINCT-child-doc',
    body: 'DISTINCT-child-body',
    statusLine: 'Status: DISTINCT-child-status',
    parentId: parentDoc.id,
    folderId: childFolder.id,
  });

  await createEdge(db, {
    id: ids.edge,
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
    id: ids.note,
    projectId: project.id,
    title: 'DISTINCT-note-title',
    body: 'DISTINCT-note-body',
  });

  const artifact = await createArtifact(db, {
    id: ids.artifact,
    projectId: project.id,
    title: 'DISTINCT-artifact-title',
    kind: 'html',
    content: '<p>DISTINCT-artifact-content</p>',
  });
  await db
    .update(artifacts)
    .set({
      createdAt: FIXTURE_ROW_STAMPS.artifacts,
      updatedAt: FIXTURE_ROW_STAMPS.artifacts,
    })
    .where(eq(artifacts.id, artifact.id))
    .run();

  await createComment(db, {
    id: ids.docComment,
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
    id: ids.artifactComment,
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
    id: ids.agentRun,
    projectId: project.id,
    label: 'DISTINCT-agent-run-label',
    status: 'running',
    startedAt: runStarted,
  });
  await createAgentRunEvent(db, {
    id: ids.agentRunEvent,
    runId: run.id,
    message: 'DISTINCT-agent-event-message',
    createdAt: new Date('2029-06-01T08:15:00.000Z'),
  });
  await updateAgentRunStatus(db, run.id, {
    status: 'completed',
    completedAt: runCompleted,
  });

  await createFile(db, {
    id: FIXTURE_BLOB_FILE_ID,
    projectId: project.id,
    filename: 'DISTINCT-blob-file.bin',
    mime: 'application/octet-stream',
    size: BLOB_BYTES.length,
    bytes: BLOB_BYTES,
    createdAt: '2028-11-11T11:11:11.000Z',
  });

  await createFile(db, {
    id: FIXTURE_EXTERNAL_FILE_ID,
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

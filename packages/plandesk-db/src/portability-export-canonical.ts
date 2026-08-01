import type { PlandeskExport } from './portability.js';

/**
 * Canonical export snapshot for golden-fixture and regression comparisons.
 * Sorts collections whose SQL read order is undefined; compares by value, not
 * JSON.stringify key order.
 */
export type CanonicalExportSnapshot = {
  project: PlandeskExport['project'];
  goals: Array<Omit<PlandeskExport['goals'][number], 'id' | 'created_at' | 'updated_at'> & {
    id: string;
    created_at?: string;
    updated_at?: string;
  }>;
  tasks: PlandeskExport['tasks'];
  tags: PlandeskExport['tags'];
  edges: PlandeskExport['edges'];
  folders: PlandeskExport['folders'];
  documents: PlandeskExport['documents'];
  notes: PlandeskExport['notes'];
  views: PlandeskExport['views'];
  comments: PlandeskExport['comments'];
  agent_runs: PlandeskExport['agent_runs'];
  files: PlandeskExport['files'];
  artifacts: PlandeskExport['artifacts'];
};

function reorderProjectFields(project: PlandeskExport['project']): PlandeskExport['project'] {
  return {
    name: project.name,
    description: project.description,
    repo_url: project.repo_url,
    folder_path: project.folder_path,
    canvas_layout: project.canvas_layout,
  };
}

function compareBy<T>(a: T, b: T, ...getters: Array<(row: T) => string>): number {
  for (const get of getters) {
    const cmp = get(a).localeCompare(get(b));
    if (cmp !== 0) {
      return cmp;
    }
  }
  return 0;
}

export function canonicalizeExportForComparison(exported: PlandeskExport): CanonicalExportSnapshot {
  return {
    project: reorderProjectFields(exported.project),
    goals: [...exported.goals].sort((a, b) => compareBy(a, b, (g) => g.objective, (g) => g.id)),
    tasks: [...exported.tasks].sort((a, b) => compareBy(a, b, (t) => t.label, (t) => t.id)),
    tags: [...exported.tags].sort((a, b) => compareBy(a, b, (t) => t.name, (t) => t.id)),
    edges: [...exported.edges].sort((a, b) =>
      compareBy(
        a,
        b,
        (e) => `${e.from_type ?? ''}:${e.from_id ?? ''}`,
        (e) => `${e.to_type ?? ''}:${e.to_id ?? ''}`,
        (e) => e.label ?? '',
        (e) => e.id,
      ),
    ),
    folders: [...exported.folders].sort((a, b) => compareBy(a, b, (f) => f.name, (f) => f.id)),
    documents: [...exported.documents].sort((a, b) => compareBy(a, b, (d) => d.title, (d) => d.id)),
    notes: [...exported.notes].sort((a, b) => compareBy(a, b, (n) => n.title, (n) => n.id)),
    views: [...exported.views].sort((a, b) => compareBy(a, b, (v) => v.name, (v) => v.id)),
    comments: [...exported.comments].sort((a, b) => compareBy(a, b, (c) => c.body, (c) => c.id)),
    agent_runs: [...exported.agent_runs].sort((a, b) =>
      compareBy(a, b, (r) => r.label ?? '', (r) => r.id),
    ),
    files: [...exported.files].sort((a, b) => compareBy(a, b, (f) => f.filename, (f) => f.id)),
    artifacts: [...exported.artifacts].sort((a, b) => compareBy(a, b, (a) => a.title, (a) => a.id)),
  };
}

/** Portable values only — remapped ids and server timestamps resolved to natural keys. */
export type PortableExportSnapshot = {
  project: PlandeskExport['project'];
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
    kind: string | undefined;
    priority: string | null | undefined;
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
  views: Array<{ name: string; config: PlandeskExport['views'][number]['config']; position: number }>;
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

export function toPortableExportSnapshot(exported: PlandeskExport): PortableExportSnapshot {
  const taskLabelById = new Map(exported.tasks.map((task) => [task.id, task.label]));
  const goalObjectiveById = new Map(exported.goals.map((goal) => [goal.id, goal.objective]));
  const documentTitleById = new Map(exported.documents.map((doc) => [doc.id, doc.title]));
  const folderNameById = new Map(exported.folders.map((folder) => [folder.id, folder.name]));
  const tagNameById = new Map(exported.tags.map((tag) => [tag.id, tag.name]));
  const artifactTitleById = new Map(
    exported.artifacts.map((artifact) => [artifact.id, artifact.title]),
  );

  return {
    project: reorderProjectFields(exported.project),
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
        kind: task.kind,
        priority: task.priority,
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
    views: [...exported.views]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((view) => ({ name: view.name, config: view.config, position: view.position })),
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

/** Field-level assertions that must hold for the fully-populated golden fixture. */
export function assertGoldenExportFieldCoverage(exported: PlandeskExport): void {
  if (exported.project.repo_url !== 'https://example.com/org/coverage-repo.git') {
    throw new Error(`golden project.repo_url mismatch: ${String(exported.project.repo_url)}`);
  }
  if (exported.project.folder_path !== 'packages/coverage-fixture') {
    throw new Error(`golden project.folder_path mismatch: ${String(exported.project.folder_path)}`);
  }
  if (exported.project.description !== 'DISTINCT-project-description') {
    throw new Error('golden project.description mismatch');
  }
  if (exported.goals.length !== 1 || exported.goals[0]?.objective !== 'DISTINCT-goal-objective') {
    throw new Error('golden goals mismatch');
  }
  const task = exported.tasks.find((row) => row.label === 'DISTINCT-task-label');
  if (!task || task.kind !== 'decision' || task.status !== 'in_progress' || task.priority !== 'urgent') {
    throw new Error('golden task mismatch');
  }
  if (exported.tags.length !== 1 || exported.tags[0]?.name !== 'DISTINCT-tag-name') {
    throw new Error('golden tags mismatch');
  }
  const view = exported.views[0];
  if (
    exported.views.length !== 1 ||
    view === undefined ||
    view.name !== 'DISTINCT-view-name' ||
    view.config.filter === null ||
    view.config.sort.length !== 2 ||
    view.config.group === null ||
    view.config.group.length !== 2
  ) {
    throw new Error('golden views mismatch');
  }
}

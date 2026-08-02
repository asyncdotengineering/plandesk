import type {
  AgentRun,
  AgentRunEvent,
  Artifact,
  Document,
  Comment,
  Edge,
  Folder,
  Goal,
  LinkEntityType,
  Note,
  Project,
  Prototype,
  Revision,
  SavedViewConfig,
  Tag,
  Task,
  TaskStatus,
  View,
} from '@plandesk/db';
import { parseCommitRefs, parseSavedViewConfig, taskStatuses } from '@plandesk/db';

export { parseCommitRefs } from '@plandesk/db';

export type PaginationParams = {
  limit?: number;
  offset?: number;
};

export function parsePaginationParams(
  limitRaw: string | undefined,
  offsetRaw: string | undefined,
): PaginationParams | 'invalid' {
  let limit: number | undefined;
  let offset = 0;

  if (offsetRaw !== undefined) {
    const parsed = Number(offsetRaw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return 'invalid';
    }
    offset = parsed;
  }

  if (limitRaw !== undefined) {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return 'invalid';
    }
    limit = parsed;
  }

  return { limit, offset };
}

export type TaskStatusSummary = Record<TaskStatus, number>;

export function emptyTaskStatusSummary(): TaskStatusSummary {
  return Object.fromEntries(taskStatuses.map((status) => [status, 0])) as TaskStatusSummary;
}

export function serializeProject(project: Project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    owner_id: project.ownerId,
    overview_document_id: project.overviewDocumentId,
    repo_url: project.repoUrl,
    folder_path: project.folderPath,
    workspace_id: project.workspaceId,
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString(),
  };
}

export function serializeProjectDetail(project: Project, summary: TaskStatusSummary) {
  return {
    ...serializeProject(project),
    summary,
  };
}

export type SerializedTag = {
  id: string;
  project_id: string;
  name: string;
  color: string | null;
  created_at: string;
};

export function serializeTag(tag: Tag): SerializedTag {
  return {
    id: tag.id,
    project_id: tag.projectId,
    name: tag.name,
    color: tag.color,
    created_at: tag.createdAt.toISOString(),
  };
}

export type SerializedView = {
  id: string;
  project_id: string;
  name: string;
  config: SavedViewConfig;
  position: number;
  created_at: string;
  updated_at: string;
};

export function serializeView(view: View): SerializedView {
  return {
    id: view.id,
    project_id: view.projectId,
    name: view.name,
    config: parseSavedViewConfig(view.config),
    position: view.position,
    created_at: view.createdAt.toISOString(),
    updated_at: view.updatedAt.toISOString(),
  };
}

function parseLastVerification(raw: string | null) {
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      at: string;
      green: boolean;
      kind: string | null;
      detail?: string;
    };
    if (
      typeof parsed.at === 'string' &&
      typeof parsed.green === 'boolean' &&
      (parsed.kind === null || typeof parsed.kind === 'string')
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeGoal(goal: Goal) {
  return {
    id: goal.id,
    project_id: goal.projectId,
    objective: goal.objective,
    status: goal.status,
    verification_surface: goal.verificationSurface,
    constraints: goal.constraints,
    boundaries: goal.boundaries,
    iteration_policy: goal.iterationPolicy,
    stop_condition: goal.stopCondition,
    budget: goal.budget,
    last_verification: parseLastVerification(goal.lastVerification),
    created_at: goal.createdAt.toISOString(),
    updated_at: goal.updatedAt.toISOString(),
  };
}

export function serializeTask(task: Task, tags?: Tag[], waitingOn?: string[]) {
  return {
    id: task.id,
    project_id: task.projectId,
    goal_id: task.goalId,
    label: task.label,
    status: task.status,
    kind: task.kind,
    priority: task.priority,
    description: task.description,
    x: task.x,
    y: task.y,
    assignee: task.assignee,
    due_date: task.dueDate?.toISOString() ?? null,
    commit_refs: parseCommitRefs(task.commitRefs),
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
    ...(tags !== undefined ? { tags: tags.map(serializeTag) } : {}),
    ...(waitingOn !== undefined ? { blocked: waitingOn.length > 0, waiting_on: waitingOn } : {}),
  };
}

/** One graph neighbour of a document (or a task, via the backlinks read path). */
export type SerializedEntityLink = {
  type: LinkEntityType;
  id: string;
  /** Task label or document title of the other endpoint. */
  title: string;
  /** Edge label (`documents`, `references`, `blocks`, …). */
  label: string | null;
  /** Owning edge id — use with DELETE /projects/:id/edges/:edgeId. */
  edge_id: string;
};

export type SerializedDocument = {
  id: string;
  project_id: string;
  title: string;
  body: string | null;
  status_line: string | null;
  parent_id: string | null;
  folder_id: string | null;
  /** Outgoing edges from this document (what it points at). */
  links: SerializedEntityLink[];
  /** Incoming edges to this document (what points at it). */
  backlinks: SerializedEntityLink[];
  created_at: string;
  updated_at: string;
};

export type SerializedDocumentTree = SerializedDocument & {
  children: SerializedDocumentTree[];
};

export function serializeDocument(
  document: Document,
  options?: {
    links?: SerializedEntityLink[];
    backlinks?: SerializedEntityLink[];
  },
): SerializedDocument {
  return {
    id: document.id,
    project_id: document.projectId,
    title: document.title,
    body: document.body,
    status_line: document.statusLine,
    parent_id: document.parentId,
    folder_id: document.folderId,
    links: options?.links ?? [],
    backlinks: options?.backlinks ?? [],
    created_at: document.createdAt.toISOString(),
    updated_at: document.updatedAt.toISOString(),
  };
}

export type SerializedNote = {
  id: string;
  project_id: string;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
};

export function serializeNote(note: Note): SerializedNote {
  return {
    id: note.id,
    project_id: note.projectId,
    title: note.title,
    body: note.body,
    created_at: note.createdAt.toISOString(),
    updated_at: note.updatedAt.toISOString(),
  };
}

export type SerializedArtifact = {
  id: string;
  project_id: string;
  title: string;
  kind: Artifact['kind'];
  content: string;
  prototype_id: string | null;
  x: number | null;
  y: number | null;
  /** Newest revision id when history exists; otherwise updated_at ISO (cache-bust / anchor key). */
  revision_id: string;
  created_at: string;
  updated_at: string;
};

export type SerializedArtifactSummary = {
  id: string;
  title: string;
  kind: Artifact['kind'];
  updated_at: string;
};

export function serializeArtifact(
  artifact: Artifact,
  revisionId: string,
): SerializedArtifact {
  return {
    id: artifact.id,
    project_id: artifact.projectId,
    title: artifact.title,
    kind: artifact.kind,
    content: artifact.content,
    prototype_id: artifact.prototypeId,
    x: artifact.x,
    y: artifact.y,
    revision_id: revisionId,
    created_at: artifact.createdAt.toISOString(),
    updated_at: artifact.updatedAt.toISOString(),
  };
}

export function serializeArtifactSummary(artifact: Artifact): SerializedArtifactSummary {
  return {
    id: artifact.id,
    title: artifact.title,
    kind: artifact.kind,
    updated_at: artifact.updatedAt.toISOString(),
  };
}

export type SerializedPrototype = {
  id: string;
  project_id: string;
  name: string;
  viewport_width: number;
  viewport_height: number;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
};

export function serializePrototype(prototype: Prototype): SerializedPrototype {
  return {
    id: prototype.id,
    project_id: prototype.projectId,
    name: prototype.name,
    viewport_width: prototype.viewportWidth,
    viewport_height: prototype.viewportHeight,
    folder_id: prototype.folderId,
    created_at: prototype.createdAt.toISOString(),
    updated_at: prototype.updatedAt.toISOString(),
  };
}

export type SerializedPrototypeWithScreens = SerializedPrototype & {
  screens: SerializedArtifact[];
  links: SerializedPrototypeLink[];
};

export type SerializedPrototypeLink = {
  id: string;
  project_id: string;
  from_artifact_id: string;
  to_artifact_id: string | null;
  raw_target: string;
};

export function serializePrototypeLink(link: {
  id: string;
  projectId: string;
  fromArtifactId: string;
  toArtifactId: string | null;
  rawTarget: string;
}): SerializedPrototypeLink {
  return {
    id: link.id,
    project_id: link.projectId,
    from_artifact_id: link.fromArtifactId,
    to_artifact_id: link.toArtifactId,
    raw_target: link.rawTarget,
  };
}

export type SerializedComment = {
  id: string;
  target_type: Comment['targetType'];
  target_id: string;
  document_id: string | null;
  passage: string | null;
  anchor: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
};

export function serializeComment(comment: Comment): SerializedComment {
  return {
    id: comment.id,
    target_type: comment.targetType,
    target_id: comment.targetId,
    document_id: comment.targetType === 'document' ? comment.targetId : null,
    passage: comment.passage,
    anchor: comment.anchor,
    body: comment.body,
    resolved: comment.resolved,
    created_at: comment.createdAt.toISOString(),
  };
}

export function buildDocumentTree(documents: Document[]): SerializedDocumentTree[] {
  const nodes = new Map<string, SerializedDocumentTree>();
  for (const document of documents) {
    nodes.set(document.id, { ...serializeDocument(document), children: [] });
  }

  const roots: SerializedDocumentTree[] = [];
  for (const document of documents) {
    const node = nodes.get(document.id);
    if (!node) {
      continue;
    }
    if (document.parentId === null) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(document.parentId);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export type SerializedFolder = {
  id: string;
  project_id: string;
  name: string;
  parent_folder_id: string | null;
  created_at: string;
  updated_at: string;
};

export function serializeFolder(folder: Folder): SerializedFolder {
  return {
    id: folder.id,
    project_id: folder.projectId,
    name: folder.name,
    parent_folder_id: folder.parentFolderId,
    created_at: folder.createdAt.toISOString(),
    updated_at: folder.updatedAt.toISOString(),
  };
}

export type SerializedFolderTree = SerializedFolder & {
  folders: SerializedFolderTree[];
  documents: SerializedDocumentTree[];
};

export type SerializedDocumentFolderTree = {
  folders: SerializedFolderTree[];
  documents: SerializedDocumentTree[];
};

export function buildFolderTree(
  folders: Folder[],
  documents: Document[],
): SerializedDocumentFolderTree {
  const folderNodes = new Map<string, SerializedFolderTree>();
  for (const folder of folders) {
    folderNodes.set(folder.id, { ...serializeFolder(folder), folders: [], documents: [] });
  }

  const rootFolders: SerializedFolderTree[] = [];
  for (const folder of folders) {
    const node = folderNodes.get(folder.id);
    if (!node) {
      continue;
    }
    const parent =
      folder.parentFolderId === null ? undefined : folderNodes.get(folder.parentFolderId);
    if (parent) {
      parent.folders.push(node);
    } else {
      rootFolders.push(node);
    }
  }

  const documentsByFolder = new Map<string | null, Document[]>();
  for (const document of documents) {
    const key =
      document.folderId !== null && folderNodes.has(document.folderId) ? document.folderId : null;
    const group = documentsByFolder.get(key);
    if (group) {
      group.push(document);
    } else {
      documentsByFolder.set(key, [document]);
    }
  }

  for (const [folderId, group] of documentsByFolder) {
    if (folderId === null) {
      continue;
    }
    const node = folderNodes.get(folderId);
    if (node) {
      node.documents = buildDocumentTree(group);
    }
  }

  return {
    folders: rootFolders,
    documents: buildDocumentTree(documentsByFolder.get(null) ?? []),
  };
}

export function serializeEdge(edge: Edge) {
  return {
    id: edge.id,
    project_id: edge.projectId,
    from_type: edge.fromType,
    from_id: edge.fromId,
    to_type: edge.toType,
    to_id: edge.toId,
    label: edge.label,
    arrow_direction: edge.arrowDirection,
    style: edge.style,
    created_at: edge.createdAt.toISOString(),
  };
}

export function serializeAgentRun(run: AgentRun) {
  return {
    id: run.id,
    project_id: run.projectId,
    status: run.status,
    label: run.label,
    started_at: run.startedAt.toISOString(),
    completed_at: run.completedAt?.toISOString() ?? null,
  };
}

export function serializeAgentRunEvent(event: AgentRunEvent) {
  return {
    id: event.id,
    run_id: event.runId,
    message: event.message,
    created_at: event.createdAt.toISOString(),
  };
}

export type SerializedToken = {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
};

export function serializeToken(token: {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
}): SerializedToken {
  return {
    id: token.id,
    name: token.name,
    created_at: token.created_at,
    revoked_at: token.revoked_at,
  };
}

/** Wire-format field names for revision snapshots / changed_fields. */
export function revisionFieldToWire(field: string): string {
  if (field === 'statusLine') {
    return 'status_line';
  }
  return field;
}

export function parseRevisionSnapshot(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Revision snapshot must be a JSON object');
  }
  const wire: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    wire[revisionFieldToWire(key)] = value;
  }
  return wire;
}

export function parseRevisionChangedFields(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Revision changed_fields must be a JSON array');
  }
  return parsed.map((field) => {
    if (typeof field !== 'string') {
      throw new Error('Revision changed_fields entries must be strings');
    }
    return revisionFieldToWire(field);
  });
}

export type SerializedRevisionMeta = {
  id: string;
  author: string;
  changed_fields: string[];
  created_at: string;
};

export type SerializedRevision = SerializedRevisionMeta & {
  target_type: string;
  target_id: string;
  snapshot: Record<string, unknown>;
};

export function serializeRevisionMeta(revision: Revision): SerializedRevisionMeta {
  return {
    id: revision.id,
    author: revision.author,
    changed_fields: parseRevisionChangedFields(revision.changedFields),
    created_at: revision.createdAt.toISOString(),
  };
}

export function serializeRevision(revision: Revision): SerializedRevision {
  return {
    ...serializeRevisionMeta(revision),
    target_type: revision.targetType,
    target_id: revision.targetId,
    snapshot: parseRevisionSnapshot(revision.snapshot),
  };
}

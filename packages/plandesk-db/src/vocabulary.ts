/**
 * Enum vocabularies shared between the database and any client that renders or
 * orders them.
 *
 * **This module must never import drizzle, node:*, or anything else that cannot
 * run in a browser.** It is published as the `@plandesk/db/vocabulary` subpath
 * so the web app can hold one definition of these values rather than a copy —
 * `schema.ts` pulls `drizzle-orm/sqlite-core` and the package index pulls
 * `node:fs`, so neither can reach a bundle.
 *
 * A duplicated ordering constant is the specific failure this prevents: two
 * definitions that agree today, drift silently, and produce a UI ordered
 * differently from the data it came from.
 */

export const taskStatuses = ['scope', 'todo', 'in_progress', 'done', 'backlog'] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const taskKinds = ['build', 'decision'] as const;
export type TaskKind = (typeof taskKinds)[number];

export const taskPriorities = ['urgent', 'high', 'medium', 'low'] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export const taskLanes = ['auto', 'approve', 'full'] as const;
export type TaskLane = (typeof taskLanes)[number];

export const taskSeverities = ['low', 'medium', 'high'] as const;
export type TaskSeverity = (typeof taskSeverities)[number];

/** Ascending sort rank — null sorts after every defined priority. */
export const taskPriorityOrder: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const goalStatuses = ['active', 'paused', 'complete', 'blocked'] as const;
export type GoalStatus = (typeof goalStatuses)[number];

export const agentRunStatuses = ['running', 'completed', 'failed'] as const;
export type AgentRunStatus = (typeof agentRunStatuses)[number];

/** Terminal agent-run statuses — derived from agentRunStatuses, not restated. */
export const terminalAgentRunStatuses = agentRunStatuses.filter(
  (status): status is Exclude<AgentRunStatus, 'running'> => status !== 'running',
);

export const commentTargetTypes = ['document', 'task', 'note', 'submission', 'artifact'] as const;
export type CommentTargetType = (typeof commentTargetTypes)[number];

/** Comment surfaces that are not artifact-scoped (artifact uses its own route). */
export const commentTargetTypesForComments = commentTargetTypes.filter(
  (type): type is Exclude<CommentTargetType, 'artifact'> => type !== 'artifact',
);

export const revisionTargetTypes = ['task', 'document', 'artifact'] as const;
export type RevisionTargetType = (typeof revisionTargetTypes)[number];

/** Revision list surfaces that omit artifact (listed separately today). */
export const revisionTargetTypesForList = revisionTargetTypes.filter(
  (type): type is 'task' | 'document' => type !== 'artifact',
);

export const orgRoles = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof orgRoles)[number];

export const shareSubmissionStatuses = ['pending', 'accepted', 'rejected'] as const;
export type ShareSubmissionStatus = (typeof shareSubmissionStatuses)[number];

export const artifactKinds = ['markdown', 'html'] as const;
export type ArtifactKind = (typeof artifactKinds)[number];

/** Polymorphic edge endpoint kinds for authored links. */
export const linkEntityTypes = ['task', 'document', 'artifact', 'prototype'] as const;
export type LinkEntityType = (typeof linkEntityTypes)[number];

/*
 * Edge relationship labels. The column stays free text; these are the authored
 * vocabulary, split by which endpoint pair they describe.
 *
 * The split lives here, not in each consumer. It previously did not: the web
 * app declared the task set and the document set as two local constants while
 * `schema.ts` declared all twelve, and the canvas validated against the web's
 * eight and threw on the rest — so a stored task→task edge carrying a document
 * label killed the whole Flow route. That is the drift this module exists to
 * prevent, and edge labels were the one vocabulary that never moved in.
 */
export const taskEdgeLabels = [
  'blocks',
  'depends_on',
  'unblocks',
  'feeds',
  'clarifies',
  'enables',
  'supports',
  'relates',
] as const;
export type TaskEdgeLabel = (typeof taskEdgeLabels)[number];

/** Document→task (`documents`) and document→document (the rest). */
export const documentEdgeLabels = ['documents', 'references', 'supersedes', 'extends'] as const;
export type DocumentEdgeLabel = (typeof documentEdgeLabels)[number];

/** Every authored label, in vocabulary order. */
export const edgeLabels = [...taskEdgeLabels, ...documentEdgeLabels] as const;
export type EdgeLabel = (typeof edgeLabels)[number];

/** Rendered when a stored label is not one a given surface knows how to draw. */
export const DEFAULT_EDGE_LABEL: TaskEdgeLabel = 'depends_on';

export function isTaskEdgeLabel(label: string): label is TaskEdgeLabel {
  return (taskEdgeLabels as readonly string[]).includes(label);
}

export function isDocumentEdgeLabel(label: string): label is DocumentEdgeLabel {
  return (documentEdgeLabels as readonly string[]).includes(label);
}

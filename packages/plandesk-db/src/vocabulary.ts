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

/** Ascending sort rank — null sorts after every defined priority. */
export const taskPriorityOrder: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const goalStatuses = ['active', 'paused', 'complete', 'blocked'] as const;
export type GoalStatus = (typeof goalStatuses)[number];

/** Polymorphic edge endpoint kinds for authored links. */
export const linkEntityTypes = ['task', 'document', 'artifact', 'prototype'] as const;
export type LinkEntityType = (typeof linkEntityTypes)[number];

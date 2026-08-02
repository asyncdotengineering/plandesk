import type { DbClient } from './client.js';
import {
  assembleExportFromManifest,
  listImportManifestEntries,
  requiredExportCollections,
  validateImportOwnKeys,
  type PlandeskExportCollectionKey,
} from './portability-export-manifest.js';
import { runImportFromManifest } from './portability-import.js';

export {
  PLANDESK_EXPORT_TABLES,
  PLANDESK_EXPORT_TABLE_COLLECTIONS,
  type PlandeskExportCollectionKey,
  type PlandeskExportTable,
} from './portability-export-manifest.js';
import {
  type AgentRunStatus,
  type ArtifactKind,
  type CommentTargetType,
  type GoalStatus,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
} from './schema.js';
import type { SavedViewConfig } from './saved-view-config.js';

/** Version stamped into new exports. */
export const PLANDESK_EXPORT_VERSION = 'plandesk-export-v3' as const;

/**
 * Every version this importer understands, newest first.
 *
 * The check used to be equality against the one current version, which froze it:
 * bumping the constant would have orphaned every export file already on disk, so
 * nine successive features were bolted on as optional fields instead and the
 * version never moved. Accepting a set is what lets it move.
 *
 * v1 → v2: edges gained polymorphic endpoints (from_type/from_id/to_type/to_id)
 * and from_task_id/to_task_id became nullable, because an edge between two
 * documents names no task. A v1 file still imports — the reader falls back to
 * the task pair when the typed fields are absent.
 *
 * v2 → v3: task-only edge columns and the document primary-task column are gone.
 * Import still accepts the older shapes and rewrites them onto typed edges.
 */
export const SUPPORTED_EXPORT_VERSIONS = [
  'plandesk-export-v3',
  'plandesk-export-v2',
  'plandesk-export-v1',
] as const;

export type PlandeskExportProject = {
  name: string;
  description: string | null;
  // Always written on export; optional on import for exports written before owner existed.
  owner_id?: string | null;
  // Always written on export; optional on import for exports written before overview pin existed.
  // Remapped through documentIdMap on import (set after documents are inserted).
  overview_document_id?: string | null;
  // Always written on export; optional on import for exports written before repo binding.
  repo_url?: string | null;
  // Always written on export; optional on import for exports written before repo binding.
  folder_path?: string | null;
  canvas_layout: string | null;
};

export type PlandeskExportGoal = {
  id: string;
  objective: string;
  status: GoalStatus;
  verification_surface: string | null;
  constraints: string | null;
  boundaries: string | null;
  iteration_policy: string | null;
  stop_condition: string | null;
  budget: string | null;
  last_verification?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PlandeskExportTask = {
  id: string;
  label: string;
  status: TaskStatus;
  // Always written on export; optional on import for exports written before kind existed.
  kind?: TaskKind;
  // Always written on export; optional on import for exports written before priority existed.
  priority?: TaskPriority | null;
  description: string | null;
  x: number;
  y: number;
  assignee: string | null;
  due_date: string | null;
  // Always written on export; optional on import for exports written before goals existed.
  goal_id?: string;
  // Optional for backward compatibility with exports written before tags existed.
  tag_ids?: string[];
  // Always written on export; optional on import for exports written before commit_refs.
  commit_refs?: string[] | null;
  created_at?: string;
  updated_at?: string;
};

export type PlandeskExportTag = {
  id: string;
  name: string;
  color: string | null;
};

export type PlandeskExportEdge = {
  id: string;
  /**
   * Polymorphic endpoints — the only shape written on v3+ exports.
   * Absent in exports written before links spanned documents; the importer
   * falls back to the optional task pair for those.
   */
  from_type?: string | null;
  from_id?: string | null;
  to_type?: string | null;
  to_id?: string | null;
  /** Pre-v3 task-shaped endpoints. Optional on import; never written on v3+. */
  from_task_id?: string | null;
  to_task_id?: string | null;
  label: string | null;
  arrow_direction: string | null;
  style: string | null;
};

export type PlandeskExportFolder = {
  id: string;
  name: string;
  parent_folder_id: string | null;
};

export type PlandeskExportPrototype = {
  id: string;
  name: string;
  viewport_width: number;
  viewport_height: number;
  folder_id?: string | null;
};

export type PlandeskExportDocument = {
  id: string;
  title: string;
  body: string | null;
  status_line: string | null;
  parent_id: string | null;
  // Optional for backward compatibility with exports written before folders existed.
  folder_id?: string | null;
};

export type PlandeskExportNote = {
  id: string;
  title: string;
  body: string | null;
};

export type PlandeskExportView = {
  id: string;
  name: string;
  config: SavedViewConfig;
  position: number;
};

export type PlandeskExportComment = {
  id: string;
  target_type: CommentTargetType;
  target_id: string;
  passage: string | null;
  // Optional for backward compatibility with exports written before anchors were portable.
  anchor?: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
};

export type PlandeskExportDocumentComment = {
  id: string;
  document_id: string;
  passage: string | null;
  body: string;
  resolved: boolean;
  created_at?: string;
};

export type PlandeskExportArtifact = {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  created_at?: string;
  updated_at?: string;
  // Optional for backward compatibility with exports written before prototypes existed.
  prototype_id?: string | null;
  x?: number | null;
  y?: number | null;
};

export type PlandeskExportFile = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  // Present for locally-stored (BLOB) files; null for s3-backed files.
  bytes_base64: string | null;
  // Present for s3-backed files; null for locally-stored (BLOB) files.
  external_url: string | null;
  created_at: string;
};

export type PlandeskExportAgentRunEvent = {
  message: string;
  created_at: string;
};

export type PlandeskExportAgentRun = {
  id: string;
  status: AgentRunStatus;
  label: string | null;
  started_at: string;
  completed_at: string | null;
  events: PlandeskExportAgentRunEvent[];
};

export type PlandeskExport = {
  version: typeof PLANDESK_EXPORT_VERSION;
  project: PlandeskExportProject;
  goals: PlandeskExportGoal[];
  tasks: PlandeskExportTask[];
  tags: PlandeskExportTag[];
  edges: PlandeskExportEdge[];
  folders: PlandeskExportFolder[];
  prototypes: PlandeskExportPrototype[];
  documents: PlandeskExportDocument[];
  notes: PlandeskExportNote[];
  views: PlandeskExportView[];
  comments: PlandeskExportComment[];
  agent_runs: PlandeskExportAgentRun[];
  files: PlandeskExportFile[];
  artifacts: PlandeskExportArtifact[];
};

/**
 * Assemble a portable export blob, requiring every collection named by the
 * export-table manifest. Callers still build each collection; this ties the
 * return shape to {@link PLANDESK_EXPORT_TABLE_COLLECTIONS} so a registered
 * collection cannot be dropped silently, and rejects unknown keys so a
 * spread cannot smuggle an unregistered collection into the blob.
 */
export function buildExportFromManifest<C extends Omit<PlandeskExport, 'version'>>(
  collections: {
    [K in keyof C]: K extends PlandeskExportCollectionKey ? C[K] : never;
  } & Omit<PlandeskExport, 'version'>,
): PlandeskExport {
  const required = requiredExportCollections();
  // One own-property snapshot drives validation AND construction. Enumerating
  // the caller's object twice is a check/use gap: a Proxy whose `ownKeys`
  // differs between the two passes validation and then smuggles an
  // unregistered collection into the spread. Own-properties only — object
  // spread ignores inherited keys, so `in` would accept a prototype-carried
  // collection that never reaches the output.
  const snapshot = new Map<string, unknown>(Object.entries(collections));
  for (const key of required) {
    if (!snapshot.has(key)) {
      throw new Error(`export missing collection registered in PLANDESK_EXPORT_TABLES: ${key}`);
    }
  }
  for (const key of snapshot.keys()) {
    if (!required.has(key as PlandeskExportCollectionKey)) {
      throw new Error(`export collection not registered in PLANDESK_EXPORT_TABLES: ${key}`);
    }
  }
  return {
    version: PLANDESK_EXPORT_VERSION,
    ...(Object.fromEntries(snapshot) as Omit<PlandeskExport, 'version'>),
  };
}

export type PlandeskExportInput = {
  version: string;
  project: PlandeskExportProject;
  tasks: PlandeskExportTask[];
  // Optional for backward compatibility with exports written before goals existed.
  goals?: PlandeskExportGoal[];
  // Optional for backward compatibility with exports written before tags existed.
  tags?: PlandeskExportTag[];
  edges: PlandeskExportEdge[];
  // Optional for backward compatibility with exports written before folders existed.
  folders?: PlandeskExportFolder[];
  // Optional for backward compatibility with exports written before prototypes existed.
  prototypes?: PlandeskExportPrototype[];
  documents: PlandeskExportDocument[];
  // Optional for backward compatibility with exports written before notes existed.
  notes?: PlandeskExportNote[];
  // Optional for backward compatibility with exports written before views existed.
  views?: PlandeskExportView[];
  // Optional for backward compatibility with exports written before comments existed.
  comments?: PlandeskExportComment[];
  // Legacy shape from exports written before polymorphic comments.
  document_comments?: PlandeskExportDocumentComment[];
  agent_runs: PlandeskExportAgentRun[];
  // Optional for backward compatibility with exports written before files existed.
  files?: PlandeskExportFile[];
  // Optional for backward compatibility with exports written before artifacts existed.
  artifacts?: PlandeskExportArtifact[];
};

export class InvalidExportVersionError extends Error {
  constructor(version: string) {
    super(
      `Unsupported export version: ${version}. This build reads ${SUPPORTED_EXPORT_VERSIONS.join(', ')}. A newer version means the file was written by a newer Plan Desk — upgrade to import it.`,
    );
    this.name = 'InvalidExportVersionError';
  }
}

export async function exportProject(
  db: DbClient,
  projectId: string,
): Promise<PlandeskExport | undefined> {
  const collections = await assembleExportFromManifest(db, projectId);
  if (!collections) {
    return undefined;
  }
  return buildExportFromManifest(collections);
}

export type ImportProjectOptions = {
  /** Hosted org to own the imported project. When omitted, uses the default org. */
  orgId?: string;
  /** Workspace to own the imported project. When omitted, uses the default workspace. */
  workspaceId?: string;
};

/**
 * Import a portable export as a new project.
 *
 * Uses `db.batch([...])` — one round-trip, all-or-nothing — so remote Turso
 * imports stay under the interactive-transaction time budget. All ids are
 * pre-generated; no interactive read-then-write inside the batch.
 */
export async function importProject(
  db: DbClient,
  data: PlandeskExportInput,
  options?: ImportProjectOptions,
): Promise<{ projectId: string }> {
  if (!(SUPPORTED_EXPORT_VERSIONS as readonly string[]).includes(data.version)) {
    throw new InvalidExportVersionError(data.version);
  }

  validateImportOwnKeys(data);

  return runImportFromManifest(db, data, listImportManifestEntries(), options);
}

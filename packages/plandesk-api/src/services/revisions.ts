import {
  getDocument,
  getRevision as dbGetRevision,
  getTask,
  listRevisionsByTarget,
  revisionTargetTypes,
  type Db,
  type Revision,
  type RevisionTargetType,
} from '@plandesk/db';
import {
  DOCUMENT_VERSIONED_FIELDS,
  TASK_VERSIONED_FIELDS,
  versionedFieldSnapshot,
} from './revision-capture.js';
import { diffSnapshots, type FieldDiff } from '../revision-diff.js';
import {
  revisionFieldToWire,
  serializeRevision,
  serializeRevisionMeta,
  type SerializedRevision,
  type SerializedRevisionMeta,
} from '../serialize.js';
import { resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type RevisionServiceDeps = OrgScopedDeps & {
  db: Db;
};

export class InvalidRevisionQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRevisionQueryError';
  }
}

export type RevisionService = ReturnType<typeof createRevisionService>;

function isRevisionTargetType(value: string): value is RevisionTargetType {
  return (revisionTargetTypes as readonly string[]).includes(value);
}

function parseStoredSnapshot(revision: Revision): Record<string, unknown> {
  const parsed: unknown = JSON.parse(revision.snapshot);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Revision snapshot must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

async function loadCurrentSnapshot(
  db: Db,
  targetType: RevisionTargetType,
  targetId: string,
): Promise<Record<string, unknown> | undefined> {
  if (targetType === 'task') {
    const task = await getTask(db, targetId);
    if (!task) {
      return undefined;
    }
    return versionedFieldSnapshot(task, TASK_VERSIONED_FIELDS);
  }
  const document = await getDocument(db, targetId);
  if (!document) {
    return undefined;
  }
  return versionedFieldSnapshot(document, DOCUMENT_VERSIONED_FIELDS);
}

export function createRevisionService(deps: RevisionServiceDeps) {
  const { db } = deps;

  return {
    async list(
      projectId: string,
      targetTypeRaw: string,
      targetId: string,
    ): Promise<SerializedRevisionMeta[] | undefined> {
      if (!isRevisionTargetType(targetTypeRaw)) {
        throw new InvalidRevisionQueryError('target_type must be task or document');
      }
      if (targetId.trim() === '') {
        throw new InvalidRevisionQueryError('target_id is required');
      }
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      const rows = await listRevisionsByTarget(db, projectId, targetTypeRaw, targetId);
      // Newest first for the history panel; repository stays ascending for capture tests.
      return [...rows].reverse().map(serializeRevisionMeta);
    },

    async get(id: string): Promise<SerializedRevision | undefined> {
      const revision = await dbGetRevision(db, id);
      if (!revision) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, revision.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return serializeRevision(revision);
    },

    async diff(id: string, against: string): Promise<FieldDiff[] | undefined> {
      if (against.trim() === '') {
        throw new InvalidRevisionQueryError('against is required');
      }

      const base = await dbGetRevision(db, id);
      if (!base) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, base.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      let otherSnapshot: Record<string, unknown>;
      if (against === 'current') {
        const current = await loadCurrentSnapshot(db, base.targetType, base.targetId);
        if (current === undefined) {
          return undefined;
        }
        otherSnapshot = current;
      } else {
        const other = await dbGetRevision(db, against);
        if (!other) {
          return undefined;
        }
        try {
          await assertProjectInOrg(db, other.projectId, resolveOrgId(deps));
        } catch (error) {
          if (error instanceof ProjectNotInOrgError) {
            return undefined;
          }
          throw error;
        }
        if (other.targetType !== base.targetType || other.targetId !== base.targetId) {
          throw new InvalidRevisionQueryError('against revision must target the same entity');
        }
        otherSnapshot = parseStoredSnapshot(other);
      }

      const projectBodyAsMarkdown = base.targetType === 'document';
      return diffSnapshots(parseStoredSnapshot(base), otherSnapshot, {
        projectBodyAsMarkdown,
        fieldName: revisionFieldToWire,
      });
    },
  };
}

export type { SerializedRevision, SerializedRevisionMeta };

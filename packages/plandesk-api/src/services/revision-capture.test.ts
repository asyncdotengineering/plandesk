import { describe, expect, it } from 'vitest';
import {
  captureRevision,
  changedVersionedFields,
  DOCUMENT_VERSIONED_FIELDS,
  maxRevisionsFromEnv,
  TASK_VERSIONED_FIELDS,
  versionedFieldSnapshot,
} from './revision-capture.js';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  createTaskWithDefaultGoal as createTask,
  evictRevisionsBeyondCap,
  insertRevision,
  listRevisionsByTarget,
  migrate,
  reportRevisionUsage,
  withTransaction,
} from '@plandesk/db';
import { createTaskService } from './tasks.js';
import { createServices } from './index.js';

describe('revision-capture helpers', () => {
  it('detects changed versioned fields only when input carries them', () => {
    const prior = { label: 'A', description: 'old', status: 'todo' };
    expect(changedVersionedFields(prior, { label: 'B' }, TASK_VERSIONED_FIELDS)).toEqual(['label']);
    expect(changedVersionedFields(prior, { label: 'A' }, TASK_VERSIONED_FIELDS)).toEqual([]);
    expect(changedVersionedFields(prior, { status: 'done' }, TASK_VERSIONED_FIELDS)).toEqual([]);
  });

  it('builds a complete versioned-field snapshot', () => {
    const prior = { title: 'T', body: null, statusLine: 'S', parentId: 'x' };
    expect(versionedFieldSnapshot(prior, DOCUMENT_VERSIONED_FIELDS)).toEqual({
      title: 'T',
      body: null,
      statusLine: 'S',
    });
  });
});

describe('maxRevisionsFromEnv', () => {
  it('treats unset and empty as unlimited', () => {
    expect(maxRevisionsFromEnv({})).toBeNull();
    expect(maxRevisionsFromEnv({ PLANDESK_MAX_REVISIONS: '' })).toBeNull();
    expect(maxRevisionsFromEnv({ PLANDESK_MAX_REVISIONS: '   ' })).toBeNull();
  });

  it('treats -1 as unlimited', () => {
    expect(maxRevisionsFromEnv({ PLANDESK_MAX_REVISIONS: '-1' })).toBeNull();
  });

  it('accepts a positive integer', () => {
    expect(maxRevisionsFromEnv({ PLANDESK_MAX_REVISIONS: '3' })).toBe(3);
    expect(maxRevisionsFromEnv({ PLANDESK_MAX_REVISIONS: '12' })).toBe(12);
  });

  it('fails fast on non-numeric and non-positive values', () => {
    expect(() => maxRevisionsFromEnv({ PLANDESK_MAX_REVISIONS: 'abc' })).toThrow(
      /PLANDESK_MAX_REVISIONS/,
    );
    expect(() => maxRevisionsFromEnv({ PLANDESK_MAX_REVISIONS: '0' })).toThrow(
      /PLANDESK_MAX_REVISIONS/,
    );
    expect(() => maxRevisionsFromEnv({ PLANDESK_MAX_REVISIONS: '3.5' })).toThrow(
      /PLANDESK_MAX_REVISIONS/,
    );
    expect(() => maxRevisionsFromEnv({ PLANDESK_MAX_REVISIONS: '-2' })).toThrow(
      /PLANDESK_MAX_REVISIONS/,
    );
  });

  it('createServices fails at startup on an invalid env value', async () => {
    // A real in-memory Db rather than a cast: the assertion is that env
    // validation throws, and it should hold against a genuine handle.
    const envDb = await createDb(':memory:');
    const previous = process.env.PLANDESK_MAX_REVISIONS;
    process.env.PLANDESK_MAX_REVISIONS = 'nope';
    try {
      expect(() =>
        createServices({
          db: envDb,
        }),
      ).toThrow(/PLANDESK_MAX_REVISIONS/);
    } finally {
      if (previous === undefined) {
        delete process.env.PLANDESK_MAX_REVISIONS;
      } else {
        process.env.PLANDESK_MAX_REVISIONS = previous;
      }
    }
  });
});

describe('PLANDESK_MAX_REVISIONS retention', () => {
  async function setup() {
    const db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Cap' });
    const task = await createTask(db, { projectId: project.id, label: 'T', description: 'v0' });
    const other = await createTask(db, {
      projectId: project.id,
      label: 'Other',
      description: 'other-v0',
    });
    return { db, project, task, other, orgId: project.orgId };
  }

  it('REVERT-PROOF: with cap=3, a fourth write leaves exactly three and the oldest is gone', async () => {
    const { db, project, task, orgId } = await setup();
    const service = createTaskService({ db, orgId, maxRevisions: 3 });

    await service.update(task.id, { description: 'v1' });
    await service.update(task.id, { description: 'v2' });
    await service.update(task.id, { description: 'v3' });
    const beforeFourth = await listRevisionsByTarget(db, project.id, 'task', task.id);
    expect(beforeFourth).toHaveLength(3);
    const oldestId = beforeFourth[0]?.id;
    expect(oldestId).toBeDefined();
    const oldestSnapshot = JSON.parse(beforeFourth[0]?.snapshot ?? '{}') as {
      description?: string;
    };
    expect(oldestSnapshot.description).toBe('v0');

    await service.update(task.id, { description: 'v4' });

    const after = await listRevisionsByTarget(db, project.id, 'task', task.id);
    expect(after).toHaveLength(3);
    expect(after.map((r) => r.id)).not.toContain(oldestId);
    expect(
      after.map((r) => (JSON.parse(r.snapshot) as { description?: string }).description),
    ).toEqual(['v1', 'v2', 'v3']);
  });

  it('REVERT-PROOF: eviction is scoped per target', async () => {
    const { db, project, task, other, orgId } = await setup();
    const service = createTaskService({ db, orgId, maxRevisions: 2 });

    await service.update(other.id, { description: 'other-v1' });
    await service.update(other.id, { description: 'other-v2' });
    const otherBefore = await listRevisionsByTarget(db, project.id, 'task', other.id);
    expect(otherBefore).toHaveLength(2);
    const otherIds = otherBefore.map((r) => r.id);

    await service.update(task.id, { description: 'v1' });
    await service.update(task.id, { description: 'v2' });
    await service.update(task.id, { description: 'v3' });

    const capped = await listRevisionsByTarget(db, project.id, 'task', task.id);
    expect(capped).toHaveLength(2);
    expect(
      capped.map((r) => (JSON.parse(r.snapshot) as { description?: string }).description),
    ).toEqual(['v1', 'v2']);

    const otherAfter = await listRevisionsByTarget(db, project.id, 'task', other.id);
    expect(otherAfter.map((r) => r.id)).toEqual(otherIds);
  });

  it('unset keeps every revision across ten writes', async () => {
    const { db, project, task, orgId } = await setup();
    const service = createTaskService({ db, orgId });
    for (let i = 1; i <= 10; i += 1) {
      await service.update(task.id, { description: `v${String(i)}` });
    }
    expect(await listRevisionsByTarget(db, project.id, 'task', task.id)).toHaveLength(10);
  });

  it('-1 behaves as unset and keeps every revision', async () => {
    const { db, project, task, orgId } = await setup();
    expect(maxRevisionsFromEnv({ PLANDESK_MAX_REVISIONS: '-1' })).toBeNull();
    const service = createTaskService({
      db,
      orgId,
      maxRevisions: maxRevisionsFromEnv({ PLANDESK_MAX_REVISIONS: '-1' }),
    });
    for (let i = 1; i <= 10; i += 1) {
      await service.update(task.id, { description: `v${String(i)}` });
    }
    expect(await listRevisionsByTarget(db, project.id, 'task', task.id)).toHaveLength(10);
  });

  it('insert and eviction share one transaction — a failure leaves neither', async () => {
    const { db, project, task } = await setup();
    const t0 = new Date('2020-01-01T00:00:00.000Z');
    const seeded = [];
    for (let i = 0; i < 3; i += 1) {
      seeded.push(
        await insertRevision(db, {
          projectId: project.id,
          targetType: 'task',
          targetId: task.id,
          snapshot: JSON.stringify({ label: 'T', description: `seed-${String(i)}` }),
          changedFields: JSON.stringify(['description']),
          author: 'system',
          createdAt: new Date(t0.getTime() + i * 1000),
        }),
      );
    }
    const oldestId = seeded[0]?.id;
    expect(oldestId).toBeDefined();

    await expect(
      withTransaction(db, async (tx) => {
        await captureRevision(
          tx,
          {
            projectId: project.id,
            targetType: 'task',
            targetId: task.id,
            snapshot: JSON.stringify({ label: 'T', description: 'seed-2' }),
            changedFields: JSON.stringify(['description']),
            author: 'system',
            createdAt: new Date(t0.getTime() + 3000),
          },
          3,
        );
        // Prove both ops are uncommitted: mid-tx the oldest is already gone.
        const mid = await listRevisionsByTarget(tx, project.id, 'task', task.id);
        expect(mid).toHaveLength(3);
        expect(mid.map((r) => r.id)).not.toContain(oldestId);
        throw new Error('forced failure after insert+evict');
      }),
    ).rejects.toThrow(/forced failure/);

    const after = await listRevisionsByTarget(db, project.id, 'task', task.id);
    expect(after).toHaveLength(3);
    expect(after.map((r) => r.id)).toEqual(seeded.map((r) => r.id));
    expect(after[0]?.id).toBe(oldestId);
  });

  it('reportRevisionUsage surfaces counts, bytes per target, and database share', async () => {
    const { db, project, task, other } = await setup();
    await insertRevision(db, {
      projectId: project.id,
      targetType: 'task',
      targetId: task.id,
      snapshot: 'a'.repeat(100),
      changedFields: '[]',
      author: 'system',
    });
    await insertRevision(db, {
      projectId: project.id,
      targetType: 'task',
      targetId: other.id,
      snapshot: 'b'.repeat(40),
      changedFields: '[]',
      author: 'system',
    });

    const report = await reportRevisionUsage(db);
    expect(report.revisionCount).toBe(2);
    expect(report.snapshotBytes).toBe(140);
    expect(report.databaseBytes).toBeGreaterThan(0);
    expect(report.snapshotShareOfDatabase).toBeGreaterThan(0);
    expect(report.snapshotShareOfDatabase).toBeLessThanOrEqual(1);
    expect(report.perTarget).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: task.id,
          revisionCount: 1,
          snapshotBytes: 100,
        }),
        expect.objectContaining({
          targetId: other.id,
          revisionCount: 1,
          snapshotBytes: 40,
        }),
      ]),
    );
  });

  it('evictRevisionsBeyondCap rejects a non-positive cap', async () => {
    const { db, task } = await setup();
    await expect(evictRevisionsBeyondCap(db, 'task', task.id, 0)).rejects.toThrow(/positive integer/);
  });
});

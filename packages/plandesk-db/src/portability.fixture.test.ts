import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client.js';
import { migrate } from './migrate.js';
import {
  exportProject,
  importProject,
  PLANDESK_EXPORT_VERSION,
  type PlandeskExportInput,
} from './portability.js';
import { listDocuments } from './repositories/documents.js';
import { listEdges } from './repositories/edges.js';
import { listTasks } from './repositories/tasks.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturePath = join(repoRoot, 'examples/checkout-revamp.json');

function loadCheckoutRevampFixture(): PlandeskExportInput {
  const raw = readFileSync(fixturePath, 'utf8');
  return JSON.parse(raw) as PlandeskExportInput;
}

describe('checkout-revamp dogfood fixture', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });

  it('test:checkout_revamp_fixture_imports with labeled edges and linked docs', async () => {
    const fixture = loadCheckoutRevampFixture();
    expect(fixture.version).toBe(PLANDESK_EXPORT_VERSION);
    expect(fixture.project.name).toBe('Checkout Revamp');
    expect(fixture.tasks.length).toBeGreaterThanOrEqual(6);
    expect(fixture.edges.length).toBeGreaterThanOrEqual(4);
    expect(fixture.documents.length).toBeGreaterThanOrEqual(2);

    const { projectId } = await importProject(db, fixture);
    const tasks = await listTasks(db, projectId);
    const edges = await listEdges(db, projectId);
    const documents = await listDocuments(db, projectId);

    expect(tasks).toHaveLength(fixture.tasks.length);
    expect(edges).toHaveLength(fixture.edges.length);
    expect(documents).toHaveLength(fixture.documents.length);

    const taskLabelById = new Map(tasks.map((task) => [task.id, task.label]));
    const edgeSignatures = edges.map((edge) => ({
      from: taskLabelById.get(edge.fromTaskId),
      to: taskLabelById.get(edge.toTaskId),
      label: edge.label,
    }));

    expect(edgeSignatures).toContainEqual({
      from: 'Payment gateway integration',
      to: 'Feature flag rollout',
      label: 'blocks',
    });
    expect(edgeSignatures).toContainEqual({
      from: 'Address validation',
      to: 'Payment gateway integration',
      label: 'depends_on',
    });
    expect(edgeSignatures).toContainEqual({
      from: 'Cart totals audit',
      to: 'Feature flag rollout',
      label: 'feeds',
    });

    const scopeDoc = documents.find((doc) => doc.title === 'Scope: Checkout Revamp');
    expect(scopeDoc).toBeDefined();
    expect(scopeDoc?.statusLine).toBe('Ready to implement');
    expect(scopeDoc?.linkedTaskId).toBeTruthy();
    const linkedTask = tasks.find((task) => task.id === scopeDoc?.linkedTaskId);
    expect(linkedTask?.label).toBe('Scope checkout flow');

    const reExported = await exportProject(db, projectId);
    expect(reExported).toBeDefined();
    if (!reExported) {
      return;
    }
    expect(reExported.tasks.map((task) => task.label).sort()).toEqual(
      fixture.tasks.map((task) => task.label).sort(),
    );
    expect(reExported.documents.map((doc) => doc.title).sort()).toEqual(
      fixture.documents.map((doc) => doc.title).sort(),
    );
  });
});

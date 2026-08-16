import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client.js';
import { migrate } from './migrate.js';
import {
  exportProject,
  importProject,
  SUPPORTED_EXPORT_VERSIONS,
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
    // Deliberately a v1 fixture: it stays on the older version so this test keeps
    // proving that a file written before polymorphic links still imports.
    expect(SUPPORTED_EXPORT_VERSIONS as readonly string[]).toContain(fixture.version);
    expect(fixture.project.name).toBe('Checkout Revamp');
    expect(fixture.tasks.length).toBeGreaterThanOrEqual(6);
    expect(fixture.edges.length).toBeGreaterThanOrEqual(4);
    expect(fixture.documents.length).toBeGreaterThanOrEqual(2);

    const { projectId } = await importProject(db, fixture);
    const tasks = await listTasks(db, projectId);
    const edges = await listEdges(db, projectId);
    const documents = await listDocuments(db, projectId);

    expect(tasks).toHaveLength(fixture.tasks.length);
    // Pre-v3 fixtures may carry primary-task pointers on documents; import rewrites
    // those into document→task edges, so the live edge count can exceed the file's.
    const legacyDocLinks = fixture.documents.filter((doc) => {
      const raw = (doc as typeof doc & Record<string, unknown>)[['linked', 'task', 'id'].join('_')];
      return typeof raw === 'string';
    }).length;
    expect(edges.length).toBeGreaterThanOrEqual(fixture.edges.length);
    expect(edges).toHaveLength(fixture.edges.length + legacyDocLinks);
    expect(documents).toHaveLength(fixture.documents.length);

    const taskLabelById = new Map(tasks.map((task) => [task.id, task.label]));
    const edgeSignatures = edges.map((edge) => ({
      from: taskLabelById.get(edge.fromId) ?? edge.fromId,
      to: taskLabelById.get(edge.toId) ?? edge.toId,
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
    // Pre-v3 fixture carried the primary task on the document; import rewrote it to an edge.
    const scopeLink = edges.find(
      (edge) =>
        edge.fromType === 'document' && edge.fromId === scopeDoc?.id && edge.toType === 'task',
    );
    expect(scopeLink).toBeDefined();
    const linkedTask = tasks.find((task) => task.id === scopeLink?.toId);
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

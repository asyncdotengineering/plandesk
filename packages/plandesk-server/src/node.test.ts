import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SchemaDriftError } from '@plandesk/db';
import { createNodeApp } from './node.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function boardOptions(afterPrepare: () => Promise<unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-node-'));
  dirs.push(dir);
  return {
    config: { dbUrl: join(dir, 'workspace.db') },
    local: true,
    host: '127.0.0.1',
    origin: 'http://127.0.0.1:0',
    dataDir: dir,
    afterPrepare,
  };
}

describe('createNodeApp boot', () => {
  it('fails the boot when preparing the database fails for a reason other than drift', async () => {
    // A board that cannot be prepared (read-only disk, failed backfill) must not
    // boot green and serve 500s forever: the operator sees the error and exit 1.
    await expect(
      createNodeApp(boardOptions(() => Promise.reject(new Error('disk is read-only')))),
    ).rejects.toThrow('disk is read-only');
  });

  it('still boots when the schema is behind, so the gate can answer 503 and retry', async () => {
    const summary = {
      applied: 0,
      shipped: 1,
      current: false,
      latestAppliedTag: null,
      latestShippedTag: 'x',
      missingTags: ['x'],
    };
    const app = await createNodeApp(
      boardOptions(() => Promise.reject(new SchemaDriftError(summary))),
    );
    const res = await app.request('http://127.0.0.1/api/v1/health');
    expect(res.status).toBe(503);
  });
});

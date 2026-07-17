import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { createApp, createServices } from '@plandesk/api';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  migrate,
  type Db,
} from '@plandesk/db';
import { afterEach, describe, expect, it } from 'vitest';
import { buildConfigJson } from './connect-artifacts.js';
import { runProgressCheckpoint } from './progress-checkpoint.js';

async function withTestServer(
  run: (ctx: {
    baseUrl: string;
    db: Db;
    services: ReturnType<typeof createServices>;
    projectId: string;
  }) => Promise<void>,
): Promise<void> {
  const db = await createDb(':memory:');
  await migrate(db);
  const project = await createProject(db, { name: 'Checkpoint project' });
  const services = createServices({ db, orgId: project.orgId });
  const app = createApp({ db, services });

  const server: Server = createServer((req, res) => {
    void getRequestListener(app.fetch)(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('expected TCP address');
  }
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  try {
    await run({ baseUrl, db, services, projectId: project.id });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}

describe('runProgressCheckpoint', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-checkpoint-'));
    tempDirs.push(repoDir);
    return repoDir;
  }

  function bindRepo(repoDir: string, baseUrl: string, projectId: string): void {
    mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
    writeFileSync(
      join(repoDir, '.plandesk', 'config.json'),
      buildConfigJson({ serverUrl: baseUrl, projectId, projectName: 'Checkpoint project' }),
      'utf8',
    );
  }

  it('no-ops when the repo has no binding', async () => {
    const repoDir = makeRepo();
    expect(await runProgressCheckpoint(repoDir, 'hello')).toEqual({ posted: false });
  });

  it('no-ops when no agent run is currently running', async () => {
    await withTestServer(async ({ baseUrl, services, projectId }) => {
      const repoDir = makeRepo();
      bindRepo(repoDir, baseUrl, projectId);
      expect(await runProgressCheckpoint(repoDir, 'nothing running')).toEqual({ posted: false });
      expect(await services.agentRunService.listForProject(projectId)).toEqual([]);
    });
  });

  it('posts a checkpoint event to the running agent run', async () => {
    await withTestServer(async ({ baseUrl, services, projectId }) => {
      const repoDir = makeRepo();
      bindRepo(repoDir, baseUrl, projectId);
      await services.agentRunService.start(projectId, 'Worker');

      const result = await runProgressCheckpoint(repoDir, 'checkpoint message');
      expect(result).toEqual({ posted: true });

      const runs = await services.agentRunService.listForProject(projectId);
      expect(runs?.[0]?.events.map((e) => e.message)).toContain('checkpoint message');
    });
  });

  it('no-ops when the server is unreachable', async () => {
    const repoDir = makeRepo();
    bindRepo(repoDir, 'http://127.0.0.1:1', 'missing-project');
    expect(await runProgressCheckpoint(repoDir, 'unreachable')).toEqual({ posted: false });
  });
});

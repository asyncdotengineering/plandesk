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
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { buildConfigJson } from './connect-artifacts.js';
import { runContext } from './context.js';

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
  const project = await createProject(db, { name: 'Context project' });
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

describe('runContext', () => {
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
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-context-'));
    tempDirs.push(repoDir);
    return repoDir;
  }

  function bindRepo(repoDir: string, baseUrl: string, projectId: string): void {
    mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
    writeFileSync(
      join(repoDir, '.plandesk', 'config.json'),
      buildConfigJson({ serverUrl: baseUrl, projectId, projectName: 'Context project' }),
      'utf8',
    );
  }

  it('returns {} when the repo has no binding', async () => {
    const repoDir = makeRepo();
    expect(await runContext(repoDir)).toEqual({});
  });

  it('returns all-null fields when bound but server is unreachable (config alone is enough)', async () => {
    const repoDir = makeRepo();
    mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
    writeFileSync(
      join(repoDir, '.plandesk', 'config.json'),
      buildConfigJson({ serverUrl: 'http://127.0.0.1:1', projectId: 'p1', projectName: 'P' }),
      'utf8',
    );
    expect(await runContext(repoDir)).toEqual({
      current_task: null,
      linked_doc: null,
      last_progress: null,
      next_task: null,
    });
  });

  it('reports the next actionable task when idle', async () => {
    await withTestServer(async ({ baseUrl, db, projectId }) => {
      const repoDir = makeRepo();
      bindRepo(repoDir, baseUrl, projectId);
      const task = await createTask(db, { projectId, label: 'Ship the thing', status: 'todo' });

      const context = await runContext(repoDir);
      expect(context).toEqual({
        current_task: null,
        linked_doc: null,
        last_progress: null,
        next_task: { id: task.id, label: 'Ship the thing' },
      });
    });
  });

  it('reports the current task, linked doc, and last progress; skips next_task', async () => {
    await withTestServer(async ({ baseUrl, db, services, projectId }) => {
      const repoDir = makeRepo();
      bindRepo(repoDir, baseUrl, projectId);

      const task = await createTask(db, {
        projectId,
        label: 'Ship board-as-memory hooks',
        status: 'in_progress',
      });
      const linkedDoc = await services.documentService.create(projectId, {
        title: 'Design: hooks',
        body: 'the plan',
        statusLine: 'Ready to implement',
      });
      if (!linkedDoc) {
        throw new Error('expected linked document');
      }
      // Documents link to tasks through a typed edge now, not a column.
      await services.canvasService.createEdge(projectId, {
        fromType: 'document',
        fromId: linkedDoc.id,
        toType: 'task',
        toId: task.id,
        label: 'documents',
      });
      const run = await services.agentRunService.start(projectId, 'Worker');
      if (!run) {
        throw new Error('expected run');
      }
      await services.agentRunService.recordProgress(run.id, 'first update');
      await services.agentRunService.recordProgress(run.id, 'second update');

      const context = await runContext(repoDir);
      expect(context).toMatchObject({
        current_task: { id: task.id, label: 'Ship board-as-memory hooks', status: 'in_progress' },
        linked_doc: {
          title: 'Design: hooks',
          status_line: 'Ready to implement',
          body: '<p>the plan</p>\n',
        },
        last_progress: { message: 'second update' },
        next_task: null,
      });
    });
  });

  it('returns all-null fields (not an error) when the server is unreachable', async () => {
    const repoDir = makeRepo();
    bindRepo(repoDir, 'http://127.0.0.1:1', 'missing-project');
    expect(await runContext(repoDir)).toEqual({
      current_task: null,
      linked_doc: null,
      last_progress: null,
      next_task: null,
    });
  });

  it('returns {} (never throws) when config.json is malformed', async () => {
    const repoDir = makeRepo();
    mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
    writeFileSync(join(repoDir, '.plandesk', 'config.json'), '{ not valid json', 'utf8');
    writeFileSync(join(repoDir, '.plandesk', 'token'), 'test-token', 'utf8');
    await expect(runContext(repoDir)).resolves.toEqual({});
  });

  it('caps a large linked-doc body so it does not re-inflate the context', async () => {
    await withTestServer(async ({ baseUrl, db, services, projectId }) => {
      const repoDir = makeRepo();
      bindRepo(repoDir, baseUrl, projectId);
      const task = await createTask(db, { projectId, label: 'Big doc task', status: 'in_progress' });
      const bigBody = 'x'.repeat(9000);
      const bigDoc = await services.documentService.create(projectId, {
        title: 'Design: big',
        body: bigBody,
        statusLine: null,
      });
      if (!bigDoc) {
        throw new Error('expected big document');
      }
      await services.canvasService.createEdge(projectId, {
        fromType: 'document',
        fromId: bigDoc.id,
        toType: 'task',
        toId: task.id,
        label: 'documents',
      });

      const context = (await runContext(repoDir)) as { linked_doc: { body: string } };
      expect(context.linked_doc.body.length).toBeLessThan(bigBody.length);
      expect(context.linked_doc.body).toContain('[truncated');
    });
  });
});

import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { createApp, createEventBus, createServices } from '@plandesk/api';
import { createDb, createProject, createTask, migrate, type Db } from '@plandesk/db';
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
  const db = createDb(':memory:');
  migrate(db);
  const project = createProject(db, { name: 'Context project' });
  const eventBus = createEventBus();
  const services = createServices({ db, eventBus });
  const app = createApp({ db, eventBus, services });

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
    writeFileSync(join(repoDir, '.plandesk', 'token'), 'test-token', 'utf8');
  }

  it('returns {} when the repo has no binding', async () => {
    const repoDir = makeRepo();
    expect(await runContext(repoDir)).toEqual({});
  });

  it('returns {} when config.json is present but the token file is missing', async () => {
    const repoDir = makeRepo();
    mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
    writeFileSync(
      join(repoDir, '.plandesk', 'config.json'),
      buildConfigJson({ serverUrl: 'http://127.0.0.1:1', projectId: 'p1', projectName: 'P' }),
      'utf8',
    );
    expect(await runContext(repoDir)).toEqual({});
  });

  it('reports the next actionable task when idle', async () => {
    await withTestServer(async ({ baseUrl, db, projectId }) => {
      const repoDir = makeRepo();
      bindRepo(repoDir, baseUrl, projectId);
      const task = createTask(db, { projectId, label: 'Ship the thing', status: 'todo' });

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

      const task = createTask(db, {
        projectId,
        label: 'Ship board-as-memory hooks',
        status: 'in_progress',
      });
      services.documentService.create(projectId, {
        title: 'Design: hooks',
        body: 'the plan',
        statusLine: 'Ready to implement',
        linkedTaskId: task.id,
      });
      const run = services.agentRunService.start(projectId, 'Worker');
      if (!run) {
        throw new Error('expected run');
      }
      services.agentRunService.recordProgress(run.id, 'first update');
      services.agentRunService.recordProgress(run.id, 'second update');

      const context = await runContext(repoDir);
      expect(context).toMatchObject({
        current_task: { id: task.id, label: 'Ship board-as-memory hooks', status: 'in_progress' },
        linked_doc: { title: 'Design: hooks', status_line: 'Ready to implement', body: 'the plan' },
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
});

import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { getRequestListener } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp, createEventBus, createServices, type PlankDeskEvent } from '@plandesk/api';
import {
  createDb,
  createEdge,
  createProject,
  createTask,
  createToken,
  createDocument,
  createDocumentComment,
  listTasks,
  updateDocumentComment,
  migrate,
  revokeToken,
  verifyToken,
  type Db,
} from '@plandesk/db';
import {
  createSyncDb,
  createSyncServer,
  createSyncToken,
  migrate as migrateSyncServer,
} from '@plandesk/sync-server';
import { v1ToolNames } from './tools/registry.js';
import { createMcpApp } from './server.js';

function createTestTokenStore(db: Db) {
  return {
    verify(raw: string) {
      return verifyToken(db, raw);
    },
  };
}

async function withMcpServer(
  run: (ctx: {
    baseUrl: string;
    db: Db;
    token: string;
    projectId: string;
    app: ReturnType<typeof createApp>;
    eventBus: ReturnType<typeof createEventBus>;
    services: ReturnType<typeof createServices>;
  }) => Promise<void>,
): Promise<void> {
  const db = createDb(':memory:');
  migrate(db);
  const project = createProject(db, { name: 'MCP Test Project', description: 'via MCP' });
  const { token } = createToken(db, { name: 'test' });

  const eventBus = createEventBus();
  const services = createServices({ db, eventBus });
  const mcpApp = createMcpApp({ services, tokenStore: createTestTokenStore(db) });
  const app = createApp({ db, eventBus, services, mcp: mcpApp });

  const server = createServer((req, res) => {
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
    await run({ baseUrl, db, token, projectId: project.id, app, eventBus, services });
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

async function connectClient(baseUrl: string, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  const client = new Client({ name: 'plandesk-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

describe('createMcpApp', () => {
  const servers: Server[] = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  it('returns 401 without Authorization header', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    });
  });

  it('regression: MCP token revoke → subsequent MCP call returns 401', async () => {
    await withMcpServer(async ({ baseUrl, db }) => {
      const row = createToken(db, { name: 'revoke-me' });
      revokeToken(db, row.id);

      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${row.token}` },
      });
      expect(res.status).toBe(401);
    });
  });

  it('cmd:mcp_list_tools lists all v1 tools', async () => {
    await withMcpServer(async ({ baseUrl, token }) => {
      const client = await connectClient(baseUrl, token);
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([...v1ToolNames].sort());
      expect(names).toHaveLength(23);
      await client.close();
    });
  });

  it('lists read tools and get_project returns snake_case project detail', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId }) => {
      const client = await connectClient(baseUrl, token);

      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([...v1ToolNames].sort());

      const listed = await client.callTool({ name: 'list_projects', arguments: {} });
      const listContent = listed.content as Array<{ type: string; text?: string }>;
      const listText = listContent[0]?.type === 'text' ? (listContent[0].text ?? '{}') : '{}';
      const listPayload = JSON.parse(listText) as {
        projects: Array<{ id: string; name: string; created_at: string; updated_at: string }>;
      };
      expect(listPayload.projects.some((p) => p.id === projectId)).toBe(true);
      expect(listPayload.projects[0]).toHaveProperty('created_at');

      const detail = await client.callTool({
        name: 'get_project',
        arguments: { project_id: projectId },
      });
      const detailContent = detail.content as Array<{ type: string; text?: string }>;
      const detailText = detailContent[0]?.type === 'text' ? (detailContent[0].text ?? '{}') : '{}';
      const detailPayload = JSON.parse(detailText) as {
        project: { id: string; name: string; summary: Record<string, number> };
      };
      expect(detailPayload.project.id).toBe(projectId);
      expect(detailPayload.project.summary).toBeTruthy();

      await client.close();
    });
  });

  it('test:mcp_update_task updates via MCP, REST reflects change, SSE fires', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db, app, eventBus }) => {
      const task = createTask(db, { projectId, label: 'MCP task', status: 'todo' });
      const received: PlankDeskEvent[] = [];
      eventBus.subscribe((event) => {
        received.push(event);
      });

      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'update_task',
        arguments: { task_id: task.id, status: 'in_progress' },
      });
      expect(result.isError).not.toBe(true);

      const tasksRes = await app.request(`/api/v1/projects/${projectId}/tasks`);
      expect(tasksRes.status).toBe(200);
      const tasks = (await tasksRes.json()) as Array<{ id: string; status: string }>;
      expect(tasks.find((row) => row.id === task.id)?.status).toBe('in_progress');

      expect(received).toContainEqual({
        type: 'task_updated',
        taskId: task.id,
        projectId,
      });

      await client.close();
    });
  });

  it('update_task returns tool error for missing task', async () => {
    await withMcpServer(async ({ baseUrl, token }) => {
      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'update_task',
        arguments: {
          task_id: '00000000-0000-4000-8000-000000009999',
          status: 'done',
        },
      });
      expect(result.isError).toBe(true);
      await client.close();
    });
  });

  it('update_task returns invalid_argument for bad status', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const task = createTask(db, { projectId, label: 'Bad status' });
      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'update_task',
        arguments: { task_id: task.id, status: 'invalid' },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '') : '';
      expect(text).toMatch(/invalid/i);
      await client.close();
    });
  });

  it('returns tool error for missing project', async () => {
    await withMcpServer(async ({ baseUrl, token }) => {
      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'get_project',
        arguments: { project_id: '00000000-0000-4000-8000-000000009999' },
      });
      expect(result.isError).toBe(true);
      await client.close();
    });
  });

  it('create_project, get_document, and list_documents work via MCP', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const client = await connectClient(baseUrl, token);

      const createdProject = await client.callTool({
        name: 'create_project',
        arguments: { name: 'MCP Created', description: 'from MCP' },
      });
      expect(createdProject.isError).not.toBe(true);
      const createdContent = createdProject.content as Array<{ type: string; text?: string }>;
      const createdText =
        createdContent[0]?.type === 'text' ? (createdContent[0].text ?? '{}') : '{}';
      const createdPayload = JSON.parse(createdText) as {
        project: { id: string; name: string; description: string | null };
      };
      expect(createdPayload.project.name).toBe('MCP Created');

      const doc = createDocument(db, {
        projectId,
        title: 'MCP Doc',
        body: '# Body',
        statusLine: 'Status: ok',
      });

      const gotDoc = await client.callTool({
        name: 'get_document',
        arguments: { document_id: doc.id },
      });
      expect(gotDoc.isError).not.toBe(true);
      const gotContent = gotDoc.content as Array<{ type: string; text?: string }>;
      const gotText = gotContent[0]?.type === 'text' ? (gotContent[0].text ?? '{}') : '{}';
      const gotPayload = JSON.parse(gotText) as {
        document: {
          id: string;
          title: string;
          body: string | null;
          status_line: string | null;
          linked_task_id: string | null;
          parent_id: string | null;
        };
      };
      expect(gotPayload.document).toMatchObject({
        id: doc.id,
        title: 'MCP Doc',
        body: '# Body',
        status_line: 'Status: ok',
      });

      const listed = await client.callTool({
        name: 'list_documents',
        arguments: { project_id: projectId },
      });
      expect(listed.isError).not.toBe(true);
      const listContent = listed.content as Array<{ type: string; text?: string }>;
      const listText = listContent[0]?.type === 'text' ? (listContent[0].text ?? '[]') : '[]';
      const listPayload = JSON.parse(listText) as {
        documents: Array<{ id: string; title: string }>;
      };
      expect(listPayload.documents.some((entry) => entry.id === doc.id)).toBe(true);

      await client.close();
    });
  });

  it('scaffold_project_from_plan creates project atomically via MCP', async () => {
    await withMcpServer(async ({ baseUrl, token, db, eventBus }) => {
      const received: PlankDeskEvent[] = [];
      eventBus.subscribe((event) => {
        received.push(event);
      });

      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'scaffold_project_from_plan',
        arguments: {
          name: 'MCP Scaffold',
          description: 'one shot',
          tasks: [
            { key: 'setup', label: 'Setup', status: 'done' },
            { key: 'build', label: 'Build' },
          ],
          edges: [{ from: 'setup', to: 'build', label: 'blocks' }],
          documents: [{ title: 'Plan', body: '# Plan', link_to: 'build' }],
        },
      });
      expect(result.isError).not.toBe(true);

      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '{}') : '{}';
      const payload = JSON.parse(text) as {
        scaffold: {
          project: { id: string; name: string };
          counts: { tasks: number; edges: number; documents: number };
          key_to_id: Record<string, string>;
          tasks: Array<{ x: number; y: number }>;
        };
      };
      expect(payload.scaffold.project.name).toBe('MCP Scaffold');
      expect(payload.scaffold.counts).toEqual({ tasks: 2, edges: 1, documents: 1 });
      expect(payload.scaffold.key_to_id.setup).toBeTruthy();
      expect(payload.scaffold.tasks[1]).toMatchObject({ x: 240, y: 0 });
      expect(listTasks(db, payload.scaffold.project.id)).toHaveLength(2);
      expect(received.some((e) => e.type === 'canvas_updated')).toBe(true);
      expect(received.filter((e) => e.type === 'document_created')).toHaveLength(1);

      await client.close();
    });
  });

  it('scaffold_project_from_plan returns invalid_argument for duplicate keys', async () => {
    await withMcpServer(async ({ baseUrl, token }) => {
      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'scaffold_project_from_plan',
        arguments: {
          name: 'Bad',
          tasks: [
            { key: 'dup', label: 'One' },
            { key: 'dup', label: 'Two' },
          ],
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '') : '';
      expect(text).toMatch(/invalid_argument/i);
      await client.close();
    });
  });

  it('get_next_task returns actionable task and blocked context', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const actionable = createTask(db, { projectId, label: 'Actionable', status: 'todo' });
      const prerequisite = createTask(db, { projectId, label: 'Prerequisite', status: 'todo' });
      const blocked = createTask(db, { projectId, label: 'Blocked', status: 'todo' });
      createEdge(db, {
        projectId,
        fromTaskId: prerequisite.id,
        toTaskId: blocked.id,
        label: 'blocks',
      });

      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'get_next_task',
        arguments: { project_id: projectId },
      });
      expect(result.isError).not.toBe(true);

      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '{}') : '{}';
      const payload = JSON.parse(text) as {
        next: {
          reason: string;
          next_task: { id: string; label: string } | null;
          blocked: Array<{ task: { id: string }; waiting_on: Array<{ id: string }> }>;
        };
      };
      expect(payload.next.reason).toBe('ok');
      expect(payload.next.next_task?.id).toBe(actionable.id);
      expect(payload.next.blocked).toHaveLength(1);
      expect(payload.next.blocked[0]?.task.id).toBe(blocked.id);
      expect(payload.next.blocked[0]?.waiting_on.map((task) => task.id)).toEqual([prerequisite.id]);

      await client.close();
    });
  });

  it('get_next_task returns not_found for missing project', async () => {
    await withMcpServer(async ({ baseUrl, token }) => {
      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'get_next_task',
        arguments: { project_id: '00000000-0000-4000-8000-000000009999' },
      });
      expect(result.isError).toBe(true);
      await client.close();
    });
  });

  it('list_comments, add_comment, and resolve_comment work via MCP', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db, eventBus }) => {
      const received: PlankDeskEvent[] = [];
      eventBus.subscribe((event) => {
        received.push(event);
      });

      const doc = createDocument(db, { projectId, title: 'Review doc' });
      const resolved = createDocumentComment(db, { documentId: doc.id, body: 'Already done' });
      updateDocumentComment(db, resolved.id, { resolved: true });
      const open = createDocumentComment(db, { documentId: doc.id, body: 'Still open' });

      const client = await connectClient(baseUrl, token);

      const listed = await client.callTool({
        name: 'list_comments',
        arguments: { project_id: projectId },
      });
      expect(listed.isError).not.toBe(true);
      const listContent = listed.content as Array<{ type: string; text?: string }>;
      const listText = listContent[0]?.type === 'text' ? (listContent[0].text ?? '[]') : '[]';
      const listPayload = JSON.parse(listText) as {
        comments: Array<{ id: string; body: string; resolved: boolean }>;
      };
      expect(listPayload.comments).toHaveLength(1);
      expect(listPayload.comments[0]?.id).toBe(open.id);
      expect(listPayload.comments[0]?.resolved).toBe(false);

      const added = await client.callTool({
        name: 'add_comment',
        arguments: { document_id: doc.id, body: 'Agent suggestion', passage: '§3' },
      });
      expect(added.isError).not.toBe(true);
      const addedContent = added.content as Array<{ type: string; text?: string }>;
      const addedText = addedContent[0]?.type === 'text' ? (addedContent[0].text ?? '{}') : '{}';
      const addedPayload = JSON.parse(addedText) as {
        comment: { id: string; body: string; passage: string | null };
      };
      expect(addedPayload.comment.body).toBe('Agent suggestion');
      expect(addedPayload.comment.passage).toBe('§3');
      expect(received.some((e) => e.type === 'comment_created')).toBe(true);

      const resolvedResult = await client.callTool({
        name: 'resolve_comment',
        arguments: { comment_id: addedPayload.comment.id },
      });
      expect(resolvedResult.isError).not.toBe(true);
      const resolvedContent = resolvedResult.content as Array<{ type: string; text?: string }>;
      const resolvedText =
        resolvedContent[0]?.type === 'text' ? (resolvedContent[0].text ?? '{}') : '{}';
      const resolvedPayload = JSON.parse(resolvedText) as {
        comment: { resolved: boolean };
      };
      expect(resolvedPayload.comment.resolved).toBe(true);

      await client.close();
    });
  });

  it('list_comments rejects cross-project document_id', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const otherProject = createProject(db, { name: 'Other project' });
      const foreignDoc = createDocument(db, { projectId: otherProject.id, title: 'Foreign' });

      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'list_comments',
        arguments: { project_id: projectId, document_id: foreignDoc.id },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '') : '';
      expect(text).toMatch(/invalid_argument/i);
      await client.close();
    });
  });

  it('add_comment returns invalid_argument for empty body', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const doc = createDocument(db, { projectId, title: 'Doc' });
      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'add_comment',
        arguments: { document_id: doc.id, body: '   ' },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '') : '';
      expect(text).toMatch(/invalid_argument/i);
      await client.close();
    });
  });

  it('sync_push without publish returns invalid_argument', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId }) => {
      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'sync_push',
        arguments: { project_id: projectId },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '') : '';
      expect(text).toMatch(/invalid_argument/i);
      expect(text).toMatch(/publish_project/i);
      await client.close();
    });
  });

  it('publish_project round-trips sync loop through triage accept', async () => {
    const syncDb = createSyncDb(':memory:');
    migrateSyncServer(syncDb);
    const { token: syncToken } = createSyncToken(syncDb, { label: 'mcp-test' });
    const syncApp = createSyncServer({ db: syncDb });
    const syncServer = createServer((req, res) => {
      void getRequestListener(syncApp.fetch)(req, res);
    });

    await new Promise<void>((resolve) => {
      syncServer.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });

    const syncAddress = syncServer.address();
    if (syncAddress === null || typeof syncAddress !== 'object') {
      throw new Error('expected sync server address');
    }
    const syncServerUrl = `http://127.0.0.1:${String(syncAddress.port)}`;

    try {
      await withMcpServer(async ({ baseUrl, token, projectId, app, services }) => {
        const share = services.shareService.createShare(projectId, {
          audienceName: 'Client',
          mode: 'public',
          permissions: { read: true, submit: true },
        });
        if (!share) {
          throw new Error('expected share');
        }

        const client = await connectClient(baseUrl, token);

        const emptyList = await client.callTool({
          name: 'list_submissions',
          arguments: { project_id: projectId },
        });
        expect(emptyList.isError).not.toBe(true);
        const emptyContent = emptyList.content as Array<{ type: string; text?: string }>;
        const emptyText = emptyContent[0]?.type === 'text' ? (emptyContent[0].text ?? '[]') : '[]';
        const emptyPayload = JSON.parse(emptyText) as { submissions: unknown[] };
        expect(emptyPayload.submissions).toEqual([]);

        const published = await client.callTool({
          name: 'publish_project',
          arguments: {
            project_id: projectId,
            server_url: syncServerUrl,
            sync_token: syncToken,
          },
        });
        expect(published.isError).not.toBe(true);
        const publishedContent = published.content as Array<{ type: string; text?: string }>;
        const publishedText =
          publishedContent[0]?.type === 'text' ? (publishedContent[0].text ?? '{}') : '{}';
        const publishedPayload = JSON.parse(publishedText) as {
          global_project_id: string;
          pushed: number;
        };
        expect(publishedPayload.pushed).toBeGreaterThan(0);
        expect(publishedPayload.global_project_id).toBeTruthy();

        const joinRes = await fetch(`${syncServerUrl}/api/portal/v1/shares/${share.token}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Alex' }),
        });
        expect(joinRes.status).toBe(200);
        const { session_token: sessionToken } = (await joinRes.json()) as {
          session_token: string;
        };

        const viewRes = await fetch(`${syncServerUrl}/api/portal/v1/shares/${share.token}/view`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        expect(viewRes.status).toBe(200);

        const submitRes = await fetch(
          `${syncServerUrl}/api/portal/v1/shares/${share.token}/submissions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${sessionToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: 'Client bug', body: 'Broken flow' }),
          },
        );
        expect(submitRes.status).toBe(201);
        const { submission: hostedSubmission } = (await submitRes.json()) as {
          submission: { id: string };
        };

        const pulled = await client.callTool({
          name: 'sync_pull',
          arguments: { project_id: projectId },
        });
        expect(pulled.isError).not.toBe(true);
        const pulledContent = pulled.content as Array<{ type: string; text?: string }>;
        const pulledText =
          pulledContent[0]?.type === 'text' ? (pulledContent[0].text ?? '{}') : '{}';
        const pulledPayload = JSON.parse(pulledText) as { pulled: number };
        expect(pulledPayload.pulled).toBe(1);

        const pending = await client.callTool({
          name: 'list_submissions',
          arguments: { project_id: projectId, status: 'pending' },
        });
        expect(pending.isError).not.toBe(true);
        const pendingContent = pending.content as Array<{ type: string; text?: string }>;
        const pendingText =
          pendingContent[0]?.type === 'text' ? (pendingContent[0].text ?? '[]') : '[]';
        const pendingPayload = JSON.parse(pendingText) as {
          submissions: Array<{ id: string; status: string; title: string }>;
        };
        expect(pendingPayload.submissions).toHaveLength(1);
        expect(pendingPayload.submissions[0]?.id).toBe(hostedSubmission.id);
        expect(pendingPayload.submissions[0]?.status).toBe('pending');

        const triaged = await client.callTool({
          name: 'triage_submission',
          arguments: {
            submission_id: hostedSubmission.id,
            action: 'accept',
            as_task: { label: 'Fix client bug', status: 'todo' },
          },
        });
        expect(triaged.isError).not.toBe(true);
        const triagedContent = triaged.content as Array<{ type: string; text?: string }>;
        const triagedText =
          triagedContent[0]?.type === 'text' ? (triagedContent[0].text ?? '{}') : '{}';
        const triagedPayload = JSON.parse(triagedText) as {
          submission: { status: string; linked_task_id: string | null };
        };
        expect(triagedPayload.submission.status).toBe('accepted');
        expect(triagedPayload.submission.linked_task_id).toBeTruthy();

        const projectRes = await app.request(`/api/v1/projects/${projectId}`);
        expect(projectRes.status).toBe(200);
        const projectBody = (await projectRes.json()) as {
          summary: Record<string, number>;
        };
        expect(projectBody.summary.todo).toBeGreaterThanOrEqual(1);

        const participantListRes = await fetch(
          `${syncServerUrl}/api/portal/v1/shares/${share.token}/submissions`,
          { headers: { Authorization: `Bearer ${sessionToken}` } },
        );
        expect(participantListRes.status).toBe(200);
        const participantRows = (await participantListRes.json()) as Array<{
          id: string;
          status: string;
        }>;
        expect(participantRows.find((row) => row.id === hostedSubmission.id)?.status).toBe(
          'accepted',
        );

        await client.close();
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        syncServer.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    }
  });

  it('resolve_comment returns not_found for missing comment', async () => {
    await withMcpServer(async ({ baseUrl, token }) => {
      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'resolve_comment',
        arguments: { comment_id: '00000000-0000-4000-8000-000000009999' },
      });
      expect(result.isError).toBe(true);
      await client.close();
    });
  });
});

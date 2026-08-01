import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { getRequestListener } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp, createServices, createBetterAuth, runBetterAuthMigrations, ensureLocalBetterAuthOrganization } from '@plandesk/api';
import {
  createDb,
  createEdge,
  createProjectInDefaultOrg as createProject,
  createDocument,
  createComment,
  listEdges,
  listTasks,
  updateComment,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { z } from 'zod';
import { v1ToolNames, getDocumentOutputSchema, listEdgesOutputSchema, createEdgeOutputSchema } from './tools/registry.js';
import { createMcpApp } from './server.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

async function withMcpServer(
  run: (ctx: {
    baseUrl: string;
    db: Db;
    token: string;
    projectId: string;
    app: ReturnType<typeof createApp>;
    services: ReturnType<typeof createServices>;
  }) => Promise<void>,
): Promise<void> {
  const db = await createDb(':memory:');
  await migrate(db);
  const auth = createBetterAuth({
    client: db.$client,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
  });
  if (auth !== undefined) {
    await runBetterAuthMigrations(auth);
    await ensureLocalBetterAuthOrganization(db, auth);
  }
  const project = await createProject(db, { name: 'MCP Test Project', description: 'via MCP' });
  const token = '';

  const services = createServices({ db, orgId: project.orgId, auth });
  // Auth comes from parent createApp (loopback owner on 127.0.0.1).
  const mcpApp = createMcpApp({ services });
  // Default bindHost is loopback (local zero-token). Invalid bearer → 401.
  const app = createApp({ db, services, mcp: mcpApp, bindHost: '127.0.0.1', betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL } });

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
    await run({ baseUrl, db, token, projectId: project.id, app, services });
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

async function connectClient(baseUrl: string, token?: string): Promise<Client> {
  // BA7-1a: loopback owner needs no bearer. Only send Authorization when the
  // test is exercising a specific credential (invalid/revoked token).
  const requestInit =
    token !== undefined && token !== ''
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined;
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    requestInit === undefined ? undefined : { requestInit },
  );
  const client = new Client({ name: 'plandesk-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

function parseDocumentResult(result: unknown): {
  id: string;
  title: string;
  links?: Array<{ type: string; id: string; title: string; label: string | null; edge_id: string }>;
  backlinks?: Array<{ type: string; id: string; title: string; label: string | null; edge_id: string }>;
} {
  const content = (result as { content: unknown }).content as Array<{
    type: string;
    text?: string;
  }>;
  const text = content[0]?.type === 'text' ? (content[0].text ?? '{}') : '{}';
  return (
    JSON.parse(text) as {
      document: {
        id: string;
        title: string;
        links?: Array<{ type: string; id: string; title: string; label: string | null; edge_id: string }>;
        backlinks?: Array<{ type: string; id: string; title: string; label: string | null; edge_id: string }>;
      };
    }
  ).document;
}

describe('createMcpApp', () => {
  const servers: Server[] = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  it('returns 401 for an invalid bearer token', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { Authorization: 'Bearer plandesk_mcp_not-a-real-token' },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    });
  });

  it('regression: non-better-auth bearer → subsequent MCP call returns 401', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { Authorization: 'Bearer plandesk_mcp_revoked_or_unknown' },
      });
      expect(res.status).toBe(401);
    });
  });

  it('cmd:mcp_list_tools lists all v1 tools', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const client = await connectClient(baseUrl);
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([...v1ToolNames].sort());
      expect(names).toHaveLength(50);
      await client.close();
    });
  });

  it('lists read tools and get_project returns snake_case project detail', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {
      const client = await connectClient(baseUrl);

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

  it('test:mcp_update_task updates via MCP, REST reflects change', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db, app }) => {
      const task = await createTask(db, { projectId, label: 'MCP task', status: 'todo' });

      const client = await connectClient(baseUrl);
      const result = await client.callTool({
        name: 'update_task',
        arguments: { task_id: task.id, status: 'in_progress' },
      });
      expect(result.isError).not.toBe(true);

      const tasksRes = await app.request(`/api/v1/projects/${projectId}/tasks`);
      expect(tasksRes.status).toBe(200);
      const tasks = (await tasksRes.json()) as Array<{ id: string; status: string }>;
      expect(tasks.find((row) => row.id === task.id)?.status).toBe('in_progress');

      await client.close();
    });
  });

  it('update_task returns tool error for missing task', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const client = await connectClient(baseUrl);
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
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const task = await createTask(db, { projectId, label: 'Bad status' });
      const client = await connectClient(baseUrl);
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
    await withMcpServer(async ({ baseUrl }) => {
      const client = await connectClient(baseUrl);
      const result = await client.callTool({
        name: 'get_project',
        arguments: { project_id: '00000000-0000-4000-8000-000000009999' },
      });
      expect(result.isError).toBe(true);
      await client.close();
    });
  });

  it('create_project / get_project / update_project round-trip repo_url and folder_path', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const client = await connectClient(baseUrl);

      const bound = await client.callTool({
        name: 'create_project',
        arguments: {
          name: 'Bound MCP',
          repo_url: 'https://github.com/acme/plandesk',
          folder_path: 'packages/plandesk-mcp',
        },
      });
      expect(bound.isError).not.toBe(true);
      const boundContent = bound.content as Array<{ type: string; text?: string }>;
      const boundText = boundContent[0]?.type === 'text' ? (boundContent[0].text ?? '{}') : '{}';
      const boundProject = (
        JSON.parse(boundText) as {
          project: {
            id: string;
            repo_url: string | null;
            folder_path: string | null;
          };
        }
      ).project;
      expect(boundProject.repo_url).toBe('https://github.com/acme/plandesk');
      expect(boundProject.folder_path).toBe('packages/plandesk-mcp');

      const gotBound = await client.callTool({
        name: 'get_project',
        arguments: { project_id: boundProject.id },
      });
      const gotBoundContent = gotBound.content as Array<{ type: string; text?: string }>;
      const gotBoundText =
        gotBoundContent[0]?.type === 'text' ? (gotBoundContent[0].text ?? '{}') : '{}';
      const gotBoundProject = (
        JSON.parse(gotBoundText) as {
          project: { repo_url: string | null; folder_path: string | null };
        }
      ).project;
      expect(gotBoundProject.repo_url).toBe('https://github.com/acme/plandesk');
      expect(gotBoundProject.folder_path).toBe('packages/plandesk-mcp');

      const bare = await client.callTool({
        name: 'create_project',
        arguments: { name: 'Bare MCP' },
      });
      expect(bare.isError).not.toBe(true);
      const bareContent = bare.content as Array<{ type: string; text?: string }>;
      const bareText = bareContent[0]?.type === 'text' ? (bareContent[0].text ?? '{}') : '{}';
      const bareProject = (
        JSON.parse(bareText) as {
          project: { id: string; repo_url: string | null; folder_path: string | null };
        }
      ).project;
      expect(bareProject.repo_url).toBeNull();
      expect(bareProject.folder_path).toBeNull();

      const cleared = await client.callTool({
        name: 'update_project',
        arguments: { project_id: boundProject.id, repo_url: null },
      });
      expect(cleared.isError).not.toBe(true);
      const clearedContent = cleared.content as Array<{ type: string; text?: string }>;
      const clearedText =
        clearedContent[0]?.type === 'text' ? (clearedContent[0].text ?? '{}') : '{}';
      const clearedProject = (
        JSON.parse(clearedText) as {
          project: { repo_url: string | null; folder_path: string | null };
        }
      ).project;
      expect(clearedProject.repo_url).toBeNull();
      expect(clearedProject.folder_path).toBe('packages/plandesk-mcp');

      const gotCleared = await client.callTool({
        name: 'get_project',
        arguments: { project_id: boundProject.id },
      });
      const gotClearedContent = gotCleared.content as Array<{ type: string; text?: string }>;
      const gotClearedText =
        gotClearedContent[0]?.type === 'text' ? (gotClearedContent[0].text ?? '{}') : '{}';
      const gotClearedProject = (
        JSON.parse(gotClearedText) as {
          project: { repo_url: string | null; folder_path: string | null };
        }
      ).project;
      expect(gotClearedProject.repo_url).toBeNull();
      expect(gotClearedProject.folder_path).toBe('packages/plandesk-mcp');

      await client.close();
    });
  });

  it('create_project, get_document, and list_documents work via MCP', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);

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

      const doc = await createDocument(db, {
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

  it('create_document and update_document persist links via link_to (round-trip)', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);
      const task = await createTask(db, { projectId, label: 'Link target' });
      const other = await createTask(db, { projectId, label: 'Other target' });

      const created = await client.callTool({
        name: 'create_document',
        arguments: { project_id: projectId, title: 'Spec', link_to: task.id },
      });
      expect(created.isError).not.toBe(true);
      const createdDoc = parseDocumentResult(created);
      expect(createdDoc.links?.map((l) => l.id)).toEqual([task.id]);

      const updated = await client.callTool({
        name: 'update_document',
        arguments: { document_id: createdDoc.id, link_to: other.id },
      });
      expect(updated.isError).not.toBe(true);
      const updatedDoc = parseDocumentResult(updated);
      // link_to is additive for new targets
      expect(updatedDoc.links?.map((l) => l.id).sort()).toEqual([task.id, other.id].sort());

      await client.close();
    });
  });

  it('create_folder, update_folder, and folder-aware documents work via MCP', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {

      const client = await connectClient(baseUrl);

      const createdFolder = await client.callTool({
        name: 'create_folder',
        arguments: { project_id: projectId, name: 'Specs' },
      });
      expect(createdFolder.isError).not.toBe(true);
      const createdFolderContent = createdFolder.content as Array<{ type: string; text?: string }>;
      const createdFolderText =
        createdFolderContent[0]?.type === 'text' ? (createdFolderContent[0].text ?? '{}') : '{}';
      const createdFolderPayload = JSON.parse(createdFolderText) as {
        folder: { id: string; project_id: string; name: string; parent_folder_id: string | null };
      };
      expect(createdFolderPayload.folder.name).toBe('Specs');
      expect(createdFolderPayload.folder.project_id).toBe(projectId);
      expect(createdFolderPayload.folder.parent_folder_id).toBeNull();
      const folderId = createdFolderPayload.folder.id;

      const createdChild = await client.callTool({
        name: 'create_folder',
        arguments: { project_id: projectId, name: 'Archive', parent_folder_id: folderId },
      });
      const createdChildContent = createdChild.content as Array<{ type: string; text?: string }>;
      const createdChildText =
        createdChildContent[0]?.type === 'text' ? (createdChildContent[0].text ?? '{}') : '{}';
      const childPayload = JSON.parse(createdChildText) as {
        folder: { id: string; parent_folder_id: string | null };
      };
      expect(childPayload.folder.parent_folder_id).toBe(folderId);
      const childId = childPayload.folder.id;

      const renamed = await client.callTool({
        name: 'update_folder',
        arguments: { folder_id: childId, name: 'Old specs' },
      });
      const renamedContent = renamed.content as Array<{ type: string; text?: string }>;
      const renamedText =
        renamedContent[0]?.type === 'text' ? (renamedContent[0].text ?? '{}') : '{}';
      expect((JSON.parse(renamedText) as { folder: { name: string } }).folder.name).toBe(
        'Old specs',
      );

      const cycle = await client.callTool({
        name: 'update_folder',
        arguments: { folder_id: folderId, parent_folder_id: childId },
      });
      expect(cycle.isError).toBe(true);
      const cycleContent = cycle.content as Array<{ type: string; text?: string }>;
      const cycleText = cycleContent[0]?.type === 'text' ? (cycleContent[0].text ?? '{}') : '{}';
      expect((JSON.parse(cycleText) as { error: string }).error).toBe('invalid_argument');

      const createdDoc = await client.callTool({
        name: 'create_document',
        arguments: { project_id: projectId, title: 'In folder', folder_id: folderId },
      });
      expect(createdDoc.isError).not.toBe(true);
      const createdDocContent = createdDoc.content as Array<{ type: string; text?: string }>;
      const createdDocText =
        createdDocContent[0]?.type === 'text' ? (createdDocContent[0].text ?? '{}') : '{}';
      const docPayload = JSON.parse(createdDocText) as {
        document: { id: string; folder_id: string | null };
      };
      expect(docPayload.document.folder_id).toBe(folderId);
      const docId = docPayload.document.id;

      await client.callTool({
        name: 'create_document',
        arguments: { project_id: projectId, title: 'At root' },
      });

      const filtered = await client.callTool({
        name: 'list_documents',
        arguments: { project_id: projectId, folder_id: folderId },
      });
      const filteredContent = filtered.content as Array<{ type: string; text?: string }>;
      const filteredText =
        filteredContent[0]?.type === 'text' ? (filteredContent[0].text ?? '{}') : '{}';
      const filteredPayload = JSON.parse(filteredText) as {
        documents: Array<{ id: string; title: string }>;
      };
      expect(filteredPayload.documents.map((entry) => entry.id)).toEqual([docId]);

      const tree = await client.callTool({
        name: 'list_documents',
        arguments: { project_id: projectId },
      });
      const treeContent = tree.content as Array<{ type: string; text?: string }>;
      const treeText = treeContent[0]?.type === 'text' ? (treeContent[0].text ?? '{}') : '{}';
      const treePayload = JSON.parse(treeText) as {
        documents: Array<{ title: string }>;
        folders: Array<{
          id: string;
          name: string;
          folders: Array<{ name: string }>;
          documents: Array<{ id: string }>;
        }>;
      };
      expect(treePayload.documents.some((entry) => entry.title === 'At root')).toBe(true);
      const specsNode = treePayload.folders.find((entry) => entry.id === folderId);
      expect(specsNode?.documents.map((entry) => entry.id)).toEqual([docId]);
      expect(specsNode?.folders.map((entry) => entry.name)).toEqual(['Old specs']);

      const moved = await client.callTool({
        name: 'update_document',
        arguments: { document_id: docId, folder_id: null },
      });
      const movedContent = moved.content as Array<{ type: string; text?: string }>;
      const movedText = movedContent[0]?.type === 'text' ? (movedContent[0].text ?? '{}') : '{}';
      expect(
        (JSON.parse(movedText) as { document: { folder_id: string | null } }).document.folder_id,
      ).toBeNull();

      await client.close();
    });
  });

  it('list_tasks(compact) omits description; full mode is unchanged (#28)', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);
      try {
        await createTask(db, { projectId, label: 'With body', description: 'a long spec body' });

        const full = await client.callTool({
          name: 'list_tasks',
          arguments: { project_id: projectId },
        });
        const fullPayload = JSON.parse(
          (full.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as { tasks: Array<{ description: string | null; label: string }> };
        expect(fullPayload.tasks[0]?.description).toBe('a long spec body');

        const compact = await client.callTool({
          name: 'list_tasks',
          arguments: { project_id: projectId, compact: true },
        });
        const compactPayload = JSON.parse(
          (compact.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as { tasks: Array<Record<string, unknown>> };
        expect(compactPayload.tasks[0]?.label).toBe('With body');
        expect(compactPayload.tasks[0]).not.toHaveProperty('description');
      } finally {
        await client.close();
      }
    });
  });

  it('list_documents(compact) omits body in both flat and tree shapes; full mode is unchanged (#28)', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);
      try {
        const folderRes = await client.callTool({
          name: 'create_folder',
          arguments: { project_id: projectId, name: 'Specs' },
        });
        const folderId = (
          JSON.parse(
            (folderRes.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
          ) as { folder: { id: string } }
        ).folder.id;
        await createDocument(db, {
          projectId,
          title: 'In folder',
          body: '<p>secret body</p>',
          folderId,
        });
        await createDocument(db, { projectId, title: 'At root', body: '<p>root body</p>' });

        const fullTree = await client.callTool({
          name: 'list_documents',
          arguments: { project_id: projectId },
        });
        const fullTreePayload = JSON.parse(
          (fullTree.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as {
          documents: Array<{ body: string | null }>;
          folders: Array<{ documents: Array<{ body: string | null }> }>;
        };
        expect(fullTreePayload.documents[0]?.body).toBe('<p>root body</p>');
        expect(fullTreePayload.folders[0]?.documents[0]?.body).toBe('<p>secret body</p>');

        const compactTree = await client.callTool({
          name: 'list_documents',
          arguments: { project_id: projectId, compact: true },
        });
        const compactTreePayload = JSON.parse(
          (compactTree.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as {
          documents: Array<Record<string, unknown>>;
          folders: Array<{ documents: Array<Record<string, unknown>> }>;
        };
        expect(compactTreePayload.documents[0]?.title).toBe('At root');
        expect(compactTreePayload.documents[0]).not.toHaveProperty('body');
        expect(compactTreePayload.folders[0]?.documents[0]).not.toHaveProperty('body');

        const compactFlat = await client.callTool({
          name: 'list_documents',
          arguments: { project_id: projectId, folder_id: folderId, compact: true },
        });
        const compactFlatPayload = JSON.parse(
          (compactFlat.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as { documents: Array<Record<string, unknown>> };
        expect(compactFlatPayload.documents[0]?.title).toBe('In folder');
        expect(compactFlatPayload.documents[0]).not.toHaveProperty('body');
      } finally {
        await client.close();
      }
    });
  });

  it('create_folder returns not_found for missing project and invalid_argument for blank name', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {
      const client = await connectClient(baseUrl);

      const missing = await client.callTool({
        name: 'create_folder',
        arguments: { project_id: '00000000-0000-4000-8000-000000009999', name: 'Orphan' },
      });
      expect(missing.isError).toBe(true);

      const blank = await client.callTool({
        name: 'create_folder',
        arguments: { project_id: projectId, name: '   ' },
      });
      expect(blank.isError).toBe(true);

      await client.close();
    });
  });

  it('create_note, list_notes, get_note, and update_note work via MCP', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {

      const client = await connectClient(baseUrl);

      const created = await client.callTool({
        name: 'create_note',
        arguments: { project_id: projectId, title: 'Findings', body: '## Heading\n\nbody text' },
      });
      expect(created.isError).not.toBe(true);
      const createdContent = created.content as Array<{ type: string; text?: string }>;
      const createdText =
        createdContent[0]?.type === 'text' ? (createdContent[0].text ?? '{}') : '{}';
      const createdPayload = JSON.parse(createdText) as {
        note: { id: string; project_id: string; title: string; body: string | null };
      };
      expect(createdPayload.note.title).toBe('Findings');
      expect(createdPayload.note.project_id).toBe(projectId);
      // Markdown body is converted to rich-text HTML.
      expect(createdPayload.note.body).toContain('<h2>');
      const noteId = createdPayload.note.id;

      const listed = await client.callTool({
        name: 'list_notes',
        arguments: { project_id: projectId },
      });
      const listContent = listed.content as Array<{ type: string; text?: string }>;
      const listText = listContent[0]?.type === 'text' ? (listContent[0].text ?? '{}') : '{}';
      const listPayload = JSON.parse(listText) as { notes: Array<{ id: string }> };
      expect(listPayload.notes.some((n) => n.id === noteId)).toBe(true);

      const got = await client.callTool({ name: 'get_note', arguments: { note_id: noteId } });
      const gotContent = got.content as Array<{ type: string; text?: string }>;
      const gotText = gotContent[0]?.type === 'text' ? (gotContent[0].text ?? '{}') : '{}';
      expect((JSON.parse(gotText) as { note: { id: string } }).note.id).toBe(noteId);

      const updated = await client.callTool({
        name: 'update_note',
        arguments: { note_id: noteId, title: 'Renamed' },
      });
      const updatedContent = updated.content as Array<{ type: string; text?: string }>;
      const updatedText =
        updatedContent[0]?.type === 'text' ? (updatedContent[0].text ?? '{}') : '{}';
      expect((JSON.parse(updatedText) as { note: { title: string } }).note.title).toBe('Renamed');

      await client.close();
    });
  });

  it('create_note returns not_found for missing project and invalid_argument for blank title', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {
      const client = await connectClient(baseUrl);

      const missing = await client.callTool({
        name: 'create_note',
        arguments: { project_id: '00000000-0000-4000-8000-000000009999', title: 'Orphan' },
      });
      expect(missing.isError).toBe(true);

      const blank = await client.callTool({
        name: 'create_note',
        arguments: { project_id: projectId, title: '   ' },
      });
      expect(blank.isError).toBe(true);

      await client.close();
    });
  });

  it('attach_file uploads a file and the REST endpoint serves it back', async () => {
    await withMcpServer(async ({ baseUrl, projectId, app }) => {
      const client = await connectClient(baseUrl);
      const bytes = Buffer.from('fake-png-bytes', 'utf8');

      const result = await client.callTool({
        name: 'attach_file',
        arguments: {
          project_id: projectId,
          filename: 'shot.png',
          content_base64: bytes.toString('base64'),
        },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '{}') : '{}';
      const payload = JSON.parse(text) as { file: { file_id: string; url: string } };
      expect(payload.file.file_id).toBeTruthy();
      expect(payload.file.url).toBe(`/api/v1/files/${payload.file.file_id}`);

      const getRes = await app.request(payload.file.url);
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get('Content-Type')).toBe('image/png');
      const body = Buffer.from(await getRes.arrayBuffer());
      expect(body).toEqual(bytes);

      await client.close();
    });
  });

  it('create_artifact, get_artifact, update_artifact, and list_artifacts close the comment loop', async () => {
    await withMcpServer(async ({ baseUrl, projectId, app }) => {
      const client = await connectClient(baseUrl);

      const created = await client.callTool({
        name: 'create_artifact',
        arguments: {
          project_id: projectId,
          title: 'Design RFC',
          content: '# Architecture\n\nCSP details here.',
          kind: 'markdown',
        },
      });
      expect(created.isError).not.toBe(true);
      const createdContent = created.content as Array<{ type: string; text?: string }>;
      const createdText =
        createdContent[0]?.type === 'text' ? (createdContent[0].text ?? '{}') : '{}';
      const createdPayload = JSON.parse(createdText) as {
        artifact: { artifact_id: string; url: string };
      };
      expect(createdPayload.artifact.artifact_id).toBeTruthy();
      expect(createdPayload.artifact.url).toBe(
        `/api/v1/artifacts/${createdPayload.artifact.artifact_id}`,
      );

      const getRes = await app.request(createdPayload.artifact.url);
      expect(getRes.status).toBe(200);
      const fetched = (await getRes.json()) as { content: string };
      expect(fetched.content).toBe('# Architecture\n\nCSP details here.');

      const got = await client.callTool({
        name: 'get_artifact',
        arguments: { artifact_id: createdPayload.artifact.artifact_id },
      });
      expect(got.isError).not.toBe(true);

      const updated = await client.callTool({
        name: 'update_artifact',
        arguments: {
          artifact_id: createdPayload.artifact.artifact_id,
          content: '# Architecture\n\nRevised CSP details.',
        },
      });
      expect(updated.isError).not.toBe(true);

      const listed = await client.callTool({
        name: 'list_artifacts',
        arguments: { project_id: projectId },
      });
      expect(listed.isError).not.toBe(true);
      const listedContent = listed.content as Array<{ type: string; text?: string }>;
      const listedText =
        listedContent[0]?.type === 'text' ? (listedContent[0].text ?? '{}') : '{}';
      const listedPayload = JSON.parse(listedText) as {
        artifacts: Array<{ id: string; title: string }>;
      };
      expect(listedPayload.artifacts).toEqual([
        expect.objectContaining({ id: createdPayload.artifact.artifact_id, title: 'Design RFC' }),
      ]);

      const anchor = JSON.stringify({ type: 'TextQuoteSelector', exact: 'CSP' });
      const commented = await client.callTool({
        name: 'add_artifact_comment',
        arguments: {
          project_id: projectId,
          artifact_id: createdPayload.artifact.artifact_id,
          body: 'Check this section',
          passage: 'CSP',
          anchor,
        },
      });
      expect(commented.isError).not.toBe(true);

      const comments = await client.callTool({
        name: 'list_artifact_comments',
        arguments: {
          project_id: projectId,
          artifact_id: createdPayload.artifact.artifact_id,
        },
      });
      expect(comments.isError).not.toBe(true);
      const commentsContent = comments.content as Array<{ type: string; text?: string }>;
      const commentsText =
        commentsContent[0]?.type === 'text' ? (commentsContent[0].text ?? '{}') : '{}';
      const commentsPayload = JSON.parse(commentsText) as {
        comments: Array<{ target_id: string; body: string }>;
      };
      expect(commentsPayload.comments).toEqual([
        expect.objectContaining({
          target_id: createdPayload.artifact.artifact_id,
          body: 'Check this section',
        }),
      ]);

      await client.close();
    });
  });

  it('attach_file defaults mime to image/png and returns not_found for missing project', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const client = await connectClient(baseUrl);
      const result = await client.callTool({
        name: 'attach_file',
        arguments: {
          project_id: '00000000-0000-4000-8000-000000009999',
          filename: 'x.png',
          content_base64: 'aGVsbG8=',
        },
      });
      expect(result.isError).toBe(true);
      await client.close();
    });
  });

  it('create_share_link mints a resource-scoped link with a working markdown_url', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db, app }) => {
      const task = await createTask(db, { projectId, label: 'Shareable task', status: 'todo' });
      const spec = await createDocument(db, { projectId, title: 'Spec', body: '# Spec body' });
      await createEdge(db, {
        projectId,
        fromType: 'document',
        fromId: spec.id,
        toType: 'task',
        toId: task.id,
        label: 'documents',
      });

      const client = await connectClient(baseUrl);
      const result = await client.callTool({
        name: 'create_share_link',
        arguments: { task_id: task.id },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '{}') : '{}';
      const payload = JSON.parse(text) as {
        share: { url: string; markdown_url: string; expires_at: string | null };
      };
      expect(payload.share.url).toMatch(new RegExp(`^${baseUrl}/p/`));
      expect(payload.share.markdown_url).toMatch(new RegExp(`^${baseUrl}/api/v1/share/.+\\.md$`));
      expect(payload.share.expires_at).toBeTruthy();

      const mdPath = payload.share.markdown_url.slice(baseUrl.length);
      const mdRes = await app.request(mdPath);
      expect(mdRes.status).toBe(200);
      expect(mdRes.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
      const markdown = await mdRes.text();
      expect(markdown).toContain('Shareable task');
      expect(markdown).toContain('## Linked document: Spec');

      await client.close();
    });
  });

  it('create_share_link requires exactly one of task_id/document_id', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const task = await createTask(db, { projectId, label: 'Either' });
      const doc = await createDocument(db, { projectId, title: 'Either doc' });
      const client = await connectClient(baseUrl);

      const neither = await client.callTool({ name: 'create_share_link', arguments: {} });
      expect(neither.isError).toBe(true);

      const both = await client.callTool({
        name: 'create_share_link',
        arguments: { task_id: task.id, document_id: doc.id },
      });
      expect(both.isError).toBe(true);

      await client.close();
    });
  });

  it('scaffold_project_from_plan creates project atomically via MCP', async () => {
    await withMcpServer(async ({ baseUrl, db }) => {

      const client = await connectClient(baseUrl);
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
      expect(await listTasks(db, payload.scaffold.project.id)).toHaveLength(2);

      await client.close();
    });
  });

  it('scaffold_project_from_plan returns invalid_argument for duplicate keys', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const client = await connectClient(baseUrl);
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

  it('goal tools support CRUD and lifecycle', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);

      const created = await client.callTool({
        name: 'create_goal',
        arguments: { project_id: projectId, objective: 'MCP goal' },
      });
      expect(created.isError).not.toBe(true);
      const createdText =
        (created.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      const createdPayload = JSON.parse(createdText) as {
        goal: { id: string; objective: string };
      };
      expect(createdPayload.goal.objective).toBe('MCP goal');

      const listed = await client.callTool({
        name: 'list_goals',
        arguments: { project_id: projectId },
      });
      const listedText =
        (listed.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      const listedPayload = JSON.parse(listedText) as { goals: Array<{ id: string }> };
      expect(listedPayload.goals.some((goal) => goal.id === createdPayload.goal.id)).toBe(true);

      const task = await createTask(db, {
        projectId,
        goalId: createdPayload.goal.id,
        label: 'Cycle task',
        status: 'todo',
      });

      const fetched = await client.callTool({
        name: 'get_goal',
        arguments: { goal_id: createdPayload.goal.id },
      });
      const fetchedText =
        (fetched.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      const fetchedPayload = JSON.parse(fetchedText) as {
        goal: { cycle_tasks: Array<{ id: string }> };
      };
      expect(fetchedPayload.goal.cycle_tasks.map((row) => row.id)).toEqual([task.id]);

      const updated = await client.callTool({
        name: 'update_goal',
        arguments: { goal_id: createdPayload.goal.id, objective: 'Renamed objective' },
      });
      expect(updated.isError).not.toBe(true);
      const updatedText =
        (updated.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      expect((JSON.parse(updatedText) as { goal: { objective: string } }).goal.objective).toBe(
        'Renamed objective',
      );
      const refetched = await client.callTool({
        name: 'get_goal',
        arguments: { goal_id: createdPayload.goal.id },
      });
      const refetchedText =
        (refetched.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      const refetchedPayload = JSON.parse(refetchedText) as {
        goal: { objective: string; cycle_tasks: Array<{ id: string }> };
      };
      expect(refetchedPayload.goal.objective).toBe('Renamed objective');
      // Editing does not detach the goal's cycle-tasks.
      expect(refetchedPayload.goal.cycle_tasks.map((row) => row.id)).toEqual([task.id]);

      const blocked = await client.callTool({
        name: 'complete_goal',
        arguments: { goal_id: createdPayload.goal.id },
      });
      expect(blocked.isError).toBe(true);

      await db.$client.execute({
        sql: 'UPDATE tasks SET status = ? WHERE id = ?',
        args: ['done', task.id],
      });
      const completed = await client.callTool({
        name: 'complete_goal',
        arguments: { goal_id: createdPayload.goal.id },
      });
      expect(completed.isError).not.toBe(true);

      const paused = await client.callTool({
        name: 'pause_goal',
        arguments: { goal_id: createdPayload.goal.id },
      });
      expect(paused.isError).toBe(true);

      await client.close();
    });
  });

  it('create_goal returns a structured invalid_argument naming the field for a bad verification_surface (#14)', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {
      const client = await connectClient(baseUrl);
      try {
        const result = await client.callTool({
          name: 'create_goal',
          arguments: {
            project_id: projectId,
            objective: 'Bad surface',
            verification_surface: '{"foo":"bar"}',
          },
        });
        expect(result.isError).toBe(true);
        const content = result.content as Array<{ type: string; text?: string }>;
        const text = content[0]?.type === 'text' ? (content[0].text ?? '') : '';
        const payload = JSON.parse(text) as { error: string; message?: string };
        expect(payload.error).toBe('invalid_argument');
        expect(payload.message).toMatch(/verification_surface must include a kind/);
      } finally {
        await client.close();
      }
    });
  });

  it('sibling tools return invalid_argument naming the offending field/reason (#14)', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);
      try {
        const task = await createTask(db, { projectId, label: 'Edge target' });

        const badEdge = await client.callTool({
          name: 'create_edge',
          arguments: {
            project_id: projectId,
            from_task_id: task.id,
            to_task_id: '00000000-0000-4000-8000-000000009999',
          },
        });
        expect(badEdge.isError).toBe(true);
        const edgeText =
          (badEdge.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
        const edgeError = JSON.parse(edgeText) as { error?: unknown; message?: unknown };
        expect(edgeError.error).toBe('invalid_argument');
        expect(typeof edgeError.message).toBe('string');
        expect(edgeError.message).toMatch(/to task/i);

        const badParent = await client.callTool({
          name: 'create_document',
          arguments: {
            project_id: projectId,
            title: 'Orphan',
            parent_id: '00000000-0000-4000-8000-000000009999',
          },
        });
        expect(badParent.isError).toBe(true);
        const parentText =
          (badParent.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
        const parentError = JSON.parse(parentText) as { error?: unknown; message?: unknown };
        expect(parentError.error).toBe('invalid_argument');
        expect(typeof parentError.message).toBe('string');
        expect(parentError.message).toMatch(/parent document/i);
      } finally {
        await client.close();
      }
    });
  });

  it('list_edges and delete_edge close the create -> list -> delete -> list loop (#29)', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);
      try {
        const taskA = await createTask(db, { projectId, label: 'A' });
        const taskB = await createTask(db, { projectId, label: 'B' });

        const created = await client.callTool({
          name: 'create_edge',
          arguments: {
            project_id: projectId,
            from_task_id: taskA.id,
            to_task_id: taskB.id,
            label: 'blocks',
          },
        });
        expect(created.isError).not.toBe(true);
        const createdPayload = JSON.parse(
          (created.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as { edge: { id: string } };

        const listed = await client.callTool({
          name: 'list_edges',
          arguments: { project_id: projectId },
        });
        const listedPayload = JSON.parse(
          (listed.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as {
          edges: Array<{
            id: string;
            from_type: string;
            from_id: string;
            to_type: string;
            to_id: string;
            label: string | null;
          }>;
        };
        expect(listedPayload.edges).toEqual([
          expect.objectContaining({
            id: createdPayload.edge.id,
            from_type: 'task',
            from_id: taskA.id,
            to_type: 'task',
            to_id: taskB.id,
            label: 'blocks',
          }),
        ]);

        const deleted = await client.callTool({
          name: 'delete_edge',
          arguments: { edge_id: createdPayload.edge.id },
        });
        expect(deleted.isError).not.toBe(true);

        const listedAfter = await client.callTool({
          name: 'list_edges',
          arguments: { project_id: projectId },
        });
        const listedAfterPayload = JSON.parse(
          (listedAfter.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as { edges: Array<{ id: string }> };
        expect(listedAfterPayload.edges).toEqual([]);

        const deletedAgain = await client.callTool({
          name: 'delete_edge',
          arguments: { edge_id: createdPayload.edge.id },
        });
        expect(deletedAgain.isError).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  it('typed create_edge + list_edges; delete_edge removes only the addressed edge', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);
      try {
        const task = await createTask(db, { projectId, label: 'Covered' });
        const docA = await createDocument(db, { projectId, title: 'Spec A' });
        const docB = await createDocument(db, { projectId, title: 'Spec B' });

        const edgeTask = await client.callTool({
          name: 'create_edge',
          arguments: {
            project_id: projectId,
            from_type: 'document',
            from_id: docA.id,
            to_type: 'task',
            to_id: task.id,
            label: 'documents',
          },
        });
        expect(edgeTask.isError).not.toBe(true);
        const edgeTaskId = (
          JSON.parse(
            (edgeTask.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
          ) as { edge: { id: string } }
        ).edge.id;

        const edgeDoc = await client.callTool({
          name: 'create_edge',
          arguments: {
            project_id: projectId,
            from_type: 'document',
            from_id: docA.id,
            to_type: 'document',
            to_id: docB.id,
            label: 'references',
          },
        });
        expect(edgeDoc.isError).not.toBe(true);
        const edgeDocId = (
          JSON.parse(
            (edgeDoc.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
          ) as { edge: { id: string } }
        ).edge.id;

        const listed = await client.callTool({
          name: 'list_edges',
          arguments: { project_id: projectId },
        });
        const edges = (
          JSON.parse(
            (listed.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
          ) as {
            edges: Array<{
              id: string;
              from_type: string;
              from_id: string;
              to_type: string;
              to_id: string;
              label: string | null;
            }>;
          }
        ).edges;
        expect(edges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: edgeTaskId,
              from_type: 'document',
              from_id: docA.id,
              to_type: 'task',
              to_id: task.id,
              label: 'documents',
            }),
            expect.objectContaining({
              id: edgeDocId,
              from_type: 'document',
              from_id: docA.id,
              to_type: 'document',
              to_id: docB.id,
              label: 'references',
            }),
          ]),
        );

        const deleted = await client.callTool({
          name: 'delete_edge',
          arguments: { edge_id: edgeTaskId },
        });
        expect(deleted.isError).not.toBe(true);

        const listedAfter = await client.callTool({
          name: 'list_edges',
          arguments: { project_id: projectId },
        });
        const after = (
          JSON.parse(
            (listedAfter.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
          ) as { edges: Array<{ id: string }> }
        ).edges;
        expect(after.map((e) => e.id)).toEqual([edgeDocId]);
      } finally {
        await client.close();
      }
    });
  });

  it('agent can delete one link via get_document edge_id -> delete_edge; siblings survive (self-describing surface)', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);
      try {
        const task = await createTask(db, { projectId, label: 'Covered task' });
        const docB = await createDocument(db, { projectId, title: 'Sibling doc' });

        // Hub document links to BOTH a task and another document.
        const created = await client.callTool({
          name: 'create_document',
          arguments: {
            project_id: projectId,
            title: 'Hub spec',
            link_to: [task.id, docB.id],
          },
        });
        expect(created.isError).not.toBe(true);
        const hub = parseDocumentResult(created);
        expect(hub.links?.map((l) => l.id).sort()).toEqual([docB.id, task.id].sort());

        // The agent reads the document and takes ONE edge_id from a links entry
        // — exactly the chain the delete_edge.edge_id description names.
        const got = await client.callTool({
          name: 'get_document',
          arguments: { document_id: hub.id },
        });
        const gotDoc = parseDocumentResult(got);
        const taskLink = gotDoc.links?.find((l) => l.type === 'task');
        expect(taskLink).toBeDefined();
        const edgeId = taskLink?.edge_id;
        expect(edgeId).toBeDefined();

        // Delete that single edge using only the id obtained from get_document.
        const deleted = await client.callTool({
          name: 'delete_edge',
          arguments: { edge_id: edgeId },
        });
        expect(deleted.isError).not.toBe(true);

        // Re-read: the task link is gone, the document sibling survives.
        const after = await client.callTool({
          name: 'get_document',
          arguments: { document_id: hub.id },
        });
        const afterDoc = parseDocumentResult(after);
        expect(afterDoc.links?.map((l) => l.id).sort()).toEqual([docB.id]);
      } finally {
        await client.close();
      }
    });
  });

  it('get_document, list_edges, create_edge outputSchema matches their real structuredContent', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);
      try {
        const task = await createTask(db, { projectId, label: 'Target' });
        const doc = await createDocument(db, { projectId, title: 'Doc' });

        const edgeRes = await client.callTool({
          name: 'create_edge',
          arguments: {
            project_id: projectId,
            from_type: 'document',
            from_id: doc.id,
            to_type: 'task',
            to_id: task.id,
            label: 'documents',
          },
        });
        expect(edgeRes.isError).not.toBe(true);
        // Assert the declared output shape parses the real response — not eyeballed.
        expect(z.object(createEdgeOutputSchema).safeParse(edgeRes.structuredContent).success).toBe(
          true,
        );

        const listRes = await client.callTool({
          name: 'list_edges',
          arguments: { project_id: projectId },
        });
        expect(listRes.isError).not.toBe(true);
        expect(z.object(listEdgesOutputSchema).safeParse(listRes.structuredContent).success).toBe(
          true,
        );

        const getRes = await client.callTool({
          name: 'get_document',
          arguments: { document_id: doc.id },
        });
        expect(getRes.isError).not.toBe(true);
        expect(z.object(getDocumentOutputSchema).safeParse(getRes.structuredContent).success).toBe(
          true,
        );
      } finally {
        await client.close();
      }
    });
  });

  it('scaffold_project_from_plan links one document to three tasks and one other document via key_to_id', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const client = await connectClient(baseUrl);
      try {
        const result = await client.callTool({
          name: 'scaffold_project_from_plan',
          arguments: {
            name: 'Multi-link scaffold',
            tasks: [
              { key: 't1', label: 'Task One' },
              { key: 't2', label: 'Task Two' },
              { key: 't3', label: 'Task Three' },
            ],
            documents: [
              { key: 'overview', title: 'Overview', body: '# Overview' },
              {
                key: 'design',
                title: 'Design: multi',
                body: '# Design',
                link_to: ['t1', 't2', 't3', 'overview'],
              },
            ],
          },
        });
        expect(result.isError).not.toBe(true);
        const payload = JSON.parse(
          (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as {
          scaffold: {
            key_to_id: Record<string, string>;
            documents: Array<{
              id: string;
              title: string;
              links: Array<{ type: string; id: string; title: string; label: string | null }>;
              backlinks: Array<{ type: string; id: string; title: string; label: string | null }>;
            }>;
          };
        };

        const keys = payload.scaffold.key_to_id;
        expect(keys.t1).toBeTruthy();
        expect(keys.t2).toBeTruthy();
        expect(keys.t3).toBeTruthy();
        expect(keys.overview).toBeTruthy();
        expect(keys.design).toBeTruthy();

        const design = payload.scaffold.documents.find((d) => d.title === 'Design: multi');
        const overview = payload.scaffold.documents.find((d) => d.title === 'Overview');
        if (design === undefined) {
          throw new Error('missing Design: multi document');
        }
        if (overview === undefined) {
          throw new Error('missing Overview document');
        }
        expect(design.links.map((l) => l.id).sort()).toEqual(
          [keys.t1, keys.t2, keys.t3, keys.overview].sort(),
        );
        expect(design.links.filter((l) => l.type === 'task')).toHaveLength(3);
        expect(design.links.filter((l) => l.type === 'document')).toHaveLength(1);
        expect(overview.backlinks.map((l) => l.id)).toEqual([keys.design]);

        const got = await client.callTool({
          name: 'get_document',
          arguments: { document_id: design.id },
        });
        const gotDoc = parseDocumentResult(got);
        expect(gotDoc.links?.map((l) => l.id).sort()).toEqual(
          [keys.t1, keys.t2, keys.t3, keys.overview].sort(),
        );
        expect(gotDoc.backlinks).toEqual([]);

        const gotOverview = parseDocumentResult(
          await client.callTool({
            name: 'get_document',
            arguments: { document_id: overview.id },
          }),
        );
        expect(gotOverview.backlinks?.map((l) => l.id)).toEqual([keys.design]);
      } finally {
        await client.close();
      }
    });
  });

  it('create_document accepts multi link_to and single-string BC still works on scaffold', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);
      try {
        const t1 = await createTask(db, { projectId, label: 'One' });
        const t2 = await createTask(db, { projectId, label: 'Two' });
        const otherDoc = await createDocument(db, { projectId, title: 'Related' });

        const created = await client.callTool({
          name: 'create_document',
          arguments: {
            project_id: projectId,
            title: 'Multi',
            link_to: [t1.id, t2.id, otherDoc.id],
          },
        });
        expect(created.isError).not.toBe(true);
        const doc = parseDocumentResult(created);
        expect(doc.links?.map((l) => l.id).sort()).toEqual([t1.id, t2.id, otherDoc.id].sort());

        const scaffold = await client.callTool({
          name: 'scaffold_project_from_plan',
          arguments: {
            name: 'Single link_to BC',
            tasks: [
              { key: 'a', label: 'A' },
              { key: 'b', label: 'B' },
            ],
            documents: [{ title: 'Plan', body: '# Plan', link_to: 'b' }],
          },
        });
        expect(scaffold.isError).not.toBe(true);
        const scaffoldPayload = JSON.parse(
          (scaffold.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as {
          scaffold: {
            key_to_id: Record<string, string>;
            documents: Array<{ links: Array<{ id: string }> }>;
          };
        };
        expect(scaffoldPayload.scaffold.documents[0]?.links.map((l) => l.id)).toEqual([
          scaffoldPayload.scaffold.key_to_id.b,
        ]);
      } finally {
        await client.close();
      }
    });
  });

  it('goal id round-trips: create_goal -> list_goals -> create_task(goal_id) succeeds verbatim (#27)', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {
      const client = await connectClient(baseUrl);
      try {
        const created = await client.callTool({
          name: 'create_goal',
          arguments: { project_id: projectId, objective: 'Round trip goal' },
        });
        const createdGoal = (
          JSON.parse(
            (created.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
          ) as { goal: { id: string } }
        ).goal;

        const listed = await client.callTool({
          name: 'list_goals',
          arguments: { project_id: projectId },
        });
        const listedGoals = (
          JSON.parse(
            (listed.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
          ) as { goals: Array<{ id: string }> }
        ).goals;
        const returnedId = listedGoals.find((goal) => goal.id === createdGoal.id)?.id;
        expect(returnedId).toBe(createdGoal.id);

        // The id list_goals hands back must be accepted verbatim by create_task.goal_id.
        const task = await client.callTool({
          name: 'create_task',
          arguments: { project_id: projectId, label: 'Under round-trip goal', goal_id: returnedId },
        });
        expect(task.isError).not.toBe(true);
        const taskPayload = JSON.parse(
          (task.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as { task: { goal_id: string } };
        expect(taskPayload.task.goal_id).toBe(createdGoal.id);

        // An invalid goal_id is rejected with an error naming the offending field.
        const bad = await client.callTool({
          name: 'create_task',
          arguments: { project_id: projectId, label: 'Bad goal', goal_id: 'not-a-uuid' },
        });
        expect(bad.isError).toBe(true);
        const badText = (bad.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
        expect(badText).toMatch(/goal_id/);
      } finally {
        await client.close();
      }
    });
  });

  it('get_next_task returns actionable task and blocked context', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const actionable = await createTask(db, { projectId, label: 'Actionable', status: 'todo' });
      const prerequisite = await createTask(db, { projectId, label: 'Prerequisite', status: 'todo' });
      const blocked = await createTask(db, { projectId, label: 'Blocked', status: 'todo' });
      await createEdge(db, {
        projectId,
        fromTaskId: prerequisite.id,
        toTaskId: blocked.id,
        label: 'blocks',
      });

      const client = await connectClient(baseUrl);
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
    await withMcpServer(async ({ baseUrl }) => {
      const client = await connectClient(baseUrl);
      const result = await client.callTool({
        name: 'get_next_task',
        arguments: { project_id: '00000000-0000-4000-8000-000000009999' },
      });
      expect(result.isError).toBe(true);
      await client.close();
    });
  });

  it('get_next_task(goal_id) scopes to one goal; omitted with multiple active goals considers all of them (#18)', async () => {
    await withMcpServer(async ({ baseUrl, projectId, services }) => {
      const client = await connectClient(baseUrl);
      try {
        const goalA = await services.goalService.create(projectId, { objective: 'Goal A' });
        const goalB = await services.goalService.create(projectId, { objective: 'Goal B' });
        if (!goalA || !goalB) {
          throw new Error('expected goals');
        }
        const taskA = await services.taskService.create(projectId, {
          label: 'A todo',
          goalId: goalA.id,
        });
        await services.taskService.create(projectId, { label: 'B todo', goalId: goalB.id });

        const scopedToA = await client.callTool({
          name: 'get_next_task',
          arguments: { project_id: projectId, goal_id: goalA.id },
        });
        const scopedPayload = JSON.parse(
          (scopedToA.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as { next: { reason: string; next_task: { id: string } | null } };
        expect(scopedPayload.next.reason).toBe('ok');
        expect(scopedPayload.next.next_task?.id).toBe(taskA?.id);

        // No goal_id, but two active goals: no dead-end — an actionable task
        // from the union of active goals comes back instead of erroring.
        const unscoped = await client.callTool({
          name: 'get_next_task',
          arguments: { project_id: projectId },
        });
        const unscopedPayload = JSON.parse(
          (unscoped.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as { next: { reason: string; next_task: { id: string } | null } };
        expect(unscopedPayload.next.reason).toBe('ok');
        expect(unscopedPayload.next.next_task).not.toBeNull();
      } finally {
        await client.close();
      }
    });
  });

  it('create_task sets tags (auto-created by name), update_task replaces the full set, list_tags lists them', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {

      const client = await connectClient(baseUrl);

      const created = await client.callTool({
        name: 'create_task',
        arguments: { project_id: projectId, label: 'Tagged', tags: ['backend', 'urgent'] },
      });
      expect(created.isError).not.toBe(true);
      const createdContent = created.content as Array<{ type: string; text?: string }>;
      const createdText =
        createdContent[0]?.type === 'text' ? (createdContent[0].text ?? '{}') : '{}';
      const createdPayload = JSON.parse(createdText) as {
        task: { id: string; tags: Array<{ id: string; name: string; color: string | null }> };
      };
      expect(createdPayload.task.tags.map((tag) => tag.name)).toEqual(['backend', 'urgent']);

      const updated = await client.callTool({
        name: 'update_task',
        arguments: { task_id: createdPayload.task.id, tags: ['backend', 'api'] },
      });
      expect(updated.isError).not.toBe(true);
      const updatedContent = updated.content as Array<{ type: string; text?: string }>;
      const updatedText =
        updatedContent[0]?.type === 'text' ? (updatedContent[0].text ?? '{}') : '{}';
      const updatedPayload = JSON.parse(updatedText) as {
        task: { tags: Array<{ name: string }> };
      };
      expect(updatedPayload.task.tags.map((tag) => tag.name)).toEqual(['api', 'backend']);

      const listed = await client.callTool({
        name: 'list_tags',
        arguments: { project_id: projectId },
      });
      expect(listed.isError).not.toBe(true);
      const listedContent = listed.content as Array<{ type: string; text?: string }>;
      const listedText = listedContent[0]?.type === 'text' ? (listedContent[0].text ?? '{}') : '{}';
      const listedPayload = JSON.parse(listedText) as {
        tags: Array<{ name: string; project_id: string }>;
      };
      // replaced-away tags remain as project tags for reuse
      expect(listedPayload.tags.map((tag) => tag.name)).toEqual(['api', 'backend', 'urgent']);
      expect(listedPayload.tags[0]?.project_id).toBe(projectId);

      await client.close();
    });
  });

  it('update_task sets commit_refs as an array, replaces rather than appends, get_task returns them', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {
      const client = await connectClient(baseUrl);

      const created = await client.callTool({
        name: 'create_task',
        arguments: { project_id: projectId, label: 'Ship' },
      });
      expect(created.isError).not.toBe(true);
      const createdContent = created.content as Array<{ type: string; text?: string }>;
      const createdText =
        createdContent[0]?.type === 'text' ? (createdContent[0].text ?? '{}') : '{}';
      const createdPayload = JSON.parse(createdText) as {
        task: { id: string; commit_refs: string[] };
      };
      expect(createdPayload.task.commit_refs).toEqual([]);

      const updated = await client.callTool({
        name: 'update_task',
        arguments: {
          task_id: createdPayload.task.id,
          commit_refs: ['abc1234', 'deadbeef'],
        },
      });
      expect(updated.isError).not.toBe(true);
      const updatedContent = updated.content as Array<{ type: string; text?: string }>;
      const updatedText =
        updatedContent[0]?.type === 'text' ? (updatedContent[0].text ?? '{}') : '{}';
      const updatedPayload = JSON.parse(updatedText) as { task: { commit_refs: string[] } };
      expect(updatedPayload.task.commit_refs).toEqual(['abc1234', 'deadbeef']);

      const replaced = await client.callTool({
        name: 'update_task',
        arguments: { task_id: createdPayload.task.id, commit_refs: ['ffffff0'] },
      });
      expect(replaced.isError).not.toBe(true);
      const replacedContent = replaced.content as Array<{ type: string; text?: string }>;
      const replacedText =
        replacedContent[0]?.type === 'text' ? (replacedContent[0].text ?? '{}') : '{}';
      expect(
        (JSON.parse(replacedText) as { task: { commit_refs: string[] } }).task.commit_refs,
      ).toEqual(['ffffff0']);

      const got = await client.callTool({
        name: 'get_task',
        arguments: { task_id: createdPayload.task.id },
      });
      const gotContent = got.content as Array<{ type: string; text?: string }>;
      const gotText = gotContent[0]?.type === 'text' ? (gotContent[0].text ?? '{}') : '{}';
      expect((JSON.parse(gotText) as { task: { commit_refs: string[] } }).task.commit_refs).toEqual([
        'ffffff0',
      ]);

      const bad = await client.callTool({
        name: 'update_task',
        arguments: { task_id: createdPayload.task.id, commit_refs: ['NOT-HEX'] },
      });
      expect(bad.isError).toBe(true);

      const upper = await client.callTool({
        name: 'update_task',
        arguments: {
          task_id: createdPayload.task.id,
          commit_refs: ['ABC1234', 'DeAdBeEf'],
        },
      });
      expect(upper.isError).not.toBe(true);
      const upperContent = upper.content as Array<{ type: string; text?: string }>;
      const upperText =
        upperContent[0]?.type === 'text' ? (upperContent[0].text ?? '{}') : '{}';
      expect(
        (JSON.parse(upperText) as { task: { commit_refs: string[] } }).task.commit_refs,
      ).toEqual(['abc1234', 'deadbeef']);

      const gotUpper = await client.callTool({
        name: 'get_task',
        arguments: { task_id: createdPayload.task.id },
      });
      const gotUpperContent = gotUpper.content as Array<{ type: string; text?: string }>;
      const gotUpperText =
        gotUpperContent[0]?.type === 'text' ? (gotUpperContent[0].text ?? '{}') : '{}';
      expect(
        (JSON.parse(gotUpperText) as { task: { commit_refs: string[] } }).task.commit_refs,
      ).toEqual(['abc1234', 'deadbeef']);

      await client.close();
    });
  });

  it('update_task rejects more than 50 commit_refs at the MCP boundary', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {
      const client = await connectClient(baseUrl);
      const created = await client.callTool({
        name: 'create_task',
        arguments: { project_id: projectId, label: 'Many commits' },
      });
      const createdContent = created.content as Array<{ type: string; text?: string }>;
      const createdText =
        createdContent[0]?.type === 'text' ? (createdContent[0].text ?? '{}') : '{}';
      const taskId = (JSON.parse(createdText) as { task: { id: string } }).task.id;

      const fifty = Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(7, '0'));
      const atMax = await client.callTool({
        name: 'update_task',
        arguments: { task_id: taskId, commit_refs: fifty },
      });
      expect(atMax.isError).not.toBe(true);

      const overMax = await client.callTool({
        name: 'update_task',
        arguments: { task_id: taskId, commit_refs: [...fifty, 'aaaaaaa'] },
      });
      expect(overMax.isError).toBe(true);

      await client.close();
    });
  });

  it('list_tags returns not_found for missing project', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const client = await connectClient(baseUrl);
      const result = await client.callTool({
        name: 'list_tags',
        arguments: { project_id: '00000000-0000-4000-8000-000000009999' },
      });
      expect(result.isError).toBe(true);
      await client.close();
    });
  });

  it('list_views returns saved views and the surface has no mutating view tools', async () => {
    await withMcpServer(async ({ baseUrl, projectId, services }) => {
      const { NON_TRIVIAL_SAVED_VIEW_CONFIG } = await import('@plandesk/db');
      const created = await services.viewService.create(projectId, {
        name: 'Blocked & urgent',
        config: NON_TRIVIAL_SAVED_VIEW_CONFIG,
      });
      expect(created).toBeDefined();

      const client = await connectClient(baseUrl);
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain('list_views');
      expect(names.filter((name) => /^(create|update|delete)_views?$/.test(name))).toEqual([]);

      const result = await client.callTool({
        name: 'list_views',
        arguments: { project_id: projectId },
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '{}') : '{}';
      const payload = JSON.parse(text) as {
        views: Array<{ name: string; config: unknown }>;
      };
      expect(payload.views).toHaveLength(1);
      expect(payload.views[0]?.name).toBe('Blocked & urgent');
      expect(payload.views[0]?.config).toEqual(NON_TRIVIAL_SAVED_VIEW_CONFIG);

      const denied = await client.callTool({
        name: 'list_views',
        arguments: { project_id: '00000000-0000-4000-8000-000000009999' },
      });
      expect(denied.isError).toBe(true);
      await client.close();
    });
  });

  it('list_tasks and get_next_task tags filters use OR semantics', async () => {
    await withMcpServer(async ({ baseUrl, projectId, services }) => {
      const frontend = await services.taskService.create(projectId, {
        label: 'Frontend',
        tags: ['frontend'],
      });
      const backend = await services.taskService.create(projectId, {
        label: 'Backend',
        tags: ['backend'],
      });
      await services.taskService.create(projectId, { label: 'Untagged' });

      const client = await connectClient(baseUrl);

      const listed = await client.callTool({
        name: 'list_tasks',
        arguments: { project_id: projectId, tags: ['frontend', 'backend'] },
      });
      const listedContent = listed.content as Array<{ type: string; text?: string }>;
      const listedText = listedContent[0]?.type === 'text' ? (listedContent[0].text ?? '{}') : '{}';
      const listedPayload = JSON.parse(listedText) as { tasks: Array<{ id: string }> };
      expect(listedPayload.tasks.map((task) => task.id).sort()).toEqual(
        [frontend?.id, backend?.id].sort(),
      );

      const next = await client.callTool({
        name: 'get_next_task',
        arguments: { project_id: projectId, tags: ['backend'] },
      });
      const nextContent = next.content as Array<{ type: string; text?: string }>;
      const nextText = nextContent[0]?.type === 'text' ? (nextContent[0].text ?? '{}') : '{}';
      const nextPayload = JSON.parse(nextText) as {
        next: { reason: string; next_task: { id: string } | null };
      };
      expect(nextPayload.next.reason).toBe('ok');
      expect(nextPayload.next.next_task?.id).toBe(backend?.id);

      const noMatch = await client.callTool({
        name: 'get_next_task',
        arguments: { project_id: projectId, tags: ['missing'] },
      });
      const noMatchContent = noMatch.content as Array<{ type: string; text?: string }>;
      const noMatchText =
        noMatchContent[0]?.type === 'text' ? (noMatchContent[0].text ?? '{}') : '{}';
      const noMatchPayload = JSON.parse(noMatchText) as { next: { reason: string } };
      expect(noMatchPayload.next.reason).toBe('no_todo_tasks');

      await client.close();
    });
  });

  it('create_task and update_task return invalid_argument for blank tag names', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const client = await connectClient(baseUrl);

      const badCreate = await client.callTool({
        name: 'create_task',
        arguments: { project_id: projectId, label: 'Bad', tags: ['  '] },
      });
      expect(badCreate.isError).toBe(true);

      const task = await createTask(db, { projectId, label: 'Ok' });
      const badUpdate = await client.callTool({
        name: 'update_task',
        arguments: { task_id: task.id, tags: [' '] },
      });
      expect(badUpdate.isError).toBe(true);

      await client.close();
    });
  });

  it('update_task reassigns a task to a different goal, preserving edges/comments/documents (#15)', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db, services }) => {
      const client = await connectClient(baseUrl);
      try {
        const goalA = await services.goalService.create(projectId, { objective: 'Goal A' });
        const goalB = await services.goalService.create(projectId, { objective: 'Goal B' });
        if (!goalA || !goalB) {
          throw new Error('expected goals');
        }
        const task = await createTask(db, { projectId, goalId: goalA.id, label: 'Movable' });
        const other = await createTask(db, { projectId, goalId: goalA.id, label: 'Prereq' });
        const edge = await createEdge(db, { projectId, fromTaskId: other.id, toTaskId: task.id });
        const comment = await createComment(db, {
          projectId,
          targetType: 'task',
          targetId: task.id,
          body: 'keep me',
        });
        const doc = await createDocument(db, {
          projectId,
          title: 'Spec',
        });
        await createEdge(db, {
          projectId,
          fromType: 'document',
          fromId: doc.id,
          toType: 'task',
          toId: task.id,
          label: 'documents',
        });

        const result = await client.callTool({
          name: 'update_task',
          arguments: { task_id: task.id, goal_id: goalB.id },
        });
        expect(result.isError).not.toBe(true);
        const payload = JSON.parse(
          (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as { task: { goal_id: string; status: string } };
        expect(payload.task.goal_id).toBe(goalB.id);

        const got = await client.callTool({ name: 'get_task', arguments: { task_id: task.id } });
        const gotPayload = JSON.parse(
          (got.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as { task: { goal_id: string } };
        expect(gotPayload.task.goal_id).toBe(goalB.id);

        expect((await listEdges(db, projectId)).map((e) => e.id)).toContain(edge.id);
        const comments = await client.callTool({
          name: 'list_comments',
          arguments: { project_id: projectId, target_type: 'task', target_id: task.id },
        });
        const commentsPayload = JSON.parse(
          (comments.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}',
        ) as { comments: Array<{ id: string }> };
        expect(commentsPayload.comments.map((c) => c.id)).toContain(comment.id);
        const gotDoc = await client.callTool({
          name: 'get_document',
          arguments: { document_id: doc.id },
        });
        expect(parseDocumentResult(gotDoc).links?.map((l) => l.id)).toEqual([task.id]);

        // A foreign/nonexistent goal_id is rejected with a clear error.
        const bad = await client.callTool({
          name: 'update_task',
          arguments: { task_id: task.id, goal_id: '00000000-0000-4000-8000-000000009999' },
        });
        expect(bad.isError).toBe(true);
        const badText = (bad.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
        expect(badText).toMatch(/goal/i);
      } finally {
        await client.close();
      }
    });
  });

  it('list_comments, add_comment, and resolve_comment work via MCP', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {

      const doc = await createDocument(db, { projectId, title: 'Review doc' });
      const resolved = await createComment(db, {
        projectId,
        targetType: 'document',
        targetId: doc.id,
        body: 'Already done',
      });
      await updateComment(db, resolved.id, { resolved: true });
      const open = await createComment(db, {
        projectId,
        targetType: 'document',
        targetId: doc.id,
        body: 'Still open',
      });

      const client = await connectClient(baseUrl);

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
        arguments: {
          target_type: 'document',
          target_id: doc.id,
          body: 'Agent suggestion',
          passage: '§3',
        },
      });
      expect(added.isError).not.toBe(true);
      const addedContent = added.content as Array<{ type: string; text?: string }>;
      const addedText = addedContent[0]?.type === 'text' ? (addedContent[0].text ?? '{}') : '{}';
      const addedPayload = JSON.parse(addedText) as {
        comment: { id: string; body: string; passage: string | null };
      };
      // Markdown body is converted to rich-text HTML, like documents/notes (#17).
      expect(addedPayload.comment.body).toContain('<p>Agent suggestion</p>');
      expect(addedPayload.comment.passage).toBe('§3');

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

  it('add_artifact_comment and list_artifact_comments preserve artifact annotations', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {
      const client = await connectClient(baseUrl);
      const artifactId = 'sha256:abc123::/workspace/docs/report with spaces.md';
      const anchor = JSON.stringify({ type: 'TextQuoteSelector', exact: 'CSP' });

      const added = await client.callTool({
        name: 'add_artifact_comment',
        arguments: {
          project_id: projectId,
          artifact_id: artifactId,
          body: 'Check this annotation',
          passage: 'CSP',
          anchor,
        },
      });
      expect(added.isError).not.toBe(true);
      const addedContent = added.content as Array<{ type: string; text?: string }>;
      const addedText = addedContent[0]?.type === 'text' ? (addedContent[0].text ?? '{}') : '{}';
      const addedPayload = JSON.parse(addedText) as {
        comment: { id: string; target_id: string; anchor: string | null };
      };
      expect(addedPayload.comment.target_id).toBe(artifactId);
      expect(addedPayload.comment.anchor).toBe(anchor);

      const listed = await client.callTool({
        name: 'list_artifact_comments',
        arguments: { project_id: projectId, artifact_id: artifactId },
      });
      expect(listed.isError).not.toBe(true);
      const listedContent = listed.content as Array<{ type: string; text?: string }>;
      const listedText = listedContent[0]?.type === 'text' ? (listedContent[0].text ?? '{}') : '{}';
      const listedPayload = JSON.parse(listedText) as {
        comments: Array<{ id: string; anchor: string | null }>;
      };
      expect(listedPayload.comments).toEqual([
        expect.objectContaining({ id: addedPayload.comment.id, anchor }),
      ]);

      await client.close();
    });
  });

  it('list_comments rejects cross-project target', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const otherProject = await createProject(db, { name: 'Other project' });
      const foreignDoc = await createDocument(db, { projectId: otherProject.id, title: 'Foreign' });

      const client = await connectClient(baseUrl);
      const result = await client.callTool({
        name: 'list_comments',
        arguments: {
          project_id: projectId,
          target_type: 'document',
          target_id: foreignDoc.id,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '') : '';
      // Uniform not_found for a target outside the caller's project: returning
      // invalid_argument would leak that the target exists elsewhere.
      expect(text).toMatch(/not_found/i);
      await client.close();
    });
  });

  it('add_comment returns invalid_argument for empty body', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const doc = await createDocument(db, { projectId, title: 'Doc' });
      const client = await connectClient(baseUrl);
      const result = await client.callTool({
        name: 'add_comment',
        arguments: { target_type: 'document', target_id: doc.id, body: '   ' },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.type === 'text' ? (content[0].text ?? '') : '';
      expect(text).toMatch(/invalid_argument/i);
      await client.close();
    });
  });


  it('add_comment renders a Markdown body as rich-text HTML, like create_document/create_note (#17)', async () => {
    await withMcpServer(async ({ baseUrl, projectId, db }) => {
      const doc = await createDocument(db, { projectId, title: 'Doc' });
      const client = await connectClient(baseUrl);
      try {
        const result = await client.callTool({
          name: 'add_comment',
          arguments: {
            target_type: 'document',
            target_id: doc.id,
            body: '## Heading\n\n- one\n- two\n\n```js\ncode();\n```\n\nUse `inline` code.',
          },
        });
        expect(result.isError).not.toBe(true);
        const content = result.content as Array<{ type: string; text?: string }>;
        const text = content[0]?.type === 'text' ? (content[0].text ?? '{}') : '{}';
        const payload = JSON.parse(text) as { comment: { body: string } };
        expect(payload.comment.body).toContain('<h2>Heading</h2>');
        expect(payload.comment.body).toContain('<li>one</li>');
        expect(payload.comment.body).toContain('<pre>');
        expect(payload.comment.body).toContain('<code>inline</code>');
      } finally {
        await client.close();
      }
    });
  });

  it('resolve_comment returns not_found for missing comment', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const client = await connectClient(baseUrl);
      const result = await client.callTool({
        name: 'resolve_comment',
        arguments: { comment_id: '00000000-0000-4000-8000-000000009999' },
      });
      expect(result.isError).toBe(true);
      await client.close();
    });
  });

  // BA6b single-server: guest submit on plandesk-api → owner MCP list/triage (no sync-server).
  it('guest submit → list_submissions → triage_submission on one server', async () => {
    await withMcpServer(async ({ baseUrl, projectId, services }) => {
      const created = await services.shareService.createShare(projectId, {
        audienceName: 'Reviewers',
        mode: 'public',
        permissions: { read: true, submit: true },
      });
      if (!created) {
        throw new Error('expected share');
      }

      const joinRes = await fetch(`${baseUrl}/api/v1/share/${created.token}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Blake' }),
      });
      expect(joinRes.status).toBe(200);
      const { session_token: sessionToken } = (await joinRes.json()) as { session_token: string };

      const submitRes = await fetch(`${baseUrl}/api/v1/share/${created.token}/submissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ title: 'Portal bug', body: 'Cannot join', severity: 'med' }),
      });
      expect(submitRes.status).toBe(201);
      const { submission } = (await submitRes.json()) as { submission: { id: string } };

      const client = await connectClient(baseUrl);
      const listed = await client.callTool({
        name: 'list_submissions',
        arguments: { project_id: projectId, status: 'pending' },
      });
      expect(listed.isError).not.toBe(true);
      const listText =
        (listed.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      const listPayload = JSON.parse(listText) as {
        submissions: Array<{ id: string; title: string }>;
      };
      expect(listPayload.submissions.map((s) => s.title)).toContain('Portal bug');

      const triaged = await client.callTool({
        name: 'triage_submission',
        arguments: { submission_id: submission.id, action: 'accept' },
      });
      expect(triaged.isError).not.toBe(true);
      const triageText =
        (triaged.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      const triagePayload = JSON.parse(triageText) as {
        submission: { status: string; linked_task_id: string | null };
      };
      expect(triagePayload.submission.status).toBe('accepted');
      expect(triagePayload.submission.linked_task_id).toBeTruthy();

      await client.close();
    });
  });
});

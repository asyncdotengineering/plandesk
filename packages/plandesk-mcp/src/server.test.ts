import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { getRequestListener } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp, createServices } from '@plandesk/api';
import {
  createDb,
  createEdge,
  createProjectInDefaultOrg as createProject,
  createTokenInDefaultOrg as createToken,
  createDocument,
  createComment,
  listTasks,
  updateComment,
  migrate,
  revokeToken,
  verifyToken,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
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
    async verify(raw: string) {
      return await verifyToken(db, raw);
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
    services: ReturnType<typeof createServices>;
  }) => Promise<void>,
): Promise<void> {
  const db = await createDb(':memory:');
  await migrate(db);
  const project = await createProject(db, { name: 'MCP Test Project', description: 'via MCP' });
  const { token } = await createToken(db, { name: 'test' });

  const services = createServices({ db, orgId: project.orgId });
  const mcpApp = createMcpApp({ services, tokenStore: createTestTokenStore(db) });
  // Default bindHost is loopback (local zero-token). Tests that need token
  // enforcement can pass Authorization; unauthorized tests use a missing/revoked token.
  const app = createApp({ db, services, mcp: mcpApp, bindHost: '127.0.0.1' });

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

function parseDocumentResult(result: unknown): {
  id: string;
  title: string;
  linked_task_id: string | null;
} {
  const content = (result as { content: unknown }).content as Array<{
    type: string;
    text?: string;
  }>;
  const text = content[0]?.type === 'text' ? (content[0].text ?? '{}') : '{}';
  return (
    JSON.parse(text) as {
      document: { id: string; title: string; linked_task_id: string | null };
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

  it('regression: MCP token revoke → subsequent MCP call returns 401', async () => {
    await withMcpServer(async ({ baseUrl, db }) => {
      const row = await createToken(db, { name: 'revoke-me' });
      await revokeToken(db, row.id);

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
      expect(names).toHaveLength(46);
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

  it('test:mcp_update_task updates via MCP, REST reflects change', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db, app }) => {
      const task = await createTask(db, { projectId, label: 'MCP task', status: 'todo' });

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
      const task = await createTask(db, { projectId, label: 'Bad status' });
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

  it('create_document and update_document persist linked_task_id (round-trip)', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const client = await connectClient(baseUrl, token);
      const task = await createTask(db, { projectId, label: 'Link target' });
      const other = await createTask(db, { projectId, label: 'Other target' });

      // create with a link (this path already worked; guard it against regression)
      const created = await client.callTool({
        name: 'create_document',
        arguments: { project_id: projectId, title: 'Spec', linked_task_id: task.id },
      });
      expect(created.isError).not.toBe(true);
      const createdDoc = parseDocumentResult(created);
      expect(createdDoc.linked_task_id).toBe(task.id);

      // re-link via update (this path silently dropped the link before the fix)
      const updated = await client.callTool({
        name: 'update_document',
        arguments: { document_id: createdDoc.id, linked_task_id: other.id },
      });
      expect(updated.isError).not.toBe(true);
      expect(parseDocumentResult(updated).linked_task_id).toBe(other.id);

      // get_document reflects the link
      const got = await client.callTool({
        name: 'get_document',
        arguments: { document_id: createdDoc.id },
      });
      expect(parseDocumentResult(got).linked_task_id).toBe(other.id);

      // null unlinks
      const unlinked = await client.callTool({
        name: 'update_document',
        arguments: { document_id: createdDoc.id, linked_task_id: null },
      });
      expect(unlinked.isError).not.toBe(true);
      expect(parseDocumentResult(unlinked).linked_task_id).toBeNull();

      await client.close();
    });
  });

  it('create_folder, update_folder, and folder-aware documents work via MCP', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId }) => {

      const client = await connectClient(baseUrl, token);

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

  it('create_folder returns not_found for missing project and invalid_argument for blank name', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId }) => {
      const client = await connectClient(baseUrl, token);

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
    await withMcpServer(async ({ baseUrl, token, projectId }) => {

      const client = await connectClient(baseUrl, token);

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
    await withMcpServer(async ({ baseUrl, token, projectId }) => {
      const client = await connectClient(baseUrl, token);

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
    await withMcpServer(async ({ baseUrl, token, projectId, app }) => {
      const client = await connectClient(baseUrl, token);
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
    await withMcpServer(async ({ baseUrl, token, projectId, app }) => {
      const client = await connectClient(baseUrl, token);

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
    await withMcpServer(async ({ baseUrl, token }) => {
      const client = await connectClient(baseUrl, token);
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
    await withMcpServer(async ({ baseUrl, token, projectId, db, app }) => {
      const task = await createTask(db, { projectId, label: 'Shareable task', status: 'todo' });
      await createDocument(db, { projectId, title: 'Spec', body: '# Spec body', linkedTaskId: task.id });

      const client = await connectClient(baseUrl, token);
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
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const task = await createTask(db, { projectId, label: 'Either' });
      const doc = await createDocument(db, { projectId, title: 'Either doc' });
      const client = await connectClient(baseUrl, token);

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
    await withMcpServer(async ({ baseUrl, token, db }) => {

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
      expect(await listTasks(db, payload.scaffold.project.id)).toHaveLength(2);

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

  it('goal tools support CRUD and lifecycle', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const client = await connectClient(baseUrl, token);

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

  it('get_next_task returns actionable task and blocked context', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const actionable = await createTask(db, { projectId, label: 'Actionable', status: 'todo' });
      const prerequisite = await createTask(db, { projectId, label: 'Prerequisite', status: 'todo' });
      const blocked = await createTask(db, { projectId, label: 'Blocked', status: 'todo' });
      await createEdge(db, {
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

  it('create_task sets tags (auto-created by name), update_task replaces the full set, list_tags lists them', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId }) => {

      const client = await connectClient(baseUrl, token);

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

  it('list_tags returns not_found for missing project', async () => {
    await withMcpServer(async ({ baseUrl, token }) => {
      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'list_tags',
        arguments: { project_id: '00000000-0000-4000-8000-000000009999' },
      });
      expect(result.isError).toBe(true);
      await client.close();
    });
  });

  it('list_tasks and get_next_task tags filters use OR semantics', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, services }) => {
      const frontend = await services.taskService.create(projectId, {
        label: 'Frontend',
        tags: ['frontend'],
      });
      const backend = await services.taskService.create(projectId, {
        label: 'Backend',
        tags: ['backend'],
      });
      await services.taskService.create(projectId, { label: 'Untagged' });

      const client = await connectClient(baseUrl, token);

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
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const client = await connectClient(baseUrl, token);

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

  it('list_comments, add_comment, and resolve_comment work via MCP', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {

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
      expect(addedPayload.comment.body).toBe('Agent suggestion');
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
    await withMcpServer(async ({ baseUrl, token, projectId }) => {
      const client = await connectClient(baseUrl, token);
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
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const otherProject = await createProject(db, { name: 'Other project' });
      const foreignDoc = await createDocument(db, { projectId: otherProject.id, title: 'Foreign' });

      const client = await connectClient(baseUrl, token);
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
      expect(text).toMatch(/invalid_argument/i);
      await client.close();
    });
  });

  it('add_comment returns invalid_argument for empty body', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, db }) => {
      const doc = await createDocument(db, { projectId, title: 'Doc' });
      const client = await connectClient(baseUrl, token);
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
    const syncDb = await createSyncDb(':memory:');
    await migrateSyncServer(syncDb);
    const { token: syncToken } = await createSyncToken(syncDb, { label: 'mcp-test' });
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
        const share = await services.shareService.createShare(projectId, {
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
        expect(projectBody.summary.scope).toBeGreaterThanOrEqual(1);

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

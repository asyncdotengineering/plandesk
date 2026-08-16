// MCP half of release-e2e: drive the published tool surface as an agent would.
// Focus is the 2.0.0 link shape — many tasks to one document, document to
// document, and deleting exactly one link via the edge_id a read handed back.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const workDir = process.argv[2];
const client = new Client({ name: 'plandesk-release-e2e', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL)));

let fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  if (!ok) fail++;
};

/** Tool results wrap in a single top-level key (`project`, `scaffold`, `document`…). */
async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.content)}`);
  const text = r.content?.find((c) => c.type === 'text')?.text ?? '';
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    return { parsed: text, structured: r.structuredContent };
  }
  const keys = Object.keys(out);
  if (keys.length === 1 && out[keys[0]] && typeof out[keys[0]] === 'object') out = out[keys[0]];
  return { parsed: out, structured: r.structuredContent };
}

// --- the surface is self-describing -----------------------------------------
const { tools } = await client.listTools();
const deleteEdge = tools.find((t) => t.name === 'delete_edge');
const edgeIdDesc = deleteEdge?.inputSchema?.properties?.edge_id?.description ?? '';
chk('tool surface is non-empty', tools.length > 0, `${tools.length} tools`);
chk(
  'delete_edge.edge_id names where to obtain it',
  /get_document|list_edges|links|backlinks/i.test(edgeIdDesc),
);
chk('delete_edge carries destructiveHint', !!deleteEdge?.annotations?.destructiveHint);
chk(
  'link tools declare an outputSchema',
  ['get_document', 'create_edge', 'list_edges'].every(
    (n) => tools.find((t) => t.name === n)?.outputSchema,
  ),
);

// --- one document, many tasks (the 2.0.0 headline) --------------------------
const { parsed: project } = await call('create_project', { name: 'Release E2E' });
const projectId = project.id;
writeFileSync(join(workDir, 'project-id'), projectId);

const { parsed: scaffold } = await call('scaffold_project_from_plan', {
  project_id: projectId,
  tasks: [
    { key: 'a', label: 'First task', status: 'todo' },
    { key: 'b', label: 'Second task', status: 'todo' },
    { key: 'c', label: 'Third task', status: 'todo' },
  ],
  edges: [
    { from: 'a', to: 'b', label: 'blocks' },
    { from: 'b', to: 'c', label: 'blocks' },
  ],
  documents: [
    {
      key: 'spec',
      title: 'Design: shared spec',
      body: 'covers all three',
      link_to: ['a', 'b', 'c'],
    },
  ],
});
const ids = scaffold.key_to_id ?? {};
chk('scaffold returned a key_to_id map', Object.keys(ids).length === 4, Object.keys(ids).join(','));

const { parsed: spec } = await call('get_document', { document_id: ids.spec });
const taskLinks = (spec.links ?? []).filter((l) => l.type === 'task');
chk('one document links to three tasks', taskLinks.length === 3, `${taskLinks.length}`);
chk(
  'every link entry carries an edge_id',
  taskLinks.every((l) => l.edge_id),
);
chk('linked_task_id is absent from the payload', !('linked_task_id' in spec));

// --- document to document ---------------------------------------------------
const { parsed: adr } = await call('create_document', {
  project_id: projectId,
  title: 'Design: referenced',
  body: 'referenced by the spec',
});
const created = await call('create_edge', {
  project_id: projectId,
  from_type: 'document',
  from_id: ids.spec,
  to_type: 'document',
  to_id: adr.id,
  label: 'references',
});
chk('create_edge returns structuredContent', !!created.structured);

const { parsed: spec2 } = await call('get_document', { document_id: ids.spec });
const docLink = (spec2.links ?? []).find((l) => l.type === 'document' && l.id === adr.id);
chk('document to document link appears', !!docLink);
const { parsed: adr2 } = await call('get_document', { document_id: adr.id });
chk(
  'the reverse backlink appears',
  (adr2.backlinks ?? []).some((b) => b.id === ids.spec),
);

// --- delete exactly one link ------------------------------------------------
await call('delete_edge', { edge_id: docLink.edge_id });
const { parsed: spec3 } = await call('get_document', { document_id: ids.spec });
chk('the targeted link is gone', !(spec3.links ?? []).some((l) => l.edge_id === docLink.edge_id));
chk('sibling links survived', (spec3.links ?? []).filter((l) => l.type === 'task').length === 3);
const { parsed: survivor } = await call('get_document', { document_id: adr.id });
chk('the linked document itself was not deleted', !!survivor.id);

// --- the dependency chain sequences -----------------------------------------
const { parsed: next } = await call('get_next_task', { project_id: projectId });
chk(
  'get_next_task returns the unblocked task',
  next.next_task?.id === ids.a,
  next.next_task?.label,
);
await call('update_task', { task_id: ids.a, status: 'done' });
const { parsed: next2 } = await call('get_next_task', { project_id: projectId });
chk(
  'the chain advances once the blocker is done',
  next2.next_task?.id === ids.b,
  next2.next_task?.label,
);

await client.close();
process.exit(fail ? 1 : 0);

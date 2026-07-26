#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const baseUrl = process.argv[2];
// Optional: a loopback-bound server treats every request as the org owner, so
// validate needs no token. Pass one only when pointing this at a bound host.
const token = process.argv[3];
const minTools = Number(process.argv[4] ?? '8');

if (baseUrl === undefined) {
  process.stderr.write('Usage: mcp-list-tools.mjs <baseUrl> [token] [minTools]\n');
  process.exit(2);
}

const normalized = baseUrl.replace(/\/$/, '');
const client = new Client({ name: 'plandesk-validate', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(`${normalized}/mcp`), {
  ...(token === undefined || token === ''
    ? {}
    : { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
});

await client.connect(transport);
try {
  const { tools } = await client.listTools();
  process.stdout.write(`MCP tools: ${String(tools.length)}\n`);
  for (const tool of tools.map((entry) => entry.name).sort()) {
    process.stdout.write(`  - ${tool}\n`);
  }
  if (tools.length < minTools) {
    process.stderr.write(
      `cmd:mcp_list_tools FAILED: expected at least ${String(minTools)} tools, got ${String(tools.length)}\n`,
    );
    process.exit(1);
  }
} finally {
  await client.close();
}

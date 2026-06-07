#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir, hostname, platform, arch, cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLANDESK = join(ROOT, 'packages/plandesk-cli/bin/plandesk');
const METRICS_PATH = join(ROOT, 'METRICS.md');
const MCP_SDK = join(ROOT, 'packages/plandesk-cli/node_modules/@modelcontextprotocol/sdk/dist/esm');

const TARGETS = {
  coldStartMs: 5000,
  mcpP95Ms: 2000,
  sseP95Ms: 500,
};

let dataDir = '';
let serverChild = null;

function cleanup() {
  if (serverChild !== null && !serverChild.killed) {
    serverChild.kill('SIGTERM');
    serverChild = null;
  }
  if (dataDir !== '') {
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = '';
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

async function pickPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'object') {
        const port = address?.port;
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          if (port === undefined) {
            reject(new Error('failed to allocate port'));
            return;
          }
          resolve(port);
        });
        return;
      }
      reject(new Error('unexpected address type'));
    });
    server.on('error', reject);
  });
}

function runPlandesk(args) {
  const result = spawnSync(PLANDESK, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `plandesk ${args.join(' ')} failed (${String(result.status)}): ${result.stderr || result.stdout}`,
    );
  }
  return (result.stdout ?? '').trim();
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/health`);
      if (res.ok) {
        const body = await res.json();
        if (body?.ok === true) {
          return;
        }
      }
    } catch {
      // server still starting
    }
    await sleep(50);
  }
  throw new Error(`server did not become healthy within ${String(timeoutMs)} ms`);
}

async function measureColdStart(baseUrl, port) {
  const spawnAt = performance.now();
  serverChild = spawn(PLANDESK, ['serve', '--port', String(port), '--data-dir', dataDir], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  serverChild.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const deadline = performance.now() + 30000;
  while (performance.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Cold Start Probe' }),
      });
      if (res.status === 201) {
        const project = await res.json();
        return {
          ms: performance.now() - spawnAt,
          projectId: project.id,
        };
      }
    } catch {
      // retry until ready
    }
    if (serverChild.exitCode !== null) {
      throw new Error(`plandesk serve exited early (${String(serverChild.exitCode)}): ${stderr}`);
    }
    await sleep(25);
  }
  throw new Error(`cold start timed out; stderr: ${stderr}`);
}

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

async function loadMcpSdk() {
  const { Client } = await import(pathToFileURL(join(MCP_SDK, 'client/index.js')).href);
  const { StreamableHTTPClientTransport } = await import(
    pathToFileURL(join(MCP_SDK, 'client/streamableHttp.js')).href
  );
  return { Client, StreamableHTTPClientTransport };
}

async function connectMcp(baseUrl, token) {
  const { Client, StreamableHTTPClientTransport } = await loadMcpSdk();
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  const client = new Client({ name: 'plandesk-metrics', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function mcpListInspect(client, projectId) {
  const start = performance.now();
  const listed = await client.callTool({ name: 'list_projects', arguments: {} });
  if (listed.isError) {
    throw new Error('list_projects failed');
  }
  const detail = await client.callTool({
    name: 'get_project',
    arguments: { project_id: projectId },
  });
  if (detail.isError) {
    throw new Error('get_project failed');
  }
  return performance.now() - start;
}

function parseSseEvents(chunk) {
  const events = [];
  for (const part of chunk.split('\n\n')) {
    for (const line of part.split('\n')) {
      if (line.startsWith('data: ')) {
        events.push(JSON.parse(line.slice(6)));
      }
    }
  }
  return events;
}

async function openSseCollector(baseUrl) {
  const ac = new AbortController();
  const res = await fetch(`${baseUrl}/api/v1/events`, { signal: ac.signal });
  if (!res.ok || res.body === null) {
    throw new Error(`SSE connect failed (${String(res.status)})`);
  }

  const queue = [];
  let resolveNext = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          for (const event of parseSseEvents(part)) {
            queue.push(event);
            resolveNext?.();
            resolveNext = null;
          }
        }
      }
      if (buffer.length > 0) {
        for (const event of parseSseEvents(buffer)) {
          queue.push(event);
          resolveNext?.();
          resolveNext = null;
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        throw err;
      }
    }
  })();

  return {
    async waitForTaskUpdated(taskId, sinceMs, timeoutMs = 2000) {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        const idx = queue.findIndex(
          (event) => event?.type === 'task_updated' && event.taskId === taskId,
        );
        if (idx !== -1) {
          queue.splice(idx, 1);
          return performance.now() - sinceMs;
        }
        await new Promise((resolve) => {
          resolveNext = resolve;
          setTimeout(resolve, 10);
        });
      }
      throw new Error(`task_updated for ${taskId} not received within ${String(timeoutMs)} ms`);
    },
    async close() {
      ac.abort();
      await pump;
    },
  };
}

async function measureSseLatency(baseUrl, taskId, iterations) {
  const collector = await openSseCollector(baseUrl);
  const statuses = ['todo', 'in_progress', 'done', 'in_progress'];
  const samples = [];

  try {
    await sleep(50);
    for (let i = 0; i < iterations; i += 1) {
      const status = statuses[i % statuses.length];
      const patchStart = performance.now();
      const res = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        throw new Error(`PATCH task failed (${String(res.status)})`);
      }
      const latency = await collector.waitForTaskUpdated(taskId, patchStart);
      samples.push(latency);
    }
  } finally {
    await collector.close();
  }

  return summarize(samples);
}

async function jsonFetch(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${init?.method ?? 'GET'} ${url} failed (${String(res.status)}): ${text}`);
  }
  return res.json();
}

async function buildExportFixture(baseUrl, projectId) {
  const nodeA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const nodeB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  await jsonFetch(`${baseUrl}/api/v1/projects/${projectId}/canvas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodes: [
        { id: nodeA, label: 'Design', x: 10, y: 20 },
        { id: nodeB, label: 'Build', x: 100, y: 200 },
      ],
      edges: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          from_task_id: nodeA,
          to_task_id: nodeB,
          label: 'blocks',
          arrow_direction: 'forward',
          style: 'solid',
        },
        {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          from_task_id: nodeB,
          to_task_id: nodeA,
          label: 'feedback',
          arrow_direction: 'both',
          style: 'dashed',
        },
      ],
      layout: { zoom: 1.25 },
    }),
  });

  const parentDoc = await jsonFetch(`${baseUrl}/api/v1/projects/${projectId}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Parent Spec',
      body: '# Parent',
      status_line: 'Status: approved',
    }),
  });

  await jsonFetch(`${baseUrl}/api/v1/projects/${projectId}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Child Spec',
      body: '## Child section',
      status_line: 'Status: draft',
      parent_id: parentDoc.id,
      linked_task_id: nodeA,
    }),
  });
}

function toComparable(exported) {
  const taskLabelById = new Map(exported.tasks.map((task) => [task.id, task.label]));
  const documentTitleById = new Map(exported.documents.map((doc) => [doc.id, doc.title]));

  return {
    project: {
      name: exported.project.name,
      description: exported.project.description,
      canvas_layout: exported.project.canvas_layout,
    },
    tasks: [...exported.tasks]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((task) => ({
        label: task.label,
        status: task.status,
        description: task.description,
        x: task.x,
        y: task.y,
        assignee: task.assignee,
        due_date: task.due_date,
      })),
    edges: [...exported.edges]
      .sort((a, b) => {
        const fromA = taskLabelById.get(a.from_task_id) ?? '';
        const fromB = taskLabelById.get(b.from_task_id) ?? '';
        if (fromA !== fromB) {
          return fromA.localeCompare(fromB);
        }
        const toA = taskLabelById.get(a.to_task_id) ?? '';
        const toB = taskLabelById.get(b.to_task_id) ?? '';
        return toA.localeCompare(toB);
      })
      .map((edge) => ({
        from_label: taskLabelById.get(edge.from_task_id) ?? edge.from_task_id,
        to_label: taskLabelById.get(edge.to_task_id) ?? edge.to_task_id,
        label: edge.label,
        arrow_direction: edge.arrow_direction,
        style: edge.style,
      })),
    documents: [...exported.documents]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((document) => ({
        title: document.title,
        body: document.body,
        status_line: document.status_line,
        parent_title:
          document.parent_id === null
            ? null
            : (documentTitleById.get(document.parent_id) ?? document.parent_id),
        linked_task_label:
          document.linked_task_id === null
            ? null
            : (taskLabelById.get(document.linked_task_id) ?? document.linked_task_id),
      })),
    agent_runs: [...(exported.agent_runs ?? [])].map((run) => ({
      status: run.status,
      label: run.label,
      events: (run.events ?? []).map((event) => event.message),
    })),
  };
}

async function stopServer() {
  if (serverChild === null) {
    return;
  }
  const child = serverChild;
  serverChild = null;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

function measureExportImport(projectId, exportPath) {
  runPlandesk(['export', '--data-dir', dataDir, '--project', projectId, '--out', exportPath]);
  const source = JSON.parse(readFileSync(exportPath, 'utf8'));
  const importedProjectId = runPlandesk(['import', '--data-dir', dataDir, '--in', exportPath]);
  const reExportPath = `${exportPath}.re`;
  runPlandesk([
    'export',
    '--data-dir',
    dataDir,
    '--project',
    importedProjectId,
    '--out',
    reExportPath,
  ]);
  const reExported = JSON.parse(readFileSync(reExportPath, 'utf8'));

  const sourceComparable = toComparable(source);
  const importedComparable = toComparable(reExported);
  const lossless =
    JSON.stringify(sourceComparable) === JSON.stringify(importedComparable) &&
    source.tasks.length === reExported.tasks.length &&
    source.edges.length === reExported.edges.length &&
    source.documents.length === reExported.documents.length;

  return {
    lossless,
    counts: {
      tasks: source.tasks.length,
      edges: source.edges.length,
      documents: source.documents.length,
    },
    importedProjectId,
  };
}

function machineNote() {
  const cpu = cpus()[0]?.model?.trim() ?? 'unknown CPU';
  return `${platform()} ${arch()} (${hostname()}); ${cpu}; Node ${process.version}`;
}

function formatMs(ms) {
  return `${ms.toFixed(1)} ms`;
}

function passFlag(actual, target, higherIsBad = true) {
  if (higherIsBad) {
    return actual <= target ? 'PASS' : 'MISS';
  }
  return actual ? 'PASS' : 'MISS';
}

function writeMetricsMd(results) {
  const lines = [
    '# Plan Desk v1 Metrics',
    '',
    `Measured: ${results.measuredAt}`,
    '',
    `Machine: ${results.machine}`,
    '',
    '## Results vs RFC §1 targets',
    '',
    '| Metric | Target | Measured | Status |',
    '|--------|--------|----------|--------|',
    `| Cold start (serve spawn → first \`POST /projects\`) | < ${TARGETS.coldStartMs / 1000} s | ${formatMs(results.coldStartMs)} (${(results.coldStartMs / 1000).toFixed(2)} s) | ${passFlag(results.coldStartMs, TARGETS.coldStartMs)} |`,
    `| MCP \`list_projects\` + \`get_project\` p50 | — | ${formatMs(results.mcp.p50)} | — |`,
    `| MCP \`list_projects\` + \`get_project\` p95 | < ${TARGETS.mcpP95Ms / 1000} s | ${formatMs(results.mcp.p95)} | ${passFlag(results.mcp.p95, TARGETS.mcpP95Ms)} |`,
    `| SSE \`task_updated\` latency p50 (PATCH → event) | — | ${formatMs(results.sse.p50)} | — |`,
    `| SSE \`task_updated\` latency p95 | < ${TARGETS.sseP95Ms} ms | ${formatMs(results.sse.p95)} | ${passFlag(results.sse.p95, TARGETS.sseP95Ms)} |`,
    `| Export/import lossless (counts + links) | lossless | ${results.exportImport.lossless ? 'true' : 'false'} (tasks=${String(results.exportImport.counts.tasks)}, edges=${String(results.exportImport.counts.edges)}, docs=${String(results.exportImport.counts.documents)}) | ${passFlag(results.exportImport.lossless, true, false)} |`,
    '',
  ];

  const misses = [];
  if (results.coldStartMs > TARGETS.coldStartMs) {
    misses.push('cold start');
  }
  if (results.mcp.p95 > TARGETS.mcpP95Ms) {
    misses.push('MCP p95');
  }
  if (results.sse.p95 > TARGETS.sseP95Ms) {
    misses.push('SSE p95');
  }
  if (!results.exportImport.lossless) {
    misses.push('export/import');
  }

  if (misses.length > 0) {
    lines.push(
      '## Notes',
      '',
      `Targets missed on this run: ${misses.join(', ')}. Numbers above are measured, not asserted — consider RFC amendment or optimization if structural.`,
      '',
    );
  }

  lines.push(
    '## Measurement rig',
    '',
    '- Script: `node scripts/metrics.mjs` (also `pnpm metrics`).',
    '- Isolated temp data dir + ephemeral loopback port; `plandesk init` before serve.',
    '- Cold start: fresh `plandesk serve` spawn until first successful `POST /api/v1/projects`.',
    '- MCP: Bearer token; 50 sequential `list_projects` + `get_project` pairs via Streamable HTTP MCP.',
    '- SSE: one `/api/v1/events` subscriber; 20 `PATCH /api/v1/tasks/:id` toggles; time to `task_updated`.',
    '- Export/import: REST fixture (canvas nodes/edges + linked docs) → CLI export → import → re-export; compare structure without IDs.',
    '- Server and temp dir are trapped on exit.',
    '',
  );

  writeFileSync(METRICS_PATH, `${lines.join('\n')}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

async function main() {
  if (!spawnSync(PLANDESK, ['--help'], { encoding: 'utf8' }).stdout?.includes('serve')) {
    throw new Error(`plandesk CLI missing or not built at ${PLANDESK}`);
  }

  dataDir = mkdtempSync(join(tmpdir(), 'plandesk-metrics-'));
  const port = await pickPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const exportPath = join(dataDir, 'export.json');

  log('Plan Desk metrics (RFC §1)');
  log(`data-dir: ${dataDir}`);
  log(`base-url: ${baseUrl}`);

  runPlandesk(['init', '--data-dir', dataDir]);

  const cold = await measureColdStart(baseUrl, port);
  log(`cold_start: ${formatMs(cold.ms)} (${(cold.ms / 1000).toFixed(2)} s)`);

  const token = runPlandesk(['token', 'create', '--name', 'metrics', '--data-dir', dataDir]);
  const mcpClient = await connectMcp(baseUrl, token);
  await mcpListInspect(mcpClient, cold.projectId);

  const mcpSamples = [];
  for (let i = 0; i < 50; i += 1) {
    mcpSamples.push(await mcpListInspect(mcpClient, cold.projectId));
  }
  await mcpClient.close();
  const mcp = summarize(mcpSamples);
  log(`mcp_list_inspect: n=${String(mcp.n)} p50=${formatMs(mcp.p50)} p95=${formatMs(mcp.p95)}`);

  const fixtureProject = await jsonFetch(`${baseUrl}/api/v1/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Metrics Fixture', description: 'SSE + export/import' }),
  });
  const canvas = await jsonFetch(`${baseUrl}/api/v1/projects/${fixtureProject.id}/canvas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodes: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', label: 'SSE Task', x: 0, y: 0 }],
      edges: [],
    }),
  });
  const sseTaskId = canvas.nodes[0]?.id;
  if (typeof sseTaskId !== 'string') {
    throw new Error('failed to create SSE task');
  }

  const sse = await measureSseLatency(baseUrl, sseTaskId, 20);
  log(`sse_task_updated: n=${String(sse.n)} p50=${formatMs(sse.p50)} p95=${formatMs(sse.p95)}`);

  await buildExportFixture(baseUrl, fixtureProject.id);
  await stopServer();

  const exportImport = measureExportImport(fixtureProject.id, exportPath);
  log(
    `export_import_lossless: ${exportImport.lossless ? 'true' : 'false'} (tasks=${String(exportImport.counts.tasks)}, edges=${String(exportImport.counts.edges)}, docs=${String(exportImport.counts.documents)})`,
  );

  const measuredAt = new Date().toISOString();
  const results = {
    measuredAt,
    machine: machineNote(),
    coldStartMs: cold.ms,
    mcp,
    sse,
    exportImport,
  };

  writeMetricsMd(results);

  log('');
  log(`METRICS.md updated (${METRICS_PATH})`);
  log(`measured_at: ${measuredAt}`);
  log(`machine: ${results.machine}`);

  const allPass =
    cold.ms <= TARGETS.coldStartMs &&
    mcp.p95 <= TARGETS.mcpP95Ms &&
    sse.p95 <= TARGETS.sseP95Ms &&
    exportImport.lossless;

  if (!allPass) {
    log('');
    log('One or more targets missed — see METRICS.md for details.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  cleanup();
  process.exit(1);
});

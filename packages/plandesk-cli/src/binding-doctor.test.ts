import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getRequestListener } from '@hono/node-server';
import { createApp, createServices } from '@plandesk/api';
import { createDb, createProjectInDefaultOrg as createProject, migrate } from '@plandesk/db';
import { createMcpApp } from '@plandesk/mcp';
import { buildConfigJson } from './connect-artifacts.js';
import { formatBindingDoctorReport, runBindingDoctor } from './binding-doctor.js';

/** Boot a real loopback server (bound to `dataDir`, health-identifiable) with one project. */
async function withBoundRepo(
  dataDir: string,
  run: (ctx: { repoDir: string; baseUrl: string }) => Promise<void>,
): Promise<void> {
  const db = await createDb(':memory:');
  await migrate(db);
  const project = await createProject(db, { name: 'binding-doctor-repo' });
  const services = createServices({ db, orgId: project.orgId });
  const mcpApp = createMcpApp({ services });
  const app = createApp({ db, services, mcp: mcpApp, dataDir });

  const server = createServer((req, res) => {
    void getRequestListener(app.fetch)(req, res);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('expected TCP address');
  }
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-binding-doctor-repo-'));
  mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
  writeFileSync(
    join(repoDir, '.plandesk', 'config.json'),
    buildConfigJson({ serverUrl: baseUrl, projectId: project.id, projectName: project.name }),
    'utf8',
  );

  try {
    await run({ repoDir, baseUrl });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    rmSync(repoDir, { recursive: true, force: true });
  }
}

describe('runBindingDoctor served-board identity (REQ-A3b)', () => {
  it('reports the served dataDir from the bound server health endpoint', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-binding-doctor-board-'));
    try {
      await withBoundRepo(dataDir, async ({ repoDir }) => {
        const report = await runBindingDoctor(repoDir);
        expect(report.servedDataDir).toBe(dataDir);
        expect(report.issues).toEqual([]);
      });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('flags a divergence when the served board does not match the expected one', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-binding-doctor-board-'));
    try {
      await withBoundRepo(dataDir, async ({ repoDir }) => {
        const report = await runBindingDoctor(repoDir, '/some/other/expected/board');
        expect(report.servedDataDir).toBe(dataDir);
        expect(report.issues.some((issue) => issue.includes('does not match'))).toBe(true);
      });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('reports no divergence issue when the served board matches the expected one', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-binding-doctor-board-'));
    try {
      await withBoundRepo(dataDir, async ({ repoDir }) => {
        const report = await runBindingDoctor(repoDir, dataDir);
        expect(report.issues).toEqual([]);
      });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('formatBindingDoctorReport mcp-tools annotation (REQ-A5a)', () => {
  it('annotates binding-mcp-tools: 0 as expected on a fresh loopback connect (no token, no issue)', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-binding-doctor-board-'));
    try {
      await withBoundRepo(dataDir, async ({ repoDir }) => {
        const report = await runBindingDoctor(repoDir);
        expect(report.mcpToolCount).toBe(0);
        expect(report.issues).toEqual([]);
        const lines = formatBindingDoctorReport(report);
        expect(lines).toContain(
          'binding-mcp-tools: 0 (expected until a fresh agent session connects)',
        );
      });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('does not soften the annotation when zero tools IS a flagged issue', () => {
    const lines = formatBindingDoctorReport({
      present: true,
      serverReachable: true,
      tokenValid: false,
      projectExists: true,
      mcpToolCount: 0,
      issues: ['MCP tools list is empty'],
    });
    expect(lines).toContain('binding-mcp-tools: 0');
    expect(lines).not.toContain(
      'binding-mcp-tools: 0 (expected until a fresh agent session connects)',
    );
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acceptOrganizationInvitation,
  createBetterAuth,
  mintSessionCookieHeader,
  runBetterAuthMigrations,
} from '@plandesk/api';
import { DEFAULT_ORG_ID, createDb, migrate } from '@plandesk/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from './args.js';
import { main } from './cli.js';
import { runInit } from './init.js';
import { formatAdminInviteOwnerSummary, runAdminInviteOwner } from './admin.js';

async function captureIo(
  run: () => Promise<number> | number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });

  let code = 1;
  try {
    code = await Promise.resolve(run());
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }

  return {
    code,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
  };
}

describe('plandesk admin invite-owner (BA3c REQ-3)', () => {
  it('parses admin invite-owner --email', () => {
    expect(
      parseArgs(['node', 'plandesk', 'admin', 'invite-owner', '--email', 'founder@x.com']),
    ).toEqual({
      command: 'admin',
      subcommand: 'invite-owner',
      email: 'founder@x.com',
      dataDir: undefined,
      dbUrl: undefined,
      dbToken: undefined,
      secret: undefined,
    });
  });

  it('parses admin invite-owner with remote --db/--db-token/--secret', () => {
    expect(
      parseArgs([
        'node',
        'plandesk',
        'admin',
        'invite-owner',
        '--email',
        'founder@x.com',
        '--db',
        'libsql://example.turso.io',
        '--db-token',
        'tok',
        '--secret',
        'deployed-secret',
      ]),
    ).toEqual({
      command: 'admin',
      subcommand: 'invite-owner',
      email: 'founder@x.com',
      dataDir: undefined,
      dbUrl: 'libsql://example.turso.io',
      dbToken: 'tok',
      secret: 'deployed-secret',
    });
  });

  it('prints a claim link with no GitHub app configured', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-admin-ws-'));
    try {
      await runInit(dataDir);
      const { createDb: open, migrate: mig } = await import('@plandesk/db');
      const { workspaceDbPath } = await import('./args.js');
      const db = await open(workspaceDbPath(dataDir));
      await mig(db);

      const result = await runAdminInviteOwner(db, {
        email: 'founder@x.com',
        dataDir,
        baseURL: 'http://127.0.0.1:7526',
      });
      expect(result.email).toBe('founder@x.com');
      expect(result.invitationId.length).toBeGreaterThan(0);
      expect(result.claimUrl).toContain(result.invitationId);
      expect(result.claimUrl).toContain('/invite/');

      const summary = formatAdminInviteOwnerSummary(result);
      expect(summary).toContain('founder@x.com');
      expect(summary).toContain(result.claimUrl);

      // Accepting (server-side) yields an owner member.
      const secretPath = join(dataDir, 'better-auth-secret');
      const { readFileSync } = await import('node:fs');
      const secret = readFileSync(secretPath, 'utf8').trim();
      const auth = createBetterAuth({
        client: db.$client,
        secret,
        baseURL: 'http://127.0.0.1:7526',
      });
      if (auth === undefined) throw new Error('expected better-auth');
      await runBetterAuthMigrations(auth);

      const adapter = (await auth.$context).adapter;
      const now = new Date();
      const founder = await adapter.create<{
        id: string;
        name: string;
        email: string;
        emailVerified: boolean;
        image: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>({
        model: 'user',
        data: {
          name: 'Founder',
          email: 'founder@x.com',
          emailVerified: true,
          image: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      const headers = await mintSessionCookieHeader(auth, founder.id);
      const accepted = await acceptOrganizationInvitation(auth, {
        invitationId: result.invitationId,
        headers,
      });
      expect(accepted.member.role).toBe('owner');
      expect(accepted.member.userId).toBe(founder.id);

      expect(accepted.member.organizationId).toBe(DEFAULT_ORG_ID);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('CLI entry prints claim link and exits 0', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-admin-cli-'));
    try {
      await runInit(dataDir);
      const io = await captureIo(() =>
        main([
          'node',
          'plandesk',
          'admin',
          'invite-owner',
          '--email',
          'founder@x.com',
          '--data-dir',
          dataDir,
        ]),
      );
      expect(io.code).toBe(0);
      expect(io.stdout).toContain('founder@x.com');
      expect(io.stdout).toContain('/invite/');
      expect(io.stdout).toContain('claim link');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('runAdminInviteOwner with explicit secret mints owner invitation (remote path)', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-admin-remote-'));
    try {
      // Local file DB stands in for remote Turso. Secret path omits dataDir so
      // ensureLocalBetterAuthSecret cannot run (would throw without dataDir).
      const dbPath = join(dataDir, 'remote-standin.db');
      const db = await createDb(dbPath);
      await migrate(db);
      const remoteSecret = 'remote-deployed-secret-not-from-data-dir';

      // Operator would run `plandesk migrate` against the remote DB first.
      const auth = createBetterAuth({
        client: db.$client,
        secret: remoteSecret,
        baseURL: 'https://plandesk.example',
      });
      if (auth === undefined) throw new Error('expected better-auth');
      await runBetterAuthMigrations(auth);

      const result = await runAdminInviteOwner(db, {
        email: 'ops@example.com',
        secret: remoteSecret,
        baseURL: 'https://plandesk.example',
      });

      expect(result.email).toBe('ops@example.com');
      expect(result.invitationId.length).toBeGreaterThan(0);
      expect(result.claimUrl).toContain('https://plandesk.example/invite/');
      expect(result.claimUrl).toContain(result.invitationId);

      const summary = formatAdminInviteOwnerSummary(result);
      expect(summary).toContain('ops@example.com');
      expect(summary).toContain(result.claimUrl);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('admin invite-owner claim link origin', () => {
  const secret = 'claim-origin-test-secret';
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true });
  });

  /** A prepared file database standing in for the deployed one, plus an empty data dir. */
  async function preparedDb(): Promise<{ dbPath: string; dataDir: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'plandesk-admin-origin-'));
    dirs.push(dir);
    const dbPath = join(dir, 'deployed.db');
    const db = await createDb(dbPath);
    await migrate(db);
    const auth = createBetterAuth({ client: db.$client, secret, baseURL: 'http://unused' });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir);
    return { dbPath, dataDir };
  }

  function invite(dbPath: string, dataDir: string, extra: string[] = []) {
    return captureIo(() =>
      main([
        'node',
        'plandesk',
        'admin',
        'invite-owner',
        '--email',
        'owner@example.com',
        '--db',
        dbPath,
        '--secret',
        secret,
        '--data-dir',
        dataDir,
        ...extra,
      ]),
    );
  }

  function claimLink(stdout: string): string {
    return /claim link:\s+(\S+)/.exec(stdout)?.[1] ?? '';
  }

  it('builds the link on PLANDESK_BASE_URL', async () => {
    const { dbPath, dataDir } = await preparedDb();
    vi.stubEnv('PLANDESK_BASE_URL', 'https://boards.example');
    const io = await invite(dbPath, dataDir);
    expect(io.code).toBe(0);
    expect(claimLink(io.stdout).startsWith('https://boards.example/')).toBe(true);
    expect(io.stderr).not.toContain('only works on this machine');
  });

  it('builds the link on the config file baseUrl when the env is unset', async () => {
    const { dbPath, dataDir } = await preparedDb();
    vi.stubEnv('PLANDESK_BASE_URL', '');
    writeFileSync(
      join(dataDir, 'plandesk.server.json'),
      JSON.stringify({ baseUrl: 'https://file.example' }),
    );
    const io = await invite(dbPath, dataDir);
    expect(io.code).toBe(0);
    expect(claimLink(io.stdout).startsWith('https://file.example/')).toBe(true);
  });

  it('--base-url wins over PLANDESK_BASE_URL', async () => {
    const { dbPath, dataDir } = await preparedDb();
    vi.stubEnv('PLANDESK_BASE_URL', 'https://boards.example');
    const io = await invite(dbPath, dataDir, ['--base-url', 'https://flag.example']);
    expect(io.code).toBe(0);
    expect(claimLink(io.stdout).startsWith('https://flag.example/')).toBe(true);
  });

  it('with no base URL, keeps the loopback link and warns it only works here', async () => {
    const { dbPath, dataDir } = await preparedDb();
    vi.stubEnv('PLANDESK_BASE_URL', '');
    const io = await invite(dbPath, dataDir);
    expect(io.code).toBe(0);
    expect(claimLink(io.stdout).startsWith('http://127.0.0.1')).toBe(true);
    expect(io.stderr).toContain('only works on this machine');
    expect(io.stderr).toContain('PLANDESK_BASE_URL');
    expect(io.stderr).toContain('--base-url');
  });
});

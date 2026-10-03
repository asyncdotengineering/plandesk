import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ORG_ID } from '@plandesk/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeWorkspaceJson } from './connect-artifacts.js';
import { runWorkspaceList } from './workspace-command.js';

describe('plandesk workspace (local)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('targets the custom port recorded in workspace.json', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'pd-ws-port-'));
    try {
      mkdirSync(join(repoDir, '.plandesk'));
      writeWorkspaceJson(join(repoDir, '.plandesk'), 49123);
      const urls: string[] = [];
      vi.stubGlobal('fetch', (input: string | URL) => {
        urls.push(String(input));
        return Promise.resolve(Response.json({ workspaces: [] }));
      });
      vi.spyOn(process.stdout, 'write').mockReturnValue(true);

      await runWorkspaceList({ repoDir });

      expect(urls).toEqual([`http://127.0.0.1:49123/api/v1/orgs/${DEFAULT_ORG_ID}/workspaces`]);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

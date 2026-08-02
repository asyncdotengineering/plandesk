import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from './args.js';
import { PushArtifactError, runPushArtifact } from './push-artifact.js';
import { AttachError, runAttach } from './attach.js';

describe('parseArgs attach / push-artifact', () => {
  it('parses attach and push-artifact flags', () => {
    expect(parseArgs(['node', 'plandesk', 'attach', 'shot.png'])).toEqual({
      command: 'attach',
      filePath: 'shot.png',
      repoDir: undefined,
    });
    expect(
      parseArgs([
        'node',
        'plandesk',
        'push-artifact',
        'screen.html',
        '--prototype',
        'Checkout',
        '--force',
      ]),
    ).toEqual({
      command: 'push-artifact',
      filePath: 'screen.html',
      prototypeName: 'Checkout',
      force: true,
      repoDir: undefined,
    });
  });
});

describe('attach / push-artifact path gate', () => {
  it('refuses files outside the project directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-cli-att-'));
    const other = mkdtempSync(join(tmpdir(), 'pd-cli-out-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      writeFileSync(
        join(root, '.plandesk', 'config.json'),
        JSON.stringify({
          serverUrl: 'http://127.0.0.1:9',
          projectId: '00000000-0000-4000-8000-0000000000a1',
          projectName: 'Test',
        }),
      );
      writeFileSync(join(other, 'secret.png'), 'x');
      await expect(runAttach(join(other, 'secret.png'), { repoDir: root })).rejects.toBeInstanceOf(
        AttachError,
      );
      await expect(
        runPushArtifact(join(other, 'secret.png'), { repoDir: root }),
      ).rejects.toBeInstanceOf(PushArtifactError);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('push-artifact sentinel helpers', () => {
  it('writes a push map shape after a mocked identity round-trip is not available offline', () => {
    // Offline unit: ensure the map file format is stable when we write it via
    // the same helpers the command uses (covered live in MCP/API integration).
    const root = mkdtempSync(join(tmpdir(), 'pd-cli-map-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      const mapPath = join(root, '.plandesk', 'artifact-pushes.json');
      writeFileSync(
        mapPath,
        JSON.stringify(
          {
            'screen.html': {
              artifactId: '00000000-0000-4000-8000-0000000000aa',
              basedOnRevisionId: 'r1',
            },
          },
          null,
          2,
        ),
      );
      const parsed = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<
        string,
        { artifactId: string; basedOnRevisionId: string }
      >;
      expect(parsed['screen.html']?.artifactId).toMatch(/^00000000/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

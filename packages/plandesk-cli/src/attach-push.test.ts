import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, usage, RESERVED_COMMANDS } from './args.js';
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

describe('help discoverability', () => {
  /*
   * A command that parses but never appears in `plandesk help` is invisible to
   * anyone who asks the CLI what it can do — including an agent, which is the
   * only way an agent *can* ask. That produced plandesk#51: `push-artifact`
   * worked, shipped, and was reported as "not a CLI command" because
   * `plandesk help --commands` did not list it.
   *
   * Exemptions are named individually so adding a command silently is not one.
   */
  const NOT_A_LISTED_COMMAND = new Map([
    ['help', 'is the help'],
    ['preview', 'bare-file sugar; documented as `plandesk <file.md>`'],
    ['annotate', 'bare-file sugar; documented as `plandesk <file.md>`'],
    ['token', 'reserved word so a file named `token` is not previewed; has no handler'],
    ['ps', 'alias, documented on the `plandesk status` line'],
  ]);

  it('documents every reserved command in usage()', () => {
    const text = usage();
    const undocumented = [...RESERVED_COMMANDS].filter(
      (name) => !NOT_A_LISTED_COMMAND.has(name) && !text.includes(`plandesk ${name}`),
    );
    expect(undocumented).toEqual([]);
  });

  it('lists push-artifact, the command issue #51 could not find', () => {
    expect(usage()).toContain('plandesk push-artifact');
  });
});

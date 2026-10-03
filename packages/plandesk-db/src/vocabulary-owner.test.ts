import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as vocabulary from './vocabulary.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

function needleFor(values: readonly unknown[]): string {
  return values.map((value) => `'${String(value)}'`).join(', ');
}

/** Subsets derived from a parent vocabulary — not independent copies to guard. */
const DERIVED_VOCABULARY_NAMES = new Set([
  'terminalAgentRunStatuses',
  'commentTargetTypesForComments',
  'revisionTargetTypesForList',
  'edgeLabels',
]);

function ownedVocabularyNeedles(): { name: string; needle: string }[] {
  const needles: { name: string; needle: string }[] = [];
  for (const [name, value] of Object.entries(vocabulary)) {
    if (DERIVED_VOCABULARY_NAMES.has(name)) {
      continue;
    }
    if (!Array.isArray(value)) {
      continue;
    }
    if (value.length === 0 || typeof value[0] !== 'string') {
      continue;
    }
    needles.push({ name, needle: needleFor(value) });
  }
  return needles;
}

async function walkSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkSourceFiles(path)));
      continue;
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) {
      continue;
    }
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
      continue;
    }
    files.push(path);
  }
  return files;
}

async function collectGuardedFiles(): Promise<string[]> {
  const roots = [
    join(REPO_ROOT, 'apps/plandesk-web/src'),
    ...(await readdir(join(REPO_ROOT, 'packages'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== 'plandesk-runner')
      .map((entry) => join(REPO_ROOT, 'packages', entry.name, 'src')),
  ];

  const files: string[] = [];
  for (const root of roots) {
    try {
      files.push(...(await walkSourceFiles(root)));
    } catch {
      // Package has no src/ — skip.
    }
  }
  return files;
}

describe('vocabulary owner guard', () => {
  it('does not restate owned vocabulary arrays outside vocabulary.ts', async () => {
    const needles = ownedVocabularyNeedles();
    expect(needles.length).toBeGreaterThan(0);

    const duplicates: string[] = [];
    for (const file of await collectGuardedFiles()) {
      if (file.endsWith('/vocabulary.ts')) {
        continue;
      }
      const content = await readFile(file, 'utf8');
      for (const { name, needle } of needles) {
        if (content.includes(needle)) {
          duplicates.push(`${relative(REPO_ROOT, file)}: restated ${name}`);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CURATOR_TEMPLATES } from './curator-templates.js';

// The template constants are the CLI's shipping copy of .agents/curator/*; this repo
// also dogfoods those files at the root. They must stay byte-identical, or a
// `factory init` in a fresh repo ships content that has silently drifted from the
// agents this repo actually reads. This guard fails the moment either side is edited
// without the other.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('curator templates match the .agents/curator source', () => {
  it.each(CURATOR_TEMPLATES.map((t) => [t.relativePath, t.content] as const))(
    '%s constant is byte-identical to the repo source',
    (relativePath, content) => {
      const onDisk = readFileSync(join(repoRoot, '.agents', 'curator', relativePath), 'utf8');
      expect(content).toBe(onDisk);
    },
  );
});

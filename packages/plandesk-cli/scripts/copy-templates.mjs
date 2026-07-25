#!/usr/bin/env node
// Vendors repo-root `.agents/` into `dist/templates/` for the published CLI.
// Excludes transient machine state under `factory/runs/**` (keeps only
// `factory/runs/.gitignore`) and consumer-local `.plandesk-sync.json`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(scriptsDir, '..');
const repoRoot = join(packageDir, '..', '..');
const source = join(repoRoot, '.agents');
const dest = join(packageDir, 'dist', 'templates');

if (!existsSync(source)) {
  console.error(`copy-templates: source not found: ${source}`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

cpSync(source, dest, {
  recursive: true,
  filter(srcPath) {
    const rel = relative(source, srcPath);
    if (rel === '') {
      return true;
    }
    // Consumer-local sync manifest — must never ship.
    if (rel === '.plandesk-sync.json' || rel.endsWith('/.plandesk-sync.json')) {
      return false;
    }
    // Transient machine state under factory/runs/** — keep only .gitignore.
    if (rel === 'factory/runs' || rel.startsWith('factory/runs/')) {
      return rel === 'factory/runs' || rel === 'factory/runs/.gitignore';
    }
    return true;
  },
});

console.log(`copy-templates: ${source} → ${dest}`);

#!/usr/bin/env node
// Vendors repo-root `.agents/` into `dist/templates/` for the published CLI.
// Excludes transient machine state under `factory/runs/**` (keeps only
// `factory/runs/.gitignore`) and consumer-local `.plandesk-sync.json`.
//
// Dotfiles are de-dotted on the way in (`.gitignore` → `gitignore`). npm
// rewrites a packaged `.gitignore` to `.npmignore` at INSTALL time — the file
// is present in the tarball and missing once installed, so `factory init`
// crashed with ENOENT for consumers while every local gate stayed green.
// `readTemplate` resolves the de-dotted name transparently.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
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

/** Rename every `.foo` to `foo` under dest, so npm cannot rewrite it on install. */
function deDot(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      deDot(full);
    } else if (entry.name.startsWith('.')) {
      renameSync(full, join(dir, entry.name.slice(1)));
    }
  }
}
deDot(dest);

// Guard the property that actually broke: a dotfile here survives `pnpm pack`
// but not `npm install`, so no local gate would notice. Fail the build instead.
function findDotfiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? findDotfiles(join(dir, entry.name))
      : entry.name.startsWith('.')
        ? [relative(dest, join(dir, entry.name))]
        : [],
  );
}
const stragglers = findDotfiles(dest);
if (stragglers.length > 0) {
  console.error(
    `copy-templates: dotfiles left in dist/templates — npm rewrites these on install:\n` +
      stragglers.map((f) => `  ${f}`).join('\n'),
  );
  process.exit(1);
}

console.log(`copy-templates: ${source} → ${dest}`);

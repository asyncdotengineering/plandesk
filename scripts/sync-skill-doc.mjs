#!/usr/bin/env node
//
// The docs page `connecting-agents/skill.md` tells readers that `plandesk
// connect` writes "the same content" to `.plandesk/skill.md`. That was a claim
// with nothing enforcing it: the page was a hand-maintained copy of
// PLANDESK_SKILL_TEMPLATE, and it drifted — the shipped template gained typed
// edge endpoints and many-tasks-per-document while the page still told agents
// edges only join tasks.
//
// The template is the source of truth. This regenerates the page body from it,
// keeping only the page's own Astro frontmatter and preamble.
//
//   node scripts/sync-skill-doc.mjs           # rewrite the page
//   node scripts/sync-skill-doc.mjs --check   # fail if it is stale (CI gate)
//
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docPath = join(root, 'apps/docs/src/content/docs/connecting-agents/skill.md');

const { PLANDESK_SKILL_TEMPLATE } = await import(
  join(root, 'packages/plandesk-cli/dist/skill-template.js')
).catch(() => {
  console.error('sync-skill-doc: build @plandesk/cli first (pnpm build)');
  process.exit(1);
});

/** The template carries its own skill frontmatter; the docs page has Astro's. */
function templateBody(text) {
  const withoutFrontmatter = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  return withoutFrontmatter.trim();
}

/** Everything up to and including the `---` separator is the page's own preamble. */
function pagePreamble(text) {
  const marker = '\n---\n\n';
  const end = text.indexOf(marker, text.indexOf('\n---\n') + 5);
  if (end === -1) {
    console.error('sync-skill-doc: could not find the preamble separator in the docs page');
    process.exit(1);
  }
  return text.slice(0, end + marker.length);
}

const current = readFileSync(docPath, 'utf8');
const expected = `${pagePreamble(current)}${templateBody(PLANDESK_SKILL_TEMPLATE)}\n`;

if (process.argv.includes('--check')) {
  if (current !== expected) {
    console.error(
      'sync-skill-doc: apps/docs/.../connecting-agents/skill.md is stale.\n' +
        '  It must match PLANDESK_SKILL_TEMPLATE — run: node scripts/sync-skill-doc.mjs',
    );
    process.exit(1);
  }
  console.log('sync-skill-doc: docs skill page matches the shipped template');
} else if (current === expected) {
  console.log('sync-skill-doc: already up to date');
} else {
  writeFileSync(docPath, expected);
  console.log('sync-skill-doc: regenerated the docs skill page from the shipped template');
}

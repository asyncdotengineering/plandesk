import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cache = new Map<string, string>();

let resolvedRoot: string | undefined;

/**
 * Vendored templates live at `dist/templates/` next to the compiled module.
 * When vitest runs TypeScript from `src/`, fall back to the monorepo-root
 * `.agents/` source of truth so tests need no prior build step.
 */
export function templatesRoot(): string {
  if (resolvedRoot !== undefined) {
    return resolvedRoot;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const vendored = join(here, 'templates');
  if (existsSync(vendored)) {
    resolvedRoot = vendored;
    return resolvedRoot;
  }
  const monorepoAgents = join(here, '..', '..', '..', '.agents');
  if (existsSync(monorepoAgents)) {
    resolvedRoot = monorepoAgents;
    return resolvedRoot;
  }
  throw new Error(
    `Plan Desk templates not found (looked in ${vendored} and ${monorepoAgents}). ` +
      `Run the package build to vendor templates into dist/templates/.`,
  );
}

/**
 * Resolve a template path against the active root, tolerating the de-dotted
 * spelling the build produces.
 *
 * npm rewrites a packaged `.gitignore` to `.npmignore` when it INSTALLS a
 * package, so a dotfile that is present in the tarball is gone by the time a
 * consumer runs the CLI. `copy-templates.mjs` therefore vendors `.gitignore`
 * as `gitignore`; callers keep asking for the real name and land here.
 * Reading from the monorepo `.agents/` source (vitest, no build) still finds
 * the literal dotfile, so both roots work from one call site.
 */
function resolveTemplatePath(relativePath: string): string {
  const literal = join(templatesRoot(), relativePath);
  if (existsSync(literal)) {
    return literal;
  }
  const slash = relativePath.lastIndexOf('/');
  const base = relativePath.slice(slash + 1);
  if (base.startsWith('.')) {
    return join(templatesRoot(), `${relativePath.slice(0, slash + 1)}${base.slice(1)}`);
  }
  return literal;
}

/** Read a template by path relative to the templates root (e.g. `factory/protocol.md`). */
export function readTemplate(relativePath: string): string {
  const cached = cache.get(relativePath);
  if (cached !== undefined) {
    return cached;
  }
  const content = readFileSync(resolveTemplatePath(relativePath), 'utf8');
  cache.set(relativePath, content);
  return content;
}

/** True when a template file exists at the given relative path. */
export function templateExists(relativePath: string): boolean {
  return existsSync(resolveTemplatePath(relativePath));
}

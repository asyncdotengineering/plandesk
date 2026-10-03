import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The @plandesk/api root re-exports the server (auth context, AsyncLocalStorage,
// node:crypto). Vitest runs on Node, where all of that exists, so a runtime
// import from it passes every unit test and then blanks the app in a browser.
// Only types, or the browser-safe subpaths, may cross into the web bundle.
const srcRoot = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('web bundle stays free of server code', () => {
  it('imports only types from the @plandesk/api root', () => {
    const offenders = sourceFiles(srcRoot).filter((file) =>
      /^import (?!type\b)[^;]*from '@plandesk\/api';/m.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((file) => file.slice(srcRoot.length + 1))).toEqual([]);
  });
});

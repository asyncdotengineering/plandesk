import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { invalidArgument } from './errors.js';

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));

describe('invalidArgument', () => {
  it('returns 400 naming the field and the expectation', async () => {
    const app = new Hono();
    app.post('/x', (c) =>
      invalidArgument(c, 'viewport_width', 'viewport_width must be a finite number'),
    );

    const res = await app.request('/x', { method: 'POST' });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'invalid_argument',
      field: 'viewport_width',
      message: 'viewport_width must be a finite number',
    });
  });

  it('keeps the error code callers switch on', async () => {
    const app = new Hono();
    app.post('/x', (c) => invalidArgument(c, 'name', 'name is required'));

    const body = (await (await app.request('/x', { method: 'POST' })).json()) as { error: string };
    expect(body.error).toBe('invalid_argument');
  });
});

/*
 * The lever that makes the sweep stick. Without this, the next route added
 * inherits the bare literal by default and the class of defect regrows one
 * handler at a time — which is exactly how 131 of them accumulated.
 *
 * This test failed against the pre-sweep tree, reporting all 19 offending
 * files. If it ever passes trivially, check that ROUTES_DIR still resolves.
 */
describe('route validation errors are discoverable', () => {
  // errors.ts is the one sanctioned place the literal is constructed.
  const routeFiles = readdirSync(ROUTES_DIR).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'errors.ts',
  );

  it('has route files to check', () => {
    expect(routeFiles.length).toBeGreaterThan(10);
  });

  it('no route returns a bare invalid_argument body', () => {
    const offenders = routeFiles
      .map((name) => {
        const source = readFileSync(join(ROUTES_DIR, name), 'utf8');
        const matches = source.match(/\{\s*error:\s*'invalid_argument'\s*\}/g);
        return { name, count: matches === null ? 0 : matches.length };
      })
      .filter((entry) => entry.count > 0);

    expect(
      offenders,
      `Use invalidArgument(c, field, message) from ./errors.js instead:\n${offenders
        .map((o) => `  ${o.name}: ${String(o.count)}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { readTemplate, templateExists, templatesRoot } from './templates.js';

describe('template resolution', () => {
  it('reads a plain template', () => {
    expect(readTemplate('factory/factory.md')).toContain('Factory contract');
  });

  // npm rewrites a packaged `.gitignore` to `.npmignore` when it installs a
  // package. The file is in the tarball and gone after install, so `factory
  // init` crashed with ENOENT for every consumer while all local gates passed.
  // The build vendors it de-dotted; callers still ask for the real name.
  it('resolves a dotfile template under either spelling', () => {
    expect(templateExists('factory/runs/.gitignore')).toBe(true);
    expect(readTemplate('factory/runs/.gitignore')).toContain('*');
  });

  it('reports a genuinely missing template as missing', () => {
    expect(templateExists('factory/does-not-exist.md')).toBe(false);
  });

  it('resolves a root that exists', () => {
    expect(templatesRoot()).toBeTruthy();
  });
});

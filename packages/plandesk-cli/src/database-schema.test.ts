import { describe, expect, it } from 'vitest';
import { readStringCell } from './database-schema.js';

describe('readStringCell', () => {
  it('accepts strings and rejects non-string libSQL cells', () => {
    expect(readStringCell('projects', 'sqlite_master.name')).toBe('projects');
    expect(() => readStringCell(new ArrayBuffer(0), 'sqlite_master.name')).toThrow(
      'Expected sqlite_master.name to be a string',
    );
  });
});

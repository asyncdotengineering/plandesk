import { describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrate } from './migrate.js';
import { listProjects } from './repositories/projects.js';
import { FIXTURE_PROJECT_ID, seed } from './seed.js';

describe('seed', () => {
  it('inserts the fixture project idempotently', () => {
    const db = createDb(':memory:');
    migrate(db);
    seed(db);
    seed(db);
    const projects = listProjects(db);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(FIXTURE_PROJECT_ID);
    expect(projects[0]?.name).toBe('Fixture Project');
  });
});

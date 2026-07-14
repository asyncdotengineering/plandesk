import { describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrate } from './migrate.js';
import { listProjects } from './repositories/projects.js';
import { FIXTURE_PROJECT_ID, seed } from './seed.js';

describe('seed', () => {
  it('inserts the fixture project idempotently', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    await seed(db);
    await seed(db);
    const projects = await listProjects(db);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(FIXTURE_PROJECT_ID);
    expect(projects[0]?.name).toBe('Fixture Project');
  });
});

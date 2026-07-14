import type { Db } from './client.js';
import { createProject, getProject } from './repositories/projects.js';

export const FIXTURE_PROJECT_ID = '00000000-0000-4000-8000-000000000001';

export async function seed(db: Db): Promise<void> {
  const existing = await getProject(db, FIXTURE_PROJECT_ID);
  if (existing) {
    return;
  }
  await createProject(db, {
    id: FIXTURE_PROJECT_ID,
    name: 'Fixture Project',
    description: 'Seed fixture for development and tests',
  });
}

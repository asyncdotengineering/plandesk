import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject, getProject, listProjects, updateProject } from './projects.js';

describe('projects repository', () => {
  const db = createDb(':memory:');

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM projects');
  });

  it('creates and retrieves a project', () => {
    const created = createProject(db, {
      name: 'Checkout Revamp',
      description: 'Q2 initiative',
    });
    const fetched = getProject(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.name).toBe('Checkout Revamp');
  });

  it('returns undefined for a missing project', () => {
    expect(getProject(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists all projects', () => {
    createProject(db, { name: 'Alpha' });
    createProject(db, { name: 'Beta' });
    const all = listProjects(db);
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('updates a project and bumps updated_at', () => {
    const created = createProject(db, { name: 'Before' });
    const updated = updateProject(db, created.id, { name: 'After' });
    expect(updated?.name).toBe('After');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('returns undefined when updating a missing project', () => {
    expect(
      updateProject(db, '00000000-0000-4000-8000-000000009999', { name: 'Ghost' }),
    ).toBeUndefined();
  });
});

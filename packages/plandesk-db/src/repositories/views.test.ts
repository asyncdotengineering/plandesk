import { describe, expect, it } from 'vitest';
import { createDb, migrate } from '../index.js';
import { NON_TRIVIAL_SAVED_VIEW_CONFIG } from '../saved-view-config.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import {
  createView,
  deleteView,
  deleteViewsByProjectId,
  getView,
  listViews,
  updateView,
  viewConfig,
} from './views.js';

describe('views repository', () => {
  it('round-trips a nested config and keeps a second view independent', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Views' });

    const first = await createView(db, {
      projectId: project.id,
      name: 'Blocked & urgent',
      config: NON_TRIVIAL_SAVED_VIEW_CONFIG,
      position: 0,
    });
    const second = await createView(db, {
      projectId: project.id,
      name: 'By assignee',
      config: {
        version: 1,
        filter: null,
        sort: [{ field: 'assignee', direction: 'asc' }],
        group: [{ field: 'assignee', direction: 'asc' }],
        visibleColumns: ['label', 'assignee'],
      },
      position: 1,
    });

    const reloaded = await getView(db, first.id);
    expect(reloaded).toBeDefined();
    if (reloaded === undefined) {
      throw new Error('expected reloaded view');
    }
    expect(viewConfig(reloaded)).toEqual(NON_TRIVIAL_SAVED_VIEW_CONFIG);

    const listed = await listViews(db, project.id);
    expect(listed.map((v) => v.name)).toEqual(['Blocked & urgent', 'By assignee']);
    const secondListed = listed[1];
    if (secondListed === undefined) {
      throw new Error('expected second listed view');
    }
    expect(viewConfig(secondListed)).toEqual({
      version: 1,
      filter: null,
      sort: [{ field: 'assignee', direction: 'asc' }],
      group: [{ field: 'assignee', direction: 'asc' }],
      visibleColumns: ['label', 'assignee'],
    });

    await updateView(db, first.id, { name: 'Blocked urgent' });
    expect((await getView(db, first.id))?.name).toBe('Blocked urgent');
    expect((await getView(db, second.id))?.name).toBe('By assignee');

    expect(await deleteView(db, first.id)).toBe(true);
    expect(await listViews(db, project.id)).toHaveLength(1);
    expect((await listViews(db, project.id))[0]?.id).toBe(second.id);

    expect(await deleteViewsByProjectId(db, project.id)).toBe(1);
    expect(await listViews(db, project.id)).toHaveLength(0);
  });
});

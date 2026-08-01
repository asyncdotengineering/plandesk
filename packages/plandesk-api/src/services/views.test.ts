import { describe, expect, it } from 'vitest';
import {
  createDb,
  createProject,
  migrate,
  NON_TRIVIAL_SAVED_VIEW_CONFIG,
} from '@plandesk/db';
import { createViewService, InvalidViewError } from './views.js';

const ORG_A = '00000000-0000-4000-8000-00000000aaaa';
const ORG_B = '00000000-0000-4000-8000-00000000bbbb';
const WS_A = '00000000-0000-4000-8000-00000000aaaw';
const WS_B = '00000000-0000-4000-8000-00000000bbbw';

describe('view service', () => {
  it('denies cross-org list/get/create/update/delete like unknown ids', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const projectA = await createProject(db, {
      name: 'Org A',
      orgId: ORG_A,
      workspaceId: WS_A,
    });
    const projectB = await createProject(db, {
      name: 'Org B',
      orgId: ORG_B,
      workspaceId: WS_B,
    });

    const serviceA = createViewService({ db, orgId: ORG_A });
    const serviceB = createViewService({ db, orgId: ORG_B });

    const created = await serviceA.create(projectA.id, {
      name: 'Secret',
      config: NON_TRIVIAL_SAVED_VIEW_CONFIG,
    });
    if (created === undefined) {
      throw new Error('expected view create');
    }

    expect(await serviceB.list(projectA.id)).toBeUndefined();
    expect(await serviceB.get(created.id)).toBeUndefined();
    expect(
      await serviceB.create(projectA.id, {
        name: 'Leak',
        config: NON_TRIVIAL_SAVED_VIEW_CONFIG,
      }),
    ).toBeUndefined();
    expect(await serviceB.update(created.id, { name: 'Hijacked' })).toBeUndefined();
    expect(await serviceB.delete(created.id)).toBe(false);

    // Same failures as a genuinely unknown id — no weaker downgrade.
    expect(await serviceB.list('00000000-0000-4000-8000-000000009999')).toBeUndefined();
    expect(await serviceB.get('00000000-0000-4000-8000-000000009999')).toBeUndefined();

    // In-org still works.
    expect(await serviceA.get(created.id)).toMatchObject({ name: 'Secret' });
    expect(await serviceA.list(projectB.id)).toBeUndefined();
  });

  it('rejects invalid config with InvalidViewError', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, {
      name: 'Validate',
      orgId: ORG_A,
      workspaceId: WS_A,
    });
    const service = createViewService({ db, orgId: ORG_A });

    await expect(
      service.create(project.id, {
        name: 'Bad',
        config: { version: 99, filter: null, sort: [], group: null, visibleColumns: [] },
      }),
    ).rejects.toBeInstanceOf(InvalidViewError);
  });
});

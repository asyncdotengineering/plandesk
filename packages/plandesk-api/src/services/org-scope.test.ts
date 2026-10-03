import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  migrate,
  type Db,
} from '@plandesk/db';
import { PermissionDeniedError } from '../permissions.js';
import { localOwner, localPrincipal, PrincipalUnresolvedError } from '../principal.js';
import { createProjectService } from './projects.js';
import { createReferenceCheckService } from './reference-check.js';
import { createTaskService } from './tasks.js';

describe('org-scope principal resolution', () => {
  let db: Db;
  let projectId: string;
  let orgId: string;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Scope' });
    projectId = project.id;
    orgId = project.orgId;
  });

  it('rejects a write when there is no principal and no auth context', async () => {
    const tasks = createTaskService({ db });
    await expect(tasks.create(projectId, { label: 'Ghost' })).rejects.toThrow(
      PrincipalUnresolvedError,
    );
  });

  it('rejects a permission-gated read when there is no principal and no auth context', async () => {
    const refs = createReferenceCheckService({ db });
    await expect(refs.check(projectId)).rejects.toThrow(PrincipalUnresolvedError);
  });

  it('gates a member principal like a member auth context', async () => {
    const projects = createProjectService({ db, principal: localPrincipal(orgId, 'member') });
    await expect(projects.create({ name: 'Members cannot create projects' })).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('allows an explicit local owner principal without request context', async () => {
    const tasks = createTaskService({ db, principal: localOwner(orgId) });
    const created = await tasks.create(projectId, { label: 'Explicit owner' });
    expect(created).toBeDefined();
    if (!created) {
      return;
    }
    expect(created.label).toBe('Explicit owner');
  });
});

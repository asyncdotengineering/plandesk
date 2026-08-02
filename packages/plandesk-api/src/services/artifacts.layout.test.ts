import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  migrate,
  type Db,
} from '@plandesk/db';
import { createArtifactService } from './artifacts.js';
import { createPrototypeService } from './prototypes.js';

describe('artifactService auto-layout on screen create', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Layout' });
    projectId = project.id;
    orgId = project.orgId;
  });

  it('assigns x/y in navigation order without the client sending coordinates', async () => {
    const prototypes = createPrototypeService({ db, orgId });
    const artifacts = createArtifactService({ db, orgId });
    const proto = await prototypes.create(projectId, {
      name: 'Flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto) {
      return;
    }

    const home = await artifacts.create(projectId, {
      title: 'Home',
      kind: 'html',
      content: '<!doctype html><html><body><a href="plandesk://artifact/Pay">Pay</a></body></html>',
      prototypeId: proto.id,
    });
    const pay = await artifacts.create(projectId, {
      title: 'Pay',
      kind: 'html',
      content: '<!doctype html><html><body>Pay</body></html>',
      prototypeId: proto.id,
    });

    expect(home?.x).not.toBeNull();
    expect(home?.y).not.toBeNull();
    expect(pay?.x).not.toBeNull();
    expect(pay?.y).not.toBeNull();
    expect(pay?.y ?? 0).toBeGreaterThan(home?.y ?? 0);
  });
});

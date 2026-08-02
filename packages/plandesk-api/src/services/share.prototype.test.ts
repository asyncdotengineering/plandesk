import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createProject,
  createProjectInDefaultOrg as createProjectDefault,
  createPrototype,
  createTaskWithDefaultGoal as createTask,
  migrate,
  type Db,
} from '@plandesk/db';
import { runWithAuthContext } from '../auth-context.js';
import { createArtifactService } from './artifacts.js';
import { createPrototypeService } from './prototypes.js';
import { createShareService } from './share.js';

describe('prototype canvas share', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProjectDefault(db, { name: 'Share project' });
    projectId = project.id;
    orgId = project.orgId;
  });

  function shares() {
    return createShareService({ db, orgId });
  }

  it('exposes the shared prototype screens and links and nothing else', async () => {
    await createTask(db, { projectId, label: 'Secret task' });
    await createDocument(db, { projectId, title: 'Secret doc', body: 'nope' });

    const proto = await createPrototypeService({ db, orgId }).create(projectId, {
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto) {
      return;
    }
    const other = await createPrototypeService({ db, orgId }).create(projectId, {
      name: 'Other flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(other).toBeDefined();
    if (!other) {
      return;
    }

    await createArtifactService({ db, orgId }).create(projectId, {
      title: 'Home',
      kind: 'html',
      content: '<a href="plandesk://artifact/Pay">go</a>',
      prototypeId: proto.id,
    });
    await createArtifactService({ db, orgId }).create(projectId, {
      title: 'Pay',
      kind: 'html',
      content: '<p>pay</p>',
      prototypeId: proto.id,
    });
    await createArtifactService({ db, orgId }).create(projectId, {
      title: 'Other screen',
      kind: 'html',
      content: '<p>x</p>',
      prototypeId: other.id,
    });

    const minted = await shares().createResourceShare(
      { resource: { kind: 'prototype', ids: [proto.id] }, expiresAt: null },
      'http://localhost',
    );
    expect(minted).toBeDefined();
    if (!minted) {
      return;
    }

    const listed = await shares().listShares(projectId);
    const shareRow = listed?.find((s) => s.audience_name.startsWith('Prototype:'));
    expect(shareRow).toBeDefined();
    if (!shareRow) {
      return;
    }

    const view = await shares().buildClientView(projectId, shareRow.id);
    expect(view).toBeDefined();
    if (!view) {
      return;
    }

    expect(view.tasks).toEqual([]);
    expect(view.documents).toEqual([]);
    expect(view.edges).toEqual([]);
    expect(view.prototypes).toHaveLength(1);
    expect(view.prototypes[0]?.id).toBe(proto.id);
    expect(view.prototypes[0]?.screens.map((s) => s.title).sort()).toEqual(['Home', 'Pay']);
    expect(view.prototypes[0]?.links.length).toBeGreaterThan(0);
    expect(view.prototypes.map((p) => p.id)).not.toContain(other.id);
  });

  it('a share naming two prototypes exposes both under one link', async () => {
    const a = await createPrototypeService({ db, orgId }).create(projectId, {
      name: 'A',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const b = await createPrototypeService({ db, orgId }).create(projectId, {
      name: 'B',
      viewportWidth: 1024,
      viewportHeight: 768,
    });
    expect(a && b).toBeTruthy();
    if (!a || !b) {
      return;
    }

    const minted = await shares().createResourceShare(
      { resource: { kind: 'prototype', ids: [a.id, b.id] }, expiresAt: null },
      'http://localhost',
    );
    expect(minted).toBeDefined();
    if (!minted) {
      return;
    }
    const listed = await shares().listShares(projectId);
    const shareRow = listed?.find((s) => (s.policy.prototypeIds?.length ?? 0) === 2);
    expect(shareRow).toBeDefined();
    if (!shareRow) {
      return;
    }
    expect(shareRow.policy.prototypeIds?.sort()).toEqual([a.id, b.id].sort());

    const view = await shares().buildClientView(projectId, shareRow.id);
    expect(view?.prototypes.map((p) => p.name).sort()).toEqual(['A', 'B']);
  });

  it('REVERT-PROOF: revoking the share kills access', async () => {
    const proto = await createPrototypeService({ db, orgId }).create(projectId, {
      name: 'Flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto) {
      return;
    }

    const minted = await shares().createResourceShare(
      { resource: { kind: 'prototype', ids: [proto.id] }, expiresAt: null },
      'http://localhost',
    );
    expect(minted).toBeDefined();
    if (!minted) {
      return;
    }

    const listed = await shares().listShares(projectId);
    const shareRow = listed?.find((s) => s.audience_name.startsWith('Prototype:'));
    expect(shareRow).toBeDefined();
    if (!shareRow) {
      return;
    }

    const join = await shares().joinShare(minted.token, { name: 'Client' });
    expect(join.status).toBe('ok');
    if (join.status !== 'ok') {
      return;
    }

    const live = await runWithAuthContext(
      {
        kind: 'guest',
        shareId: shareRow.id,
        projectId,
        guestSessionId: join.participant.id,
      },
      () => shares().getClientView(minted.token),
    );
    expect(live).toBeDefined();
    if (!live || 'kind' in live) {
      return;
    }
    expect(live.prototypes).toHaveLength(1);

    const revoked = await shares().revokeShare(shareRow.id);
    expect(revoked).toBe(true);

    const after = await runWithAuthContext(
      {
        kind: 'guest',
        shareId: shareRow.id,
        projectId,
        guestSessionId: join.participant.id,
      },
      () => shares().getClientView(minted.token),
    );
    expect(after).toBeUndefined();

    const md = await shares().getResourceMarkdown(minted.token, 'http://localhost');
    expect(md.status).toBe('gone');

    const rejoin = await shares().joinShare(minted.token, { name: 'Again' });
    expect(rejoin.status).toBe('unauthorized');
  });

  it('REVERT-PROOF: org A cannot share org B prototype (404, no leak)', async () => {
    const otherOrgId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const projectB = await createProject(db, {
      name: 'Org B',
      orgId: otherOrgId,
      workspaceId: otherWorkspaceId,
    });
    const protoB = await createPrototype(db, {
      projectId: projectB.id,
      name: 'Secret',
      viewportWidth: 390,
      viewportHeight: 844,
    });

    const result = await shares().createResourceShare(
      { resource: { kind: 'prototype', ids: [protoB.id] }, expiresAt: null },
      'http://localhost',
    );
    expect(result).toBeUndefined();
  });

  it('existing task and document share paths still mint and project', async () => {
    const task = await createTask(db, { projectId, label: 'Shared task' });
    const doc = await createDocument(db, { projectId, title: 'Shared doc', body: 'hello' });

    const taskShare = await shares().createResourceShare(
      { resource: { kind: 'task', id: task.id }, expiresAt: null },
      'http://localhost',
    );
    const docShare = await shares().createResourceShare(
      { resource: { kind: 'document', id: doc.id }, expiresAt: null },
      'http://localhost',
    );
    expect(taskShare?.url).toContain('/p/');
    expect(docShare?.markdownUrl).toContain('.md');

    const listed = await shares().listShares(projectId);
    const taskRow = listed?.find((s) => s.audience_name.includes('Shared task'));
    const docRow = listed?.find((s) => s.audience_name.includes('Shared doc'));
    expect(taskRow).toBeDefined();
    expect(docRow).toBeDefined();
    if (!taskRow || !docRow) {
      return;
    }
    expect(taskRow.policy.tasks).toEqual([task.id]);
    expect(taskRow.policy.prototypeIds).toEqual([]);
    expect(docRow.policy.documentIds).toEqual([doc.id]);
    expect(docRow.policy.prototypeIds).toEqual([]);

    const taskView = await shares().buildClientView(projectId, taskRow.id);
    expect(taskView?.tasks.map((t) => t.label)).toContain('Shared task');
    expect(taskView?.prototypes).toEqual([]);

    const docView = await shares().buildClientView(projectId, docRow.id);
    expect(docView?.documents.map((d) => d.title)).toContain('Shared doc');
    expect(docView?.prototypes).toEqual([]);
  });
});

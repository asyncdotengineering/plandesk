import { beforeEach, describe, expect, it } from 'vitest';
import {
  createComment,
  createDb,
  createProjectInDefaultOrg as createProject,
  listCommentsByTarget,
  listPrototypeLinksByFromArtifact,
  listPrototypeLinksByProject,
  migrate,
  type Db,
} from '@plandesk/db';
import { createArtifactService, InvalidArtifactError } from './artifacts.js';
import { createPrototypeService } from './prototypes.js';

describe('artifactService moveScreen / copyScreen', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';
  let otherProjectId = '';
  let otherOrgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'MoveCopy' });
    projectId = project.id;
    orgId = project.orgId;
    const other = await createProject(db, { name: 'Other' });
    otherProjectId = other.id;
    otherOrgId = other.orgId;
  });

  function artifacts(oid = orgId) {
    return createArtifactService({ db, orgId: oid });
  }

  function prototypes(oid = orgId) {
    return createPrototypeService({ db, orgId: oid });
  }

  async function twoProtos() {
    const source = await prototypes().create(projectId, {
      name: 'Onboarding',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const dest = await prototypes().create(projectId, {
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(source).toBeDefined();
    expect(dest).toBeDefined();
    if (!source || !dest) {
      throw new Error('prototype create failed');
    }
    return { source, dest };
  }

  it('move keeps artifact id and comments; rescans links for the new prototype', async () => {
    const { source, dest } = await twoProtos();
    const payment = await artifacts().create(projectId, {
      title: 'Payment',
      kind: 'html',
      content: '<a href="plandesk://artifact/Confirm">go</a>',
      prototypeId: source.id,
    });
    expect(payment).toBeDefined();
    if (!payment) {
      return;
    }
    await createComment(db, {
      projectId,
      targetType: 'artifact',
      targetId: payment.id,
      body: 'fix the CTA',
    });

    const moved = await artifacts().move(payment.id, dest.id);
    expect(moved).toMatchObject({
      id: payment.id,
      prototype_id: dest.id,
      title: 'Payment',
      content: '<a href="plandesk://artifact/Confirm">go</a>',
    });

    const comments = await listCommentsByTarget(db, 'artifact', payment.id);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe('fix the CTA');

    // Confirm does not exist in dest → dangling (null), not throw.
    const links = await listPrototypeLinksByFromArtifact(db, payment.id);
    expect(links).toHaveLength(1);
    expect(links[0]?.toArtifactId).toBeNull();
    expect(links[0]?.rawTarget).toContain('Confirm');
  });

  it('move leaves a cross-boundary link that still resolves to the moved screen', async () => {
    const { source, dest } = await twoProtos();
    const welcome = await artifacts().create(projectId, {
      title: 'Welcome',
      kind: 'html',
      content: '<a href="plandesk://artifact/Payment">pay</a>',
      prototypeId: source.id,
    });
    const payment = await artifacts().create(projectId, {
      title: 'Payment',
      kind: 'html',
      content: '<p>pay</p>',
      prototypeId: source.id,
    });
    expect(welcome && payment).toBeTruthy();
    if (!welcome || !payment) {
      return;
    }

    const before = await listPrototypeLinksByFromArtifact(db, welcome.id);
    expect(before[0]?.toArtifactId).toBe(payment.id);

    await artifacts().move(payment.id, dest.id);

    // Markup untouched; derived link still points at the moved artifact.
    const after = await listPrototypeLinksByFromArtifact(db, welcome.id);
    expect(after[0]?.toArtifactId).toBe(payment.id);
    expect(after[0]?.rawTarget).toContain('Payment');

    const sourceView = await prototypes().get(source.id);
    const destView = await prototypes().get(dest.id);
    expect(sourceView?.boundary_links.some((b) => b.direction === 'exit')).toBe(true);
    expect(destView?.boundary_links.some((b) => b.direction === 'arrive')).toBe(true);
    const exit = sourceView?.boundary_links.find((b) => b.direction === 'exit');
    expect(exit?.foreign_prototype_name).toBe('Checkout');
    const arrive = destView?.boundary_links.find((b) => b.direction === 'arrive');
    expect(arrive?.foreign_prototype_name).toBe('Onboarding');
  });

  it('copy creates a new artifact with same content, zero comments, and prototype-scoped resolution', async () => {
    const { source, dest } = await twoProtos();
    const original = await artifacts().create(projectId, {
      title: 'Cart',
      kind: 'html',
      content: '<a href="plandesk://artifact/Payment">next</a>',
      prototypeId: source.id,
    });
    expect(original).toBeDefined();
    if (!original) {
      return;
    }
    await createComment(db, {
      projectId,
      targetType: 'artifact',
      targetId: original.id,
      body: 'do not copy me',
    });

    // Dest has its own Payment — copy's title link must wire there, not the source one.
    const destPayment = await artifacts().create(projectId, {
      title: 'Payment',
      kind: 'html',
      content: '<p>dest pay</p>',
      prototypeId: dest.id,
    });
    expect(destPayment).toBeDefined();
    if (!destPayment) {
      return;
    }

    const copy = await artifacts().copy(original.id, dest.id);
    expect(copy).toBeDefined();
    if (!copy) {
      return;
    }
    expect(copy.id).not.toBe(original.id);
    expect(copy).toMatchObject({
      title: 'Cart',
      content: original.content,
      prototype_id: dest.id,
    });
    expect(await listCommentsByTarget(db, 'artifact', copy.id)).toHaveLength(0);
    expect(await listCommentsByTarget(db, 'artifact', original.id)).toHaveLength(1);

    const copyLinks = await listPrototypeLinksByFromArtifact(db, copy.id);
    expect(copyLinks[0]?.toArtifactId).toBe(destPayment.id);
  });

  it('copy whose markup names a missing title in the destination dangles visibly', async () => {
    const { source, dest } = await twoProtos();
    const original = await artifacts().create(projectId, {
      title: 'Cart',
      kind: 'html',
      content: '<a href="plandesk://artifact/Payment">next</a>',
      prototypeId: source.id,
    });
    expect(original).toBeDefined();
    if (!original) {
      return;
    }

    const copy = await artifacts().copy(original.id, dest.id);
    expect(copy).toBeDefined();
    if (!copy) {
      return;
    }
    const links = await listPrototypeLinksByFromArtifact(db, copy.id);
    expect(links).toHaveLength(1);
    expect(links[0]?.toArtifactId).toBeNull();
  });

  it('refuses move or copy across projects', async () => {
    const { source } = await twoProtos();
    const otherProto = await prototypes(otherOrgId).create(otherProjectId, {
      name: 'Foreign',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(otherProto).toBeDefined();
    if (!otherProto) {
      return;
    }
    const screen = await artifacts().create(projectId, {
      title: 'Home',
      kind: 'html',
      content: '<p>hi</p>',
      prototypeId: source.id,
    });
    expect(screen).toBeDefined();
    if (!screen) {
      return;
    }

    await expect(artifacts().move(screen.id, otherProto.id)).rejects.toThrow(InvalidArtifactError);
    await expect(artifacts().copy(screen.id, otherProto.id)).rejects.toThrow(InvalidArtifactError);
  });

  it('refuses move/copy of a non-screen artifact', async () => {
    const { dest } = await twoProtos();
    const report = await artifacts().create(projectId, {
      title: 'Report',
      kind: 'markdown',
      content: '# x',
    });
    expect(report).toBeDefined();
    if (!report) {
      return;
    }
    await expect(artifacts().move(report.id, dest.id)).rejects.toThrow(InvalidArtifactError);
    await expect(artifacts().copy(report.id, dest.id)).rejects.toThrow(InvalidArtifactError);
  });

  it('get prototype does not invent links — boundary_links are derived from prototype_links', async () => {
    const { source, dest } = await twoProtos();
    const a = await artifacts().create(projectId, {
      title: 'A',
      kind: 'html',
      content: '<a href="plandesk://artifact/B">b</a>',
      prototypeId: source.id,
    });
    const b = await artifacts().create(projectId, {
      title: 'B',
      kind: 'html',
      content: '<p>b</p>',
      prototypeId: source.id,
    });
    expect(a && b).toBeTruthy();
    if (!a || !b) {
      return;
    }
    await artifacts().move(b.id, dest.id);
    const all = await listPrototypeLinksByProject(db, projectId);
    const cross = all.find((l) => l.fromArtifactId === a.id && l.toArtifactId === b.id);
    expect(cross).toBeDefined();
  });
});

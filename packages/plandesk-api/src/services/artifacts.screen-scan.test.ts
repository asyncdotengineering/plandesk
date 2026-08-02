import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createProject,
  createProjectInDefaultOrg as createProjectDefault,
  getFile,
  listPrototypeLinksByFromArtifact,
  migrate,
  type Db,
} from '@plandesk/db';
import { createArtifactService, ExternalReferenceError, UnknownLibraryError } from './artifacts.js';
import { createPrototypeService } from './prototypes.js';

describe('screen content scan on write', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';
  let protoId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProjectDefault(db, { name: 'Scan project' });
    projectId = project.id;
    orgId = project.orgId;
    const proto = await createPrototypeService({ db, orgId }).create(projectId, {
      name: 'Flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto) {
      throw new Error('prototype required');
    }
    protoId = proto.id;
  });

  function artifacts() {
    return createArtifactService({ db, orgId });
  }

  it('writes three plandesk://artifact/ links as three rows; rewrite to two leaves two', async () => {
    const home = await artifacts().create(projectId, {
      title: 'Home',
      kind: 'html',
      content: '<html><body>home</body></html>',
      prototypeId: protoId,
    });
    const pay = await artifacts().create(projectId, {
      title: 'Payment',
      kind: 'html',
      content: '<html><body>pay</body></html>',
      prototypeId: protoId,
    });
    const done = await artifacts().create(projectId, {
      title: 'Done',
      kind: 'html',
      content: '<html><body>done</body></html>',
      prototypeId: protoId,
    });
    expect(home && pay && done).toBeTruthy();
    if (!home || !pay || !done) {
      return;
    }

    const screen = await artifacts().create(projectId, {
      title: 'Start',
      kind: 'html',
      content: `<a href="plandesk://artifact/Home">h</a>
        <a href="plandesk://artifact/Payment">p</a>
        <a href="plandesk://artifact/Done">d</a>`,
      prototypeId: protoId,
    });
    expect(screen).toBeDefined();
    if (!screen) {
      return;
    }

    const three = await listPrototypeLinksByFromArtifact(db, screen.id);
    expect(three).toHaveLength(3);
    expect(three.map((l) => l.toArtifactId).sort()).toEqual([home.id, pay.id, done.id].sort());

    await artifacts().update(screen.id, {
      content: `<a href="plandesk://artifact/Home">h</a>
        <a href="plandesk://artifact/Payment">p</a>`,
    });
    const two = await listPrototypeLinksByFromArtifact(db, screen.id);
    expect(two).toHaveLength(2);
  });

  it('resolves a title to the same-prototype screen when another prototype also has one', async () => {
    const other = await createPrototypeService({ db, orgId }).create(projectId, {
      name: 'Other flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(other).toBeDefined();
    if (!other) {
      return;
    }
    const foreign = await artifacts().create(projectId, {
      title: 'Payment',
      kind: 'html',
      content: '<p>foreign</p>',
      prototypeId: other.id,
    });
    const local = await artifacts().create(projectId, {
      title: 'Payment',
      kind: 'html',
      content: '<p>local</p>',
      prototypeId: protoId,
    });
    expect(foreign && local).toBeTruthy();
    if (!local) {
      return;
    }

    const screen = await artifacts().create(projectId, {
      title: 'Checkout',
      kind: 'html',
      content: '<a href="plandesk://artifact/Payment">pay</a>',
      prototypeId: protoId,
    });
    expect(screen).toBeDefined();
    if (!screen) {
      return;
    }
    const links = await listPrototypeLinksByFromArtifact(db, screen.id);
    expect(links).toHaveLength(1);
    expect(links[0]?.toArtifactId).toBe(local.id);
  });

  it('stores null for missing title; adding the screen re-resolves the null row', async () => {
    const screen = await artifacts().create(projectId, {
      title: 'Start',
      kind: 'html',
      content: '<a href="plandesk://artifact/Missing">x</a>',
      prototypeId: protoId,
    });
    expect(screen).toBeDefined();
    if (!screen) {
      return;
    }
    let links = await listPrototypeLinksByFromArtifact(db, screen.id);
    expect(links[0]?.toArtifactId).toBeNull();

    const missing = await artifacts().create(projectId, {
      title: 'Missing',
      kind: 'html',
      content: '<p>now here</p>',
      prototypeId: protoId,
    });
    expect(missing).toBeDefined();
    if (!missing) {
      return;
    }
    links = await listPrototypeLinksByFromArtifact(db, screen.id);
    expect(links[0]?.toArtifactId).toBe(missing.id);
  });

  it('refuses a screen with three external refs naming all three', async () => {
    await expect(
      artifacts().create(projectId, {
        title: 'Bad',
        kind: 'html',
        content: `
          <script src="https://unpkg.com/x"></script>
          <link href="https://cdn.example/a.css" rel="stylesheet">
          <img src="//images.example/y.png">
        `,
        prototypeId: protoId,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ExternalReferenceError);
      if (!(err instanceof ExternalReferenceError)) {
        return false;
      }
      expect(err.refs).toHaveLength(3);
      expect(err.refs.map((r) => r.url)).toEqual(
        expect.arrayContaining([
          'https://unpkg.com/x',
          'https://cdn.example/a.css',
          '//images.example/y.png',
        ]),
      );
      return true;
    });
  });

  it('accepts manifest-listed mermaid@11.16.0 and materialises the file', async () => {
    const screen = await artifacts().create(projectId, {
      title: 'Diagram',
      kind: 'html',
      content: '<script src="plandesk://lib/mermaid@11.16.0"></script>',
      prototypeId: protoId,
    });
    expect(screen).toBeDefined();
    const file = await getFile(
      db,
      projectId,
      '74d7c46dabca328c2294733910a8aa1ed0c37451776e8d5295da38a2b758fb9b',
    );
    expect(file).toBeDefined();
    expect(file?.filename).toBe('mermaid@11.16.0.js');
  });

  it('refuses jquery@3 and mermaid at an unlisted version', async () => {
    await expect(
      artifacts().create(projectId, {
        title: 'Bad lib',
        kind: 'html',
        content: '<script src="plandesk://lib/jquery@3"></script>',
        prototypeId: protoId,
      }),
    ).rejects.toBeInstanceOf(UnknownLibraryError);

    await expect(
      artifacts().create(projectId, {
        title: 'Bad version',
        kind: 'html',
        content: '<script src="plandesk://lib/mermaid@9.0.0"></script>',
        prototypeId: protoId,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UnknownLibraryError);
      if (!(err instanceof UnknownLibraryError)) {
        return false;
      }
      expect(err.refs).toContain('plandesk://lib/mermaid@9.0.0');
      return true;
    });
  });

  it('accepts data:, blob:, and plandesk://file/ references', async () => {
    const screen = await artifacts().create(projectId, {
      title: 'Ok refs',
      kind: 'html',
      content: `
        <img src="data:image/png;base64,abc">
        <img src="blob:https://example.com/1">
        <img src="plandesk://file/deadbeef">
      `,
      prototypeId: protoId,
    });
    expect(screen?.id).toBeTruthy();
  });

  it('leaves markdown and prototype-less artifacts unscanned', async () => {
    const md = await artifacts().create(projectId, {
      title: 'Report',
      kind: 'markdown',
      content: '<script src="https://unpkg.com/x"></script>',
    });
    expect(md?.id).toBeTruthy();

    const html = await artifacts().create(projectId, {
      title: 'Loose html',
      kind: 'html',
      content: '<script src="https://unpkg.com/x"></script>',
    });
    expect(html).toBeDefined();
    if (!html) {
      return;
    }
    expect(await listPrototypeLinksByFromArtifact(db, html.id)).toEqual([]);
  });

  it('exposes links on GET prototype alongside screens', async () => {
    const target = await artifacts().create(projectId, {
      title: 'Next',
      kind: 'html',
      content: '<p>n</p>',
      prototypeId: protoId,
    });
    const from = await artifacts().create(projectId, {
      title: 'From',
      kind: 'html',
      content: '<a href="plandesk://artifact/Next">go</a>',
      prototypeId: protoId,
    });
    expect(target).toBeDefined();
    expect(from).toBeDefined();
    if (!target || !from) {
      return;
    }

    const got = await createPrototypeService({ db, orgId }).get(protoId);
    expect(got?.screens.map((s) => s.title).sort()).toEqual(['From', 'Next']);
    expect(got?.links).toHaveLength(1);
    expect(got?.links[0]).toMatchObject({
      from_artifact_id: from.id,
      to_artifact_id: target.id,
      raw_target: 'plandesk://artifact/Next',
    });
  });

  it('REVERT-PROOF: org A cannot attach screens or read links for org B prototype (two orgs)', async () => {
    const otherOrgId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const projectB = await createProject(db, {
      name: 'Org B',
      orgId: otherOrgId,
      workspaceId: otherWorkspaceId,
    });
    const protoB = await createPrototypeService({ db, orgId: otherOrgId }).create(projectB.id, {
      name: 'B flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(protoB).toBeDefined();
    if (!protoB) {
      return;
    }

    // Org A service refuses org B's prototype_id on write.
    await expect(
      artifacts().create(projectId, {
        title: 'Leak',
        kind: 'html',
        content: '<a href="plandesk://artifact/Secret">x</a>',
        prototypeId: protoB.id,
      }),
    ).rejects.toThrow(/cross-project|does not belong/i);

    // Org A cannot GET org B's prototype (links included).
    const leaked = await createPrototypeService({ db, orgId }).get(protoB.id);
    expect(leaked).toBeUndefined();

    // Org B screen UUID used as a title/id target from org A does not resolve across orgs.
    const screenB = await createArtifactService({ db, orgId: otherOrgId }).create(projectB.id, {
      title: 'Secret',
      kind: 'html',
      content: '<p>org-b-secret</p>',
      prototypeId: protoB.id,
    });
    expect(screenB).toBeDefined();
    if (!screenB) {
      return;
    }

    const screenA = await artifacts().create(projectId, {
      title: 'A start',
      kind: 'html',
      content: `<a href="plandesk://artifact/${screenB.id}">cross</a>`,
      prototypeId: protoId,
    });
    expect(screenA).toBeDefined();
    if (!screenA) {
      return;
    }
    const links = await listPrototypeLinksByFromArtifact(db, screenA.id);
    expect(links[0]?.toArtifactId).toBeNull();
    expect(links[0]?.rawTarget).toContain(screenB.id);
  });
});

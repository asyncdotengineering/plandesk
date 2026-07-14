import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
import {
  createArtifact,
  getArtifact,
  getArtifactByProjectAndId,
  listArtifactsByProject,
  updateArtifact,
} from './artifacts.js';

describe('artifacts repository', () => {
  let db: Db;
  let projectId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Artifacts' })).id;
  });

  it('creates and retrieves an artifact', async () => {
    const created = await createArtifact(db, {
      projectId,
      title: 'RFC draft',
      kind: 'markdown',
      content: '# Hello',
    });
    const fetched = await getArtifact(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.title).toBe('RFC draft');
    expect(fetched?.kind).toBe('markdown');
    expect(fetched?.content).toBe('# Hello');
  });

  it('defaults kind to markdown and content to empty string', async () => {
    const created = await createArtifact(db, { projectId, title: 'Empty' });
    expect(created.kind).toBe('markdown');
    expect(created.content).toBe('');
  });

  it('returns undefined for a missing artifact', async () => {
    expect(await getArtifact(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists artifacts for a project', async () => {
    await createArtifact(db, { projectId, title: 'One' });
    await createArtifact(db, { projectId, title: 'Two' });
    const other = (await createProject(db, { name: 'Other' })).id;
    await createArtifact(db, { projectId: other, title: 'Elsewhere' });
    expect(await listArtifactsByProject(db, projectId)).toHaveLength(2);
  });

  it('scopes getArtifactByProjectAndId to the project', async () => {
    const artifact = await createArtifact(db, { projectId, title: 'Scoped' });
    expect((await getArtifactByProjectAndId(db, projectId, artifact.id))?.id).toBe(artifact.id);
    const other = (await createProject(db, { name: 'Other' })).id;
    expect(await getArtifactByProjectAndId(db, other, artifact.id)).toBeUndefined();
  });

  it('updates an artifact and bumps updated_at', async () => {
    const created = await createArtifact(db, {
      projectId,
      title: 'Before',
      content: 'v1',
      kind: 'markdown',
    });
    const updated = await updateArtifact(db, created.id, {
      title: 'After',
      content: 'v2',
      kind: 'html',
    });
    expect(updated?.title).toBe('After');
    expect(updated?.content).toBe('v2');
    expect(updated?.kind).toBe('html');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });
});

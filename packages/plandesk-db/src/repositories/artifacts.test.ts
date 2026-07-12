import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
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
  const db = createDb(':memory:');
  let projectId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM artifacts');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Artifacts' }).id;
  });

  it('creates and retrieves an artifact', () => {
    const created = createArtifact(db, {
      projectId,
      title: 'RFC draft',
      kind: 'markdown',
      content: '# Hello',
    });
    const fetched = getArtifact(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.title).toBe('RFC draft');
    expect(fetched?.kind).toBe('markdown');
    expect(fetched?.content).toBe('# Hello');
  });

  it('defaults kind to markdown and content to empty string', () => {
    const created = createArtifact(db, { projectId, title: 'Empty' });
    expect(created.kind).toBe('markdown');
    expect(created.content).toBe('');
  });

  it('returns undefined for a missing artifact', () => {
    expect(getArtifact(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists artifacts for a project', () => {
    createArtifact(db, { projectId, title: 'One' });
    createArtifact(db, { projectId, title: 'Two' });
    const other = createProject(db, { name: 'Other' }).id;
    createArtifact(db, { projectId: other, title: 'Elsewhere' });
    expect(listArtifactsByProject(db, projectId)).toHaveLength(2);
  });

  it('scopes getArtifactByProjectAndId to the project', () => {
    const artifact = createArtifact(db, { projectId, title: 'Scoped' });
    expect(getArtifactByProjectAndId(db, projectId, artifact.id)?.id).toBe(artifact.id);
    const other = createProject(db, { name: 'Other' }).id;
    expect(getArtifactByProjectAndId(db, other, artifact.id)).toBeUndefined();
  });

  it('updates an artifact and bumps updated_at', () => {
    const created = createArtifact(db, {
      projectId,
      title: 'Before',
      content: 'v1',
      kind: 'markdown',
    });
    const updated = updateArtifact(db, created.id, {
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
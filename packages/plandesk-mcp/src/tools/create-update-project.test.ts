import { describe, expect, it } from 'vitest';
import type { ProjectService } from '@plandesk/api';
import { createCreateProjectHandler } from './create-project.js';
import { createUpdateProjectHandler } from './update-project.js';

type CreateInput = Parameters<ProjectService['create']>[0];
type UpdateInput = Parameters<ProjectService['update']>[1];

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  repo_url: string | null;
  folder_path: string | null;
  workspace_id: string;
  created_at: string;
  updated_at: string;
};

function parseProject(result: { content: Array<{ type: string; text?: string }> }): {
  id: string;
  repo_url: string | null;
  folder_path: string | null;
} {
  const text = result.content[0]?.type === 'text' ? (result.content[0].text ?? '{}') : '{}';
  return (
    JSON.parse(text) as {
      project: { id: string; repo_url: string | null; folder_path: string | null };
    }
  ).project;
}

describe('create/update project handlers forward repo binding', () => {
  it('forwards repo_url and folder_path on create; clears repo_url on update; omit → null', async () => {
    const creates: CreateInput[] = [];
    const updates: Array<{ id: string; input: UpdateInput }> = [];
    const rows = new Map<string, ProjectRow>();
    let next = 1;

    const projectService = {
      create: (input: CreateInput) => {
        creates.push(input);
        const id = `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
        const row: ProjectRow = {
          id,
          name: input.name,
          description: input.description ?? null,
          repo_url: input.repoUrl === undefined ? null : input.repoUrl,
          folder_path: input.folderPath === undefined ? null : input.folderPath,
          workspace_id: 'ws',
          created_at: '2020-01-01T00:00:00.000Z',
          updated_at: '2020-01-01T00:00:00.000Z',
        };
        rows.set(id, row);
        return Promise.resolve(row);
      },
      update: (id: string, input: UpdateInput) => {
        updates.push({ id, input });
        const prev = rows.get(id);
        if (prev === undefined) {
          return Promise.resolve(undefined);
        }
        const row: ProjectRow = {
          ...prev,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.repoUrl !== undefined ? { repo_url: input.repoUrl } : {}),
          ...(input.folderPath !== undefined ? { folder_path: input.folderPath } : {}),
        };
        rows.set(id, row);
        return Promise.resolve(row);
      },
      get: (id: string) => Promise.resolve(rows.get(id)),
    } as unknown as ProjectService;

    const create = createCreateProjectHandler(projectService);
    const update = createUpdateProjectHandler(projectService);

    const bound = parseProject(
      await create({
        name: 'Bound',
        repo_url: 'https://github.com/acme/plandesk',
        folder_path: 'packages/plandesk-mcp',
      }),
    );
    expect(creates[0]).toEqual({
      name: 'Bound',
      repoUrl: 'https://github.com/acme/plandesk',
      folderPath: 'packages/plandesk-mcp',
    });
    expect(bound.repo_url).toBe('https://github.com/acme/plandesk');
    expect(bound.folder_path).toBe('packages/plandesk-mcp');

    const bare = parseProject(await create({ name: 'Bare' }));
    expect(creates[1]).toEqual({ name: 'Bare' });
    expect(bare.repo_url).toBeNull();
    expect(bare.folder_path).toBeNull();

    const cleared = parseProject(
      await update({ project_id: bound.id, repo_url: null }),
    );
    expect(updates[0]).toEqual({
      id: bound.id,
      input: { repoUrl: null },
    });
    expect(cleared.repo_url).toBeNull();
    expect(cleared.folder_path).toBe('packages/plandesk-mcp');

    const after = await projectService.get(bound.id);
    expect(after?.repo_url).toBeNull();
    expect(after?.folder_path).toBe('packages/plandesk-mcp');
  });
});

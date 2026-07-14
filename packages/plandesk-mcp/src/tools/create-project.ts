import type { ProjectService } from '@plandesk/api';
import { toolInvalidArgument, toolSuccess, type ToolResult } from './result.js';

export function createCreateProjectHandler(
  projectService: ProjectService,
): (args: { name: string; description?: string }) => Promise<ToolResult> {
  return async (args) => {
    if (args.name.trim() === '') {
      return toolInvalidArgument();
    }
    const project = await projectService.create({
      name: args.name,
      ...(args.description !== undefined ? { description: args.description } : {}),
    });
    return toolSuccess('project', project);
  };
}

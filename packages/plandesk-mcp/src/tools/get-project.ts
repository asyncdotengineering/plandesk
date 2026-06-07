import type { ProjectService } from '@plandesk/api';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function createGetProjectHandler(
  projectService: ProjectService,
): (args: { project_id: string }) => ToolResult {
  return ({ project_id }) => {
    const project = projectService.get(project_id);
    if (!project) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'not_found' }) }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ project }) }],
      structuredContent: { project },
    };
  };
}

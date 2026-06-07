import type { ProjectService } from '@plandesk/api';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
};

export function createListProjectsHandler(projectService: ProjectService): () => ToolResult {
  return () => {
    const projects = projectService.list();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ projects }) }],
      structuredContent: { projects },
    };
  };
}

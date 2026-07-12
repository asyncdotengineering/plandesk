import type { ProjectService } from '@plandesk/api';
import { InvalidScaffoldError } from '@plandesk/api';
import { InvalidTaskStatusError, type TaskStatus } from '@plandesk/db';
import { ensureHtmlBody } from './markdown.js';
import { toolInvalidArgument, toolSuccess, type ToolResult } from './result.js';

type ScaffoldArgs = {
  project_id?: string;
  name?: string;
  description?: string;
  tasks: Array<{
    key: string;
    label: string;
    status?: string;
    description?: string;
    x?: number;
    y?: number;
  }>;
  edges?: Array<{
    from: string;
    to: string;
    label?: string;
    style?: string;
  }>;
  documents?: Array<{
    title: string;
    body?: string;
    status_line?: string;
    link_to?: string;
  }>;
};

export function createScaffoldProjectFromPlanHandler(
  projectService: ProjectService,
): (args: ScaffoldArgs) => ToolResult {
  return (args) => {
    try {
      const result = projectService.scaffoldFromPlan({
        ...(args.project_id !== undefined ? { projectId: args.project_id } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        tasks: args.tasks.map((task) => ({
          key: task.key,
          label: task.label,
          ...(task.status !== undefined ? { status: task.status as TaskStatus } : {}),
          ...(task.description !== undefined ? { description: task.description } : {}),
          ...(task.x !== undefined ? { x: task.x } : {}),
          ...(task.y !== undefined ? { y: task.y } : {}),
        })),
        ...(args.edges !== undefined
          ? {
              edges: args.edges.map((edge) => ({
                from: edge.from,
                to: edge.to,
                ...(edge.label !== undefined ? { label: edge.label } : {}),
                ...(edge.style !== undefined ? { style: edge.style } : {}),
              })),
            }
          : {}),
        ...(args.documents !== undefined
          ? {
              documents: args.documents.map((doc) => ({
                title: doc.title,
                ...(doc.body !== undefined ? { body: ensureHtmlBody(doc.body) } : {}),
                ...(doc.status_line !== undefined ? { statusLine: doc.status_line } : {}),
                ...(doc.link_to !== undefined ? { linkTo: doc.link_to } : {}),
              })),
            }
          : {}),
      });
      return toolSuccess('scaffold', result);
    } catch (error) {
      if (error instanceof InvalidScaffoldError || error instanceof InvalidTaskStatusError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}

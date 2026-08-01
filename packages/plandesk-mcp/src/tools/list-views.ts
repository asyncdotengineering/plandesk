import type { ViewService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListViewsHandler(
  viewService: ViewService,
): (args: { project_id: string }) => Promise<ToolResult> {
  return async ({ project_id }) => {
    const views = await viewService.list(project_id);
    if (!views) {
      return toolNotFound();
    }
    return toolSuccess(
      'views',
      views.map((view) => ({
        id: view.id,
        name: view.name,
        config: view.config,
        position: view.position,
      })),
    );
  };
}

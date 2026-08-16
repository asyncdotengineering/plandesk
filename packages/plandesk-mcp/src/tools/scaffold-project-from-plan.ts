import type { CanvasService, DocumentService, ProjectService } from '@plandesk/api';
import { InvalidCanvasError, InvalidGoalReferenceError, InvalidScaffoldError } from '@plandesk/api';
import { AmbiguousActiveGoalsError, InvalidTaskStatusError, type TaskStatus } from '@plandesk/db';
import { defaultLinkLabel, normalizeLinkTo, type LinkEntityKind } from './link-to.js';
import { toolInvalidArgument, toolSuccess, type ToolResult } from './result.js';

type ScaffoldArgs = {
  project_id?: string;
  goal_id?: string;
  workspace_id?: string;
  name?: string;
  description?: string;
  tasks: Array<{
    key: string;
    label: string;
    status?: string;
    description?: string;
    goal_id?: string;
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
    /** Stable key so other documents can link_to this one in the same plan. */
    key?: string;
    title: string;
    body?: string;
    status_line?: string;
    /** Task or document plan key(s). Single string or list; resolved via key_to_id. */
    link_to?: string | string[];
  }>;
};

export function createScaffoldProjectFromPlanHandler(
  projectService: ProjectService,
  canvasService: CanvasService,
  documentService: DocumentService,
): (args: ScaffoldArgs) => Promise<ToolResult> {
  return async (args) => {
    try {
      const taskKeys = new Set(args.tasks.map((task) => task.key));
      const documentKeys = new Set<string>();
      for (const doc of args.documents ?? []) {
        if (doc.key === undefined) {
          continue;
        }
        if (doc.key.trim() === '') {
          return toolInvalidArgument('document key must not be empty');
        }
        if (taskKeys.has(doc.key) || documentKeys.has(doc.key)) {
          return toolInvalidArgument(`duplicate plan key: ${doc.key}`);
        }
        documentKeys.add(doc.key);
      }

      // Validate every link_to key exists as a task or document key in this plan.
      for (const doc of args.documents ?? []) {
        for (const key of normalizeLinkTo(doc.link_to)) {
          if (!taskKeys.has(key) && !documentKeys.has(key)) {
            return toolInvalidArgument(`document link_to references unknown plan key: ${key}`);
          }
        }
      }

      // API accepts a single task-shaped linkTo and creates a document→task edge.
      // Multi-target and document→document links are applied after via typed edges.
      const result = await projectService.scaffoldFromPlan({
        ...(args.project_id !== undefined ? { projectId: args.project_id } : {}),
        ...(args.goal_id !== undefined ? { goalId: args.goal_id } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        // Ignored when project_id is set; otherwise picks the workspace for the
        // new project. Omitted -> the caller's bound workspace, then the org default.
        ...(args.workspace_id !== undefined ? { workspaceId: args.workspace_id } : {}),
        tasks: args.tasks.map((task) => ({
          key: task.key,
          label: task.label,
          ...(task.status !== undefined ? { status: task.status as TaskStatus } : {}),
          ...(task.description !== undefined ? { description: task.description } : {}),
          ...(task.goal_id !== undefined ? { goalId: task.goal_id } : {}),
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
              documents: args.documents.map((doc) => {
                const links = normalizeLinkTo(doc.link_to);
                const firstTaskKey = links.find((key) => taskKeys.has(key));
                return {
                  title: doc.title,
                  ...(doc.body !== undefined ? { body: doc.body } : {}),
                  ...(doc.status_line !== undefined ? { statusLine: doc.status_line } : {}),
                  ...(firstTaskKey !== undefined ? { linkTo: firstTaskKey } : {}),
                };
              }),
            }
          : {}),
      });

      const keyToId: Record<string, string> = { ...result.key_to_id };
      const planDocuments = args.documents ?? [];
      for (let i = 0; i < planDocuments.length; i++) {
        const planDoc = planDocuments[i];
        const created = result.documents[i];
        if (planDoc?.key !== undefined && created !== undefined) {
          keyToId[planDoc.key] = created.id;
        }
      }

      const projectId = result.project.id;
      for (let i = 0; i < planDocuments.length; i++) {
        const planDoc = planDocuments[i];
        const created = result.documents[i];
        if (planDoc === undefined || created === undefined) {
          continue;
        }
        const links = normalizeLinkTo(planDoc.link_to);
        const firstTaskKey = links.find((key) => taskKeys.has(key));
        for (const key of links) {
          if (key === firstTaskKey) {
            // Already written by scaffoldFromPlan as a document→task edge.
            continue;
          }
          const targetId = keyToId[key];
          if (targetId === undefined) {
            return toolInvalidArgument(`document link_to references unknown plan key: ${key}`);
          }
          if (targetId === created.id) {
            return toolInvalidArgument('document cannot link_to itself');
          }
          const toType: LinkEntityKind = taskKeys.has(key) ? 'task' : 'document';
          await canvasService.createEdge(projectId, {
            fromType: 'document',
            fromId: created.id,
            toType,
            toId: targetId,
            label: defaultLinkLabel(toType),
          });
        }
      }

      // Re-hydrate so returned documents carry full links/backlinks.
      const documents = [];
      for (const doc of result.documents) {
        const hydrated = await documentService.get(doc.id);
        documents.push(hydrated ?? doc);
      }

      return toolSuccess('scaffold', {
        ...result,
        documents,
        key_to_id: keyToId,
      });
    } catch (error) {
      if (
        error instanceof InvalidScaffoldError ||
        error instanceof InvalidGoalReferenceError ||
        error instanceof AmbiguousActiveGoalsError ||
        error instanceof InvalidTaskStatusError ||
        error instanceof InvalidCanvasError
      ) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}

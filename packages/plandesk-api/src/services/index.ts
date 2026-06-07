import type { Db } from '@plandesk/db';
import { createEventBus, type EventBus } from '../events.js';
import { createCanvasService, type CanvasService } from './canvas.js';
import { createDocumentService, type DocumentService } from './documents.js';
import { createProjectService, type ProjectService } from './projects.js';
import { createTaskService, type TaskService } from './tasks.js';

export type ServicesDeps = {
  db: Db;
  eventBus?: EventBus;
};

export type Services = {
  eventBus: EventBus;
  projectService: ProjectService;
  taskService: TaskService;
  canvasService: CanvasService;
  documentService: DocumentService;
};

export function createServices(deps: ServicesDeps): Services {
  const eventBus = deps.eventBus ?? createEventBus();
  const projectService = createProjectService({ db: deps.db });
  const taskService = createTaskService({ db: deps.db, eventBus });
  const canvasService = createCanvasService({ db: deps.db, eventBus });
  const documentService = createDocumentService({ db: deps.db, eventBus });

  return {
    eventBus,
    projectService,
    taskService,
    canvasService,
    documentService,
  };
}

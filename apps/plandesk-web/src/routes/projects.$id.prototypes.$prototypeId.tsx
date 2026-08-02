import { createFileRoute } from '@tanstack/react-router';
import { PrototypeCanvas } from '../components/prototypes/PrototypeCanvas.js';

function ProjectPrototypeCanvasPage() {
  const { prototypeId } = Route.useParams();
  return (
    <div className="h-full min-h-0">
      <PrototypeCanvas prototypeId={prototypeId} />
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/prototypes/$prototypeId')({
  component: ProjectPrototypeCanvasPage,
});

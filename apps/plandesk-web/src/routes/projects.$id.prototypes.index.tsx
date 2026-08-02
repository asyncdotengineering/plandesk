import { createFileRoute } from '@tanstack/react-router';
import { PrototypePicker } from '../components/prototypes/PrototypeCanvas.js';

function ProjectPrototypesPage() {
  const { id } = Route.useParams();
  return <PrototypePicker projectId={id} />;
}

export const Route = createFileRoute('/projects/$id/prototypes/')({
  component: ProjectPrototypesPage,
});

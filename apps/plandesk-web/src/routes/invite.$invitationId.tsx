import { createFileRoute } from '@tanstack/react-router';
import { InvitePage } from '../components/auth/InvitePage.js';

function InviteRoute() {
  const { invitationId } = Route.useParams();
  return <InvitePage invitationId={invitationId} />;
}

export const Route = createFileRoute('/invite/$invitationId')({
  component: InviteRoute,
});

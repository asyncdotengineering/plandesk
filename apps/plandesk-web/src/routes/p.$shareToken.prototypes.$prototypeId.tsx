import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { PortalPrototypeCanvas } from '@/components/portal/PortalPrototypeCanvas.js';
import { PortalShareGate } from '@/components/portal/PortalShareGate.js';

function PortalPrototypePage() {
  const { shareToken, prototypeId } = Route.useParams();
  const navigate = useNavigate();
  return (
    <PortalShareGate shareToken={shareToken}>
      {(view, sessionToken) => {
        const prototype = view.prototypes?.find((candidate) => candidate.id === prototypeId);
        if (prototype === undefined) {
          return (
            <main className="px-5 py-6">
              <Link
                to="/p/$shareToken/prototypes"
                params={{ shareToken }}
                className="text-sm text-muted-foreground underline-offset-2 hover:underline"
              >
                Back to prototypes
              </Link>
              <p className="mt-4 text-sm text-muted-foreground">Prototype not found.</p>
            </main>
          );
        }
        return (
          <main className="h-dvh min-h-[32rem] w-screen overflow-hidden">
            <PortalPrototypeCanvas
              onPresent={(screenId) => {
                void navigate({
                  to: '/p/$shareToken/prototypes/$prototypeId/present/$screenId',
                  params: { shareToken, prototypeId, screenId },
                });
              }}
              backSlot={
                <Link
                  to="/p/$shareToken/prototypes"
                  params={{ shareToken }}
                  aria-label="Back to prototypes"
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ArrowLeftIcon className="size-3.5" />
                  Prototypes
                </Link>
              }
              prototype={prototype}
              projectId={view.project.id}
              shareToken={shareToken}
              sessionToken={sessionToken}
              canComment={view.share.permissions.submit}
            />
          </main>
        );
      }}
    </PortalShareGate>
  );
}

export const Route = createFileRoute('/p/$shareToken/prototypes/$prototypeId')({
  component: PortalPrototypePage,
});

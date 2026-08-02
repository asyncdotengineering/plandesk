import { Link, createFileRoute } from '@tanstack/react-router';
import { PortalPrototypeCanvas } from '@/components/portal/PortalPrototypeCanvas.js';
import { PortalShareGate } from '@/components/portal/PortalShareGate.js';

function PortalPrototypePage() {
  const { shareToken, prototypeId } = Route.useParams();
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
          <main className="h-[calc(100vh-1px)] min-h-[32rem]">
            <PortalPrototypeCanvas
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

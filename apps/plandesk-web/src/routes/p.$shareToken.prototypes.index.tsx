import { Link, createFileRoute } from '@tanstack/react-router';
import { Card } from '@/components/ui/card';
import { PortalShareGate } from '@/components/portal/PortalShareGate.js';

function PortalPrototypesIndexPage() {
  const { shareToken } = Route.useParams();
  return (
    <PortalShareGate shareToken={shareToken}>
      {(view) => (
        <main className="mx-auto max-w-4xl px-5 py-6">
          <Link
            to="/p/$shareToken"
            params={{ shareToken }}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Back to shared project
          </Link>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Prototypes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a prototype to walk through its screens and leave feedback.
          </p>
          {view.prototypes === undefined || view.prototypes.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">No prototypes are shared here.</p>
          ) : (
            <ul className="mt-6 grid list-none gap-3 p-0">
              {view.prototypes.map((prototype) => (
                <li key={prototype.id}>
                  <Link
                    to="/p/$shareToken/prototypes/$prototypeId"
                    params={{ shareToken, prototypeId: prototype.id }}
                    data-portal-prototype-link={prototype.id}
                  >
                    <Card className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40">
                      <span className="font-medium">{prototype.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {prototype.screens.length} screen{prototype.screens.length === 1 ? '' : 's'}
                      </span>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </main>
      )}
    </PortalShareGate>
  );
}

export const Route = createFileRoute('/p/$shareToken/prototypes/')({
  component: PortalPrototypesIndexPage,
});

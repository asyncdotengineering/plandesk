import { Outlet, createFileRoute } from '@tanstack/react-router';

// Layout only. The landing page lives in `p.$shareToken.index.tsx`.
//
// This route is the parent of every nested portal route (`/prototypes`,
// `/prototypes/$prototypeId`, …). A parent whose component renders page
// content instead of an `Outlet` never renders its children, so the nested
// routes silently displayed this landing page instead of their own — correct
// URL, no error, wrong content. Keep this component an `Outlet`.
//
// Each child gates itself through `PortalShareGate`, which owns the guest
// session and the join flow, so no share state needs to live here.
export const Route = createFileRoute('/p/$shareToken')({
  component: Outlet,
});

import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/p/$shareToken/prototypes')({
  component: Outlet,
});

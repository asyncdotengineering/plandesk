import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/projects/$id/notes')({
  component: Outlet,
});

import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

// Blog posts are not part of the manual. They render as a single centred column
// — no docs sidebar, no table of contents, no pagination into a docs page — so
// the only navigation between them is the index at /blog/.
//
// Dropping the table of contents is not cosmetic: Starlight only reserves room
// for the right column when the left sidebar is present, so a post that kept
// both would push its table of contents off the viewport.
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  if (!route.id.startsWith('blog/')) return;
  route.hasSidebar = false;
  route.toc = undefined;
  route.pagination = { prev: undefined, next: undefined };
});

import type { Context } from 'hono';

/**
 * The one way to return a 400 for a failed field validation.
 *
 * `field` and `message` are **required parameters, not options**. That is the
 * whole point of this module: every route previously hand-wrote
 * `c.json({ error: 'invalid_argument' }, 400)`, so a caller who did not already
 * know a route's shape could not discover it — every wrong guess produced a
 * byte-identical response. `POST /projects/:id/prototypes` was reported as a
 * non-existent endpoint on exactly that basis, after nine payload shapes
 * (including `{}`) all returned the same bare string.
 *
 * An optional field name would be omitted under deadline and the defect would
 * regrow, which is why the signature does not offer that choice.
 *
 * `error` keeps its value and position — callers switch on that string, so this
 * adds detail beside it rather than renaming it.
 */
export function invalidArgument(c: Context, field: string, message: string): Response {
  return c.json({ error: 'invalid_argument', field, message }, 400);
}

/**
 * For a 400 where no single field is at fault — a whole-payload shape error, a
 * rule spanning two fields, or a validation error raised by a service that
 * already carries its own message.
 *
 * `message` is still required. This exists so that "there is no one field to
 * name" never becomes an excuse to return a bare body; it is not an escape
 * hatch from saying anything.
 */
export function invalidRequest(c: Context, message: string): Response {
  return c.json({ error: 'invalid_argument', message }, 400);
}

/**
 * The one way to return a 404 for a resource that was addressed and not found.
 *
 * `resource` and `id` are required for the same reason `invalidArgument` requires
 * `field`: a bare `{ "error": "not_found" }` tells a caller nothing it can act on.
 * That body is not merely unhelpful — it has destroyed data. A read-modify-write
 * script read `.description` off a 404 body, got `undefined`, appended to it, and
 * `PATCH` accepted the result with 200, overwriting four task descriptions with
 * the string "undefined". A body that names what was missing does not survive
 * being folded into a caller's data unnoticed.
 *
 * `error` keeps its value and position — callers switch on that string.
 */
export function notFound(c: Context, resource: string, id: string): Response {
  return c.json({ error: 'not_found', resource, id }, 404);
}

type RegisteredRoute = { path: string; method: string };

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment === '*') {
        return '.*';
      }
      if (segment.startsWith(':')) {
        return '[^/]+';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${source}/?$`);
}

/**
 * Methods any registered route would accept for `path`, so a 404 handler can
 * tell "no such route" from "wrong verb". Middleware registered with `app.use`
 * carries the method `ALL` and matches every path, so it is excluded — counting
 * it would report every path as supporting every method.
 *
 * Cold path only: this runs when routing has already missed.
 */
export function allowedMethodsForPath(routes: RegisteredRoute[], path: string): string[] {
  const methods = new Set<string>();
  for (const route of routes) {
    if (route.method === 'ALL') {
      continue;
    }
    if (patternToRegExp(route.path).test(path)) {
      methods.add(route.method.toUpperCase());
    }
  }
  return [...methods].sort();
}

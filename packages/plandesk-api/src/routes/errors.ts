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

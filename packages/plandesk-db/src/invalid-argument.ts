/**
 * Base for every error that means "the caller's input is invalid". REST
 * (`app.onError`) and MCP (the `TOOLS` table) each map any subclass to
 * `invalid_argument` in one place, so a new validation error needs no
 * per-route or per-tool catch. `field` names the offending input when there
 * is exactly one.
 */
export class InvalidArgumentError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'InvalidArgumentError';
  }
}

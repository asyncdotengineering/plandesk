import { getAuthContext } from '../auth-context.js';

export type OrgScopedDeps = {
  /** Fixed org scope for unit tests; production uses request auth context. */
  orgId?: string;
};

export function resolveOrgId(deps: OrgScopedDeps): string {
  return deps.orgId ?? getAuthContext().orgId;
}

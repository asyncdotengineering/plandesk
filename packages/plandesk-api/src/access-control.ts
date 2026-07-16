import { createAccessControl } from 'better-auth/plugins/access';

const workActions = ['read', 'create', 'update', 'delete'] as const;

export const statement = {
  task: workActions,
  document: workActions,
  edge: workActions,
  goal: workActions,
  comment: workActions,
  agent_run: workActions,
  project: ['create', 'delete'],
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
  apiKey: ['create', 'read', 'update', 'delete'],
} as const;

export const ac = createAccessControl(statement);

const memberPermissions = {
  task: workActions,
  document: workActions,
  edge: workActions,
  goal: workActions,
  comment: workActions,
  agent_run: workActions,
  project: [],
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: [],
  apiKey: [],
} as const;

export const member = ac.newRole(memberPermissions);
export const admin = ac.newRole({
  ...memberPermissions,
  project: ['create', 'delete'],
});
export const owner = ac.newRole({
  ...memberPermissions,
  project: ['create', 'delete'],
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
  apiKey: ['create', 'read', 'update', 'delete'],
});

export function intersectPermissions(
  a: Record<string, readonly string[]>,
  b: Record<string, readonly string[]>,
): Record<string, string[]> {
  const intersection: Record<string, string[]> = {};

  for (const [resource, actions] of Object.entries(a)) {
    const otherActions = b[resource];
    if (otherActions === undefined) {
      continue;
    }
    const sharedActions = actions.filter((action) => otherActions.includes(action));
    if (sharedActions.length > 0) {
      intersection[resource] = sharedActions;
    }
  }

  return intersection;
}

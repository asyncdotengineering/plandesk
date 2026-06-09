export type Capability = 'read' | 'submit';

export function capabilitiesFromShare(permissions: {
  read: boolean;
  submit: boolean;
}): Capability[] {
  const caps: Capability[] = [];
  if (permissions.read) {
    caps.push('read');
  }
  if (permissions.submit) {
    caps.push('submit');
  }
  return caps;
}

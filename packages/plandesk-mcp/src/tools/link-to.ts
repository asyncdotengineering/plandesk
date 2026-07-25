/** Normalize link_to that may be a single key/id or a list. */
export function normalizeLinkTo(linkTo: string | string[] | undefined): string[] {
  if (linkTo === undefined) {
    return [];
  }
  return Array.isArray(linkTo) ? linkTo : [linkTo];
}

export type LinkEntityKind = 'task' | 'document';

export function defaultLinkLabel(toType: LinkEntityKind): string {
  return toType === 'task' ? 'documents' : 'references';
}

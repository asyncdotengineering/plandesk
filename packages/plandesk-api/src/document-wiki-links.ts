import { createEdge, getEdgeByEndpoints, type DbClient, type Document } from '@plandesk/db';
import { convertDocumentBody, type WikiLinkResolved } from './markdown.js';

export function buildDocumentTitleResolver(
  documents: Document[],
  excludeDocumentId?: string,
): (title: string) => { id: string; title: string } | undefined {
  const titleMap = new Map<string, { id: string; title: string }>();
  for (const document of documents) {
    if (document.id === excludeDocumentId) {
      continue;
    }
    const key = document.title.toLowerCase();
    if (!titleMap.has(key)) {
      titleMap.set(key, { id: document.id, title: document.title });
    }
  }
  return (title) => titleMap.get(title.toLowerCase());
}

export function prepareDocumentBody(
  body: string | null | undefined,
  projectId: string,
  documents: Document[],
  excludeDocumentId?: string,
): { body: string | null | undefined; resolved: WikiLinkResolved[] } {
  if (body === undefined || body === null) {
    return { body, resolved: [] };
  }
  const { html, resolved } = convertDocumentBody(body, {
    projectId,
    resolve: buildDocumentTitleResolver(documents, excludeDocumentId),
  });
  return { body: html, resolved };
}

export async function ensureWikiLinkEdges(
  db: DbClient,
  projectId: string,
  fromDocumentId: string,
  resolved: WikiLinkResolved[],
): Promise<void> {
  const seen = new Set<string>();
  for (const target of resolved) {
    if (target.id === fromDocumentId || seen.has(target.id)) {
      continue;
    }
    seen.add(target.id);
    const existing = await getEdgeByEndpoints(db, projectId, {
      fromType: 'document',
      fromId: fromDocumentId,
      toType: 'document',
      toId: target.id,
    });
    if (existing !== undefined) {
      continue;
    }
    await createEdge(db, {
      projectId,
      fromType: 'document',
      fromId: fromDocumentId,
      toType: 'document',
      toId: target.id,
      label: 'references',
    });
  }
}

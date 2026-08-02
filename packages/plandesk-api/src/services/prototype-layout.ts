import {
  getPrototype,
  listArtifactsByPrototype,
  listPrototypeLinksByProject,
  updateArtifact,
  type Artifact,
  type DbClient,
  type PrototypeLink,
} from '@plandesk/db';

const LAYOUT_GAP = 80;

export type LayoutPosition = { x: number; y: number };

/**
 * Topological (navigation) order over resolved links. Unresolved / null-target
 * edges are ignored for ranking. Screens with no inbound edge come first;
 * remaining cycles or isolates append in stable id order.
 */
export function navigationOrder(
  screenIds: string[],
  links: ReadonlyArray<{ fromArtifactId: string; toArtifactId: string | null }>,
): string[] {
  const idSet = new Set(screenIds);
  const inbound = new Map<string, number>();
  const outbound = new Map<string, string[]>();
  for (const id of screenIds) {
    inbound.set(id, 0);
    outbound.set(id, []);
  }
  for (const link of links) {
    if (link.toArtifactId === null) {
      continue;
    }
    if (!idSet.has(link.fromArtifactId) || !idSet.has(link.toArtifactId)) {
      continue;
    }
    outbound.get(link.fromArtifactId)?.push(link.toArtifactId);
    inbound.set(link.toArtifactId, (inbound.get(link.toArtifactId) ?? 0) + 1);
  }

  const queue = screenIds
    .filter((id) => (inbound.get(id) ?? 0) === 0)
    .sort((a, b) => a.localeCompare(b));
  const ordered: string[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ordered.push(id);
    for (const next of outbound.get(id) ?? []) {
      const remaining = (inbound.get(next) ?? 1) - 1;
      inbound.set(next, remaining);
      if (remaining === 0) {
        queue.push(next);
        queue.sort((a, b) => a.localeCompare(b));
      }
    }
  }

  for (const id of [...screenIds].sort((a, b) => a.localeCompare(b))) {
    if (!seen.has(id)) {
      ordered.push(id);
    }
  }
  return ordered;
}

/**
 * Assign positions for screens that still have null x or y. Already-placed
 * screens keep their coordinates; new ones stack in navigation order beneath
 * the lowest placed screen (or from the origin when none are placed).
 */
export function computePrototypeLayout(
  screens: ReadonlyArray<Pick<Artifact, 'id' | 'x' | 'y'>>,
  links: ReadonlyArray<Pick<PrototypeLink, 'fromArtifactId' | 'toArtifactId'>>,
  viewportHeight: number,
): Map<string, LayoutPosition> {
  const order = navigationOrder(
    screens.map((s) => s.id),
    links,
  );
  const byId = new Map(screens.map((s) => [s.id, s]));
  const positions = new Map<string, LayoutPosition>();

  let nextY = 0;
  for (const screen of screens) {
    if (screen.x !== null && screen.y !== null) {
      positions.set(screen.id, { x: screen.x, y: screen.y });
      nextY = Math.max(nextY, screen.y + viewportHeight + LAYOUT_GAP);
    }
  }

  for (const id of order) {
    const screen = byId.get(id);
    if (screen === undefined) {
      continue;
    }
    if (screen.x !== null && screen.y !== null) {
      continue;
    }
    positions.set(id, { x: 0, y: nextY });
    nextY += viewportHeight + LAYOUT_GAP;
  }

  return positions;
}

/**
 * Persist positions for any screen in the prototype that still has null coords.
 * Called after link extraction so agents never send x/y.
 */
export async function ensurePrototypeLayout(
  db: DbClient,
  prototypeId: string,
): Promise<Map<string, LayoutPosition>> {
  const prototype = await getPrototype(db, prototypeId);
  if (!prototype) {
    return new Map();
  }
  const screens = await listArtifactsByPrototype(db, prototypeId);
  if (screens.length === 0) {
    return new Map();
  }
  const screenIds = new Set(screens.map((s) => s.id));
  const links = (await listPrototypeLinksByProject(db, prototype.projectId)).filter((link) =>
    screenIds.has(link.fromArtifactId),
  );
  const positions = computePrototypeLayout(screens, links, prototype.viewportHeight);

  for (const screen of screens) {
    if (screen.x !== null && screen.y !== null) {
      continue;
    }
    const pos = positions.get(screen.id);
    if (pos === undefined) {
      continue;
    }
    await updateArtifact(db, screen.id, { x: pos.x, y: pos.y });
  }

  return positions;
}

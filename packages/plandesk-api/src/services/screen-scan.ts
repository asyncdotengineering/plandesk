import {
  deletePrototypeLinksByFromArtifact,
  createPrototypeLink,
  findLibraryByRef,
  listArtifactsByProject,
  listNullPrototypeLinksByProject,
  listPrototypeLinksByFromArtifact,
  materialiseLibrary,
  resolveTarget,
  scanScreen,
  updatePrototypeLinkTarget,
  type DbClient,
  type ExternalRef,
  type PrototypeLink,
} from '@plandesk/db';

export class ExternalReferenceError extends Error {
  readonly refs: ExternalRef[];

  constructor(refs: ExternalRef[]) {
    super('external_reference');
    this.name = 'ExternalReferenceError';
    this.refs = refs;
  }
}

export class UnknownLibraryError extends Error {
  readonly refs: string[];

  constructor(refs: string[]) {
    super('unknown_library');
    this.name = 'UnknownLibraryError';
    this.refs = refs;
  }
}

/** Refuse external refs and unknown libraries without touching the DB. */
export function assertScreenContentAllowed(content: string): {
  links: string[];
  libs: string[];
} {
  const { links, libs, externalRefs } = scanScreen(content);
  if (externalRefs.length > 0) {
    throw new ExternalReferenceError(externalRefs);
  }
  const unknownLibs = libs.filter((ref) => !findLibraryByRef(ref));
  if (unknownLibs.length > 0) {
    throw new UnknownLibraryError(unknownLibs);
  }
  return { links, libs };
}

/**
 * Scan screen content, refuse external/unknown-library refs, materialise
 * libraries, and replace derived prototype_links for this artifact.
 *
 * Call only when the artifact has a non-null prototypeId (it is a screen).
 */
export async function applyScreenContentScan(
  db: DbClient,
  input: {
    projectId: string;
    artifactId: string;
    prototypeId: string;
    content: string;
  },
): Promise<PrototypeLink[]> {
  const { links, libs } = assertScreenContentAllowed(input.content);

  for (const ref of libs) {
    const entry = findLibraryByRef(ref);
    if (!entry) {
      throw new UnknownLibraryError([ref]);
    }
    await materialiseLibrary(db, entry, input.projectId);
  }

  await deletePrototypeLinksByFromArtifact(db, input.artifactId);

  const projectScreens = (await listArtifactsByProject(db, input.projectId)).map((a) => ({
    id: a.id,
    title: a.title,
    prototypeId: a.prototypeId,
  }));

  const created: PrototypeLink[] = [];
  for (const raw of links) {
    const toArtifactId = resolveTarget(raw, projectScreens, input.prototypeId);
    created.push(
      await createPrototypeLink(db, {
        projectId: input.projectId,
        fromArtifactId: input.artifactId,
        toArtifactId,
        rawTarget: raw,
      }),
    );
  }

  await reResolveNullTargets(db, input.projectId);

  return created;
}

/** Clear derived links when a screen leaves its prototype. */
export async function clearScreenLinks(db: DbClient, artifactId: string): Promise<void> {
  await deletePrototypeLinksByFromArtifact(db, artifactId);
}

/**
 * Re-resolve every null-target link in the project. A newly added/renamed
 * screen can make a previously broken title link valid.
 */
export async function reResolveNullTargets(db: DbClient, projectId: string): Promise<void> {
  const nullLinks = await listNullPrototypeLinksByProject(db, projectId);
  if (nullLinks.length === 0) {
    return;
  }

  const projectScreens = (await listArtifactsByProject(db, projectId)).map((a) => ({
    id: a.id,
    title: a.title,
    prototypeId: a.prototypeId,
  }));

  const fromIds = new Set(nullLinks.map((l) => l.fromArtifactId));
  const fromPrototypeById = new Map<string, string | null>();
  for (const screen of projectScreens) {
    if (fromIds.has(screen.id)) {
      fromPrototypeById.set(screen.id, screen.prototypeId);
    }
  }

  for (const link of nullLinks) {
    const fromPrototypeId = fromPrototypeById.get(link.fromArtifactId);
    if (!fromPrototypeId) {
      continue;
    }
    const resolved = resolveTarget(link.rawTarget, projectScreens, fromPrototypeId);
    if (resolved) {
      await updatePrototypeLinkTarget(db, link.id, resolved);
    }
  }
}

export async function listLinksForArtifact(
  db: DbClient,
  artifactId: string,
): Promise<PrototypeLink[]> {
  return listPrototypeLinksByFromArtifact(db, artifactId);
}

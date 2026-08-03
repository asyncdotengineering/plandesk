/** Shared with InvalidFolderError in folders.ts — single source for cycle rejection copy. */
export const FOLDER_REPARENT_CYCLE_MESSAGE = 'Re-parenting would create a folder cycle';

export type FolderParentLookup = (folderId: string) => string | null | undefined;

/** True when moving `folderId` under `newParentFolderId` would close a parent loop. */
export function wouldCreateFolderReparentCycle(
  folderId: string,
  newParentFolderId: string,
  parentOf: FolderParentLookup,
): boolean {
  const visited = new Set<string>();
  let current: string | null = newParentFolderId;
  while (current !== null) {
    if (current === folderId) {
      return true;
    }
    if (visited.has(current)) {
      return false;
    }
    visited.add(current);
    current = parentOf(current) ?? null;
  }
  return false;
}

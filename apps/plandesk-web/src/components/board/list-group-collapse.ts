export function listGroupCollapseStorageKey(projectId: string): string {
  return `plandesk.listGroupCollapse.${projectId}`;
}

export function loadCollapsedGroupIds(projectId: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(listGroupCollapseStorageKey(projectId));
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
      return null;
    }
    return new Set(parsed);
  } catch {
    return null;
  }
}

export function saveCollapsedGroupIds(projectId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(listGroupCollapseStorageKey(projectId), JSON.stringify([...ids]));
  } catch {
    // Private mode / quota — collapse state is best-effort.
  }
}

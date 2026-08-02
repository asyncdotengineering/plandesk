/**
 * Pure write-time scan of screen HTML. Pattern match only — no markup parser.
 * Collects navigation targets, library refs, and external resource URLs.
 */

export type ExternalRefKind = 'script' | 'style' | 'font' | 'image' | 'frame';

export type ExternalRef = {
  kind: ExternalRefKind;
  url: string;
};

export type ScanScreenResult = {
  /** Full `plandesk://artifact/…` hrefs as authored. */
  links: string[];
  /** Full `plandesk://lib/name@version` refs as authored. */
  libs: string[];
  externalRefs: ExternalRef[];
};

const ARTIFACT_REF = /plandesk:\/\/artifact\/[^\s"'<>]+/gi;
const LIB_REF = /plandesk:\/\/lib\/[^/@\s"'<>]+@[^/@\s"'<>]+/gi;

const ATTR_PATTERNS: Array<{ kind: ExternalRefKind; re: RegExp }> = [
  { kind: 'script', re: /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi },
  { kind: 'style', re: /<link\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi },
  { kind: 'image', re: /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi },
  { kind: 'frame', re: /<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi },
  { kind: 'frame', re: /<iframe\b[^>]*\bsrcdoc\s*=\s*(["'])(.*?)\1/gi },
];

const IMPORT_RE = /@import\s+(?:url\(\s*)?(["']?)([^"')\s]+)\1\s*\)?/gi;
const FONT_FACE_SRC_RE =
  /@font-face\s*\{[^}]*?\bsrc\s*:\s*[^;]*?\burl\(\s*(["']?)([^"')\s]+)\1\s*\)/gi;

function isAcceptedNonExternal(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '') {
    return true;
  }
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('plandesk://file/') ||
    trimmed.startsWith('plandesk://lib/')
  ) {
    return true;
  }
  return false;
}

/** Absolute http(s)/other-scheme URL, or protocol-relative `//host…`. */
export function isExternalUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '' || isAcceptedNonExternal(trimmed)) {
    return false;
  }
  if (trimmed.startsWith('//')) {
    return true;
  }
  // scheme://… but not relative path or hash/query-only
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed);
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function collectMatches(content: string, re: RegExp): string[] {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  const found: string[] = [];
  for (const match of content.matchAll(global)) {
    const full = match[0];
    if (full) {
      found.push(full);
    }
  }
  return found;
}

function pushExternal(refs: ExternalRef[], kind: ExternalRefKind, url: string): void {
  if (!isExternalUrl(url)) {
    return;
  }
  refs.push({ kind, url: url.trim() });
}

/**
 * One pass over screen content: navigation links, library refs, external URLs.
 * Pure — no I/O.
 */
export function scanScreen(content: string): ScanScreenResult {
  const links = uniquePreserveOrder(collectMatches(content, ARTIFACT_REF));
  const libs = uniquePreserveOrder(collectMatches(content, LIB_REF));
  const externalRefs: ExternalRef[] = [];

  for (const { kind, re } of ATTR_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const match of content.matchAll(global)) {
      const url = match[2];
      if (url !== undefined) {
        pushExternal(externalRefs, kind, url);
      }
    }
  }

  for (const match of content.matchAll(new RegExp(IMPORT_RE.source, 'gi'))) {
    const url = match[2];
    if (url !== undefined) {
      pushExternal(externalRefs, 'style', url);
    }
  }

  for (const match of content.matchAll(new RegExp(FONT_FACE_SRC_RE.source, 'gi'))) {
    const url = match[2];
    if (url !== undefined) {
      pushExternal(externalRefs, 'font', url);
    }
  }

  return { links, libs, externalRefs };
}

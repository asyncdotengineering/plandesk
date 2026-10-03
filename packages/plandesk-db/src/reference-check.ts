import { resolve } from 'node:path';
import { resolvedPathStaysUnderRoot } from './project-binding.js';

export type ReferenceFinding = {
  document_id: string;
  title: string;
  source_path: string;
  state: 'missing';
};

export type ReferenceCheckResult = {
  checked: number;
  findings: ReferenceFinding[];
  unknown: boolean;
};

export type ReferenceCheckFs = {
  pathExists: (absolutePath: string) => boolean;
  folderExists: (folderPath: string) => boolean;
};

export type ReferenceCheckDocument = {
  id: string;
  title: string;
  sourcePath: string;
};

/**
 * Report documents whose `source_path` does not exist under `folderPath`.
 * When `fs` is omitted or the folder is missing, returns `unknown: true` and
 * never claims a path is missing.
 */
export function checkDocumentReferences(
  folderPath: string | null,
  docs: ReferenceCheckDocument[],
  fs: ReferenceCheckFs | null,
): ReferenceCheckResult {
  const withPath = docs.filter((doc) => doc.sourcePath.trim() !== '');
  const checked = withPath.length;
  if (
    fs === null ||
    folderPath === null ||
    folderPath.trim() === '' ||
    !fs.folderExists(folderPath)
  ) {
    return { checked, findings: [], unknown: true };
  }

  const root = resolve(folderPath);
  const findings: ReferenceFinding[] = [];
  for (const doc of withPath) {
    if (!resolvedPathStaysUnderRoot(root, doc.sourcePath)) {
      findings.push({
        document_id: doc.id,
        title: doc.title,
        source_path: doc.sourcePath,
        state: 'missing',
      });
      continue;
    }
    const absolute = resolve(root, doc.sourcePath);
    if (!fs.pathExists(absolute)) {
      findings.push({
        document_id: doc.id,
        title: doc.title,
        source_path: doc.sourcePath,
        state: 'missing',
      });
    }
  }

  return { checked, findings, unknown: false };
}

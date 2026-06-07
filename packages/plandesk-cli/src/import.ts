import { readFileSync } from 'node:fs';
import {
  importProject,
  InvalidExportVersionError,
  type Db,
  type PlandeskExportInput,
} from '@plandesk/db';

export class InvalidImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImportFileError';
  }
}

export function runImport(db: Db, inPath: string): string {
  let raw: string;
  try {
    raw = readFileSync(inPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unable to read import file';
    throw new InvalidImportFileError(message);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new InvalidImportFileError('invalid JSON in import file');
  }

  if (typeof data !== 'object' || data === null) {
    throw new InvalidImportFileError('import file must contain a JSON object');
  }

  try {
    const { projectId } = importProject(db, data as PlandeskExportInput);
    return projectId;
  } catch (err) {
    if (err instanceof InvalidExportVersionError) {
      throw new InvalidImportFileError(err.message);
    }
    throw err;
  }
}

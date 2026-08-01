import { Readable } from 'node:stream';

/**
 * exceljs is ~1MB and only needed when someone asks for XLSX. Importing it
 * eagerly loads it into every module graph that touches export — which
 * inflated test collection by ~60s and starved timing-sensitive suites
 * running in parallel. Loaded on demand instead; CSV never pays for it.
 */
async function excel() {
  return (await import('exceljs')).default;
}
import { stringify } from 'csv-stringify/sync';
import type { ExportTable } from './view-rows.js';

export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** RFC 4180 CSV (CRLF record separator via csv-stringify defaults). */
export function renderCsv(table: ExportTable): string {
  return stringify([table.headers, ...table.rows], {
    quoted_string: true,
    record_delimiter: '\r\n',
  });
}

/** Single-sheet workbook; same rectangular values as the CSV. */
export async function renderXlsx(table: ExportTable): Promise<Uint8Array> {
  const workbook = new (await excel()).Workbook();
  const sheet = workbook.addWorksheet('Export');
  sheet.addRow(table.headers);
  for (const row of table.rows) {
    sheet.addRow(row);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer);
  }
  return new Uint8Array(buffer);
}

/** Extract string cells from an XLSX buffer for parity assertions. */
export async function readXlsxTable(bytes: Uint8Array): Promise<ExportTable> {
  const workbook = new (await excel()).Workbook();
  // exceljs typings expect its own Buffer alias; Uint8Array is accepted at runtime.
  await workbook.xlsx.read(Readable.from([bytes]));
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) {
    return { headers: [], rows: [] };
  }
  const matrix: string[][] = [];
  sheet.eachRow((row) => {
    const values = row.values;
    // exceljs row.values is 1-indexed (index 0 unused).
    const cells = Array.isArray(values)
      ? values.slice(1).map((cell) => cellValueToString(cell))
      : [];
    matrix.push(cells);
  });
  if (matrix.length === 0) {
    return { headers: [], rows: [] };
  }
  const [headers = [], ...rows] = matrix;
  return { headers, rows };
}

function cellValueToString(cell: unknown): string {
  if (cell === null || cell === undefined) {
    return '';
  }
  if (typeof cell === 'string') {
    return cell;
  }
  if (typeof cell === 'number' || typeof cell === 'boolean') {
    return String(cell);
  }
  if (typeof cell === 'object') {
    if ('text' in cell) {
      const text = Reflect.get(cell, 'text');
      return typeof text === 'string' ? text : '';
    }
    if ('result' in cell) {
      const result = Reflect.get(cell, 'result');
      if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
        return String(result);
      }
      return '';
    }
  }
  return '';
}

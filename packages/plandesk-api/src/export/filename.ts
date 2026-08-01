/** Build `Content-Disposition` filename: `<project>-<YYYY-MM-DD>.<ext>`. */
export function buildExportFilename(
  projectName: string,
  format: 'csv' | 'xlsx',
  date: Date = new Date(),
): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${safe}-${String(year)}-${month}-${day}.${format}`;
}

export function contentDispositionAttachment(filename: string): string {
  // ASCII-safe filename only (we sanitize before calling).
  return `attachment; filename="${filename}"`;
}

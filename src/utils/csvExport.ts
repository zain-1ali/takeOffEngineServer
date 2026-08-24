/** One row of takeoff data for CSV export. */
export interface TakeoffCsvRow {
  sheetName: string;
  type: string;
  label: string;
  value: number;
  unit: string;
}

/** Escape a CSV field (RFC 4180-style quoting). */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Build a CSV document: Sheet Name, Type, Label, Value, Unit.
 * Includes a header row; uses CRLF line endings for spreadsheet apps.
 */
export function buildTakeoffCsv(rows: readonly TakeoffCsvRow[]): string {
  const header = ['Sheet Name', 'Type', 'Label', 'Value', 'Unit'];
  const lines = [header.map(escapeCsvField).join(',')];

  for (const row of rows) {
    lines.push(
      [
        escapeCsvField(row.sheetName),
        escapeCsvField(row.type),
        escapeCsvField(row.label),
        escapeCsvField(String(row.value)),
        escapeCsvField(row.unit),
      ].join(','),
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}

/** Safe attachment filename from a project or sheet name. */
export function csvFilenameForProject(projectName: string): string {
  const slug = projectName
    .trim()
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);

  return `${slug || 'takeoff'}_export.csv`;
}

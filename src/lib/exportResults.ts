import type { DisplayRow } from './types';

export type ExportFormat = 'csv' | 'txt';

const LINE_END = '\r\n';
const CSV_HEADER = ['Path', 'Name', 'Folder', 'Matches', 'Size (bytes)', 'Modified (UTC)', 'Type'];

/**
 * A spreadsheet treats a cell starting with one of these as a formula. A file called `=cmd|...`
 * would then run when the export is opened, so such cells get a leading apostrophe.
 */
const FORMULA_STARTS = ['=', '+', '-', '@', '\t', '\r'];

function csvField(value: string): string {
  const safe = FORMULA_STARTS.some((start) => value.startsWith(start)) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const isoTime = (milliseconds: number | null): string =>
  milliseconds === null ? '' : new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/, 'Z');

function toCsv(rows: DisplayRow[]): string {
  const lines = rows.map((row) =>
    [
      row.path,
      row.name,
      row.folder,
      row.hits > 0 ? String(row.hits) : '',
      String(row.size),
      isoTime(row.modifiedMs),
      row.typeName,
    ]
      .map(csvField)
      .join(','),
  );
  // The byte order mark makes Excel read the file as UTF-8, so accented names survive.
  return `﻿${[CSV_HEADER.join(','), ...lines].join(LINE_END)}${LINE_END}`;
}

/** The results as text for a file: CSV with every column, or just the full paths one per line. */
export function formatResults(rows: DisplayRow[], format: ExportFormat): string {
  if (format === 'csv') return toCsv(rows);
  return rows.map((row) => `${row.path}${LINE_END}`).join('');
}

const twoDigits = (value: number) => String(value).padStart(2, '0');

export function exportFileName(format: ExportFormat, date: Date): string {
  const day = `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
  return `spelunker-results-${day}.${format}`;
}

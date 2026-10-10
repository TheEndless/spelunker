const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'];

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${SIZE_UNITS[unitIndex]}`;
}

const twoDigits = (value: number) => String(value).padStart(2, '0');

export function formatDate(modifiedMs: number | null): string {
  if (modifiedMs === null) return '';
  const date = new Date(modifiedMs);
  const day = `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
  return `${day} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

/**
 * The Modified column's text: what Windows formatted from the user's regional settings, so it reads
 * like Explorer's. Without that (a plain browser, or a date Windows could not format) a plain local
 * format is used.
 */
export function modifiedLabel(row: { modifiedMs: number | null; modifiedText: string }): string {
  return row.modifiedText || formatDate(row.modifiedMs);
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)} s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export interface SplitPath {
  name: string;
  folder: string;
}

export function splitPath(path: string): SplitPath {
  const lastSeparator = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return {
    name: path.slice(lastSeparator + 1),
    folder: lastSeparator >= 0 ? path.slice(0, lastSeparator) : '',
  };
}

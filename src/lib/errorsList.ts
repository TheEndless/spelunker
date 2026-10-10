import type { ErrorRow } from './types';

/** How many skipped entries the popover renders. The copy action always includes all of them. */
export const MAX_SHOWN = 200;

export function visibleErrors(errors: ErrorRow[]): { shown: ErrorRow[]; hidden: number } {
  const shown = errors.slice(0, MAX_SHOWN);
  return { shown, hidden: errors.length - shown.length };
}

/** Sentence that says how many files and folders were skipped, for example "3 files and folders could not be read". */
export function errorsHeader(count: number): string {
  return count === 1 ? '1 file or folder could not be read' : `${count} files and folders could not be read`;
}

export function formatErrorsForCopy(errors: ErrorRow[]): string {
  const lines = errors.map((error) => `${error.path}\t${error.message}`);
  return [errorsHeader(errors.length), ...lines].join('\n');
}

/**
 * The reason to show under a path. The operating system's message usually starts with the path
 * ("C:\x: Access is denied."), which would repeat the line above it, so that prefix is dropped.
 */
export function reasonFor(error: ErrorRow): string {
  const prefix = `${error.path}: `;
  if (!error.message.startsWith(prefix)) return error.message;
  const rest = error.message.slice(prefix.length);
  return rest === '' ? error.message : rest;
}

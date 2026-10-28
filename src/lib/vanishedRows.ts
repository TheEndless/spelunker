/**
 * The system menu can leave rows behind whose files are gone: a shell command deleted or renamed
 * them, they were gone before the menu opened, or the menu failed because of them. These helpers
 * drop such rows only once the backend has confirmed the files are gone, so a file the shell
 * merely could not handle (a long path, an offline share, no access) keeps its row.
 */

/** The most items one system menu may name. Mirrors `MAX_ITEMS` in `src-tauri/src/shell_items.rs`. */
export const MAX_SHELL_ITEMS = 5000;

/**
 * Removes the rows of `paths` whose files the backend confirms are gone, and returns those paths.
 * More than `MAX_SHELL_ITEMS` paths are not checked, because the menu refused them for their
 * count, not for their files. A failed check removes nothing.
 */
export async function removeGoneRows(
  paths: string[],
  existingPaths: (paths: string[]) => Promise<string[]>,
  removeRows: (gone: string[]) => void,
): Promise<string[]> {
  if (paths.length === 0 || paths.length > MAX_SHELL_ITEMS) return [];
  let remaining: Set<string>;
  try {
    remaining = new Set(await existingPaths(paths));
  } catch {
    return [];
  }
  const gone = paths.filter((path) => !remaining.has(path));
  if (gone.length > 0) removeRows(gone);
  return gone;
}

function countOf(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}

/** "3 files no longer exist", for the rows just removed. */
export function goneNotice(goneCount: number): string {
  return countOf(goneCount, 'file no longer exists', 'files no longer exist');
}

/**
 * What to tell the user about the paths the system menu left out: the ones that are gone, and the
 * ones that still exist but could not be shown in it. Null when there is nothing to say.
 */
export function skippedNotice(goneCount: number, keptCount: number): string | null {
  const parts: string[] = [];
  if (goneCount > 0) parts.push(goneNotice(goneCount));
  if (keptCount > 0) {
    parts.push(countOf(keptCount, 'file could not be included', 'files could not be included') + ' in the system menu');
  }
  return parts.length > 0 ? parts.join('. ') : null;
}

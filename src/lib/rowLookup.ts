/**
 * The position of the row with `path`, or -1. `hint` is where it was last time. While a search is
 * running rows are only added at the end, so the row is still there and no scan is needed. Without
 * this, every batch of results walks the whole list (100k+ rows) to find the selected row again.
 */
export function findRowIndex(rows: { path: string }[], path: string | null, hint: number): number {
  if (path === null) return -1;
  if (hint >= 0 && hint < rows.length && rows[hint].path === path) return hint;
  return rows.findIndex((row) => row.path === path);
}

import type { DisplayRow, SortColumn, SortDirection } from './types';

type SortKey = string | number | null;

const keyFor: Record<SortColumn, (row: DisplayRow) => SortKey> = {
  name: (row) => row.name.toLowerCase(),
  folder: (row) => row.folder.toLowerCase(),
  hits: (row) => row.hits,
  size: (row) => row.size,
  modified: (row) => row.modifiedMs,
  type: (row) => row.typeName.toLowerCase(),
};

/** Returns a sorted copy. Rows with an unknown key (null) always sort last. */
export function sortRows(
  rows: DisplayRow[],
  column: SortColumn,
  direction: SortDirection,
): DisplayRow[] {
  const getKey = keyFor[column];
  const sign = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, key: getKey(row) }))
    .sort((left, right) => {
      if (left.key === null || right.key === null) {
        if (left.key === right.key) return left.index - right.index;
        return left.key === null ? 1 : -1;
      }
      if (left.key < right.key) return -sign;
      if (left.key > right.key) return sign;
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

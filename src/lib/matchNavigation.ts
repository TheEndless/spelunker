/**
 * The match to show after F3 (direction 1) or Shift+F3 (direction -1). Wraps around at both
 * ends. `current` is -1 when no match is selected yet. Returns -1 when there are no matches.
 */
export function stepMatch(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

/** "Match 2 of 5" for display and speech. */
export function matchPosition(current: number, count: number): string {
  if (count === 0) return 'No matches';
  if (current < 0) return count === 1 ? '1 match' : `${count} matches`;
  return `Match ${current + 1} of ${count}`;
}

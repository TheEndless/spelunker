import { formatSize } from './format';
import type { SelectionState } from './selection';
import { count } from './statusSummary';

/**
 * "3 selected" for screen readers after a selection change, or null when nothing changed. The
 * selection functions return the very same state when they change nothing, so identity is the test.
 */
export function selectionAnnouncement(previous: SelectionState, next: SelectionState): string | null {
  return next === previous ? null : count(next.paths.size, 'selected', 'selected');
}

/** "3 selected, 12.4 MB" for the status bar. Empty below two rows, where there is nothing to summarize. */
export function selectionSummary(selectedCount: number, totalBytes: number): string {
  if (selectedCount < 2) return '';
  return `${count(selectedCount, 'selected', 'selected')}, ${formatSize(totalBytes)}`;
}

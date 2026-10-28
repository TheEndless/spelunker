import { formatSize } from './format';
import { count } from './statusSummary';

/** "3 selected, 12.4 MB" for the status bar. Empty below two rows, where there is nothing to summarize. */
export function selectionSummary(selectedCount: number, totalBytes: number): string {
  if (selectedCount < 2) return '';
  return `${count(selectedCount, 'selected', 'selected')}, ${formatSize(totalBytes)}`;
}

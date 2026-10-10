export interface FindCounts {
  /** Files in the results list. */
  filesMatched: number;
  /** Matching lines across those files. Zero for a name-only search. */
  totalHits: number;
}

const count = (value: number, singular: string, pluralForm: string): string =>
  `${value.toLocaleString('en-US')} ${value === 1 ? singular : pluralForm}`;

/**
 * The find in the user's words, for the first phrase of the status bar: "95 matches in 3 files".
 * A name-only search has no matching lines, so it counts files only.
 */
export function describeFind({ filesMatched, totalHits }: FindCounts): string {
  if (filesMatched === 0) return 'No files matched';
  if (totalHits === 0) return `${count(filesMatched, 'file', 'files')} matched`;
  return `${count(totalHits, 'match', 'matches')} in ${count(filesMatched, 'file', 'files')}`;
}

export interface PhaseInput {
  running: boolean;
  stopping: boolean;
  summary: { cancelled: boolean } | null;
}

/** One word for where the search is: Ready, Searching, Stopping, Stopped, or Done. */
export function statusPhase({ running, stopping, summary }: PhaseInput): string {
  if (stopping) return 'Stopping';
  if (running) return 'Searching';
  if (summary) return summary.cancelled ? 'Stopped' : 'Done';
  return 'Ready';
}

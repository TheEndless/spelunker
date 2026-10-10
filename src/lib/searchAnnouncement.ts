export interface SearchStateForSpeech {
  running: boolean;
  stopping: boolean;
  /** The search could not start. The inline alert already explains why, so nothing more is said. */
  failed: boolean;
  summary: { filesMatched: number; cancelled: boolean } | null;
}

function matchedPhrase(count: number): string {
  if (count === 0) return 'No files matched';
  if (count === 1) return '1 file matched';
  return `${count.toLocaleString('en-US')} files matched`;
}

/**
 * What a screen reader should be told about the search as a whole. Only changes of state are
 * described. Live counters and the elapsed time are deliberately left out, since announcing
 * them as they tick would drown out everything else.
 */
export function describeSearchState(state: SearchStateForSpeech): string {
  if (state.stopping) return 'Stopping the search';
  if (state.running) return 'Searching';
  if (state.failed || !state.summary) return '';
  const outcome = state.summary.cancelled ? 'Search stopped' : 'Search finished';
  return `${outcome}. ${matchedPhrase(state.summary.filesMatched)}.`;
}

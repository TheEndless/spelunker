export interface EmptyStateInput {
  phase: 'idle' | 'searching' | 'done';
  /** How many filters are switched on (size, dates, name regex, multi-line). */
  activeFilters: number;
  includeHidden: boolean;
  /** Files that were skipped because they looked binary. */
  binarySkipped: number;
}

export interface EmptyState {
  title: string;
  lines: string[];
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * What the empty results list says. Before a search it explains how to start, and after a search
 * with no matches it says what may have narrowed the result, so the next step is obvious.
 */
export function describeEmptyState(input: EmptyStateInput): EmptyState {
  if (input.phase === 'idle') {
    return {
      title: 'Find files',
      lines: ['Choose a folder in Look in, type part of a file name or the text to find, then press Enter.'],
    };
  }
  if (input.phase === 'searching') {
    return { title: 'Searching', lines: ['Results appear here as they are found.'] };
  }

  const lines: string[] = [];
  if (input.activeFilters > 0) {
    const verb = plural(input.activeFilters, 'filter is', 'filters are');
    const remedy = plural(input.activeFilters, 'it', 'one');
    lines.push(`${input.activeFilters} ${verb} on. Try removing ${remedy}.`);
  }
  if (!input.includeHidden) {
    lines.push('Hidden files and folders are not searched. Turn them on to include them.');
  }
  if (input.binarySkipped > 0) {
    const count = input.binarySkipped.toLocaleString('en-US');
    const noun = plural(input.binarySkipped, 'binary file was', 'binary files were');
    const pronoun = plural(input.binarySkipped, 'it', 'them');
    lines.push(`${count} ${noun} skipped. Turn on Binary files to search inside ${pronoun}.`);
  }
  if (lines.length === 0) lines.push('Check the spelling and the folder in Look in.');
  return { title: 'No files matched', lines };
}

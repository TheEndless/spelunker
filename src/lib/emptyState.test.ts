import { describe, expect, it } from 'vitest';
import { describeEmptyState } from './emptyState';

const base = { phase: 'done' as const, activeFilters: 0, includeHidden: true, binarySkipped: 0 };

describe('describeEmptyState', () => {
  it('guides a first-time user before any search has run', () => {
    const state = describeEmptyState({ ...base, phase: 'idle' });
    expect(state.title).toBe('Find files');
    expect(state.lines.join(' ')).toMatch(/Look in/);
    expect(state.lines.join(' ')).toMatch(/Enter/);
  });

  it('says results will appear while a search is running', () => {
    const state = describeEmptyState({ ...base, phase: 'searching' });
    expect(state.title).toBe('Searching');
    expect(state.lines.length).toBeGreaterThan(0);
  });

  it('says nothing matched, and falls back to a spelling hint when nothing narrowed the search', () => {
    const state = describeEmptyState(base);
    expect(state.title).toBe('No files matched');
    expect(state.lines).toEqual(['Check the spelling and the folder in Look in.']);
  });

  it('points at active filters, singular and plural', () => {
    expect(describeEmptyState({ ...base, activeFilters: 1 }).lines).toContain('1 filter is on. Try removing it.');
    expect(describeEmptyState({ ...base, activeFilters: 3 }).lines).toContain('3 filters are on. Try removing one.');
  });

  it('mentions hidden files and folders when they are not being searched', () => {
    const lines = describeEmptyState({ ...base, includeHidden: false }).lines;
    expect(lines).toContain('Hidden files and folders are not searched. Turn them on to include them.');
  });

  it('mentions skipped binary files with a thousands separator', () => {
    const lines = describeEmptyState({ ...base, binarySkipped: 12345 }).lines;
    expect(lines).toContain('12,345 binary files were skipped. Turn on Binary files to search inside them.');
    expect(describeEmptyState({ ...base, binarySkipped: 1 }).lines).toContain(
      '1 binary file was skipped. Turn on Binary files to search inside it.',
    );
  });

  it('lists every applicable hint and drops the fallback when there are some', () => {
    const lines = describeEmptyState({ ...base, activeFilters: 2, includeHidden: false, binarySkipped: 4 }).lines;
    expect(lines).toHaveLength(3);
    expect(lines).not.toContain('Check the spelling and the folder in Look in.');
  });
});

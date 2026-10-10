import { describe, expect, it } from 'vitest';
import { describeSearchState } from './searchAnnouncement';

const idle = { running: false, stopping: false, failed: false, summary: null };

const finished = (filesMatched: number, cancelled = false) => ({
  ...idle,
  summary: { filesMatched, cancelled },
});

describe('describeSearchState', () => {
  it('says nothing before any search has run', () => {
    expect(describeSearchState(idle)).toBe('');
  });

  it('announces that a search is running, and does not repeat counts while it runs', () => {
    expect(describeSearchState({ ...idle, running: true })).toBe('Searching');
  });

  it('announces stopping with priority over running', () => {
    expect(describeSearchState({ ...idle, running: true, stopping: true })).toBe('Stopping the search');
  });

  it('announces the result count when a search finishes', () => {
    expect(describeSearchState(finished(11))).toBe('Search finished. 11 files matched.');
    expect(describeSearchState(finished(1))).toBe('Search finished. 1 file matched.');
    expect(describeSearchState(finished(0))).toBe('Search finished. No files matched.');
  });

  it('announces a stopped search differently from a finished one', () => {
    expect(describeSearchState(finished(5, true))).toBe('Search stopped. 5 files matched.');
    expect(describeSearchState(finished(0, true))).toBe('Search stopped. No files matched.');
  });

  it('formats large counts with separators', () => {
    expect(describeSearchState(finished(15586))).toBe('Search finished. 15,586 files matched.');
  });

  it('stays silent when the search could not start, because the inline alert already says why', () => {
    expect(describeSearchState({ ...idle, failed: true })).toBe('');
    expect(describeSearchState({ ...idle, failed: true, summary: null })).toBe('');
  });
});

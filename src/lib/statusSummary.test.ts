import { describe, expect, it } from 'vitest';
import { describeFind, statusPhase } from './statusSummary';

describe('describeFind', () => {
  it('leads with the matches and the files for a content search', () => {
    expect(describeFind({ filesMatched: 3, totalHits: 95 })).toBe('95 matches in 3 files');
  });

  it('uses singular words when there is one of something', () => {
    expect(describeFind({ filesMatched: 1, totalHits: 1 })).toBe('1 match in 1 file');
    expect(describeFind({ filesMatched: 1, totalHits: 4 })).toBe('4 matches in 1 file');
  });

  it('counts only files for a name-only search, which has no matches', () => {
    expect(describeFind({ filesMatched: 12, totalHits: 0 })).toBe('12 files matched');
    expect(describeFind({ filesMatched: 1, totalHits: 0 })).toBe('1 file matched');
  });

  it('says plainly when nothing matched', () => {
    expect(describeFind({ filesMatched: 0, totalHits: 0 })).toBe('No files matched');
  });

  it('separates thousands', () => {
    expect(describeFind({ filesMatched: 1234, totalHits: 56789 })).toBe('56,789 matches in 1,234 files');
  });
});

describe('statusPhase', () => {
  it('names the phase of the search in the order the words are checked', () => {
    expect(statusPhase({ running: true, stopping: true, summary: null })).toBe('Stopping');
    expect(statusPhase({ running: true, stopping: false, summary: null })).toBe('Searching');
    expect(statusPhase({ running: false, stopping: false, summary: { cancelled: true } })).toBe('Stopped');
    expect(statusPhase({ running: false, stopping: false, summary: { cancelled: false } })).toBe('Done');
    expect(statusPhase({ running: false, stopping: false, summary: null })).toBe('Ready');
  });
});

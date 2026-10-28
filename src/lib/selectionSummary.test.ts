import { describe, expect, it } from 'vitest';
import { selectionSummary } from './selectionSummary';

describe('selectionSummary', () => {
  it('is empty when fewer than two rows are selected', () => {
    expect(selectionSummary(0, 0)).toBe('');
    expect(selectionSummary(1, 2048)).toBe('');
  });

  it('says N selected with the total size', () => {
    expect(selectionSummary(3, 13_002_342)).toBe('3 selected, 12.4 MB');
  });

  it('uses the same form for two rows as for many', () => {
    expect(selectionSummary(2, 100)).toBe('2 selected, 100 B');
  });

  it('groups thousands in large counts', () => {
    expect(selectionSummary(100_000, 1024)).toBe('100,000 selected, 1.0 KB');
  });
});

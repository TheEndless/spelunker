import { describe, expect, it } from 'vitest';
import { EMPTY_SELECTION, selectAll, toggleCurrent, type SelectionState } from './selection';
import { selectionAnnouncement, selectionSummary } from './selectionSummary';

describe('selectionAnnouncement', () => {
  const rows = [{ path: 'a' }, { path: 'b' }, { path: 'c' }];

  it('says nothing when select all on an empty list changes nothing', () => {
    expect(selectionAnnouncement(EMPTY_SELECTION, selectAll(EMPTY_SELECTION, []))).toBeNull();
  });

  it('says nothing when Ctrl+Space has no current row to toggle', () => {
    const before: SelectionState = { anchor: null, current: null, paths: new Set(['a']) };
    expect(selectionAnnouncement(before, toggleCurrent(before))).toBeNull();
  });

  it('says how many are selected after a change', () => {
    expect(selectionAnnouncement(EMPTY_SELECTION, selectAll(EMPTY_SELECTION, rows))).toBe('3 selected');
  });

  it('also speaks a change that leaves nothing selected', () => {
    const before: SelectionState = { anchor: 'a', current: 'a', paths: new Set(['a']) };
    expect(selectionAnnouncement(before, toggleCurrent(before))).toBe('0 selected');
  });
});

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

import { describe, expect, it } from 'vitest';
import { nextRowIndex } from './gridNavigation';

const page = 10;

describe('nextRowIndex', () => {
  it('moves one row with the arrow keys', () => {
    expect(nextRowIndex('ArrowDown', 3, 100, page)).toBe(4);
    expect(nextRowIndex('ArrowUp', 3, 100, page)).toBe(2);
  });

  it('stays on the first and last rows instead of wrapping', () => {
    expect(nextRowIndex('ArrowUp', 0, 100, page)).toBe(0);
    expect(nextRowIndex('ArrowDown', 99, 100, page)).toBe(99);
  });

  it('moves a page at a time and clamps at the ends', () => {
    expect(nextRowIndex('PageDown', 5, 100, page)).toBe(15);
    expect(nextRowIndex('PageUp', 25, 100, page)).toBe(15);
    expect(nextRowIndex('PageDown', 95, 100, page)).toBe(99);
    expect(nextRowIndex('PageUp', 4, 100, page)).toBe(0);
  });

  it('jumps to the first and last row with Home and End', () => {
    expect(nextRowIndex('Home', 42, 100, page)).toBe(0);
    expect(nextRowIndex('End', 42, 100, page)).toBe(99);
  });

  it('starts from the top when nothing is selected and the key moves forward', () => {
    expect(nextRowIndex('ArrowDown', -1, 100, page)).toBe(0);
    expect(nextRowIndex('PageDown', -1, 100, page)).toBe(0);
    expect(nextRowIndex('Home', -1, 100, page)).toBe(0);
  });

  it('starts from the bottom when nothing is selected and the key moves backward', () => {
    expect(nextRowIndex('ArrowUp', -1, 100, page)).toBe(99);
    expect(nextRowIndex('PageUp', -1, 100, page)).toBe(99);
    expect(nextRowIndex('End', -1, 100, page)).toBe(99);
  });

  it('does nothing for an empty list or an unrelated key', () => {
    expect(nextRowIndex('ArrowDown', -1, 0, page)).toBeNull();
    expect(nextRowIndex('a', 3, 100, page)).toBeNull();
    expect(nextRowIndex('Tab', 3, 100, page)).toBeNull();
  });

  it('treats a stale selection past the end as the last row', () => {
    expect(nextRowIndex('ArrowUp', 500, 10, page)).toBe(8);
    expect(nextRowIndex('ArrowDown', 500, 10, page)).toBe(9);
  });

  it('always moves at least one row for Page keys even with a tiny viewport', () => {
    expect(nextRowIndex('PageDown', 3, 100, 0)).toBe(4);
    expect(nextRowIndex('PageUp', 3, 100, 0)).toBe(2);
  });
});

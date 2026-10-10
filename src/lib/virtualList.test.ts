import { describe, expect, it } from 'vitest';
import { visibleWindow } from './virtualList';

const base = { rowHeight: 20, viewportHeight: 100, overscan: 2 };

describe('visibleWindow', () => {
  it('renders the first screenful plus overscan at the top', () => {
    const window = visibleWindow({ ...base, scrollTop: 0, rowCount: 1000 });
    expect(window.start).toBe(0);
    expect(window.end).toBe(7); // 5 visible rows + 2 overscan
    expect(window.offsetY).toBe(0);
    expect(window.totalHeight).toBe(20000);
  });

  it('starts earlier by the overscan when scrolled', () => {
    const window = visibleWindow({ ...base, scrollTop: 400, rowCount: 1000 });
    expect(window.start).toBe(18);
    expect(window.end).toBe(27);
    expect(window.offsetY).toBe(18 * 20);
  });

  it('counts a partially visible row', () => {
    const window = visibleWindow({ ...base, scrollTop: 10, rowCount: 1000 });
    expect(window.start).toBe(0);
    expect(window.end).toBe(8);
  });

  it('never runs past the last row', () => {
    const window = visibleWindow({ ...base, scrollTop: 19900, rowCount: 1000 });
    expect(window.end).toBe(1000);
  });

  it('handles an empty list', () => {
    const window = visibleWindow({ ...base, scrollTop: 0, rowCount: 0 });
    expect(window).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0 });
  });

  it('clamps a stale scroll position after the list shrinks', () => {
    const window = visibleWindow({ ...base, scrollTop: 5000, rowCount: 10 });
    expect(window.start).toBeLessThanOrEqual(window.end);
    expect(window.end).toBe(10);
  });
});

import { describe, expect, it } from 'vitest';
import { fitColumnWidth, resizeWithKey } from './columnResize';

describe('resizeWithKey', () => {
  it('widens and narrows by a small step', () => {
    expect(resizeWithKey(200, 'ArrowRight', false, 48)).toBe(208);
    expect(resizeWithKey(200, 'ArrowLeft', false, 48)).toBe(192);
  });

  it('uses a larger step with Shift', () => {
    expect(resizeWithKey(200, 'ArrowRight', true, 48)).toBe(232);
    expect(resizeWithKey(200, 'ArrowLeft', true, 48)).toBe(168);
  });

  it('never goes below the minimum width', () => {
    expect(resizeWithKey(50, 'ArrowLeft', false, 48)).toBe(48);
    expect(resizeWithKey(60, 'ArrowLeft', true, 48)).toBe(48);
  });

  it('ignores other keys', () => {
    expect(resizeWithKey(200, 'ArrowUp', false, 48)).toBeNull();
    expect(resizeWithKey(200, 'a', false, 48)).toBeNull();
  });
});

describe('fitColumnWidth', () => {
  it('fits the widest cell plus padding', () => {
    expect(fitColumnWidth({ cellWidths: [80, 140, 95], headerWidth: 40, padding: 20, min: 48, max: 600 })).toBe(160);
  });

  it('is never narrower than the header', () => {
    expect(fitColumnWidth({ cellWidths: [30, 20], headerWidth: 90, padding: 20, min: 48, max: 600 })).toBe(110);
  });

  it('respects the minimum and maximum', () => {
    expect(fitColumnWidth({ cellWidths: [5], headerWidth: 5, padding: 4, min: 48, max: 600 })).toBe(48);
    expect(fitColumnWidth({ cellWidths: [2000], headerWidth: 40, padding: 20, min: 48, max: 600 })).toBe(600);
  });

  it('rounds up to whole pixels', () => {
    expect(fitColumnWidth({ cellWidths: [100.2], headerWidth: 10, padding: 20, min: 48, max: 600 })).toBe(121);
  });

  it('handles an empty column by fitting the header', () => {
    expect(fitColumnWidth({ cellWidths: [], headerWidth: 60, padding: 20, min: 48, max: 600 })).toBe(80);
  });
});

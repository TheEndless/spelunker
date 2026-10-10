import { describe, expect, it } from 'vitest';
import { fitMiddle } from './textFit';

const ELLIPSIS = '\u2026';
/** One pixel per UTF-16 unit keeps the expectations easy to read. */
const unitWidth = (text: string) => text.length;

describe('fitMiddle', () => {
  it('returns text that already fits unchanged', () => {
    expect(fitMiddle('C:\\short', 100, unitWidth)).toBe('C:\\short');
  });

  it('replaces the middle with an ellipsis so the result fits', () => {
    const path = 'C:\\Users\\steve\\Documents\\projects\\spelunker\\src\\lib';
    const fitted = fitMiddle(path, 24, unitWidth);
    expect(fitted.length).toBeLessThanOrEqual(24);
    expect(fitted).toContain(ELLIPSIS);
    expect(fitted.startsWith('C:\\')).toBe(true);
    expect(fitted.endsWith('src\\lib')).toBe(true);
  });

  it('uses the whole width rather than cutting more than needed', () => {
    const fitted = fitMiddle('abcdefghijklmnopqrstuvwxyz', 11, unitWidth);
    expect(fitted.length).toBe(11);
  });

  it('keeps at least as much of the end as the start, since the end names the folder', () => {
    const fitted = fitMiddle('abcdefghijklmnopqrstuvwxyz', 10, unitWidth);
    const [start, end] = fitted.split(ELLIPSIS);
    expect(end.length).toBeGreaterThanOrEqual(start.length);
  });

  it('degrades to just the ellipsis, then nothing, in a very narrow column', () => {
    expect(fitMiddle('abcdefghij', 1, unitWidth)).toBe(ELLIPSIS);
    expect(fitMiddle('abcdefghij', 0, unitWidth)).toBe('');
  });

  it('never splits a surrogate pair', () => {
    const text = 'a\u{1F600}'.repeat(20);
    for (let width = 2; width < 30; width++) {
      const fitted = fitMiddle(text, width, unitWidth);
      expect(fitted).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(fitted).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  });

  it('copes with proportional widths', () => {
    const narrowLetters = (text: string) =>
      [...text].reduce((sum, character) => sum + (character === 'i' ? 1 : 3), 0);
    const fitted = fitMiddle('iiiiiiiiiiWWWWWWWWWWiiiiiiiiii', 30, narrowLetters);
    expect(narrowLetters(fitted)).toBeLessThanOrEqual(30);
    expect(fitted).toContain(ELLIPSIS);
  });
});

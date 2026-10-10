import { describe, expect, it } from 'vitest';
import { highlightSegments } from './highlight';

const ELLIPSIS = '…';

describe('highlightSegments', () => {
  it('splits text around a match', () => {
    expect(highlightSegments('say needle now', [{ start: 4, end: 10 }], 200)).toEqual([
      { text: 'say ', match: false },
      { text: 'needle', match: true },
      { text: ' now', match: false },
    ]);
  });

  it('returns one plain segment when there are no matches', () => {
    expect(highlightSegments('plain', [], 200)).toEqual([{ text: 'plain', match: false }]);
  });

  it('handles adjacent and unsorted ranges', () => {
    const segments = highlightSegments('abcd', [{ start: 2, end: 4 }, { start: 0, end: 2 }], 200);
    expect(segments.map((s) => s.text).join('')).toBe('abcd');
    expect(segments.every((s) => s.match)).toBe(true);
  });

  it('merges overlapping ranges', () => {
    const segments = highlightSegments('abcdef', [{ start: 1, end: 4 }, { start: 3, end: 5 }], 200);
    expect(segments).toEqual([
      { text: 'a', match: false },
      { text: 'bcde', match: true },
      { text: 'f', match: false },
    ]);
  });

  it('drops empty and out-of-bounds ranges', () => {
    const segments = highlightSegments('abc', [{ start: 1, end: 1 }, { start: 5, end: 9 }], 200);
    expect(segments).toEqual([{ text: 'abc', match: false }]);
  });

  it('truncates a long line around the first match with ellipses', () => {
    const line = 'x'.repeat(1000) + 'needle' + 'y'.repeat(1000);
    const segments = highlightSegments(line, [{ start: 1000, end: 1006 }], 40);
    const joined = segments.map((s) => s.text).join('');
    expect(joined.length).toBeLessThan(80);
    expect(segments.find((s) => s.match)?.text).toBe('needle');
    expect(joined.startsWith(ELLIPSIS)).toBe(true);
    expect(joined.endsWith(ELLIPSIS)).toBe(true);
  });

  it('does not add a leading ellipsis when the match is at the start', () => {
    const line = 'needle' + 'y'.repeat(1000);
    const joined = highlightSegments(line, [{ start: 0, end: 6 }], 40)
      .map((s) => s.text)
      .join('');
    expect(joined.startsWith(ELLIPSIS)).toBe(false);
    expect(joined.endsWith(ELLIPSIS)).toBe(true);
  });
});

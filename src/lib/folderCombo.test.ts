import { describe, expect, it } from 'vitest';
import { ALL_DRIVES_LABEL, applyChoice, currentSegment, filterRecents, isAllDrives, nextActiveIndex, toggleAllDrives } from './folderCombo';

describe('currentSegment', () => {
  it('returns the whole value when there is no semicolon', () => {
    expect(currentSegment('C:\\data')).toBe('C:\\data');
  });
  it('returns the text after the last semicolon, trimmed', () => {
    expect(currentSegment('C:\\a;  D:\\b  ')).toBe('D:\\b');
    expect(currentSegment('C:\\a; D:\\b; E:')).toBe('E:');
  });
  it('returns an empty string for an empty value or a trailing semicolon', () => {
    expect(currentSegment('')).toBe('');
    expect(currentSegment('C:\\a;')).toBe('');
    expect(currentSegment('C:\\a;   ')).toBe('');
  });
  it('trims surrounding spaces when there is one segment', () => {
    expect(currentSegment('   C:\\a ')).toBe('C:\\a');
  });
});

describe('filterRecents', () => {
  const recents = ['C:\\Data', 'D:\\other', 'C:\\work\\data2'];

  it('returns all recents for an empty segment', () => {
    expect(filterRecents(recents, '')).toEqual(recents);
  });
  it('matches case-insensitively as a substring and keeps order', () => {
    expect(filterRecents(recents, 'DATA')).toEqual(['C:\\Data', 'C:\\work\\data2']);
  });
  it('returns nothing when no recent matches', () => {
    expect(filterRecents(recents, 'zzz')).toEqual([]);
  });
  it('returns nothing for no recents', () => {
    expect(filterRecents([], '')).toEqual([]);
    expect(filterRecents([], 'a')).toEqual([]);
  });
  it('hides a lone match that equals the typed text exactly, ignoring case', () => {
    expect(filterRecents(['C:\\Data'], 'c:\\data')).toEqual([]);
    expect(filterRecents(recents, 'd:\\OTHER')).toEqual([]);
  });
  it('keeps an exact match when other recents also match', () => {
    expect(filterRecents(['C:\\data', 'C:\\data2'], 'C:\\data')).toEqual(['C:\\data', 'C:\\data2']);
  });
  it('handles a single recent that matches partially', () => {
    expect(filterRecents(['C:\\data'], 'dat')).toEqual(['C:\\data']);
  });
});

describe('applyChoice', () => {
  it('replaces the last segment and keeps earlier ones', () => {
    expect(applyChoice('C:\\a; D:', 'D:\\b')).toBe('C:\\a; D:\\b');
  });
  it('handles an empty value', () => {
    expect(applyChoice('', 'D:\\b')).toBe('D:\\b');
  });
  it('replaces a single segment', () => {
    expect(applyChoice('C:\\da', 'C:\\data')).toBe('C:\\data');
  });
  it('handles a trailing semicolon', () => {
    expect(applyChoice('C:\\a;', 'D:\\b')).toBe('C:\\a; D:\\b');
    expect(applyChoice('C:\\a; ', 'D:\\b')).toBe('C:\\a; D:\\b');
  });
  it('normalizes extra spaces around earlier separators', () => {
    expect(applyChoice('C:\\a ;   D:\\b ; x', 'E:\\c')).toBe('C:\\a; D:\\b; E:\\c');
  });
});

describe('nextActiveIndex', () => {
  it('returns -1 when there are no items', () => {
    expect(nextActiveIndex(-1, 0, 'ArrowDown')).toBe(-1);
    expect(nextActiveIndex(0, 0, 'ArrowUp')).toBe(-1);
  });
  it('ArrowDown goes from nothing to the first item', () => {
    expect(nextActiveIndex(-1, 3, 'ArrowDown')).toBe(0);
  });
  it('ArrowDown moves forward and wraps from the last item', () => {
    expect(nextActiveIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(nextActiveIndex(2, 3, 'ArrowDown')).toBe(0);
  });
  it('ArrowUp goes from nothing to the last item', () => {
    expect(nextActiveIndex(-1, 3, 'ArrowUp')).toBe(2);
  });
  it('ArrowUp moves back and wraps from the first item', () => {
    expect(nextActiveIndex(2, 3, 'ArrowUp')).toBe(1);
    expect(nextActiveIndex(0, 3, 'ArrowUp')).toBe(2);
  });
  it('works with a single item', () => {
    expect(nextActiveIndex(-1, 1, 'ArrowDown')).toBe(0);
    expect(nextActiveIndex(0, 1, 'ArrowDown')).toBe(0);
    expect(nextActiveIndex(0, 1, 'ArrowUp')).toBe(0);
    expect(nextActiveIndex(-1, 1, 'ArrowUp')).toBe(0);
  });
});

describe('all drives', () => {
  it('recognises the words that mean every local drive, in any case', () => {
    for (const value of ['This PC', 'this pc', ' All drives ', 'This PC (all drives)', 'Computer']) {
      expect(isAllDrives(value), value).toBe(true);
    }
  });

  it('is only true when the whole box says so', () => {
    expect(isAllDrives('C:/')).toBe(false);
    expect(isAllDrives('This PC; D:/Data')).toBe(false);
    expect(isAllDrives('')).toBe(false);
    expect(isAllDrives('My PC Games')).toBe(false);
  });

  it('switching on remembers what was in the box', () => {
    expect(toggleAllDrives('D:/Work; E:/Notes', '')).toEqual({ value: ALL_DRIVES_LABEL, remembered: 'D:/Work; E:/Notes' });
  });

  it('switching off puts back what was remembered', () => {
    expect(toggleAllDrives(ALL_DRIVES_LABEL, 'D:/Work')).toEqual({ value: 'D:/Work', remembered: '' });
  });

  it('switching off with nothing remembered leaves the box empty', () => {
    expect(toggleAllDrives('This PC', '')).toEqual({ value: '', remembered: '' });
  });

  it('switching on from an empty box remembers nothing', () => {
    expect(toggleAllDrives('', '')).toEqual({ value: ALL_DRIVES_LABEL, remembered: '' });
  });
});

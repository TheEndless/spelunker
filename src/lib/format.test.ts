import { describe, expect, it } from 'vitest';
import { formatDate, formatDuration, formatSize, modifiedLabel, splitPath } from './format';

describe('formatSize', () => {
  it('uses bytes below 1 KB', () => expect(formatSize(512)).toBe('512 B'));
  it('uses one decimal for larger units', () => {
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatSize(3 * 1024 ** 3)).toBe('3.0 GB');
  });
  it('handles zero', () => expect(formatSize(0)).toBe('0 B'));
});

describe('formatDate', () => {
  it('formats local time as YYYY-MM-DD HH:mm', () => {
    const local = new Date(2026, 0, 5, 9, 7).getTime();
    expect(formatDate(local)).toBe('2026-01-05 09:07');
  });
  it('shows an empty cell when unknown', () => expect(formatDate(null)).toBe(''));
});

describe('formatDuration', () => {
  it('shows milliseconds under a second', () => expect(formatDuration(240)).toBe('240 ms'));
  it('shows seconds with one decimal', () => expect(formatDuration(2450)).toBe('2.5 s'));
  it('shows minutes and seconds over a minute', () => expect(formatDuration(125000)).toBe('2m 5s'));
});

describe('splitPath', () => {
  it('splits a Windows path', () => {
    expect(splitPath('C:\\code\\src\\main.rs')).toEqual({ name: 'main.rs', folder: 'C:\\code\\src' });
  });
  it('handles UNC paths and forward slashes', () => {
    expect(splitPath('\\\\server\\share\\f.txt').folder).toBe('\\\\server\\share');
    expect(splitPath('/tmp/x/y.log')).toEqual({ name: 'y.log', folder: '/tmp/x' });
  });
  it('treats a bare name as having no folder', () => {
    expect(splitPath('lonely.txt')).toEqual({ name: 'lonely.txt', folder: '' });
  });
});

describe('modifiedLabel', () => {
  it('shows the text Windows formatted, exactly as given', () => {
    expect(modifiedLabel({ modifiedMs: 1_700_000_000_000, modifiedText: '14/11/2023 22:13' })).toBe('14/11/2023 22:13');
  });

  it('falls back to a plain local format when there is no Windows text', () => {
    const label = modifiedLabel({ modifiedMs: new Date(2026, 5, 15, 9, 5).getTime(), modifiedText: '' });
    expect(label).toBe('2026-06-15 09:05');
  });

  it('is empty when the time is unknown', () => {
    expect(modifiedLabel({ modifiedMs: null, modifiedText: '' })).toBe('');
  });
});

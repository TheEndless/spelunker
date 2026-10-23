import { describe, expect, it } from 'vitest';
import { exportFileName, formatResults } from './exportResults';
import type { DisplayRow } from './types';

const row = (overrides: Partial<DisplayRow>): DisplayRow => ({
  id: 0,
  path: 'C:\\data\\notes.txt',
  name: 'notes.txt',
  folder: 'C:\\data',
  size: 1234,
  modifiedMs: Date.UTC(2026, 0, 2, 3, 4, 5),
  modifiedText: '',
  hits: 3,
  typeName: 'Text Document',
  ...overrides,
});

describe('plain text export', () => {
  it('lists one full path per line', () => {
    const text = formatResults([row({}), row({ path: 'C:\\x\\b.log' })], 'txt');
    expect(text).toBe('C:\\data\\notes.txt\r\nC:\\x\\b.log\r\n');
  });

  it('is empty for no results', () => {
    expect(formatResults([], 'txt')).toBe('');
  });
});

describe('CSV export', () => {
  it('starts with a byte order mark so Excel reads accents, then a header row', () => {
    const csv = formatResults([row({})], 'csv');
    expect(csv.startsWith('\uFEFFPath,Name,Folder,Matches,Size (bytes),Modified (UTC),Type\r\n')).toBe(true);
  });

  it('writes raw sizes and ISO times so the file sorts and parses cleanly', () => {
    const csv = formatResults([row({})], 'csv');
    expect(csv).toContain('C:\\data\\notes.txt,notes.txt,C:\\data,3,1234,2026-01-02T03:04:05Z,Text Document\r\n');
  });

  it('quotes fields with commas, quotes, or line breaks, doubling inner quotes', () => {
    const csv = formatResults([row({ name: 'a,b "c".txt', typeName: 'x\ny' })], 'csv');
    expect(csv).toContain('"a,b ""c"".txt"');
    expect(csv).toContain('"x\ny"');
  });

  it('leaves the date blank when unknown and the matches blank for name-only rows', () => {
    const csv = formatResults([row({ modifiedMs: null, hits: 0 })], 'csv');
    expect(csv).toContain(',,1234,,Text Document\r\n');
  });

  it('guards against spreadsheet formula injection in file names', () => {
    const csv = formatResults([row({ name: '=HYPERLINK("x")' })], 'csv');
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
  });
});

describe('suggested file name', () => {
  it('uses the format extension and a date', () => {
    expect(exportFileName('csv', new Date(2026, 5, 7))).toBe('spelunker-results-2026-06-07.csv');
    expect(exportFileName('txt', new Date(2026, 11, 25))).toBe('spelunker-results-2026-12-25.txt');
  });
});

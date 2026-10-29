import { describe, expect, it } from 'vitest';
import { DEMO_NOTE_PATH, DEMO_QUERY, demoPreview, demoRows } from './demoFixture';

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const MB = 1024 * 1024;

describe('the demo fixture', () => {
  it('is the same every time it is made for the same moment', () => {
    expect(demoRows(NOW)).toEqual(demoRows(NOW));
  });

  it('keeps every file under one invented user, so no real folder or name can show', () => {
    const rows = demoRows(NOW);
    for (const row of rows) expect(row.path.startsWith('C:\\Users\\sam\\Documents\\'), row.path).toBe(true);
    const everything = rows.map((row) => row.path).join('\n').toLowerCase();
    for (const real of ['skean', 'theendless', 'paramount', 'roku', 'conan']) expect(everything).not.toContain(real);
  });

  it('is big enough to fill a map, with each path once and a hit in every file', () => {
    const rows = demoRows(NOW);
    expect(rows.length).toBeGreaterThanOrEqual(250);
    expect(rows.length).toBeLessThanOrEqual(500);
    expect(new Set(rows.map((row) => row.path)).size).toBe(rows.length);
    for (const row of rows) expect(row.hits, row.path).toBeGreaterThanOrEqual(1);
  });

  it('has the spread of types and sizes of a real documents folder, with a few big files', () => {
    const rows = demoRows(NOW);
    expect(new Set(rows.map((row) => row.typeName)).size).toBeGreaterThanOrEqual(6);
    expect(rows.some((row) => row.size > 40 * 1024 * 1024)).toBe(true);
    expect(rows.filter((row) => row.size < 100 * 1024).length).toBeGreaterThan(40);
  });

  it('puts files in the size bands from tiny to 64 MB and over, with none so big it swamps the map', () => {
    const rows = demoRows(NOW);
    const limits = [16 * 1024, 256 * 1024, 4 * MB, 64 * MB];
    const bandOf = (size: number) => limits.filter((limit) => size >= limit).length;
    expect([...new Set(rows.map((row) => bandOf(row.size)))].sort()).toEqual([0, 1, 2, 3, 4]);
    const total = rows.reduce((sum, row) => sum + row.size, 0);
    expect(Math.max(...rows.map((row) => row.size))).toBeLessThan(total / 6);
  });

  it('lists the folders in name order, as a search does', () => {
    const folders = demoRows(NOW).map((row) => row.path.slice(0, row.path.lastIndexOf('\\')).toLowerCase());
    const firstSeen = [...new Set(folders)];
    expect(firstSeen).toEqual([...firstSeen].sort());
    // A folder's files are together, not scattered.
    expect(folders.filter((folder, index) => index > 0 && folder !== folders[index - 1]).length).toBe(firstSeen.length - 1);
  });

  it('dates every file within the last few years, and writes the date in the row', () => {
    for (const row of demoRows(NOW)) {
      expect(row.modifiedMs!).toBeLessThanOrEqual(NOW);
      expect(row.modifiedMs!).toBeGreaterThan(NOW - 3 * 365 * 86_400_000);
      expect(row.modifiedText).not.toBe('');
    }
  });
});

describe('the demo preview', () => {
  const rows = demoRows(NOW);

  it('is the text of one email among the rows, whose hit count is what the text holds', () => {
    const note = rows.find((row) => row.path === DEMO_NOTE_PATH);
    expect(note).toBeDefined();
    const lines = demoPreview(100);
    const occurrences = lines.reduce((sum, line) => sum + line.matchRanges.length, 0);
    expect(occurrences).toBeGreaterThan(0);
    expect(note!.hits).toBe(occurrences);
  });

  it('marks each match with its place in the line, whatever the case', () => {
    for (const line of demoPreview(100)) {
      for (const range of line.matchRanges) expect(line.text.slice(range.start, range.end).toLowerCase()).toBe(DEMO_QUERY);
      expect(line.isMatch).toBe(line.matchRanges.length > 0);
    }
  });

  it('shows only the lines near a match for a small context, and in order', () => {
    const near = demoPreview(1);
    const all = demoPreview(100);
    expect(near.length).toBeLessThan(all.length);
    expect(near.map((line) => line.lineNumber)).toEqual([...near.map((line) => line.lineNumber)].sort((a, b) => a - b));
  });
});

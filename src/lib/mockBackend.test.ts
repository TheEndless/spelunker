import { describe, expect, it } from 'vitest';
import { fileCategory } from './fileKinds';
import { deepPath, deepRow } from './mockBackend';

describe('deepPath', () => {
  it('is deterministic', () => {
    for (const index of [0, 1, 7, 4242, 99_999]) expect(deepPath(index)).toBe(deepPath(index));
  });

  it('produces at least 5 distinct depths over 1000 indexes', () => {
    const depths = new Set<number>();
    for (let index = 0; index < 1000; index++) depths.add(deepPath(index).split('\\').length);
    expect(depths.size).toBeGreaterThanOrEqual(5);
  });

  it('never returns the same path for two indexes in 0..100000', () => {
    const paths = new Set<string>();
    for (let index = 0; index < 100_000; index++) paths.add(deepPath(index));
    expect(paths.size).toBe(100_000);
  });

  it('spreads files over many folders, unevenly', () => {
    const filesPerFolder = new Map<string, number>();
    for (let index = 0; index < 100_000; index++) {
      const path = deepPath(index);
      const folder = path.slice(0, path.lastIndexOf('\\'));
      filesPerFolder.set(folder, (filesPerFolder.get(folder) ?? 0) + 1);
    }
    const counts = [...filesPerFolder.values()];
    expect(filesPerFolder.size).toBeGreaterThan(1000);
    expect(Math.max(...counts)).toBeGreaterThan(4 * Math.min(...counts));
  });
});

describe('deepRow', () => {
  it('uses the deep path, carries hits, and has heavy-tailed sizes', () => {
    const rows = Array.from({ length: 100_000 }, (_, index) => deepRow(index));
    expect(rows[123].path).toBe(deepPath(123));
    expect(rows.every((row) => row.hits > 0)).toBe(true);
    const sizes = rows.map((row) => row.size).sort((left, right) => left - right);
    const median = sizes[sizes.length / 2];
    const largest = sizes[sizes.length - 1];
    expect(largest).toBeGreaterThan(20 * median);
  });

  it('gives a share of files an unrecognised extension, so the map shows the Other category', () => {
    const names = Array.from({ length: 1000 }, (_, index) => deepRow(index).path);
    const others = names.filter((name) => fileCategory(name) === 'other').length;
    expect(others).toBeGreaterThanOrEqual(100);
    expect(others).toBeLessThan(200);
  });

  it('spreads modified dates over every age bucket the map knows (today to older)', () => {
    const now = Date.now();
    const dayMs = 86_400_000;
    const dates = Array.from({ length: 1000 }, (_, index) => deepRow(index).modifiedMs);
    expect(dates.some((modifiedMs) => modifiedMs === null)).toBe(true);
    const ages = dates.flatMap((modifiedMs) => (modifiedMs === null ? [] : [(now - modifiedMs) / dayMs]));
    expect(ages.some((age) => age < 1)).toBe(true);
    expect(ages.some((age) => age >= 1 && age < 7)).toBe(true);
    expect(ages.some((age) => age >= 7 && age < 28)).toBe(true);
    expect(ages.some((age) => age >= 31 && age < 300)).toBe(true);
    expect(ages.some((age) => age > 400)).toBe(true);
  });
});

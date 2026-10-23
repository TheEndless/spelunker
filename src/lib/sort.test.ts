import { describe, expect, it } from 'vitest';
import { sortRows } from './sort';
import type { DisplayRow } from './types';

function row(name: string, overrides: Partial<DisplayRow> = {}): DisplayRow {
  return {
    id: 0,
    path: `C:\\d\\${name}`,
    name,
    folder: 'C:\\d',
    typeName: 'File',
    size: 1,
    modifiedMs: 1,
    modifiedText: '',
    hits: 0,
    ...overrides,
  };
}

const names = (rows: DisplayRow[]) => rows.map((r) => r.name);

describe('sortRows', () => {
  it('sorts names case-insensitively', () => {
    const rows = [row('b.txt'), row('A.txt'), row('c.txt')];
    expect(names(sortRows(rows, 'name', 'asc'))).toEqual(['A.txt', 'b.txt', 'c.txt']);
    expect(names(sortRows(rows, 'name', 'desc'))).toEqual(['c.txt', 'b.txt', 'A.txt']);
  });

  it('sorts numbers numerically, not as text', () => {
    const rows = [row('a', { size: 100 }), row('b', { size: 9 }), row('c', { size: 20 })];
    expect(names(sortRows(rows, 'size', 'asc'))).toEqual(['b', 'c', 'a']);
  });

  it('puts unknown dates last in both directions', () => {
    const rows = [row('x', { modifiedMs: null }), row('y', { modifiedMs: 5 }), row('z', { modifiedMs: 9 })];
    expect(names(sortRows(rows, 'modified', 'asc'))).toEqual(['y', 'z', 'x']);
    expect(names(sortRows(rows, 'modified', 'desc'))).toEqual(['z', 'y', 'x']);
  });

  it('is stable for equal keys', () => {
    const rows = [row('first', { hits: 1 }), row('second', { hits: 1 }), row('third', { hits: 1 })];
    expect(names(sortRows(rows, 'hits', 'desc'))).toEqual(['first', 'second', 'third']);
  });

  it('does not mutate the input', () => {
    const rows = [row('b'), row('a')];
    sortRows(rows, 'name', 'asc');
    expect(names(rows)).toEqual(['b', 'a']);
  });

  it('sorts the type column by type name, ignoring case', () => {
    const rows = [
      row('a', { typeName: 'Text Document' }),
      row('b', { typeName: 'json File' }),
      row('c', { typeName: 'PNG File' }),
    ];
    expect(names(sortRows(rows, 'type', 'asc'))).toEqual(['b', 'c', 'a']);
  });
});

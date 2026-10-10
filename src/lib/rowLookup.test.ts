import { describe, expect, it } from 'vitest';
import { findRowIndex } from './rowLookup';

const rows = ['a', 'b', 'c', 'd'].map((path) => ({ path }));

describe('findRowIndex', () => {
  it('takes the hint when that row is the one asked for', () => {
    expect(findRowIndex(rows, 'c', 2)).toBe(2);
  });

  it('searches when the hint points at another row, for example after a sort', () => {
    expect(findRowIndex(rows, 'd', 0)).toBe(3);
  });

  it('searches when the hint is out of range, or there is none yet', () => {
    expect(findRowIndex(rows, 'b', 99)).toBe(1);
    expect(findRowIndex(rows, 'b', -1)).toBe(1);
  });

  it('answers -1 for a path that is not listed, or for no path', () => {
    expect(findRowIndex(rows, 'zzz', 1)).toBe(-1);
    expect(findRowIndex(rows, null, 1)).toBe(-1);
  });

  it('does not look at any other row when the hint is right', () => {
    let reads = 0;
    const watched = new Proxy(rows, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(findRowIndex(watched, 'c', 2)).toBe(2);
    expect(reads).toBe(1);
  });
});

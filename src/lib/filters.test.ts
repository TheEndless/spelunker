import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  emptyDateFilter,
  emptySizeFilter,
  resolveDateFilter,
  resolveSizeFilter,
  type DateFilter,
  type SizeFilter,
} from './filters';

const size = (overrides: Partial<SizeFilter>): SizeFilter => ({ ...emptySizeFilter(), ...overrides });
const date = (overrides: Partial<DateFilter>): DateFilter => ({ ...emptyDateFilter(), ...overrides });

const MB = 1024 * 1024;

describe('resolveSizeFilter', () => {
  it('is open on both sides when off', () => {
    expect(resolveSizeFilter(size({ mode: 'any' }))).toEqual({ ok: true, value: { min: null, max: null } });
  });

  it('larger than excludes the exact size', () => {
    expect(resolveSizeFilter(size({ mode: 'larger', value: '50', unit: 'MB' }))).toEqual({
      ok: true,
      value: { min: 50 * MB + 1, max: null },
    });
  });

  it('smaller than excludes the exact size', () => {
    expect(resolveSizeFilter(size({ mode: 'smaller', value: '10', unit: 'KB' }))).toEqual({
      ok: true,
      value: { min: null, max: 10 * 1024 - 1 },
    });
  });

  it('between is inclusive at both ends and mixes units', () => {
    expect(resolveSizeFilter(size({ mode: 'between', value: '1', unit: 'KB', value2: '2', unit2: 'MB' }))).toEqual({
      ok: true,
      value: { min: 1024, max: 2 * MB },
    });
  });

  it('accepts decimals and rounds to whole bytes', () => {
    expect(resolveSizeFilter(size({ mode: 'between', value: '1.5', unit: 'KB', value2: '2', unit2: 'KB' }))).toEqual({
      ok: true,
      value: { min: 1536, max: 2048 },
    });
  });

  it('asks for a number when the field is empty or not numeric', () => {
    for (const value of ['', '  ', 'abc', '-5', '1e3x']) {
      const result = resolveSizeFilter(size({ mode: 'larger', value, unit: 'MB' }));
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a backwards range', () => {
    const result = resolveSizeFilter(size({ mode: 'between', value: '5', unit: 'MB', value2: '1', unit2: 'MB' }));
    expect(result).toEqual({ ok: false, error: 'The first size is larger than the second' });
  });

  it('rejects smaller than zero, which can match nothing', () => {
    expect(resolveSizeFilter(size({ mode: 'smaller', value: '0', unit: 'B' })).ok).toBe(false);
  });

  it('allows larger than zero', () => {
    expect(resolveSizeFilter(size({ mode: 'larger', value: '0', unit: 'B' }))).toEqual({
      ok: true,
      value: { min: 1, max: null },
    });
  });
});

describe('resolveDateFilter', () => {
  const now = new Date(2026, 9, 9, 15, 30).getTime();
  const localDay = (year: number, month: number, day: number) => new Date(year, month - 1, day).getTime();

  it('is open on both sides when off', () => {
    expect(resolveDateFilter(date({ mode: 'any' }), now)).toEqual({ ok: true, value: { fromMs: null, toMs: null } });
  });

  it('resolves "within the last" relative to the moment of the search', () => {
    expect(resolveDateFilter(date({ mode: 'within', amount: '7', unit: 'days' }), now)).toEqual({
      ok: true,
      value: { fromMs: now - 7 * 86_400_000, toMs: null },
    });
    expect(resolveDateFilter(date({ mode: 'within', amount: '2', unit: 'hours' }), now)).toEqual({
      ok: true,
      value: { fromMs: now - 2 * 3_600_000, toMs: null },
    });
    expect(resolveDateFilter(date({ mode: 'within', amount: '1', unit: 'weeks' }), now)).toEqual({
      ok: true,
      value: { fromMs: now - 7 * 86_400_000, toMs: null },
    });
  });

  it('resolves the same saved filter differently on a later day', () => {
    const filter = date({ mode: 'within', amount: '1', unit: 'days' });
    const later = now + 30 * 86_400_000;
    const first = resolveDateFilter(filter, now);
    const second = resolveDateFilter(filter, later);
    expect(first.ok && second.ok && second.value.fromMs! - first.value.fromMs!).toBe(30 * 86_400_000);
  });

  it('before a day excludes that whole day', () => {
    expect(resolveDateFilter(date({ mode: 'before', date: '2026-01-01' }), now)).toEqual({
      ok: true,
      value: { fromMs: null, toMs: localDay(2026, 1, 1) },
    });
  });

  it('after a day starts at the following local midnight', () => {
    expect(resolveDateFilter(date({ mode: 'after', date: '2026-01-01' }), now)).toEqual({
      ok: true,
      value: { fromMs: localDay(2026, 1, 2), toMs: null },
    });
  });

  it('after the last day of a month rolls into the next month', () => {
    const result = resolveDateFilter(date({ mode: 'after', date: '2026-12-31' }), now);
    expect(result).toEqual({ ok: true, value: { fromMs: localDay(2027, 1, 1), toMs: null } });
  });

  it('between includes both whole days', () => {
    expect(resolveDateFilter(date({ mode: 'between', date: '2026-01-01', date2: '2026-01-31' }), now)).toEqual({
      ok: true,
      value: { fromMs: localDay(2026, 1, 1), toMs: localDay(2026, 2, 1) },
    });
  });

  it('rejects a backwards range', () => {
    const result = resolveDateFilter(date({ mode: 'between', date: '2026-02-01', date2: '2026-01-01' }), now);
    expect(result).toEqual({ ok: false, error: 'The start date is after the end date' });
  });

  it('rejects missing, malformed, and impossible dates', () => {
    for (const bad of ['', '2026-1-1', 'yesterday', '2026-02-30', '2026-13-01']) {
      expect(resolveDateFilter(date({ mode: 'before', date: bad }), now).ok).toBe(false);
    }
  });

  it('needs a positive amount for "within the last"', () => {
    for (const amount of ['', '0', '-3', 'x']) {
      expect(resolveDateFilter(date({ mode: 'within', amount, unit: 'days' }), now).ok).toBe(false);
    }
  });
});

describe('activeFilterCount', () => {
  const none = { size: size({}), modified: date({}), created: date({}), nameIsRegex: false, multiLine: false };

  it('is zero when nothing is set', () => {
    expect(activeFilterCount(none)).toBe(0);
  });

  it('counts each active filter once', () => {
    expect(activeFilterCount({ ...none, size: size({ mode: 'larger', value: '1', unit: 'MB' }) })).toBe(1);
    expect(
      activeFilterCount({
        ...none,
        size: size({ mode: 'between', value: '1', unit: 'MB', value2: '2', unit2: 'MB' }),
        modified: date({ mode: 'within', amount: '7', unit: 'days' }),
        created: date({ mode: 'before', date: '2026-01-01' }),
        nameIsRegex: true,
        multiLine: true,
      }),
    ).toBe(5);
  });

  it('counts a filter that is switched on even before its values are filled in', () => {
    expect(activeFilterCount({ ...none, modified: date({ mode: 'within' }) })).toBe(1);
  });
});

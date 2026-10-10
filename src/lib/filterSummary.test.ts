import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, type Criteria } from './criteria';
import { emptyDateFilter, emptySizeFilter } from './filters';
import { clearAllFilters, clearFilter, summarizeFilters, type FilterId } from './filterSummary';

const ELLIPSIS = '\u2026';

const freshCriteria = (): Criteria => structuredClone(DEFAULT_CRITERIA);

function labelsFor(change: (criteria: Criteria) => void): string[] {
  const criteria = freshCriteria();
  change(criteria);
  return summarizeFilters(criteria).map((item) => item.label);
}

function everythingOn(): Criteria {
  const criteria = freshCriteria();
  criteria.size = { ...emptySizeFilter(), mode: 'larger', value: '1', unit: 'MB' };
  criteria.modified = { ...emptyDateFilter(), mode: 'within', amount: '7', unit: 'days' };
  criteria.created = { ...emptyDateFilter(), mode: 'before', date: '2026-01-01' };
  criteria.nameIsRegex = true;
  criteria.multiLine = true;
  return criteria;
}

describe('summarizeFilters', () => {
  it('lists nothing for default criteria', () => {
    expect(summarizeFilters(freshCriteria())).toEqual([]);
  });

  describe('size', () => {
    it('describes larger', () => {
      expect(labelsFor((c) => (c.size = { ...c.size, mode: 'larger', value: '1', unit: 'MB' }))).toEqual([
        'Size over 1 MB',
      ]);
    });

    it('keeps the value and unit as typed', () => {
      expect(labelsFor((c) => (c.size = { ...c.size, mode: 'larger', value: '1.5', unit: 'KB' }))).toEqual([
        'Size over 1.5 KB',
      ]);
    });

    it('describes smaller', () => {
      expect(labelsFor((c) => (c.size = { ...c.size, mode: 'smaller', value: '10', unit: 'KB' }))).toEqual([
        'Size under 10 KB',
      ]);
    });

    it('describes between', () => {
      expect(
        labelsFor(
          (c) => (c.size = { mode: 'between', value: '1', unit: 'KB', value2: '2', unit2: 'MB' }),
        ),
      ).toEqual(['Size 1 KB to 2 MB']);
    });

    it('trims whitespace around typed values', () => {
      expect(labelsFor((c) => (c.size = { ...c.size, mode: 'larger', value: '  3 ', unit: 'GB' }))).toEqual([
        'Size over 3 GB',
      ]);
    });

    it('shows an ellipsis for a missing larger value', () => {
      expect(labelsFor((c) => (c.size = { ...c.size, mode: 'larger', value: '' }))).toEqual([
        `Size over ${ELLIPSIS}`,
      ]);
    });

    it('shows an ellipsis for a blank smaller value', () => {
      expect(labelsFor((c) => (c.size = { ...c.size, mode: 'smaller', value: '   ' }))).toEqual([
        `Size under ${ELLIPSIS}`,
      ]);
    });

    it('shows an ellipsis for each missing side of between', () => {
      expect(
        labelsFor((c) => (c.size = { mode: 'between', value: '', unit: 'KB', value2: '2', unit2: 'MB' })),
      ).toEqual([`Size ${ELLIPSIS} to 2 MB`]);
      expect(
        labelsFor((c) => (c.size = { mode: 'between', value: '1', unit: 'KB', value2: '', unit2: 'MB' })),
      ).toEqual([`Size 1 KB to ${ELLIPSIS}`]);
      expect(
        labelsFor((c) => (c.size = { mode: 'between', value: '', unit: 'KB', value2: '', unit2: 'MB' })),
      ).toEqual([`Size ${ELLIPSIS} to ${ELLIPSIS}`]);
    });
  });

  describe.each([
    ['modified', 'Modified'],
    ['created', 'Created'],
  ] as const)('%s date', (key, word) => {
    const setDate = (criteria: Criteria, change: Partial<Criteria['modified']>) => {
      criteria[key] = { ...criteria[key], ...change };
    };

    it('describes within with a plural unit', () => {
      expect(labelsFor((c) => setDate(c, { mode: 'within', amount: '7', unit: 'days' }))).toEqual([
        `${word} in the last 7 days`,
      ]);
    });

    it('uses singular for an amount of exactly 1', () => {
      expect(labelsFor((c) => setDate(c, { mode: 'within', amount: '1', unit: 'days' }))).toEqual([
        `${word} in the last day`,
      ]);
      expect(labelsFor((c) => setDate(c, { mode: 'within', amount: '1', unit: 'hours' }))).toEqual([
        `${word} in the last hour`,
      ]);
      expect(labelsFor((c) => setDate(c, { mode: 'within', amount: '1', unit: 'weeks' }))).toEqual([
        `${word} in the last week`,
      ]);
    });

    it('keeps plural for other amounts', () => {
      expect(labelsFor((c) => setDate(c, { mode: 'within', amount: '2', unit: 'hours' }))).toEqual([
        `${word} in the last 2 hours`,
      ]);
      expect(labelsFor((c) => setDate(c, { mode: 'within', amount: '1.5', unit: 'weeks' }))).toEqual([
        `${word} in the last 1.5 weeks`,
      ]);
      expect(labelsFor((c) => setDate(c, { mode: 'within', amount: '0', unit: 'days' }))).toEqual([
        `${word} in the last 0 days`,
      ]);
    });

    it('shows an ellipsis for a missing amount', () => {
      expect(labelsFor((c) => setDate(c, { mode: 'within', amount: '  ', unit: 'days' }))).toEqual([
        `${word} in the last ${ELLIPSIS}`,
      ]);
    });

    it('describes before and after', () => {
      expect(labelsFor((c) => setDate(c, { mode: 'before', date: '2026-01-01' }))).toEqual([
        `${word} before 2026-01-01`,
      ]);
      expect(labelsFor((c) => setDate(c, { mode: 'after', date: '2026-01-01' }))).toEqual([
        `${word} after 2026-01-01`,
      ]);
    });

    it('describes between', () => {
      expect(
        labelsFor((c) => setDate(c, { mode: 'between', date: '2026-01-01', date2: '2026-01-31' })),
      ).toEqual([`${word} 2026-01-01 to 2026-01-31`]);
    });

    it('shows an ellipsis for missing dates', () => {
      expect(labelsFor((c) => setDate(c, { mode: 'before', date: '' }))).toEqual([
        `${word} before ${ELLIPSIS}`,
      ]);
      expect(labelsFor((c) => setDate(c, { mode: 'after', date: '' }))).toEqual([
        `${word} after ${ELLIPSIS}`,
      ]);
      expect(labelsFor((c) => setDate(c, { mode: 'between', date: '', date2: '2026-01-31' }))).toEqual([
        `${word} ${ELLIPSIS} to 2026-01-31`,
      ]);
      expect(labelsFor((c) => setDate(c, { mode: 'between', date: '2026-01-01', date2: '' }))).toEqual([
        `${word} 2026-01-01 to ${ELLIPSIS}`,
      ]);
    });

    it('lists nothing when the mode is any, even with leftover values', () => {
      expect(labelsFor((c) => setDate(c, { mode: 'any', date: '2026-01-01' }))).toEqual([]);
    });
  });

  it('describes the name regex and multi-line flags', () => {
    expect(labelsFor((c) => (c.nameIsRegex = true))).toEqual(['Name is a regex']);
    expect(labelsFor((c) => (c.multiLine = true))).toEqual(['Multi-line']);
  });

  it('ignores a size filter whose mode is any even with leftover values', () => {
    expect(labelsFor((c) => (c.size = { ...c.size, mode: 'any', value: '5' }))).toEqual([]);
  });

  it('keeps the order size, modified, created, name regex, multi-line', () => {
    const items = summarizeFilters(everythingOn());
    expect(items.map((item) => item.id)).toEqual(['size', 'modified', 'created', 'nameRegex', 'multiLine']);
    expect(items.map((item) => item.label)).toEqual([
      'Size over 1 MB',
      'Modified in the last 7 days',
      'Created before 2026-01-01',
      'Name is a regex',
      'Multi-line',
    ]);
  });

  it('does not mutate the criteria', () => {
    const criteria = everythingOn();
    const before = structuredClone(criteria);
    summarizeFilters(criteria);
    expect(criteria).toEqual(before);
  });
});

describe('clearFilter', () => {
  const ids: FilterId[] = ['size', 'modified', 'created', 'nameRegex', 'multiLine'];

  it('resets size only', () => {
    const cleared = clearFilter(everythingOn(), 'size');
    expect(cleared.size).toEqual(emptySizeFilter());
    expect(summarizeFilters(cleared).map((item) => item.id)).toEqual([
      'modified',
      'created',
      'nameRegex',
      'multiLine',
    ]);
  });

  it('resets modified only', () => {
    const cleared = clearFilter(everythingOn(), 'modified');
    expect(cleared.modified).toEqual(emptyDateFilter());
    expect(summarizeFilters(cleared).map((item) => item.id)).toEqual([
      'size',
      'created',
      'nameRegex',
      'multiLine',
    ]);
  });

  it('resets created only', () => {
    const cleared = clearFilter(everythingOn(), 'created');
    expect(cleared.created).toEqual(emptyDateFilter());
    expect(summarizeFilters(cleared).map((item) => item.id)).toEqual([
      'size',
      'modified',
      'nameRegex',
      'multiLine',
    ]);
  });

  it('resets nameRegex only', () => {
    const cleared = clearFilter(everythingOn(), 'nameRegex');
    expect(cleared.nameIsRegex).toBe(false);
    expect(summarizeFilters(cleared).map((item) => item.id)).toEqual([
      'size',
      'modified',
      'created',
      'multiLine',
    ]);
  });

  it('resets multiLine only', () => {
    const cleared = clearFilter(everythingOn(), 'multiLine');
    expect(cleared.multiLine).toBe(false);
    expect(summarizeFilters(cleared).map((item) => item.id)).toEqual([
      'size',
      'modified',
      'created',
      'nameRegex',
    ]);
  });

  it('leaves unrelated criteria untouched', () => {
    const criteria = everythingOn();
    criteria.namePatterns = '*.log';
    criteria.text = 'needle';
    criteria.regex = true;
    criteria.lookIn = 'C:\\logs';
    for (const id of ids) {
      const cleared = clearFilter(criteria, id);
      expect(cleared.namePatterns).toBe('*.log');
      expect(cleared.text).toBe('needle');
      expect(cleared.regex).toBe(true);
      expect(cleared.lookIn).toBe('C:\\logs');
    }
  });

  it('returns a new object and does not mutate the input', () => {
    for (const id of ids) {
      const criteria = everythingOn();
      const before = structuredClone(criteria);
      const cleared = clearFilter(criteria, id);
      expect(cleared).not.toBe(criteria);
      expect(criteria).toEqual(before);
    }
  });

  it('does not share nested filter objects with the input', () => {
    const criteria = everythingOn();
    const cleared = clearFilter(criteria, 'nameRegex');
    expect(cleared.size).not.toBe(criteria.size);
    expect(cleared.modified).not.toBe(criteria.modified);
    expect(cleared.created).not.toBe(criteria.created);
  });
});

describe('clearAllFilters', () => {
  it('resets all five filters', () => {
    const cleared = clearAllFilters(everythingOn());
    expect(summarizeFilters(cleared)).toEqual([]);
    expect(cleared.size).toEqual(emptySizeFilter());
    expect(cleared.modified).toEqual(emptyDateFilter());
    expect(cleared.created).toEqual(emptyDateFilter());
    expect(cleared.nameIsRegex).toBe(false);
    expect(cleared.multiLine).toBe(false);
  });

  it('returns a new object and does not mutate the input', () => {
    const criteria = everythingOn();
    const before = structuredClone(criteria);
    const cleared = clearAllFilters(criteria);
    expect(cleared).not.toBe(criteria);
    expect(criteria).toEqual(before);
  });

  it('leaves unrelated criteria untouched', () => {
    const criteria = everythingOn();
    criteria.text = 'needle';
    criteria.subfolders = false;
    const cleared = clearAllFilters(criteria);
    expect(cleared.text).toBe('needle');
    expect(cleared.subfolders).toBe(false);
  });
});

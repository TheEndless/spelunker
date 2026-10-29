import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, countActiveFilters } from './criteria';

describe('countActiveFilters', () => {
  const fresh = () => structuredClone(DEFAULT_CRITERIA);

  it('is zero for default criteria', () => {
    expect(countActiveFilters(fresh())).toBe(0);
  });

  it('counts every filter that is switched on', () => {
    const criteria = fresh();
    criteria.size.mode = 'larger';
    criteria.modified.mode = 'within';
    criteria.created.mode = 'before';
    criteria.multiLine = true;
    expect(countActiveFilters(criteria)).toBe(4);
  });

  it('does not count ordinary search options as filters', () => {
    const criteria = fresh();
    criteria.matchCase = true;
    criteria.includeHidden = true;
    criteria.nameIsRegex = true;
    criteria.regex = true;
    expect(countActiveFilters(criteria)).toBe(0);
  });
});

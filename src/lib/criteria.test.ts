import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, countActiveFilters, normalizeCriteria } from './criteria';

describe('normalizeCriteria', () => {
  it('gives criteria saved before the newer options existed their defaults', () => {
    const loaded = normalizeCriteria({ text: 'alpha', lookIn: 'C:/x' });
    expect(loaded).toMatchObject({ text: 'alpha', searchDocuments: false, respectGitignore: false });
  });

  it('keeps the options that were saved, and ignores ones of the wrong type', () => {
    expect(normalizeCriteria({ searchDocuments: true, respectGitignore: true })).toMatchObject({ searchDocuments: true, respectGitignore: true });
    expect(normalizeCriteria({ searchDocuments: 'yes' }).searchDocuments).toBe(false);
  });
});

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
    criteria.respectGitignore = true;
    expect(countActiveFilters(criteria)).toBe(5);
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

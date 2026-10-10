import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, normalizeCriteria } from './criteria';
import {
  parseSavedSearches,
  removeSavedSearch,
  upsertSavedSearch,
  validateSearchName,
  type SavedSearch,
} from './savedSearches';

const saved = (name: string, text = ''): SavedSearch => ({ name, criteria: { ...DEFAULT_CRITERIA, text } });

describe('normalizeCriteria', () => {
  it('fills every missing field from the defaults', () => {
    expect(normalizeCriteria({ text: 'abc' })).toEqual({ ...DEFAULT_CRITERIA, text: 'abc' });
  });

  it('keeps valid values of every type', () => {
    const criteria = {
      ...DEFAULT_CRITERIA,
      text: 'x',
      matchCase: true,
      size: { mode: 'larger', value: '5', unit: 'MB', value2: '', unit2: 'MB' },
    };
    expect(normalizeCriteria(criteria)).toEqual(criteria);
  });

  it('drops fields of the wrong type instead of trusting them', () => {
    const result = normalizeCriteria({ text: 42, matchCase: 'yes', lookIn: null, size: 'big' });
    expect(result.text).toBe(DEFAULT_CRITERIA.text);
    expect(result.matchCase).toBe(false);
    expect(result.lookIn).toBe(DEFAULT_CRITERIA.lookIn);
    expect(result.size).toEqual(DEFAULT_CRITERIA.size);
  });

  it('repairs a nested filter that has an unknown mode', () => {
    const result = normalizeCriteria({ modified: { mode: 'sometime', amount: '3' } });
    expect(result.modified.mode).toBe('any');
  });

  it('ignores unknown fields', () => {
    expect(normalizeCriteria({ surprise: true })).toEqual(DEFAULT_CRITERIA);
  });

  it('survives non-objects', () => {
    for (const junk of [null, undefined, 5, 'text', []]) {
      expect(normalizeCriteria(junk)).toEqual(DEFAULT_CRITERIA);
    }
  });
});

describe('parseSavedSearches', () => {
  it('reads a stored list', () => {
    const json = JSON.stringify([saved('Logs', 'ERR')]);
    const list = parseSavedSearches(json);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Logs');
    expect(list[0].criteria.text).toBe('ERR');
  });

  it('returns an empty list for bad JSON or the wrong shape', () => {
    expect(parseSavedSearches('{nope')).toEqual([]);
    expect(parseSavedSearches('{"a":1}')).toEqual([]);
    expect(parseSavedSearches('[]')).toEqual([]);
  });

  it('skips entries without a usable name and normalizes old entries', () => {
    const list = parseSavedSearches(JSON.stringify([{ name: '', criteria: {} }, { criteria: {} }, { name: 'Old', criteria: { text: 'a' } }, 7]));
    expect(list.map((entry) => entry.name)).toEqual(['Old']);
    expect(list[0].criteria).toEqual({ ...DEFAULT_CRITERIA, text: 'a' });
  });
});

describe('upsertSavedSearch', () => {
  it('adds a new search and keeps the list sorted by name, ignoring case', () => {
    const list = upsertSavedSearch(upsertSavedSearch([], saved('beta')), saved('Alpha'));
    expect(list.map((entry) => entry.name)).toEqual(['Alpha', 'beta']);
  });

  it('replaces an existing search with the same name, ignoring case', () => {
    const list = upsertSavedSearch([saved('Logs', 'old')], saved('LOGS', 'new'));
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('LOGS');
    expect(list[0].criteria.text).toBe('new');
  });

  it('does not change the input list', () => {
    const original = [saved('a')];
    upsertSavedSearch(original, saved('b'));
    expect(original).toHaveLength(1);
  });
});

describe('removeSavedSearch', () => {
  it('removes by name, ignoring case', () => {
    expect(removeSavedSearch([saved('Logs'), saved('Other')], 'logs').map((entry) => entry.name)).toEqual(['Other']);
  });

  it('leaves the list alone when the name is unknown', () => {
    expect(removeSavedSearch([saved('Logs')], 'nope')).toHaveLength(1);
  });
});

describe('validateSearchName', () => {
  it('accepts a normal name', () => {
    expect(validateSearchName('Big logs')).toBeNull();
  });

  it('rejects blank names', () => {
    expect(validateSearchName('   ')).not.toBeNull();
  });

  it('rejects very long names', () => {
    expect(validateSearchName('x'.repeat(81))).not.toBeNull();
  });
});

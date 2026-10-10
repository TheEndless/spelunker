import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, type Criteria } from './criteria';
import { buildSearchRequest, firstFilterError } from './request';

const NOW = new Date(2026, 9, 9, 12, 0).getTime();
const criteria = (overrides: Partial<Criteria>): Criteria => ({
  ...structuredClone(DEFAULT_CRITERIA),
  lookIn: 'C:\\data',
  ...overrides,
});

describe('buildSearchRequest', () => {
  it('maps the plain fields', () => {
    const result = buildSearchRequest(
      criteria({
        namePatterns: '*.log',
        text: 'ERR',
        matchCase: true,
        regex: true,
        multiLine: true,
        subfolders: false,
        includeHidden: true,
        includeBinary: true,
        followLinks: true,
      }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      roots: ['C:\\data'],
      namePatterns: '*.log',
      nameIsRegex: false,
      query: { text: 'ERR', matchCase: true, wholeWord: false, regex: true, multiLine: true },
      recurse: false,
      includeHidden: true,
      includeBinary: true,
      followLinks: true,
    });
  });

  it('splits Look in on semicolons and drops blanks', () => {
    const result = buildSearchRequest(criteria({ lookIn: ' C:\\a ; ;D:\\b;' }), NOW);
    expect(result.ok && result.value.roots).toEqual(['C:\\a', 'D:\\b']);
  });

  it('sends no limits when no filter is active', () => {
    const result = buildSearchRequest(criteria({}), NOW);
    expect(result.ok && result.value).toMatchObject({
      minSize: null,
      maxSize: null,
      modified: { fromMs: null, toMs: null },
      created: { fromMs: null, toMs: null },
    });
  });

  it('resolves size and date filters as of the moment of the search', () => {
    const result = buildSearchRequest(
      criteria({
        size: { mode: 'larger', value: '1', unit: 'KB', value2: '', unit2: 'MB' },
        modified: { mode: 'within', amount: '2', unit: 'days', date: '', date2: '' },
        created: { mode: 'before', amount: '7', unit: 'days', date: '2026-01-01', date2: '' },
      }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.minSize).toBe(1025);
    expect(result.value.maxSize).toBeNull();
    expect(result.value.modified).toEqual({ fromMs: NOW - 2 * 86_400_000, toMs: null });
    expect(result.value.created).toEqual({ fromMs: null, toMs: new Date(2026, 0, 1).getTime() });
  });

  it('passes the name box through as a regex when asked', () => {
    const result = buildSearchRequest(criteria({ namePatterns: '^a$', nameIsRegex: true }), NOW);
    expect(result.ok && result.value).toMatchObject({ namePatterns: '^a$', nameIsRegex: true });
  });

  it('reports which filter is wrong instead of building a request', () => {
    const result = buildSearchRequest(
      criteria({ size: { mode: 'larger', value: '', unit: 'MB', value2: '', unit2: 'MB' } }),
      NOW,
    );
    expect(result).toEqual({ ok: false, error: 'Size: Enter a size' });
  });

  it('refuses to search with no folder', () => {
    expect(buildSearchRequest(criteria({ lookIn: '  ' }), NOW).ok).toBe(false);
  });
});

describe('firstFilterError', () => {
  it('is null when every active filter is complete', () => {
    expect(firstFilterError(criteria({}), NOW)).toBeNull();
  });

  it('names the filter with the problem', () => {
    const bad = criteria({ modified: { mode: 'before', amount: '7', unit: 'days', date: '', date2: '' } });
    expect(firstFilterError(bad, NOW)).toBe('Modified: Enter a valid date (YYYY-MM-DD)');
    const badCreated = criteria({ created: { mode: 'before', amount: '7', unit: 'days', date: 'x', date2: '' } });
    expect(firstFilterError(badCreated, NOW)).toMatch(/^Created: /);
  });
});

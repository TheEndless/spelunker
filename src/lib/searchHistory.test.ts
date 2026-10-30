import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, type Criteria } from './criteria';
import { MAX_RECENT_SEARCHES, parseRecentSearches, rememberSearch, searchLabel } from './searchHistory';

const search = (overrides: Partial<Criteria>): Criteria => ({
  ...structuredClone(DEFAULT_CRITERIA),
  lookIn: 'C:\\data',
  ...overrides,
});

describe('rememberSearch', () => {
  it('puts the newest search first', () => {
    const first = search({ text: 'alpha' });
    const second = search({ text: 'beta' });
    expect(rememberSearch(rememberSearch([], first), second)).toEqual([second, first]);
  });

  it('moves a search that is run again to the front instead of listing it twice', () => {
    const first = search({ text: 'alpha' });
    const second = search({ text: 'beta' });
    const again = rememberSearch([second, first], structuredClone(first));
    expect(again).toEqual([first, second]);
  });

  it('counts a different folder, option or filter as a different search', () => {
    const base = search({ text: 'alpha' });
    for (const changed of [
      search({ text: 'alpha', lookIn: 'D:\\other' }),
      search({ text: 'alpha', matchCase: true }),
      search({ text: 'alpha', includeHidden: true }),
      search({ text: 'alpha', size: { ...base.size, mode: 'larger', value: '1', unit: 'MB' } }),
    ]) {
      expect(rememberSearch([base], changed)).toHaveLength(2);
    }
  });

  it('keeps only the most recent searches', () => {
    let history: Criteria[] = [];
    for (let number = 0; number < MAX_RECENT_SEARCHES + 5; number++) history = rememberSearch(history, search({ text: `term ${number}` }));
    expect(history).toHaveLength(MAX_RECENT_SEARCHES);
    expect(history[0].text).toBe(`term ${MAX_RECENT_SEARCHES + 4}`);
    expect(history.at(-1)?.text).toBe('term 5');
  });

  it('leaves out a search that looks for nothing, which only lists a folder', () => {
    expect(rememberSearch([], search({}))).toEqual([]);
    expect(rememberSearch([], search({ namePatterns: '   ' }))).toEqual([]);
  });

  it('keeps a search that has only a name, only text, or only a filter', () => {
    expect(rememberSearch([], search({ namePatterns: '*.log' }))).toHaveLength(1);
    expect(rememberSearch([], search({ text: 'x' }))).toHaveLength(1);
    expect(rememberSearch([], search({ modified: { ...DEFAULT_CRITERIA.modified, mode: 'within', amount: '7', unit: 'days' } }))).toHaveLength(1);
  });

  it('does not change the list it was given', () => {
    const history = [search({ text: 'alpha' })];
    const before = structuredClone(history);
    rememberSearch(history, search({ text: 'beta' }));
    expect(history).toEqual(before);
  });
});

describe('searchLabel', () => {
  it('shows the text and the name pattern', () => {
    expect(searchLabel(search({ text: 'invoice', namePatterns: '*.docx; *.pdf' }))).toBe('"invoice" in *.docx; *.pdf');
  });

  it('shows just the text, or just the name', () => {
    expect(searchLabel(search({ text: 'invoice' }))).toBe('"invoice"');
    expect(searchLabel(search({ namePatterns: '*.log' }))).toBe('*.log');
  });

  it('marks a regular expression', () => {
    expect(searchLabel(search({ text: 'a.c', regex: true }))).toBe('/a.c/');
    expect(searchLabel(search({ namePatterns: '^x', nameIsRegex: true }))).toBe('/^x/');
  });

  it('calls a search with only filters any file', () => {
    expect(searchLabel(search({ modified: { ...DEFAULT_CRITERIA.modified, mode: 'within', amount: '7', unit: 'days' } }))).toBe('Any file');
  });
});

describe('parseRecentSearches', () => {
  it('reads stored searches and fills in what an older version did not store', () => {
    const parsed = parseRecentSearches([{ text: 'alpha', lookIn: 'C:\\x' }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ text: 'alpha', lookIn: 'C:\\x', respectGitignore: false, subfolders: true });
  });

  it('drops anything that is not a search, and anything beyond the limit', () => {
    expect(parseRecentSearches('nope')).toEqual([]);
    expect(parseRecentSearches([null, 5, 'x', [], { text: 'ok' }])).toHaveLength(1);
    const many = Array.from({ length: MAX_RECENT_SEARCHES + 3 }, (_, number) => ({ text: `t${number}` }));
    expect(parseRecentSearches(many)).toHaveLength(MAX_RECENT_SEARCHES);
  });
});

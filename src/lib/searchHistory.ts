import { countActiveFilters, normalizeCriteria, type Criteria } from './criteria';

export const MAX_RECENT_SEARCHES = 20;

const sameSearch = (left: Criteria, right: Criteria) =>
  JSON.stringify(normalizeCriteria(left)) === JSON.stringify(normalizeCriteria(right));

/** A search that only lists a folder has nothing worth coming back to. */
const looksForSomething = (criteria: Criteria) =>
  criteria.namePatterns.trim() !== '' || criteria.text !== '' || countActiveFilters(criteria) > 0;

/**
 * The list of recent searches with `criteria` put first. A search that is run again moves to the
 * front instead of appearing twice, and only the latest `MAX_RECENT_SEARCHES` are kept. Returns a new list.
 */
export function rememberSearch(history: Criteria[], criteria: Criteria): Criteria[] {
  if (!looksForSomething(criteria)) return history;
  const others = history.filter((earlier) => !sameSearch(earlier, criteria));
  return [criteria, ...others].slice(0, MAX_RECENT_SEARCHES);
}

/** A search in a few words for a menu: the text, then where in names it was looked for. */
export function searchLabel(criteria: Criteria): string {
  const text = criteria.text === '' ? '' : criteria.regex ? `/${criteria.text}/` : `"${criteria.text}"`;
  const name = criteria.namePatterns.trim();
  const names = name === '' ? '' : criteria.nameIsRegex ? `/${name}/` : name;
  if (text !== '' && names !== '') return `${text} in ${names}`;
  return text || names || 'Any file';
}

/** Reads recent searches from stored JSON, dropping anything unusable instead of failing the whole list. */
export function parseRecentSearches(raw: unknown): Criteria[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    .slice(0, MAX_RECENT_SEARCHES)
    .map(normalizeCriteria);
}

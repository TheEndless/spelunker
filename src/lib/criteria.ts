import {
  activeFilterCount,
  DATE_MODES,
  DATE_UNITS,
  SIZE_MODES,
  SIZE_UNITS,
  emptyDateFilter,
  emptySizeFilter,
  type DateFilter,
  type SizeFilter,
} from './filters';

/** Everything that defines a search. This is what a saved search stores. */
export interface Criteria {
  namePatterns: string;
  /** Treat the name box as a regex on the file name instead of wildcards. */
  nameIsRegex: boolean;
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  multiLine: boolean;
  lookIn: string;
  subfolders: boolean;
  includeHidden: boolean;
  includeBinary: boolean;
  followLinks: boolean;
  size: SizeFilter;
  modified: DateFilter;
  created: DateFilter;
}

export const DEFAULT_CRITERIA: Criteria = {
  namePatterns: '',
  nameIsRegex: false,
  text: '',
  matchCase: false,
  wholeWord: false,
  regex: false,
  multiLine: false,
  lookIn: '',
  subfolders: true,
  includeHidden: false,
  includeBinary: false,
  followLinks: false,
  size: emptySizeFilter(),
  modified: emptyDateFilter(),
  created: emptyDateFilter(),
};

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function pick<T extends string | boolean>(raw: PlainObject, key: string, fallback: T): T {
  const value = raw[key];
  return typeof value === typeof fallback ? (value as T) : fallback;
}

function pickOneOf<T extends string>(raw: PlainObject, key: string, allowed: readonly T[], fallback: T): T {
  const value = raw[key];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function normalizeSize(raw: unknown): SizeFilter {
  const base = emptySizeFilter();
  if (!isPlainObject(raw)) return base;
  return {
    mode: pickOneOf(raw, 'mode', SIZE_MODES, base.mode),
    value: pick(raw, 'value', base.value),
    unit: pickOneOf(raw, 'unit', SIZE_UNITS, base.unit),
    value2: pick(raw, 'value2', base.value2),
    unit2: pickOneOf(raw, 'unit2', SIZE_UNITS, base.unit2),
  };
}

function normalizeDate(raw: unknown): DateFilter {
  const base = emptyDateFilter();
  if (!isPlainObject(raw)) return base;
  return {
    mode: pickOneOf(raw, 'mode', DATE_MODES, base.mode),
    amount: pick(raw, 'amount', base.amount),
    unit: pickOneOf(raw, 'unit', DATE_UNITS, base.unit),
    date: pick(raw, 'date', base.date),
    date2: pick(raw, 'date2', base.date2),
  };
}

/**
 * Builds valid criteria from untrusted JSON (a saved search or old stored preferences).
 * Missing or wrongly typed fields fall back to defaults, so criteria saved by an older version
 * keep loading after new criteria are added.
 */
export function normalizeCriteria(raw: unknown): Criteria {
  const source = isPlainObject(raw) ? raw : {};
  const defaults = DEFAULT_CRITERIA;
  return {
    namePatterns: pick(source, 'namePatterns', defaults.namePatterns),
    nameIsRegex: pick(source, 'nameIsRegex', defaults.nameIsRegex),
    text: pick(source, 'text', defaults.text),
    matchCase: pick(source, 'matchCase', defaults.matchCase),
    wholeWord: pick(source, 'wholeWord', defaults.wholeWord),
    regex: pick(source, 'regex', defaults.regex),
    multiLine: pick(source, 'multiLine', defaults.multiLine),
    lookIn: pick(source, 'lookIn', defaults.lookIn),
    subfolders: pick(source, 'subfolders', defaults.subfolders),
    includeHidden: pick(source, 'includeHidden', defaults.includeHidden),
    includeBinary: pick(source, 'includeBinary', defaults.includeBinary),
    followLinks: pick(source, 'followLinks', defaults.followLinks),
    size: normalizeSize(source.size),
    modified: normalizeDate(source.modified),
    created: normalizeDate(source.created),
  };
}

/** How many filters are switched on. The badge, the empty-state hints, and the chips all use this. */
export function countActiveFilters(criteria: Criteria): number {
  return activeFilterCount({
    size: criteria.size,
    modified: criteria.modified,
    created: criteria.created,
    multiLine: criteria.multiLine,
  });
}

import type { Criteria } from './criteria';
import { emptyDateFilter, emptySizeFilter, type DateFilter, type DateUnit, type SizeFilter } from './filters';

export type FilterId = 'size' | 'modified' | 'created' | 'multiLine';

export interface FilterSummaryItem {
  id: FilterId;
  label: string;
}

/** Shown in place of a value the user has not filled in yet, so an incomplete filter still reads as on. */
const MISSING = '…';

const orMissing = (text: string): string => text.trim() || MISSING;

const sizePart = (value: string, unit: SizeFilter['unit']): string => {
  const trimmed = value.trim();
  return trimmed ? `${trimmed} ${unit}` : MISSING;
};

function describeSize(filter: SizeFilter): string {
  const first = sizePart(filter.value, filter.unit);
  if (filter.mode === 'larger') return `Size over ${first}`;
  if (filter.mode === 'smaller') return `Size under ${first}`;
  return `Size ${first} to ${sizePart(filter.value2, filter.unit2)}`;
}

const SINGULAR_UNIT: Record<DateUnit, string> = { hours: 'hour', days: 'day', weeks: 'week' };

function describeRelativeAmount(amount: string, unit: DateUnit): string {
  const trimmed = amount.trim();
  if (!trimmed) return MISSING;
  return trimmed === '1' ? SINGULAR_UNIT[unit] : `${trimmed} ${unit}`;
}

function describeDate(word: 'Modified' | 'Created', filter: DateFilter): string {
  switch (filter.mode) {
    case 'within':
      return `${word} in the last ${describeRelativeAmount(filter.amount, filter.unit)}`;
    case 'before':
      return `${word} before ${orMissing(filter.date)}`;
    case 'after':
      return `${word} after ${orMissing(filter.date)}`;
    default:
      return `${word} ${orMissing(filter.date)} to ${orMissing(filter.date2)}`;
  }
}

/** One item per filter that is switched on, in the same order as the Filters panel. */
export function summarizeFilters(criteria: Criteria): FilterSummaryItem[] {
  const items: FilterSummaryItem[] = [];
  if (criteria.size.mode !== 'any') items.push({ id: 'size', label: describeSize(criteria.size) });
  if (criteria.modified.mode !== 'any') {
    items.push({ id: 'modified', label: describeDate('Modified', criteria.modified) });
  }
  if (criteria.created.mode !== 'any') {
    items.push({ id: 'created', label: describeDate('Created', criteria.created) });
  }
  if (criteria.multiLine) items.push({ id: 'multiLine', label: 'Multi-line' });
  return items;
}

const FILTER_IDS: readonly FilterId[] = ['size', 'modified', 'created', 'multiLine'];

/** Returns new criteria with only the given filter switched off and its inputs reset. */
export function clearFilter(criteria: Criteria, id: FilterId): Criteria {
  // Spread copies instead of structuredClone, which throws on Svelte $state proxies.
  const cleared: Criteria = {
    ...criteria,
    size: { ...criteria.size },
    modified: { ...criteria.modified },
    created: { ...criteria.created },
  };
  switch (id) {
    case 'size':
      cleared.size = emptySizeFilter();
      break;
    case 'modified':
      cleared.modified = emptyDateFilter();
      break;
    case 'created':
      cleared.created = emptyDateFilter();
      break;
    case 'multiLine':
      cleared.multiLine = false;
      break;
  }
  return cleared;
}

export function clearAllFilters(criteria: Criteria): Criteria {
  return FILTER_IDS.reduce(clearFilter, criteria);
}

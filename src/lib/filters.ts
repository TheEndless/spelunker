export type SizeUnit = 'B' | 'KB' | 'MB' | 'GB';
export type DateUnit = 'hours' | 'days' | 'weeks';

export const SIZE_UNITS: SizeUnit[] = ['B', 'KB', 'MB', 'GB'];
export const DATE_UNITS: DateUnit[] = ['hours', 'days', 'weeks'];
export const SIZE_MODES = ['any', 'larger', 'smaller', 'between'] as const;
export const DATE_MODES = ['any', 'within', 'before', 'after', 'between'] as const;

export interface SizeFilter {
  mode: (typeof SIZE_MODES)[number];
  value: string;
  unit: SizeUnit;
  value2: string;
  unit2: SizeUnit;
}

/** Relative choices ("within the last 7 days") stay relative so saved searches remain useful. */
export interface DateFilter {
  mode: (typeof DATE_MODES)[number];
  amount: string;
  unit: DateUnit;
  /** Calendar days as YYYY-MM-DD, in local time. */
  date: string;
  date2: string;
}

export const emptySizeFilter = (): SizeFilter => ({
  mode: 'any',
  value: '',
  unit: 'MB',
  value2: '',
  unit2: 'MB',
});

export const emptyDateFilter = (): DateFilter => ({
  mode: 'any',
  amount: '7',
  unit: 'days',
  date: '',
  date2: '',
});

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ByteRange {
  min: number | null;
  max: number | null;
}

export interface MillisRange {
  fromMs: number | null;
  toMs: number | null;
}

const BYTES_PER_UNIT: Record<SizeUnit, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
const MS_PER_UNIT: Record<DateUnit, number> = {
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 7 * 86_400_000,
};

const NON_NEGATIVE_NUMBER = /^\d+(\.\d+)?$/;

function toBytes(value: string, unit: SizeUnit): number | null {
  const text = value.trim();
  if (!NON_NEGATIVE_NUMBER.test(text)) return null;
  return Math.round(Number(text) * BYTES_PER_UNIT[unit]);
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/**
 * Turns the size controls into inclusive byte bounds. "Larger than" and "smaller than" exclude
 * the exact size, which the engine expresses by moving the bound one byte.
 */
export function resolveSizeFilter(filter: SizeFilter): Resolved<ByteRange> {
  if (filter.mode === 'any') return { ok: true, value: { min: null, max: null } };

  const first = toBytes(filter.value, filter.unit);
  if (first === null) return fail('Enter a size');

  if (filter.mode === 'larger') return { ok: true, value: { min: first + 1, max: null } };
  if (filter.mode === 'smaller') {
    if (first === 0) return fail('Smaller than zero matches nothing');
    return { ok: true, value: { min: null, max: first - 1 } };
  }

  const second = toBytes(filter.value2, filter.unit2);
  if (second === null) return fail('Enter both sizes');
  if (first > second) return fail('The first size is larger than the second');
  return { ok: true, value: { min: first, max: second } };
}

interface Day {
  year: number;
  month: number;
  day: number;
}

function parseDay(text: string): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(year, month - 1, day);
  const real = check.getFullYear() === year && check.getMonth() === month - 1 && check.getDate() === day;
  return real ? { year, month, day } : null;
}

const startOfDay = ({ year, month, day }: Day) => new Date(year, month - 1, day).getTime();
const startOfNextDay = ({ year, month, day }: Day) => new Date(year, month - 1, day + 1).getTime();

/**
 * Turns the date controls into an absolute window (start inclusive, end exclusive) using local
 * midnights. Relative choices are measured from `nowMs`, the moment the search starts.
 */
export function resolveDateFilter(filter: DateFilter, nowMs: number): Resolved<MillisRange> {
  if (filter.mode === 'any') return { ok: true, value: { fromMs: null, toMs: null } };

  if (filter.mode === 'within') {
    const amount = filter.amount.trim();
    if (!NON_NEGATIVE_NUMBER.test(amount) || Number(amount) <= 0) {
      return fail('Enter how many hours, days, or weeks');
    }
    return { ok: true, value: { fromMs: nowMs - Number(amount) * MS_PER_UNIT[filter.unit], toMs: null } };
  }

  const first = parseDay(filter.date);
  if (!first) return fail('Enter a valid date (YYYY-MM-DD)');
  if (filter.mode === 'before') return { ok: true, value: { fromMs: null, toMs: startOfDay(first) } };
  if (filter.mode === 'after') return { ok: true, value: { fromMs: startOfNextDay(first), toMs: null } };

  const second = parseDay(filter.date2);
  if (!second) return fail('Enter a valid end date (YYYY-MM-DD)');
  if (startOfDay(first) > startOfDay(second)) return fail('The start date is after the end date');
  return { ok: true, value: { fromMs: startOfDay(first), toMs: startOfNextDay(second) } };
}

export interface FilterState {
  size: SizeFilter;
  modified: DateFilter;
  created: DateFilter;
  nameIsRegex: boolean;
  multiLine: boolean;
}

/** How many filters are switched on, for the badge on the panel header. */
export function activeFilterCount(state: FilterState): number {
  return [
    state.size.mode !== 'any',
    state.modified.mode !== 'any',
    state.created.mode !== 'any',
    state.nameIsRegex,
    state.multiLine,
  ].filter(Boolean).length;
}

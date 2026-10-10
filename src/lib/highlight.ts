import type { MatchRange } from './types';

export interface Segment {
  text: string;
  match: boolean;
}

const ELLIPSIS = '…';

/** Merges, sorts, and clamps ranges so each remaining range is non-empty and disjoint. */
function normalizeRanges(ranges: MatchRange[], length: number): MatchRange[] {
  const sorted = ranges
    .map((range) => ({ start: Math.max(0, range.start), end: Math.min(length, range.end) }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start);
  const merged: MatchRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Splits `text` into highlighted and plain segments. Lines longer than `maxLength` are cut to a
 * window around the first match, with an ellipsis marking each cut edge.
 */
export function highlightSegments(
  text: string,
  ranges: MatchRange[],
  maxLength: number,
): Segment[] {
  const matches = normalizeRanges(ranges, text.length);

  let windowStart = 0;
  let windowEnd = text.length;
  if (text.length > maxLength) {
    const anchor = matches.length > 0 ? matches[0].start : 0;
    const matchLength = matches.length > 0 ? matches[0].end - matches[0].start : 0;
    const padding = Math.max(0, Math.floor((maxLength - matchLength) / 2));
    windowStart = Math.max(0, anchor - padding);
    windowEnd = Math.min(text.length, Math.max(anchor + matchLength, windowStart + maxLength));
  }

  const segments: Segment[] = [];
  const push = (value: string, match: boolean) => {
    if (value.length > 0) segments.push({ text: value, match });
  };

  if (windowStart > 0) push(ELLIPSIS, false);
  let cursor = windowStart;
  for (const range of matches) {
    if (range.end <= windowStart || range.start >= windowEnd) continue;
    const start = Math.max(range.start, windowStart);
    const end = Math.min(range.end, windowEnd);
    push(text.slice(cursor, start), false);
    push(text.slice(start, end), true);
    cursor = end;
  }
  push(text.slice(cursor, windowEnd), false);
  if (windowEnd < text.length) push(ELLIPSIS, false);
  return segments;
}

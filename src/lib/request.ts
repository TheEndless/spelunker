import type { SearchRequest } from './backend';
import type { Criteria } from './criteria';
import { resolveDateFilter, resolveSizeFilter, type Resolved } from './filters';

/** Start folders typed into the Look in box, separated by semicolons. */
export function parseRoots(lookIn: string): string[] {
  return lookIn
    .split(';')
    .map((folder) => folder.trim())
    .filter((folder) => folder.length > 0);
}

/** The first problem with an active filter, labelled with the filter it belongs to. */
export function firstFilterError(criteria: Criteria, nowMs: number): string | null {
  const checks: [string, Resolved<unknown>][] = [
    ['Size', resolveSizeFilter(criteria.size)],
    ['Modified', resolveDateFilter(criteria.modified, nowMs)],
    ['Created', resolveDateFilter(criteria.created, nowMs)],
  ];
  for (const [label, result] of checks) {
    if (!result.ok) return `${label}: ${result.error}`;
  }
  return null;
}

/**
 * Builds the backend request from the criteria. Relative dates are resolved against `nowMs`,
 * which must be the moment the user starts the search.
 */
export function buildSearchRequest(criteria: Criteria, nowMs: number): Resolved<SearchRequest> {
  const roots = parseRoots(criteria.lookIn);
  if (roots.length === 0) return { ok: false, error: 'Choose a folder to look in' };

  const size = resolveSizeFilter(criteria.size);
  if (!size.ok) return { ok: false, error: `Size: ${size.error}` };
  const modified = resolveDateFilter(criteria.modified, nowMs);
  if (!modified.ok) return { ok: false, error: `Modified: ${modified.error}` };
  const created = resolveDateFilter(criteria.created, nowMs);
  if (!created.ok) return { ok: false, error: `Created: ${created.error}` };

  return {
    ok: true,
    value: {
      roots,
      namePatterns: criteria.namePatterns,
      nameIsRegex: criteria.nameIsRegex,
      query: {
        text: criteria.text,
        matchCase: criteria.matchCase,
        wholeWord: criteria.wholeWord,
        regex: criteria.regex,
        multiLine: criteria.multiLine,
      },
      recurse: criteria.subfolders,
      maxDepth: null,
      includeHidden: criteria.includeHidden,
      includeBinary: criteria.includeBinary,
      followLinks: criteria.followLinks,
      minSize: size.value.min,
      maxSize: size.value.max,
      modified: modified.value,
      created: created.value,
    },
  };
}

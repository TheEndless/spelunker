import { normalizeCriteria, type Criteria } from './criteria';

export interface SavedSearch {
  name: string;
  criteria: Criteria;
}

const MAX_NAME_LENGTH = 80;

const sameName = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();
const byName = (left: SavedSearch, right: SavedSearch) =>
  left.name.toLowerCase().localeCompare(right.name.toLowerCase());

/** Reads the stored JSON, dropping anything unusable instead of failing the whole list. */
export function parseSavedSearches(json: string): SavedSearch[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const searches: SavedSearch[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, criteria } = entry as { name?: unknown; criteria?: unknown };
    if (typeof name !== 'string' || name.trim() === '') continue;
    searches.push({ name: name.trim(), criteria: normalizeCriteria(criteria) });
  }
  return searches.sort(byName);
}

/** Adds a search, or replaces the one with the same name (ignoring case). Returns a new list. */
export function upsertSavedSearch(list: SavedSearch[], search: SavedSearch): SavedSearch[] {
  return [...list.filter((existing) => !sameName(existing.name, search.name)), search].sort(byName);
}

export function removeSavedSearch(list: SavedSearch[], name: string): SavedSearch[] {
  return list.filter((existing) => !sameName(existing.name, name));
}

export function searchNameExists(list: SavedSearch[], name: string): boolean {
  return list.some((existing) => sameName(existing.name, name));
}

/** Returns a message when the name cannot be used, or null when it is fine. */
export function validateSearchName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name';
  if (trimmed.length > MAX_NAME_LENGTH) return `Use ${MAX_NAME_LENGTH} characters or fewer`;
  return null;
}

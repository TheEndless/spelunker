/** Pure helpers for the "Look in" combobox. The value holds folders separated by semicolons. */

const SEPARATOR = ';';

/** The text after the last semicolon, trimmed. This is the part being typed. */
export function currentSegment(value: string): string {
  return value.slice(value.lastIndexOf(SEPARATOR) + 1).trim();
}

/**
 * Recents whose text contains the typed segment (case-insensitive), in their original order.
 * A lone match that equals the typed text exactly is dropped, since choosing it changes nothing.
 */
export function filterRecents(recents: string[], typed: string): string[] {
  const needle = typed.toLowerCase();
  const matches = recents.filter((recent) => recent.toLowerCase().includes(needle));
  if (matches.length === 1 && matches[0].toLowerCase() === needle) return [];
  return matches;
}

/** Replaces the last segment with the choice, keeping earlier segments joined by "; ". */
export function applyChoice(value: string, choice: string): string {
  const earlier = value
    .slice(0, Math.max(value.lastIndexOf(SEPARATOR), 0))
    .split(SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
  return [...earlier, choice].join('; ');
}

/** Moves the active option with wraparound. -1 means nothing is active. */
export function nextActiveIndex(current: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return current < 0 || current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}

/** What the box shows when every local drive is searched. The backend expands it to the drive roots. */
export const ALL_DRIVES_LABEL = 'This PC (all drives)';

/** The words the backend treats as "every local drive", compared in lower case. Keep in step with drives.rs. */
const ALL_DRIVES_WORDS = ['this pc', 'all drives', 'this pc (all drives)', 'computer'];

/** True when the whole box asks for every drive. A list that merely includes it is not "all drives". */
export function isAllDrives(value: string): boolean {
  return ALL_DRIVES_WORDS.includes(value.trim().toLowerCase());
}

/**
 * Switches the box between "all drives" and what was there before. Turning it on remembers the
 * current text so turning it off puts it back.
 */
export function toggleAllDrives(current: string, remembered: string): { value: string; remembered: string } {
  if (isAllDrives(current)) return { value: remembered, remembered: '' };
  return { value: ALL_DRIVES_LABEL, remembered: current.trim() };
}

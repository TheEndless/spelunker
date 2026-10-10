export type PaneId = 'search' | 'results' | 'preview';

/** The order F6 moves through, which is also the visual order. */
export const PANE_ORDER: PaneId[] = ['search', 'results', 'preview'];

/**
 * The pane that F6 (direction 1) or Shift+F6 (direction -1) moves to, among the panes that are
 * shown. When focus is in none of them, forward goes to the first and backward to the last. A
 * focus in a pane that has just been hidden moves from that pane's place in the order.
 */
export function nextPane(current: PaneId | null, direction: 1 | -1, shown: PaneId[] = PANE_ORDER): PaneId {
  if (current === null) return direction === 1 ? shown[0] : shown[shown.length - 1];
  const position = PANE_ORDER.indexOf(current);
  for (let step = 1; step <= PANE_ORDER.length; step++) {
    const candidate = PANE_ORDER[(position + direction * step + PANE_ORDER.length * step) % PANE_ORDER.length];
    if (shown.includes(candidate)) return candidate;
  }
  return shown[0];
}

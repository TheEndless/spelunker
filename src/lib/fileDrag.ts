/**
 * When a press on a result row turns into a file drag out of the window, and which files it
 * carries. Pure: the list feeds it pointer positions and button states, and starts the native drag
 * when it says so.
 */

export interface Point {
  x: number;
  y: number;
}

export type DragStep = { kind: 'none' } | { kind: 'start'; paths: string[] };

export interface DragGesture {
  /**
   * A primary-button press on the row `rowPath`. `selectionPaths` gives the selected paths in list
   * order. It is read only when a drag starts, so a press does not walk a large selection.
   */
  press(point: Point, rowPath: string, pressedOnSelected: boolean, selectionPaths: () => readonly string[]): void;
  /** A pointer move with the `buttons` bit mask of the event. */
  move(point: Point, buttons: number): DragStep;
  release(): void;
  cancel(): void;
}

/** The `buttons` bit of the primary (usually left) button. */
const PRIMARY_BUTTON = 1;

interface Press {
  origin: Point;
  rowPath: string;
  pressedOnSelected: boolean;
  selectionPaths: () => readonly string[];
}

/**
 * A press becomes a drag once the pointer has travelled `threshold` pixels with the primary button
 * still down. A move with that button up means the release happened where the page did not see it,
 * so the press is forgotten. One press starts at most one drag.
 */
export function createDragGesture({ threshold }: { threshold: number }): DragGesture {
  let press: Press | null = null;

  return {
    press(origin, rowPath, pressedOnSelected, selectionPaths) {
      press = { origin, rowPath, pressedOnSelected, selectionPaths };
    },
    move(point, buttons) {
      if (press === null) return { kind: 'none' };
      if ((buttons & PRIMARY_BUTTON) === 0) {
        press = null;
        return { kind: 'none' };
      }
      if (Math.hypot(point.x - press.origin.x, point.y - press.origin.y) < threshold) return { kind: 'none' };
      const started = press;
      press = null;
      const selection = started.pressedOnSelected ? started.selectionPaths() : [];
      return { kind: 'start', paths: selection.length > 0 ? [...selection] : [started.rowPath] };
    },
    release() {
      press = null;
    },
    cancel() {
      press = null;
    },
  };
}

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
   * order. It is read only when a drag starts, so it sees the selection as the press left it (a
   * Ctrl press adds the row, a Shift press selects a range), and a press does not walk a large
   * selection.
   */
  press(point: Point, rowPath: string, selectionPaths: () => readonly string[]): void;
  /** A pointer move with the `buttons` bit mask of the event. */
  move(point: Point, buttons: number): DragStep;
  release(): void;
  cancel(): void;
}

const LONG_PATH_PREFIX = '\\\\?\\';
const LONG_UNC_PREFIX = '\\\\?\\unc\\';

/**
 * The key two spellings of one Windows path share: separators unified, case folded, the long-path
 * prefix dropped, and a trailing separator trimmed. `duplicate_key` in shell_items.rs does the
 * same, and both are tested with the same cases.
 */
export function pathKey(path: string): string {
  const unified = path.replace(/\//g, '\\').toLowerCase();
  const withoutPrefix = unified.startsWith(LONG_PATH_PREFIX) && !unified.startsWith(LONG_UNC_PREFIX) ? unified.slice(LONG_PATH_PREFIX.length) : unified;
  // A drive root keeps its separator ("c:\"), since "c:" is the current folder of that drive.
  return withoutPrefix.length > 3 ? withoutPrefix.replace(/\\+$/, '') : withoutPrefix;
}

/**
 * The files of a drag the app started itself. The window's own drop target sees that drag too, so
 * its events are told apart from a user's drop by these paths. Kept until the next press, because
 * the drop events arrive by another route than the drag's answer and can come after it.
 */
export class OutgoingPaths {
  #keys = new Set<string>();

  replace(paths: readonly string[]): void {
    this.#keys = new Set(paths.map(pathKey));
  }

  clear(): void {
    this.#keys.clear();
  }

  /** True when there are paths and every one of them is going out. */
  coversAll(paths: readonly string[]): boolean {
    return paths.length > 0 && paths.every((path) => this.#keys.has(pathKey(path)));
  }
}

/** A drag and drop event on the window, as the windowing library reports it (positions left out). */
export type FolderDropEvent =
  | { type: 'enter'; paths: string[] }
  | { type: 'over' }
  | { type: 'leave' }
  | { type: 'drop'; paths: string[] };

/**
 * Whether each drop event should be handled. Only enter and drop name their files, so a drag
 * whose enter was the app's own keeps its over events ignored until it leaves or drops. A leave is
 * always handled, since all it does is hide the overlay.
 */
export function createSelfDropFilter(isOutgoing: (paths: readonly string[]) => boolean): (event: FolderDropEvent) => boolean {
  let ownDragOver = false;
  return (event) => {
    switch (event.type) {
      case 'enter':
        ownDragOver = isOutgoing(event.paths);
        return !ownDragOver;
      case 'over':
        return !ownDragOver;
      case 'leave':
        ownDragOver = false;
        return true;
      case 'drop': {
        const own = ownDragOver || isOutgoing(event.paths);
        ownDragOver = false;
        return !own;
      }
    }
  };
}

/** The `buttons` bit of the primary (usually left) button. */
const PRIMARY_BUTTON = 1;

interface Press {
  origin: Point;
  rowPath: string;
  selectionPaths: () => readonly string[];
}

/**
 * A press becomes a drag once the pointer has travelled `threshold` pixels with the primary button
 * still down. A move with that button up means the release happened where the page did not see it,
 * so the press is forgotten. One press starts at most one drag. The drag carries the whole
 * selection in list order when the pressed row is part of it, otherwise only that row.
 */
export function createDragGesture({ threshold }: { threshold: number }): DragGesture {
  let press: Press | null = null;

  return {
    press(origin, rowPath, selectionPaths) {
      press = { origin, rowPath, selectionPaths };
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
      const selection = started.selectionPaths();
      return { kind: 'start', paths: selection.includes(started.rowPath) ? [...selection] : [started.rowPath] };
    },
    release() {
      press = null;
    },
    cancel() {
      press = null;
    },
  };
}

import { describe, expect, it } from 'vitest';
import { createDragGesture, createSelfDropFilter, OutgoingPaths, pathKey, type FolderDropEvent } from './fileDrag';

describe('pathKey', () => {
  // The same cases as `duplicate_key_matches_the_pages_path_key` in src-tauri/src/shell_items.rs.
  it.each([
    ['C:/Data/One.TXT', 'c:\\data\\one.txt'],
    ['\\\\?\\C:\\Data\\One.txt', 'c:\\data\\one.txt'],
    ['C:\\Data\\Folder\\', 'c:\\data\\folder'],
    ['C:\\', 'c:\\'],
    ['\\\\?\\UNC\\server\\share\\a.txt', '\\\\?\\unc\\server\\share\\a.txt'],
    ['\\\\server\\share\\a.txt', '\\\\server\\share\\a.txt'],
  ])('turns %s into %s', (path, key) => {
    expect(pathKey(path)).toBe(key);
  });
});

describe('OutgoingPaths', () => {
  const outgoing = ['C:\\Data\\One.txt', 'D:\\other\\two.log'];

  it('covers the outgoing paths whatever their case or separator style', () => {
    const paths = new OutgoingPaths();
    paths.replace(outgoing);
    expect(paths.coversAll(['c:/data/one.TXT', 'd:\\OTHER/two.log'])).toBe(true);
    expect(paths.coversAll(['D:\\other\\two.log'])).toBe(true);
  });

  it('does not cover a list with any path that is not going out', () => {
    const paths = new OutgoingPaths();
    paths.replace(outgoing);
    expect(paths.coversAll(['C:\\Data\\One.txt', 'C:\\Data\\three.txt'])).toBe(false);
  });

  it('covers nothing when empty, and an empty list is never covered', () => {
    const paths = new OutgoingPaths();
    expect(paths.coversAll(outgoing)).toBe(false);
    paths.replace(outgoing);
    expect(paths.coversAll([])).toBe(false);
  });

  it('forgets everything on clear, and the old paths on replace', () => {
    const paths = new OutgoingPaths();
    paths.replace(outgoing);
    paths.clear();
    expect(paths.coversAll([outgoing[0]])).toBe(false);
    paths.replace([outgoing[1]]);
    expect(paths.coversAll([outgoing[0]])).toBe(false);
    expect(paths.coversAll([outgoing[1]])).toBe(true);
  });
});

describe('createSelfDropFilter', () => {
  const own = ['C:\\data\\a.txt', 'C:\\data\\b.txt'];
  const outgoing = new OutgoingPaths();
  outgoing.replace(own);
  const handled = (events: FolderDropEvent[]) => {
    const shouldHandle = createSelfDropFilter((paths) => outgoing.coversAll(paths));
    return events.map(shouldHandle);
  };

  it('ignores the enter, over and drop of a drag the app started', () => {
    expect(handled([{ type: 'enter', paths: own }, { type: 'over' }, { type: 'over' }, { type: 'drop', paths: own }])).toEqual([false, false, false, false]);
  });

  it('matches the paths case-insensitively', () => {
    const shouted = own.map((path) => path.toUpperCase());
    expect(handled([{ type: 'enter', paths: shouted }, { type: 'over' }, { type: 'drop', paths: shouted }])).toEqual([false, false, false]);
  });

  it('handles every event of a drag of other files', () => {
    const other = ['C:\\elsewhere\\c.txt'];
    expect(handled([{ type: 'enter', paths: other }, { type: 'over' }, { type: 'drop', paths: other }])).toEqual([true, true, true]);
  });

  it('handles a drag that carries the outgoing files and others too', () => {
    const mixed = [...own, 'C:\\elsewhere\\c.txt'];
    expect(handled([{ type: 'enter', paths: mixed }, { type: 'over' }, { type: 'drop', paths: mixed }])).toEqual([true, true, true]);
  });

  it('lets a leave through, which only hides the overlay, and handles the next drag of other files', () => {
    const other = ['C:\\elsewhere\\c.txt'];
    expect(handled([{ type: 'enter', paths: own }, { type: 'leave' }, { type: 'enter', paths: other }, { type: 'over' }])).toEqual([false, true, true, true]);
  });

  it('ignores the outgoing drag again when it comes back over the window', () => {
    expect(handled([{ type: 'enter', paths: own }, { type: 'leave' }, { type: 'enter', paths: own }, { type: 'over' }, { type: 'drop', paths: own }])).toEqual([false, true, false, false, false]);
  });
});

const PRIMARY = 1;
const NO_BUTTONS = 0;
const THRESHOLD = 5;
const SELECTION = ['C:\\a\\one.txt', 'C:\\b\\two.txt', 'C:\\a\\three.txt'];
const origin = { x: 100, y: 100 };

function pressedGesture(rowPath = SELECTION[1]) {
  const gesture = createDragGesture({ threshold: THRESHOLD });
  gesture.press(origin, rowPath, () => SELECTION);
  return gesture;
}

describe('createDragGesture', () => {
  it('starts nothing before the pointer travels the threshold', () => {
    const gesture = pressedGesture();
    expect(gesture.move({ x: 103, y: 103 }, PRIMARY)).toEqual({ kind: 'none' });
  });

  it('starts once the distance reaches the threshold with the primary button down', () => {
    const gesture = pressedGesture();
    expect(gesture.move({ x: 103, y: 104 }, PRIMARY)).toEqual({ kind: 'start', paths: SELECTION });
  });

  it('counts the distance in both directions, not along one axis', () => {
    const gesture = pressedGesture();
    expect(gesture.move({ x: 104, y: 100 }, PRIMARY).kind).toBe('none');
    expect(gesture.move({ x: 96, y: 97 }, PRIMARY).kind).toBe('start');
  });

  it('starts only once for one press', () => {
    const gesture = pressedGesture();
    expect(gesture.move({ x: 120, y: 100 }, PRIMARY).kind).toBe('start');
    expect(gesture.move({ x: 160, y: 100 }, PRIMARY)).toEqual({ kind: 'none' });
    expect(gesture.move({ x: 100, y: 100 }, PRIMARY)).toEqual({ kind: 'none' });
  });

  it('drags the whole selection in the given order when the pressed row is in it', () => {
    const gesture = pressedGesture(SELECTION[2]);
    expect(gesture.move({ x: 130, y: 100 }, PRIMARY)).toEqual({ kind: 'start', paths: SELECTION });
  });

  it('reads the selection when the drag starts, not on every press', () => {
    let reads = 0;
    const gesture = createDragGesture({ threshold: THRESHOLD });
    gesture.press(origin, SELECTION[0], () => {
      reads++;
      return SELECTION;
    });
    expect(reads).toBe(0);
    gesture.move({ x: 130, y: 100 }, PRIMARY);
    expect(reads).toBe(1);
  });

  it('drags the selection as it is when the drag starts, after the press changed it', () => {
    // A Ctrl press on an unselected row adds it to the selection, which the list reports after the press.
    let selection: readonly string[] = SELECTION;
    const added = 'C:\\c\\added.txt';
    const gesture = createDragGesture({ threshold: THRESHOLD });
    gesture.press(origin, added, () => selection);
    selection = [SELECTION[0], SELECTION[1], added, SELECTION[2]];
    expect(gesture.move({ x: 130, y: 100 }, PRIMARY)).toEqual({ kind: 'start', paths: [SELECTION[0], SELECTION[1], added, SELECTION[2]] });
  });

  it('drags only the pressed row when it is absent from the selection', () => {
    const gesture = pressedGesture('C:\\c\\alone.txt');
    expect(gesture.move({ x: 130, y: 100 }, PRIMARY)).toEqual({ kind: 'start', paths: ['C:\\c\\alone.txt'] });
  });

  it('drags the pressed row when the selection is empty', () => {
    const gesture = createDragGesture({ threshold: THRESHOLD });
    gesture.press(origin, SELECTION[0], () => []);
    expect(gesture.move({ x: 130, y: 100 }, PRIMARY)).toEqual({ kind: 'start', paths: [SELECTION[0]] });
  });

  it('forgets the press when a move arrives with the primary button up', () => {
    const gesture = pressedGesture();
    expect(gesture.move({ x: 102, y: 100 }, NO_BUTTONS)).toEqual({ kind: 'none' });
    expect(gesture.move({ x: 130, y: 100 }, PRIMARY)).toEqual({ kind: 'none' });
  });

  it('forgets the press when only another button is held', () => {
    const gesture = pressedGesture();
    const secondaryOnly = 2;
    expect(gesture.move({ x: 130, y: 100 }, secondaryOnly)).toEqual({ kind: 'none' });
    expect(gesture.move({ x: 140, y: 100 }, PRIMARY)).toEqual({ kind: 'none' });
  });

  it('starts with the primary button down even when other buttons are held too', () => {
    const gesture = pressedGesture();
    expect(gesture.move({ x: 130, y: 100 }, PRIMARY | 2).kind).toBe('start');
  });

  it('does nothing without a press', () => {
    const gesture = createDragGesture({ threshold: THRESHOLD });
    expect(gesture.move({ x: 500, y: 500 }, PRIMARY)).toEqual({ kind: 'none' });
  });

  it('forgets the press on release', () => {
    const gesture = pressedGesture();
    gesture.release();
    expect(gesture.move({ x: 130, y: 100 }, PRIMARY)).toEqual({ kind: 'none' });
  });

  it('forgets the press on cancel, as after a pointercancel', () => {
    const gesture = pressedGesture();
    gesture.cancel();
    expect(gesture.move({ x: 130, y: 100 }, PRIMARY)).toEqual({ kind: 'none' });
  });

  it('starts again for the next press after a drag', () => {
    const gesture = pressedGesture();
    expect(gesture.move({ x: 130, y: 100 }, PRIMARY).kind).toBe('start');
    gesture.press(origin, 'C:\\c\\next.txt', () => SELECTION);
    expect(gesture.move({ x: 130, y: 100 }, PRIMARY)).toEqual({ kind: 'start', paths: ['C:\\c\\next.txt'] });
  });

  it('measures from the new press point, not the old one', () => {
    const gesture = pressedGesture();
    gesture.press({ x: 300, y: 300 }, SELECTION[0], () => SELECTION);
    expect(gesture.move({ x: 302, y: 301 }, PRIMARY)).toEqual({ kind: 'none' });
  });

  it('hands out a copy, so later changes to the selection list do not reach the drag', () => {
    const live = [...SELECTION];
    const gesture = createDragGesture({ threshold: THRESHOLD });
    gesture.press(origin, live[0], () => live);
    const step = gesture.move({ x: 130, y: 100 }, PRIMARY);
    live.pop();
    expect(step).toEqual({ kind: 'start', paths: SELECTION });
  });
});

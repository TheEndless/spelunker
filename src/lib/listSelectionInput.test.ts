import { describe, expect, it } from 'vitest';
import { gridKeyAction, modifiersOf, type GridKeyEvent } from './listSelectionInput';

function keyEvent(key: string, held: Partial<Omit<GridKeyEvent, 'key'>> = {}): GridKeyEvent {
  return { key, ctrlKey: false, shiftKey: false, altKey: false, ...held };
}

describe('modifiersOf', () => {
  it('reads Ctrl and Shift from an event', () => {
    expect(modifiersOf({ ctrlKey: true, shiftKey: false })).toEqual({ ctrl: true, shift: false });
    expect(modifiersOf({ ctrlKey: false, shiftKey: true })).toEqual({ ctrl: false, shift: true });
  });
});

describe('gridKeyAction', () => {
  const act = (event: GridKeyEvent, currentIndex = 1, rowCount = 5, pageSize = 3) => gridKeyAction(event, currentIndex, rowCount, pageSize);

  it('turns a movement key into a move with no modifiers', () => {
    expect(act(keyEvent('ArrowDown'))).toEqual({ kind: 'move', targetIndex: 2, modifiers: { ctrl: false, shift: false } });
  });

  it('carries Shift, Ctrl and both with a move', () => {
    expect(act(keyEvent('ArrowUp', { shiftKey: true }))).toEqual({ kind: 'move', targetIndex: 0, modifiers: { ctrl: false, shift: true } });
    expect(act(keyEvent('End', { ctrlKey: true }))).toEqual({ kind: 'move', targetIndex: 4, modifiers: { ctrl: true, shift: false } });
    expect(act(keyEvent('PageDown', { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'move',
      targetIndex: 4,
      modifiers: { ctrl: true, shift: true },
    });
  });

  it('starts at the top when there is no current row', () => {
    expect(act(keyEvent('ArrowDown'), -1)).toEqual({ kind: 'move', targetIndex: 0, modifiers: { ctrl: false, shift: false } });
  });

  it('ignores every key combined with Alt', () => {
    for (const key of ['ArrowDown', 'Home', ' ', 'a', 'Enter', 'ContextMenu']) {
      expect(act(keyEvent(key, { altKey: true }))).toBeNull();
      expect(act(keyEvent(key, { altKey: true, ctrlKey: true }))).toBeNull();
      expect(act(keyEvent(key, { altKey: true, shiftKey: true }))).toBeNull();
    }
  });

  it('selects all on Ctrl+A in either case, but not with Shift', () => {
    expect(act(keyEvent('a', { ctrlKey: true }))).toEqual({ kind: 'selectAll' });
    expect(act(keyEvent('A', { ctrlKey: true }))).toEqual({ kind: 'selectAll' });
    expect(act(keyEvent('a', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(act(keyEvent('a'))).toBeNull();
  });

  it('toggles the current row on Ctrl+Space', () => {
    expect(act(keyEvent(' ', { ctrlKey: true }))).toEqual({ kind: 'toggleCurrent' });
  });

  it('swallows Space and Shift+Space so the grid does not scroll', () => {
    expect(act(keyEvent(' '))).toEqual({ kind: 'swallow' });
    expect(act(keyEvent(' ', { shiftKey: true }))).toEqual({ kind: 'swallow' });
  });

  it('opens on Enter and asks for the menu on the Menu key and Shift+F10', () => {
    expect(act(keyEvent('Enter'))).toEqual({ kind: 'open' });
    expect(act(keyEvent('ContextMenu'))).toEqual({ kind: 'menu' });
    expect(act(keyEvent('F10', { shiftKey: true }))).toEqual({ kind: 'menu' });
    expect(act(keyEvent('F10'))).toBeNull();
  });

  it('leaves other keys alone', () => {
    expect(act(keyEvent('Escape'))).toBeNull();
    expect(act(keyEvent('F6'))).toBeNull();
    expect(act(keyEvent('l', { ctrlKey: true }))).toBeNull();
  });

  it('does not move in an empty list', () => {
    expect(act(keyEvent('ArrowDown'), -1, 0)).toBeNull();
  });
});

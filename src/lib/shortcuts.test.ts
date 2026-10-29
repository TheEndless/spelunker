import { describe, expect, it } from 'vitest';
import { SHORTCUTS, SHORTCUT_COLUMNS, SHORTCUT_GROUPS, keyAlternatives, shortcutsInGroup, withShortcut } from './shortcuts';

describe('SHORTCUTS', () => {
  it('has non-empty keys and action text for every entry', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.trim()).not.toBe('');
      expect(shortcut.action.trim()).not.toBe('');
      if (shortcut.where !== undefined) expect(shortcut.where.trim()).not.toBe('');
    }
  });

  it('only uses groups that exist in SHORTCUT_GROUPS', () => {
    for (const shortcut of SHORTCUTS) {
      expect(SHORTCUT_GROUPS).toContain(shortcut.group);
    }
  });

  it('has at least one shortcut in every group', () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(shortcutsInGroup(group).length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate action text', () => {
    const actions = SHORTCUTS.map((shortcut) => shortcut.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('has no two shortcuts in the same group with the same keys and action', () => {
    const entries = SHORTCUTS.map((shortcut) => `${shortcut.group}|${shortcut.keys}|${shortcut.action}`);
    expect(new Set(entries).size).toBe(entries.length);
  });

  it('keeps where the keys work out of the keys, so each key stays short and the same keys can be told apart by group or place', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys, shortcut.action).not.toMatch(/ on (the|a) /i);
    }
  });

  it('names which splitter each splitter key belongs to', () => {
    const splitters = SHORTCUTS.filter((shortcut) => shortcut.where?.includes('splitter'));
    expect(splitters.map((shortcut) => shortcut.where)).toEqual(['On the preview splitter', 'On the map splitter']);
  });

  it('lists Ctrl+Shift+M to show or hide the map in the Panes group', () => {
    expect(shortcutsInGroup('Panes')).toContainEqual({ keys: 'Ctrl+Shift+M', action: 'Show or hide the results map', group: 'Panes' });
  });

  it('lists the map keys in their own group', () => {
    const map = shortcutsInGroup('Results map').map((shortcut) => shortcut.keys);
    expect(map).toEqual(['Arrow keys', 'Ctrl+click', 'Z or Ctrl+Enter', 'Backspace']);
  });

  it('lists the column heading keys in their own group', () => {
    const headings = shortcutsInGroup('Column headings').map((shortcut) => shortcut.keys);
    expect(headings).toContain('Ctrl+Left or Ctrl+Right');
    expect(headings).toContain('Alt+Shift+Left or Alt+Shift+Right');
  });

  it('lists the selection gestures in the Results group', () => {
    const results = shortcutsInGroup('Results').map((shortcut) => shortcut.keys);
    expect(results).toContain('Shift+click or Shift+arrow keys');
    expect(results).toContain('Ctrl+click');
    expect(results).toContain('Ctrl+A');
    expect(results).toContain('Ctrl+arrow keys then Ctrl+Space');
  });

  it('says Enter and the menu act on the current row and the selection', () => {
    const results = shortcutsInGroup('Results');
    expect(results).toContainEqual({ keys: 'Enter', action: 'Open the current file', group: 'Results' });
    expect(results.find((shortcut) => shortcut.keys === 'Menu key or Shift+F10')?.action).toBe('Open the context menu for the selected files');
  });

  it('lists groups in display order', () => {
    expect(SHORTCUT_GROUPS).toEqual(['Search', 'Results', 'General', 'Column headings', 'Results map', 'Panes']);
  });
});

describe('SHORTCUT_COLUMNS', () => {
  it('shows every group once, in two columns of about the same number of shortcuts', () => {
    expect(SHORTCUT_COLUMNS).toHaveLength(2);
    expect([...SHORTCUT_COLUMNS.flat()].sort()).toEqual([...SHORTCUT_GROUPS].sort());
    const lengths = SHORTCUT_COLUMNS.map((groups) => groups.reduce((sum, group) => sum + shortcutsInGroup(group).length, 0));
    expect(Math.abs(lengths[0] - lengths[1])).toBeLessThanOrEqual(4);
  });
});

describe('keyAlternatives', () => {
  it('splits alternatives, and each alternative into the steps done in turn', () => {
    expect(keyAlternatives('Ctrl+T or Ctrl+F')).toEqual([['Ctrl+T'], ['Ctrl+F']]);
    expect(keyAlternatives('Ctrl+arrow keys then Ctrl+Space')).toEqual([['Ctrl+arrow keys', 'Ctrl+Space']]);
    expect(keyAlternatives('Enter')).toEqual([['Enter']]);
  });

  it('gives the same shape for every shortcut, with no empty key', () => {
    for (const shortcut of SHORTCUTS) {
      const alternatives = keyAlternatives(shortcut.keys);
      expect(alternatives.length).toBeGreaterThan(0);
      for (const steps of alternatives) for (const step of steps) expect(step.trim(), shortcut.keys).not.toBe('');
    }
  });
});

describe('withShortcut', () => {
  it('formats a label with its keys in parentheses', () => {
    expect(withShortcut('Keyboard shortcuts', 'F1')).toBe('Keyboard shortcuts (F1)');
  });
});

describe('shortcutsInGroup', () => {
  it('returns only that group', () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(shortcutsInGroup(group).every((shortcut) => shortcut.group === group)).toBe(true);
    }
  });

  it('keeps the declared order', () => {
    const expected = SHORTCUTS.filter((shortcut) => shortcut.group === 'Results');
    expect(shortcutsInGroup('Results')).toEqual(expected);
    expect(shortcutsInGroup('Results')[0].keys).toBe('Up or Down');
  });
});

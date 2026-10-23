import { describe, expect, it } from 'vitest';
import { SHORTCUTS, SHORTCUT_GROUPS, shortcutsInGroup, withShortcut } from './shortcuts';

describe('SHORTCUTS', () => {
  it('has non-empty keys and action text for every entry', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.trim()).not.toBe('');
      expect(shortcut.action.trim()).not.toBe('');
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

  it('lists Ctrl+Shift+M to show or hide the map in the Panes group', () => {
    expect(shortcutsInGroup('Panes')).toContainEqual({ keys: 'Ctrl+Shift+M', action: 'Show or hide the results map', group: 'Panes' });
  });

  it('lists the map keys in the Results group', () => {
    const results = shortcutsInGroup('Results').map((shortcut) => shortcut.keys);
    expect(results).toContain('Arrow keys on the map');
    expect(results).toContain('Ctrl+click on the map');
  });

  it('has no two shortcuts in the same group with the same keys and action', () => {
    const entries = SHORTCUTS.map((shortcut) => `${shortcut.group}|${shortcut.keys}|${shortcut.action}`);
    expect(new Set(entries).size).toBe(entries.length);
  });

  it('lists groups in display order', () => {
    expect(SHORTCUT_GROUPS).toEqual(['Search', 'Results', 'Panes', 'Help']);
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

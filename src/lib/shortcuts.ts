export type ShortcutGroup = 'Search' | 'Results' | 'Column headings' | 'Results map' | 'Panes' | 'General';

export interface Shortcut {
  /**
   * Alternatives are separated by " or ", for example "F3 or Shift+F3". Steps done one after the
   * other are separated by " then ", for example "Ctrl+arrow keys then Ctrl+Space".
   */
  keys: string;
  action: string;
  /** Where the keys work when that is not the whole window, for example "On the map splitter". */
  where?: string;
  group: ShortcutGroup;
}

/** The groups as the list shows them, in two columns of about the same length, read left to right. */
export const SHORTCUT_COLUMNS: ShortcutGroup[][] = [
  ['Search', 'Results', 'General'],
  ['Column headings', 'Results map', 'Panes'],
];

export const SHORTCUT_GROUPS: ShortcutGroup[] = SHORTCUT_COLUMNS.flat();

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Enter', action: 'Start the search', group: 'Search' },
  { keys: 'Esc', action: 'Stop the search, or close a popover', group: 'Search' },
  { keys: 'Ctrl+N', action: 'Go to Name', group: 'Search' },
  { keys: 'Ctrl+T or Ctrl+F', action: 'Go to Containing text', group: 'Search' },
  { keys: 'Ctrl+L', action: 'Go to Look in', group: 'Search' },

  { keys: 'Up or Down', action: 'Move through the results', group: 'Results' },
  { keys: 'Home or End', action: 'Jump to the first or last result', group: 'Results' },
  { keys: 'Page Up or Page Down', action: 'Move a page at a time', group: 'Results' },
  { keys: 'Shift+click or Shift+arrow keys', action: 'Select a range of results', group: 'Results' },
  { keys: 'Ctrl+click', action: 'Add a result to the selection, or take it out', group: 'Results' },
  { keys: 'Ctrl+A', action: 'Select every result', group: 'Results' },
  { keys: 'Ctrl+arrow keys then Ctrl+Space', action: 'Move without changing the selection, then select or unselect that result', group: 'Results' },
  { keys: 'Enter', action: 'Open the current file', group: 'Results' },
  { keys: 'Menu key or Shift+F10', action: 'Open the context menu for the selected files', group: 'Results' },
  { keys: 'F3 or Shift+F3', action: 'Next or previous match in the preview', group: 'Results' },
  { keys: 'Ctrl+E', action: 'Export the results', group: 'Results' },

  { keys: 'Down', action: 'Go from a column heading into the rows', group: 'Column headings' },
  { keys: 'Menu key or Shift+F10', action: 'Choose which columns to show', group: 'Column headings' },
  { keys: 'Ctrl+Left or Ctrl+Right', action: 'Resize the column', group: 'Column headings' },
  { keys: 'Ctrl+Enter', action: 'Fit the column to its contents', group: 'Column headings' },
  { keys: 'Alt+Shift+Left or Alt+Shift+Right', action: 'Move the column', group: 'Column headings' },

  { keys: 'Arrow keys', action: 'Move between files', group: 'Results map' },
  { keys: 'Ctrl+click', action: "Zoom into that file's folder", group: 'Results map' },
  { keys: 'Z or Ctrl+Enter', action: "Zoom into the selected file's folder", group: 'Results map' },
  { keys: 'Backspace', action: 'Zoom out one folder', group: 'Results map' },

  { keys: 'F6 or Shift+F6', action: 'Move to the next or previous pane', group: 'Panes' },
  { keys: 'Ctrl+Shift+P', action: 'Show or hide the preview', group: 'Panes' },
  { keys: 'Ctrl+Shift+M', action: 'Show or hide the results map', group: 'Panes' },
  { keys: 'Left or Right', action: 'Make the preview wider or narrower (Shift for bigger steps)', where: 'On the preview splitter', group: 'Panes' },
  { keys: 'Up or Down', action: 'Make the map taller or shorter (Shift for bigger steps)', where: 'On the map splitter', group: 'Panes' },

  { keys: 'Ctrl+,', action: 'Open Settings', group: 'General' },
  { keys: 'F1', action: 'Show these shortcuts', group: 'General' },
];

/** What the keys of a shortcut are made of: the alternatives, each a list of steps done in turn. */
export function keyAlternatives(keys: string): string[][] {
  return keys.split(' or ').map((alternative) => alternative.split(' then '));
}

/** For tooltips, for example "Keyboard shortcuts (F1)". */
export function withShortcut(label: string, keys: string): string {
  return `${label} (${keys})`;
}

export function shortcutsInGroup(group: ShortcutGroup): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.group === group);
}

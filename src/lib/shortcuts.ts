export type ShortcutGroup = 'Search' | 'Results' | 'Panes' | 'Help';

export interface Shortcut {
  /** Alternatives are separated by " or ", for example "F3 or Shift+F3". */
  keys: string;
  action: string;
  group: ShortcutGroup;
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = ['Search', 'Results', 'Panes', 'Help'];

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Enter', action: 'Start the search', group: 'Search' },
  { keys: 'Esc', action: 'Stop the search, or close a popover', group: 'Search' },
  { keys: 'Ctrl+N', action: 'Go to Name', group: 'Search' },
  { keys: 'Ctrl+T or Ctrl+F', action: 'Go to Containing text', group: 'Search' },
  { keys: 'Ctrl+L', action: 'Go to Look in', group: 'Search' },
  { keys: 'Up or Down', action: 'Move through the results', group: 'Results' },
  { keys: 'Home or End', action: 'Jump to the first or last result', group: 'Results' },
  { keys: 'Page Up or Page Down', action: 'Move a page at a time', group: 'Results' },
  { keys: 'Enter', action: 'Open the selected file', group: 'Results' },
  { keys: 'Menu key or Shift+F10', action: 'Open the context menu for the selected file', group: 'Results' },
  { keys: 'F3 or Shift+F3', action: 'Next or previous match in the preview', group: 'Results' },
  { keys: 'Ctrl+E', action: 'Export the results', group: 'Results' },
  { keys: 'Down', action: 'Go from a column heading into the rows', group: 'Results' },
  { keys: 'Menu key or Shift+F10', action: 'On a column heading, choose which columns to show', group: 'Results' },
  { keys: 'Ctrl+Left or Ctrl+Right', action: 'Resize the column heading you are on', group: 'Results' },
  { keys: 'Ctrl+Enter', action: 'Fit that column to its contents', group: 'Results' },
  { keys: 'Alt+Shift+Left or Alt+Shift+Right', action: 'Move that column', group: 'Results' },
  { keys: 'Arrow keys on the map', action: 'Move between files in the results map', group: 'Results' },
  { keys: 'Ctrl+click on the map', action: 'Zoom the map into that file\'s folder', group: 'Results' },
  { keys: 'Z or Ctrl+Enter on the map', action: 'Zoom the map into the selected file\'s folder', group: 'Results' },
  { keys: 'Backspace on the map', action: 'Zoom the map out one folder', group: 'Results' },
  { keys: 'F6 or Shift+F6', action: 'Move to the next or previous pane', group: 'Panes' },
  { keys: 'Ctrl+Shift+P', action: 'Show or hide the preview', group: 'Panes' },
  { keys: 'Ctrl+Shift+M', action: 'Show or hide the results map', group: 'Panes' },
  { keys: 'Left or Right on the preview splitter', action: 'Make the preview wider or narrower (Shift for bigger steps)', group: 'Panes' },
  { keys: 'Up or Down on the map splitter', action: 'Make the map taller or shorter (Shift for bigger steps)', group: 'Panes' },
  { keys: 'Ctrl+,', action: 'Open Settings', group: 'Help' },
  { keys: 'F1', action: 'Show these shortcuts', group: 'Help' },
];

/** For tooltips, for example "Keyboard shortcuts (F1)". */
export function withShortcut(label: string, keys: string): string {
  return `${label} (${keys})`;
}

export function shortcutsInGroup(group: ShortcutGroup): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.group === group);
}

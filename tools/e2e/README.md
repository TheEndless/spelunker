# End-to-end checks for the real window

These scripts drive the real Spelunker window (the Tauri debug exe) through the Chrome DevTools
protocol, with real key and mouse events. They are how the keyboard model, columns, previews and
the system menu were verified. They assume the repository is at `D:\Development\ai\spelunker`.

## Setup

1. Start the dev server: `npm run dev` (port 5173).
2. Start the app with the debug port open: `pwsh tools/e2e/launch.ps1` (it builds the debug exe first).
3. Make the sample files once: `cd tools/e2e && node fixtures.mjs`.

Run the scripts from `tools/e2e`.

## Suites

| Script | What it checks |
| --- | --- |
| `node ux.mjs out` | 51 checks: empty state, announcements, grid keys, context menu requests, column heading keys, preview, F6, popovers, folder list, filters, errors, forced colors |
| `node ux2.mjs` | 17 checks: header and F6/F1 handling, theme radio group, recent folders, Stop focus, sorting, empty grid, filter chips |
| `node ux3.mjs` | 16 checks: column chooser, hide, drag and keyboard reorder, resize, fit, persistence, reset |
| `node ux4.mjs` | 27 checks: preview splitter (drag, keys, limits, reset, persistence), collapse and restore, F6 with a hidden preview, columns refitting when the pane or window changes |
| `node ux5.mjs` | 9 checks: the all-drives button, typing the words, a real search across drives, the launch with "This PC" |
| `node fill.mjs` | 8 checks: the columns fill the pane as the window widens, narrows, and the preview hides, in automatic and hand-sized mode. Runs in headless Edge against the dev server, so it needs no Spelunker window |
| `node previews.mjs <folder>` | Opens each file in a folder and saves a screenshot of the preview pane into `final/` |
| `node snap.mjs <out.png> [folder] [text] [name]` | Runs a search and saves a page screenshot |
| `node shellmenu4.mjs` | Opens the REAL Windows menu on a result and clicks entries by name (see the warning below) |

## Warnings

- The system menu is modal on the app's main thread, and a script cannot close it. The suites avoid
  it: `PAGE_HELPERS` in `cdp.mjs` installs `window.__spShellMenuHook`, which the app honours in
  development builds, so the menu request is recorded and never shown. Always evaluate
  `PAGE_HELPERS` before anything that could open a row menu.
- `shellmenu4.mjs` removes that hook on purpose and opens the real menu. It finds items by name
  through UI Automation (`clickmenu.ps1`). If an item cannot be found, the menu stays open and the
  window is stuck: restart the app (`wins.ps1` lists the app's windows, and a `#32768` entry means
  a menu is open).
- Scripts type into the app's own page only. They send no keystrokes to the desktop.
- `release-check.ps1` starts the release exe and checks it loads its own pages with no dev server. `installrun.ps1` installs the setup, launches the installed app as Explorer would for a folder, then uninstalls. `installtest.ps1` checks the registry entries across install and uninstall. Run these with no other copy of Spelunker open.
- `regshow.ps1` prints the Explorer entries in the registry (folders, drives, This PC). `thispc-verb.ps1` asks the shell which verbs it offers for This PC and can run ours.
- Backslashes and non-ASCII characters get corrupted when files are written through shell heredocs
  here, so write script files with an editor or the Write tool.

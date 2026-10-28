# End-to-end checks for the real window

These scripts drive the real Spelunker window (the Tauri debug exe) through the Chrome DevTools
protocol, with real key and mouse events sent to the app's own page. They are how the keyboard
model, columns, previews and the system menu were verified. They assume the repository is at
`D:\Development\ai\spelunker`. Read the warnings below before running anything.

## Setup

1. Start the dev server: `npm run dev` (port 5173).
2. Start the app with the debug port open: `pwsh tools/e2e/launch.ps1` (it builds the debug exe first).
   The window is shown without being activated and moved off screen, so it takes no focus.
3. Make the sample files once: `cd tools/e2e && node fixtures.mjs`.

Run the scripts from `tools/e2e`, one at a time (they share the window and its saved preferences).
The headless suites (`fill.mjs`, `ux8.mjs`, and `ux7.mjs` without `--real`) need only step 1: they start their
own headless Edge through `headless.mjs` and stop it when they finish.

Every suite prints PASS or FAIL per check and exits with code 1 when any check failed.

## Suites

The routine run is every row of this table except `shellmenu4.mjs`, plus `installtest.ps1` after a
release build. `shellmenu4.mjs`, `release-check.ps1` and `installrun.ps1` take the foreground and are
for when nobody is using the machine (see the warnings).

| Script | What it checks |
| --- | --- |
| `node ux.mjs out` | 52 checks: empty state, announcements, grid keys, context menu requests, column heading keys, preview, F6 through the results, map and preview, popovers, folder list, filters, errors, forced colors |
| `node ux2.mjs` | 17 checks: header and F6/F1 handling, theme radio group, recent folders, Stop focus, sorting, empty grid, filter chips |
| `node ux3.mjs` | 16 checks: column chooser, hide, drag and keyboard reorder, resize, fit, persistence, reset |
| `node ux4.mjs` | 27 checks: preview splitter (drag, keys, limits, reset, persistence), collapse and restore, F6 with a hidden preview, columns refitting when the pane or window changes |
| `node ux5.mjs` | 9 checks: the all-drives button, typing the words, a real search across drives, the launch with "This PC" (a second launch, started without activation) |
| `node ux6.mjs` | 21 checks: every popover, menu and dialog stays inside the window at three window sizes |
| `node ux7.mjs [--shots <folder>]` | 75 checks (numbered items 1 to 16 and 18 to 20 of the results map suite, and no console errors): drawing, Size and Matches, type and age, click and list selection, hover, zoom, the zoom button (Zoom to folder at the top level, Zoom out when zoomed in, one level per click on the deep fixture, focus kept), map keys, the context menu from a right-click, the Menu key and Shift+F10, F6, `Ctrl+Shift+M` and the Map button (also while the window is too short), the map splitter, the shortest window, forced colors with each map shading (the same outline picture with either), both themes, Cushion and Flat shading (Cushion is the default, a large tile is brighter at its top left only in Cushion, switching keeps the zoom and selection, the choice persists across a reload), and the performance budget (layout, paint at ratio 1 and at ratio 2 on 2400 by 520 device pixels, hit index, hover, the cost of posting rows to the worker, long tasks) with every number printed, plus one larger ratio 2 paint printed only. Runs in headless Edge against the dev server, so it needs no Spelunker window. `--shots` saves screenshots of the deep fixture |
| `node ux8.mjs [--shots <folder>]` | 73 checks: selecting many rows. Click, Ctrl+click, Shift+click both ways, Ctrl+Shift+click, Shift+Arrow growing and shrinking, Ctrl+Arrow moving the current row alone, Ctrl+Space, Ctrl+A (the count and size in the status bar, the announcement), `aria-multiselectable` and `aria-selected` on the exact rows, a plain Arrow collapsing, press and release on a selected row versus press-move-release, the preview header and the map outline following the current row, a map click collapsing the selection, the app's menu on a selection (Copy paths and Copy names copy every selected path in list order, right-click on an unselected row selects it alone), Space not scrolling, Enter opening only the current row (through the DEV `window.__spOpenPathHook`), Ctrl+A in the Containing text box, a new search clearing the selection, and dragging files out up to the request for the native drag: one request per press past the threshold, carrying the whole selection in list order as the press left it (also after a Ctrl or Shift press on an unselected row), or only the row after a plain press on an unselected one, none for a press without movement or with the button up mid-way, clicks after a drag not swallowed, and the rows of files the mock reports gone removed after the drag and again about 1.5 s later, pruning the selection (`window.__spMockMissingPaths` names them), and the window's own drop events for the outgoing files (in any case and separator style) showing no "Drop a folder" overlay and leaving Look in alone, while other files still show it and set Look in, and the same files count as a user's again after the next press (delivered through the DEV `window.__spEmitFolderDrop`). A finger (CDP touch events) swiping along a row asks for no drag and a tap still selects the row. The current row's cue after Ctrl+Down is checked with the grid focused and in forced colors, and `--shots` saves it in light, dark and forced colors. The drag request goes to the DEV `window.__spFileDragHook`, so no native drag is ever started. Runs in headless Edge against the dev server, so it needs no Spelunker window |
| `node ux7.mjs --real` | 4 checks (item 17, and no console errors): a real folder search through the actual backend draws the map with real file names. Attaches to the running debug exe |
| `node fill.mjs` | 8 checks: the columns fill the pane as the window widens, narrows, and the preview hides, in automatic and hand-sized mode. Runs in headless Edge against the dev server, so it needs no Spelunker window |
| `node previews.mjs <folder>` | Opens each file in a folder and saves a screenshot of the preview pane into `final/` |
| `node snap.mjs <out.png> [folder] [text] [name]` | Runs a search and saves a page screenshot |
| `node shellmenu4.mjs` | Opens the REAL Windows menu on a result and clicks entries by name. Takes the foreground (see the warnings) |

## Warnings

- **Never take focus from the person using the machine.** A test run must leave the foreground
  window, the keyboard and the mouse alone. So every launch goes through `start-quiet.ps1`, which
  starts the program without activating it (CreateProcess with `SW_SHOWNOACTIVATE`) and, given
  `-OffScreenWindowClass 'Tauri Window'`, moves the window beside the desktop without activating
  it. It is moved off screen rather than minimized because a minimized WebView2 page reports itself
  hidden, stops drawing, and gets a wrong viewport size, so the checks would not see what a person
  sees. Never start the app with `Start-Process` or from Explorer for a test run.
- `launch.ps1` also sets `SPELUNKER_NO_FOCUS=1`. A debug build that sees it never brings its window
  forward: not when the window first appears, not on a second launch (which normally restores and
  focuses the running window), and not when the window state plugin restores a saved window. A
  release build ignores the variable, so the product always behaves the same for its users.
- **Close any open Spelunker first.** Only one copy runs at a time: the single-instance plugin
  names a mutex after the app identifier (`dev.skean.spelunker-sim`), which debug and release
  builds share. A copy started while another is open hands its launch to that window and exits,
  and an open release window then restores and focuses itself. So `launch.ps1`,
  `release-check.ps1` and `installrun.ps1` call `assert-no-spelunker.ps1` first, which stops them
  with a message when that mutex exists. `ux5.mjs` makes such a second launch on purpose, which is
  safe only because `launch.ps1` made sure the window receiving it is the debug one.
- **`release-check.ps1` and `installrun.ps1` take the foreground: run them only when nobody is using
  the machine.** They start a release exe, and once a window state has been saved
  (`%APPDATA%\dev.skean.spelunker\.window-state.json`, written whenever the app is closed
  normally) the release exe restores its window and focuses it itself, the Tauri way, which injects
  an Alt key press to win the foreground. The quiet start cannot prevent that, and the release
  behavior is the product's, so it is not changed for the tests. `installtest.ps1` starts no app
  (silent install and uninstall only) and takes no focus.
- The window never has the real focus, so `openPage` (and `ux.mjs`) turn on the protocol's focus
  emulation: the page behaves as a focused one, with focus events and `:focus-visible`.
- To prove a run took no focus, run `foreground.ps1` (read-only) before and after it, or
  `foreground.ps1 -WatchSeconds <n>` in a second shell during it: it prints every change of the
  foreground window with the time, and no Spelunker window may ever appear in it.
- **`shellmenu4.mjs` and `clickmenu.ps1` take the foreground: run them only when nobody is using
  the machine.** They are excluded from the routine run. The real Windows menu only works in the
  foreground, and `clickmenu.ps1` finds its items through UI Automation and clicks them with the
  real mouse.
- The system menu is modal on the app's main thread, and a script cannot close it. The suites avoid
  it: `PAGE_HELPERS` in `cdp.mjs` installs `window.__spShellMenuHook`, which the app honours in
  development builds, so the menu request is recorded and never shown. Always evaluate
  `PAGE_HELPERS` before anything that could open a row menu.
- The native file drag is modal on the main thread as well, and a drag that starts with the button
  already up drops at once wherever the real cursor is. The backend refuses unless the physical
  button is down (synthetic protocol input presses none), and `PAGE_HELPERS` also installs
  `window.__spFileDragHook`, which records the request and answers it without calling the backend.
  Always evaluate `PAGE_HELPERS` before anything that could press and move on a row, and never
  remove that hook.
- `shellmenu4.mjs` removes that hook on purpose and opens the real menu. If an item cannot be found,
  the menu stays open and the window is stuck: restart the app (`wins.ps1` lists the app's windows,
  and a `#32768` entry means a menu is open).
- Apart from `shellmenu4.mjs`, scripts type into the app's own page only. They send no keystrokes
  or mouse input to the desktop.
- `release-check.ps1` starts the release exe and checks it loads its own pages with no dev server. `installrun.ps1` installs the setup, launches the installed app as Explorer would for a folder, then uninstalls. `installtest.ps1` checks the registry entries across install and uninstall. Run these with no other copy of Spelunker open, and not while Spelunker is installed for real: they write and then remove this user's Explorer entries.
- `regshow.ps1` prints the Explorer entries in the registry (folders, drives, This PC). `thispc-verb.ps1` asks the shell which verbs it offers for This PC. With `-Run` it runs ours, which starts the app through the shell and can take the foreground, so like `shellmenu4.mjs` that is only for when nobody is using the machine.
- Backslashes and non-ASCII characters get corrupted when files are written through shell heredocs
  here, so write script files with an editor or the Write tool.

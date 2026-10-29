<p align="center">
  <img src="docs/images/logo.png" alt="Spelunker: a magnifying glass whose lens is a cave lit by a headlamp beam" width="160" height="160">
</p>

<h1 align="center">Spelunker</h1>

<p align="center">
  <strong>Fast, keyboard-friendly file search for Windows.</strong><br>
  Find text inside files and match names with wildcards. Results stream in as they are found.
</p>

<p align="center">
  <a href="https://github.com/TheEndless/spelunker"><img alt="Repository" src="https://img.shields.io/badge/github-TheEndless%2Fspelunker-181717?logo=github"></a>
  <img alt="Visibility: private" src="https://img.shields.io/badge/repo-private-lightgrey">
  <a href="https://github.com/TheEndless/spelunker/releases/latest"><img alt="Latest release" src="https://img.shields.io/badge/release-v1.1.0-blue"></a>
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6?logo=windows11&logoColor=white">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

<p align="center">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-2021-000000?logo=rust&logoColor=white">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white">
  <img alt="Svelte 5" src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white">
  <img alt="Vitest" src="https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white">
</p>

<p align="center">
  <img src="docs/images/screenshot.png" alt="Spelunker searching a documents folder for the word invoice: the results list with match counts, a preview of the selected email with the matches highlighted, and a map of the results below" width="900">
</p>

---

## What it does

Spelunker is built for the two searches done every day: **text inside files** and **file names with wildcards**. There is no index and no background service. It walks the folders you point it at, in parallel, and shows each hit the moment it is found.

- **Instant feel.** Results stream into a virtualized list that stays smooth past 100,000 rows.
- **Content search.** Literal, whole word, match case, or regex (including across lines). Reads UTF-8, UTF-8 with BOM, UTF-16 LE/BE, and falls back to Windows-1252. Skips binary files unless asked.
- **Name search.** `*` and `?` wildcards, several patterns separated by `;` or `,`, and exclusions with a leading `-` (for example `*.log; -*.min.js`). A plain word matches anywhere in the name.
- **Filters when needed.** Size, modified date, created date, and a name regex, in a panel that stays closed until you need it, with a badge counting what is active.
- **Search everywhere.** Pick any folders, or choose **This PC** in the Browse dialog or the Look in list to search every local fixed drive (it shows as `This PC (C:, D:)`, and you can edit the letters).
- **Built-in preview.** Matching lines with context, a full scrollable view of the file with next/previous hit, and rendered previews for images, PDFs, audio, and video. The preview is resizable and collapsible.
- **Results map.** A treemap below the results shows where your matches are: rectangle area is file size or match count, color is file type or age. It fills in as the search runs, click a rectangle to select the file, Ctrl+click to zoom into its folder, and `Ctrl+Shift+M` hides it. Tiles are shaded like lit cushions, with a Flat option in Settings.
- **Select many, drag them out.** Select results the way you do in File Explorer (Ctrl+click, Shift+click, Shift with the arrow keys, Ctrl+A), see the count and total size in the status bar, and drag the selection out of the window into Explorer and other programs that accept files. Right-click a selection (up to 5,000 files) for the Windows context menu of every selected file.
- **Real Windows integration.** Right-click a result for the genuine Windows context menu, with Spelunker's own entries on top (open containing folder, copy path, copy name, copy matching lines, or copy paths and copy names for several files). Right-click a folder, a drive, or **This PC** in Explorer and choose **Search with Spelunker**.
- **Your columns, your way.** Resize, reorder, show or hide columns, and let them fill the window automatically. Dates follow your Windows regional format.
- **12 themes, each with light and dark.** Designed separately, not inverted, and the default **Slate** follows Windows. Pick one from the toolbar or on the Appearance tab of Settings. The match highlight follows each theme's accent.
- **Settings in three tabs.** **Files** holds the editor, preview and Explorer options, **Appearance** the mode and theme, and **About** the version, license, a button to copy the version details, and the update check. Reset everything to defaults from the footer (saved searches are kept).
- **Update check.** **Check for updates** on the About tab asks GitHub for the newest release, and a banner under the toolbar announces a newer one with a **View release** button. Dismissing it hides that version only. The app also checks once a day as it starts, and you can turn that off.
- **Keyboard first.** Every pane, column, and splitter works without a mouse. Press `F1` in the app for the full list, shown in a dialog grouped by what you are doing.

## Install

Download a package from the [latest release](https://github.com/TheEndless/spelunker/releases/latest):

| Package | For |
| --- | --- |
| `Spelunker_<version>_x64-setup.exe` | A per-user install with no administrator prompt. Registers the Explorer right-click entries. |
| `Spelunker_<version>_x64_en-US.msi` | A per-machine install. Registers the Explorer right-click entries for all users. |
| `Spelunker-<version>-portable.exe` | No install. |

The packages are not code-signed, so Windows SmartScreen may warn on first run. To build them yourself, see [Build](#build).

The portable exe needs no installer. On its first run from a normal folder it adds the Explorer entries for the current user, and it repairs them if the file moves. Turn that off under **Settings > Files > Windows Explorer**. Builds run straight from a cargo `target` folder never register themselves.

## Using Spelunker

1. Type a **Name** pattern, **Containing text**, or both. Leaving the text empty runs a fast name-only search.
2. Choose **Look in** folders, or press the **This PC** button to search all drives.
3. Press `Enter`. Press `Esc` to stop.
4. Select a result to see it in the preview. Use `F3` and `Shift+F3` to step through matches.

Name, content, and filters combine with AND.

### Keyboard

| Shortcut | Action |
| --- | --- |
| `Enter` / `Esc` | Start / stop the search |
| `Ctrl+N` | Go to Name |
| `Ctrl+T` or `Ctrl+F` | Go to Containing text |
| `Ctrl+L` | Go to Look in |
| `Up` / `Down`, `Home` / `End`, `Page Up` / `Page Down` | Move through the results |
| `Shift` + arrows or click | Select a range |
| `Ctrl` + click | Add or remove a result |
| `Ctrl` + arrows, then `Ctrl+Space` | Move without selecting, then toggle |
| `Ctrl+A` in the results | Select every result |
| `Enter` on a result | Open the current file |
| `Menu` key or `Shift+F10` | Context menu for the selected results |
| `F3` / `Shift+F3` | Next / previous match in the preview |
| `Ctrl+E` | Export results (CSV or plain text) |
| `F6` / `Shift+F6` | Next / previous pane |
| `Ctrl+Shift+P` | Show or hide the preview |
| `Ctrl+Shift+M` | Show or hide the results map |
| `Ctrl+,` | Settings |
| `F1` | All shortcuts |

### From the command line

Launching with folders opens Spelunker looking in them. `This PC` (or `All drives`) means every local fixed drive.

```bash
Spelunker.exe "D:\Projects" "E:\Notes"
Spelunker.exe "This PC"
```

A second launch hands its folders to the window that is already open.

## Build

You need Windows 10 or 11, a stable [Rust](https://rustup.rs/) toolchain, [Node.js](https://nodejs.org/) with npm, and the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (already present on current Windows).

```bash
npm install
npm run tauri dev      # the real app with hot reload
npm run tauri build    # NSIS setup and MSI in target/release/bundle
```

To work on the interface alone, in a plain browser with fake data:

```bash
npm run dev            # http://localhost:5173
```

Typing `many` as the search text streams 100,000 fake rows for visual checks, and `deep` streams 100,000 rows in a deep, uneven folder tree for the results map.

## Test

```bash
cargo test                               # search engine and CLI
cargo test --workspace                   # also builds and tests the Tauri shell
cargo clippy --workspace --all-targets   # kept warning-free
npm test                                 # frontend logic (Vitest)
npm run check                            # svelte-check: types and accessibility
```

The screenshot above is made by `node tools/e2e/screenshot.mjs`, from an invented documents folder in the browser build, so no real file name is in it.

The `tools/e2e` scripts drive the real app window over the Chrome DevTools protocol. Read [tools/e2e/README.md](tools/e2e/README.md) first, because some scripts open native Windows menus.

A command-line harness runs the same engine without the UI:

```bash
cargo run -p spelunker-cli -- -l <folder> -n "*.rs" -t "text" [-c] [-w] [-r]
```

## How it is put together

| Part | Role |
| --- | --- |
| [`crates/spelunker-core`](crates/spelunker-core) | The search engine, as a library. Parallel walk with [`ignore`](https://crates.io/crates/ignore), matching and binary detection with [`grep-searcher`](https://crates.io/crates/grep-searcher) and [`grep-regex`](https://crates.io/crates/grep-regex), encodings with [`encoding_rs`](https://crates.io/crates/encoding_rs). |
| [`crates/spelunker-cli`](crates/spelunker-cli) | A test harness binary over the engine. |
| [`src-tauri`](src-tauri) | The Tauri 2 shell: commands, a 50 ms event batcher that keeps the UI responsive, the native Windows context menu, and Explorer integration. |
| [`src`](src) | The Svelte 5 and TypeScript interface. Pure logic sits in `src/lib/*.ts` with tests beside it. |

The interface never touches the disk. All file access lives in `spelunker-core`.

## Security notes

The one thing Spelunker asks the network for is the newest release number. The backend (`src-tauri/src/updates.rs`) does it over HTTPS to one fixed GitHub address, when you press Check for updates on the About tab or, unless you turn it off there, once a day as the app starts. The page cannot choose the address, the reply is size and time limited, and View release opens only a page of this project's releases. Nothing about you or your files is sent. The page shown in the window is treated as untrusted, so the backend does not simply do what it asks:

- Commands that take a path (preview, open, reveal in Explorer, the system menu, drag out, open in editor) work only on files inside the folders of the current search.
- Saving an export shows the native save dialog from the backend, and the page never names the file it writes.
- A custom editor command is not run until you approve it in a native dialog the first time. The built-in editors have their command lines in the app.
- A strict Content Security Policy limits what the page can load, and a file named `.pdf` is shown only if it begins with the PDF header.

The installers are unsigned.

## License

Released under the [MIT License](LICENSE). The dependencies it builds on are permissively licensed too (MIT, Apache-2.0, or Unlicense).

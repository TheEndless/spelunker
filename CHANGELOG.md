# Changelog

All notable changes to Spelunker are listed here, newest first. The same notes are on each [release page](https://github.com/TheEndless/spelunker/releases), with the downloads.

## [1.2.0] - 2026-10-29

### Added

- **Update check.** Settings > About has a Check for updates button. A banner under the toolbar announces a newer release, and dismissing it hides that version only. Spelunker checks once a day at start-up, and you can turn that off. The only network request is for the newest release number from GitHub.
- **Settings tabs.** Settings is split into Files, Display and About, with a reset in the footer.
- **Shortcuts dialog.** A keyboard shortcuts reference you can open from the app.

### Changed

- **Appearance and themes.** The theme list lives under Appearance, and the toolbar button lines up with the others.
- **Search panel.** The Search button matches the height of the fields beside it, and the Look in and Name labels are the same width.
- **Security.** A review of the Tauri commands, links and paths led to tighter checks on which web addresses the app will open.

## [1.1.0] - 2026-10-28

### Added

- **Results map.** A treemap below the results shows where your matches are. Area is file size or match count, color is file type or age, and every file is a rectangle. It fills in while the search runs. Click to select, Ctrl+click to zoom into a folder, and `Ctrl+Shift+M` hides it.
- **Cushion shading.** Tiles are lit like cushions. Settings has a Flat option.
- **Select many results.** Ctrl+click, Shift+click, Shift with the arrow keys, and Ctrl+A work as in File Explorer. The status bar shows the count and total size.
- **Drag results out.** Drag the selection into Explorer and other programs that accept files, up to 5,000 files.
- **System menu for many files.** Right-click a selection for the Windows context menu of every selected file.

### Changed

- Faster launch in development builds, and a clearer Zoom out button on the map.

## [1.0.0] - 2026-10-10

First stable release.

### Added

- Content search (literal, whole word, match case, regex, multi-line) and wildcard name search, streaming results into a list that stays smooth past 100,000 rows.
- Filters for size, modified date, created date, and name regex.
- Search any folders, or **This PC (all drives)**.
- Preview pane with matching lines, a full file view, and rendered images, PDFs, audio, and video. Resizable and collapsible.
- The real Windows context menu on results, plus Spelunker's own entries on top.
- **Search with Spelunker** in the Explorer right-click menu for folders, drives, and This PC.
- Resizable, reorderable, hideable columns that fill the window, with dates in your Windows format.
- 13 themes, each with a designed light and dark variant.
- Fully keyboard operable. Press `F1` for the shortcuts.

[1.2.0]: https://github.com/TheEndless/spelunker/releases/tag/v1.2.0
[1.1.0]: https://github.com/TheEndless/spelunker/releases/tag/v1.1.0
[1.0.0]: https://github.com/TheEndless/spelunker/releases/tag/v1.0.0

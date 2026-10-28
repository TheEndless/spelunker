<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import {
    copyText,
    existingPaths,
    hasShellMenu,
    openInEditor,
    openPath,
    previewFile,
    revealPath,
    saveTextFile,
    showShellMenu,
    startFileDrag,
    takeLaunchFolder,
    validateContent,
    validateNameRegex,
    watchFolderDrops,
    watchOpenFolder,
  } from './lib/backend';
  import ContextMenu from './lib/ContextMenu.svelte';
  import { countActiveFilters, type Criteria } from './lib/criteria';
  import { editorTemplate } from './lib/editors';
  import { describeEmptyState } from './lib/emptyState';
  import { exportFileName, formatResults, type ExportFormat } from './lib/exportResults';
  import HorizontalSplitter from './lib/HorizontalSplitter.svelte';
  import Icon from './lib/Icon.svelte';
  import { menuRowsFor } from './lib/listSelectionInput';
  import { PANE_ORDER, nextPane, type PaneId } from './lib/paneCycle';
  import { GRID_MIN_HEIGHT, MAP_MIN_HEIGHT, mapFits } from './lib/paneSplit';
  import { applyTheme, Preferences } from './lib/preferences.svelte';
  import { findRowIndex } from './lib/rowLookup';
  import PreviewPane from './lib/PreviewPane.svelte';
  import { applyRecipe, type Recipe } from './lib/recipes';
  import { buildSearchRequest, firstFilterError } from './lib/request';
  import ResultsList from './lib/ResultsList.svelte';
  import ResultsMap from './lib/ResultsMap.svelte';
  import { TreemapClient } from './lib/treemapClient.svelte';
  import WelcomePanel from './lib/WelcomePanel.svelte';
  import SearchBar from './lib/SearchBar.svelte';
  import { SavedSearchStore } from './lib/savedSearchStore.svelte';
  import { describeSearchState } from './lib/searchAnnouncement';
  import { SearchSession } from './lib/search.svelte';
  import {
    EMPTY_SELECTION,
    moveCurrent,
    pressRow,
    pruneSelection,
    releaseRow,
    selectAll,
    selectOnly,
    toggleCurrent,
    type Modifiers,
    type SelectionState,
  } from './lib/selection';
  import { selectionAnnouncement, selectionSummary } from './lib/selectionSummary';
  import SettingsDialog from './lib/SettingsDialog.svelte';
  import { withShortcut } from './lib/shortcuts';
  import Splitter from './lib/Splitter.svelte';
  import StatusBar from './lib/StatusBar.svelte';
  import StoppingDialog from './lib/StoppingDialog.svelte';
  import type { DisplayRow } from './lib/types';
  import { createValidator } from './lib/validation.svelte';
  import { goneNotice, removeGoneRows, skippedNotice } from './lib/vanishedRows';

  const preferences = new Preferences();
  const session = new SearchSession();
  const savedSearches = new SavedSearchStore();

  // Live checks against the real regex engine. They only run while the regex option is on.
  const contentValidator = createValidator(
    () => {
      const { text, matchCase, wholeWord, regex, multiLine } = preferences.criteria;
      return regex && text !== '' ? { text, matchCase, wholeWord, regex, multiLine } : null;
    },
    validateContent,
  );
  const nameValidator = createValidator(
    () => (preferences.criteria.nameIsRegex && preferences.criteria.namePatterns !== '' ? preferences.criteria.namePatterns : null),
    validateNameRegex,
  );
  const filterError = $derived(firstFilterError(preferences.criteria, Date.now()));
  const canSearch = $derived(
    preferences.roots.length > 0 && !contentValidator.error && !nameValidator.error && filterError === null,
  );

  let searchBar: SearchBar;
  let previewPane = $state<PreviewPane>();
  let mainElement = $state<HTMLElement>();
  /**
   * The preview's width as CSS, so the browser keeps it right as the window changes with no help
   * from a measurement that could go stale: the width the user chose, or about 38 percent, and never
   * less than 280 px or more than leaves the results 360 px.
   */
  const previewTrack = $derived(`clamp(280px, ${preferences.previewWidth === null ? '38%' : `${preferences.previewWidth}px`}, calc(100% - 360px))`);
  const treemap = new TreemapClient(session);
  let resultsMap = $state<ResultsMap>();
  /** The results grid and the map below it. Its height decides whether the map fits. */
  let leftColumn = $state<HTMLElement>();
  let leftColumnHeight = $state(0);
  /** Asks the list to scroll to a row chosen on the map. The token makes a repeat of the same path a new request. */
  let revealRequest = $state<{ path: string; token: number } | null>(null);
  let revealToken = 0;
  /** The map is wanted from the moment a search starts, so its space is reserved before the first rows arrive. */
  const mapWanted = $derived(!preferences.mapCollapsed && (session.running || session.summary !== null || session.rows.length > 0));
  const mapTooShort = $derived(!mapFits(leftColumnHeight));
  const mapShown = $derived(mapWanted && !mapTooShort);
  /** The map's height as CSS, like the preview's width: the user's choice or about a third, within both minimums. */
  const mapTrack = $derived(
    `clamp(${MAP_MIN_HEIGHT}px, ${preferences.mapHeight === null ? '34%' : `${preferences.mapHeight}px`}, calc(100% - ${GRID_MIN_HEIGHT}px))`,
  );
  /** Matches needs Containing text. Without it the map uses Size, and the saved choice is kept for the next search. */
  const canUseMatches = $derived((session.query?.text ?? '') !== '');
  const effectiveMetric = $derived(preferences.mapMetric === 'matches' && !canUseMatches ? 'size' : preferences.mapMetric);
  const shownPanes = $derived<PaneId[]>(
    PANE_ORDER.filter((pane) => (pane !== 'preview' || !preferences.previewCollapsed) && (pane !== 'map' || mapShown)),
  );
  /** The results selection. Its current row drives everything that shows one file. */
  let selection = $state.raw<SelectionState>(EMPTY_SELECTION);
  const selectedPath = $derived(selection.current);
  /** The criteria of the search whose results are on screen, used to explain an empty list. */
  let searchedCriteria = $state.raw<Criteria | null>(null);
  /** The app's own file menu, used only where Windows' menu is unavailable (a plain browser). */
  let menu = $state.raw<{ rows: DisplayRow[]; x: number; y: number } | null>(null);
  let settingsOpen = $state(false);
  let notice = $state<{ kind: 'info' | 'error'; text: string } | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** No search has run in this session, so the results area shows the welcome instead of a summary. */
  const idle = $derived(!session.running && session.summary === null);
  const emptyState = $derived(
    describeEmptyState({
      phase: session.running ? 'searching' : idle ? 'idle' : 'done',
      activeFilters: searchedCriteria ? countActiveFilters(searchedCriteria) : 0,
      includeHidden: searchedCriteria?.includeHidden ?? false,
      binarySkipped: session.summary?.binarySkipped ?? 0,
    }),
  );

  // One calm announcement for screen readers. Live counters are deliberately not announced.
  const announcement = $derived(
    describeSearchState({
      running: session.running,
      stopping: session.stopping,
      failed: session.failure !== null,
      summary: session.summary
        ? { filesMatched: session.summary.filesMatched, cancelled: session.summary.cancelled }
        : null,
    }),
  );

  let selectedRowHint = -1;
  const selectedRow = $derived.by(() => {
    const rows = session.sortedRows;
    selectedRowHint = findRowIndex(rows, selectedPath, selectedRowHint);
    return selectedRowHint >= 0 ? rows[selectedRowHint] : null;
  });

  /** "3 selected, 12.4 MB" once more than one row is selected. One pass over the rows per selection or rows change. */
  const selectionText = $derived.by(() => {
    if (selection.paths.size < 2) return '';
    let selectedCount = 0;
    let totalBytes = 0;
    for (const row of session.rows) {
      if (!selection.paths.has(row.path)) continue;
      selectedCount++;
      totalBytes += row.size;
    }
    return selectionSummary(selectedCount, totalBytes);
  });

  /**
   * "N selected" for screen readers after select all, a range, or a keyboard toggle, which moving
   * the active row does not announce. It waits until the keys settle, so holding Shift+Down says it once.
   */
  let selectionAnnouncementText = $state('');
  let selectionAnnouncementTimer: ReturnType<typeof setTimeout> | undefined;
  const SELECTION_ANNOUNCEMENT_DELAY_MS = 400;

  /**
   * Replaces the selection. With `announce`, a real change is spoken once the keys settle. Any other
   * change drops a pending announcement, which would describe a selection that is gone.
   */
  function changeSelection(next: SelectionState, announce = false) {
    const text = selectionAnnouncement(selection, next);
    selection = next;
    if (text === null) return;
    clearTimeout(selectionAnnouncementTimer);
    if (!announce) return;
    // Emptied first, so the same count said twice in a row is still announced.
    selectionAnnouncementText = '';
    selectionAnnouncementTimer = setTimeout(() => (selectionAnnouncementText = text), SELECTION_ANNOUNCEMENT_DELAY_MS);
  }

  function pressResultRow(index: number, modifiers: Modifiers) {
    changeSelection(pressRow(selection, session.sortedRows, index, modifiers), modifiers.shift);
  }

  function releaseResultRow(index: number, modifiers: Modifiers, pressedOnSelected: boolean) {
    changeSelection(releaseRow(selection, session.sortedRows, index, modifiers, pressedOnSelected));
  }

  function moveCurrentRow(targetIndex: number, modifiers: Modifiers) {
    changeSelection(moveCurrent(selection, session.sortedRows, targetIndex, modifiers), modifiers.shift);
  }

  function toggleCurrentRow() {
    changeSelection(toggleCurrent(selection), true);
  }

  function selectAllRows() {
    changeSelection(selectAll(selection, session.sortedRows), true);
  }

  /** Takes rows whose files are gone out of the results, and out of the selection. */
  function removeVanishedRows(paths: string[]) {
    if (paths.length === 0) return;
    session.removeRows(paths);
    changeSelection(pruneSelection(selection, session.rows));
  }

  /** Removes the rows of those `candidates` whose files the backend confirms are gone, and returns them. */
  const removeGone = (candidates: string[]) => removeGoneRows(candidates, existingPaths, removeVanishedRows);

  /** Explorer can finish a dragged move after the drag has returned, so the rows are checked once more after this. */
  const AFTER_DRAG_RECHECK_MS = 1500;

  /**
   * Drags files out of the window. A drop target may have moved them, and an optimized move on one
   * volume reports no effect, so the rows whose files are gone are removed afterwards whatever the
   * effect says, and once more a little later. A refused or failed drag only says why.
   */
  async function dragFilesOut(paths: string[]) {
    try {
      const outcome = await startFileDrag(paths);
      if (!outcome.started) {
        say('info', outcome.reason ?? 'The drag did not start.');
        return;
      }
    } catch (error) {
      say('error', String(error));
      return;
    }
    await removeGone(paths);
    setTimeout(() => void removeGone(paths), AFTER_DRAG_RECHECK_MS);
  }

  const canExport = $derived(!session.running && session.rows.length > 0);

  $effect(() => applyTheme(preferences.theme, preferences.palette, preferences.highlightColor));

  let draggingOver = $state(false);

  function useFolder(folder: string) {
    preferences.criteria.lookIn = folder;
    preferences.save();
    searchBar.focusText();
  }

  function recallSearch(criteria: Criteria) {
    preferences.applyCriteria(criteria);
    preferences.save();
  }

  /** Fills the fields with an example from the welcome. The user presses Search once they have seen it. */
  function useRecipe(recipe: Recipe) {
    recallSearch(applyRecipe($state.snapshot(preferences.criteria), recipe));
    searchBar.focusText();
  }

  onMount(() => {
    searchBar.focusText();
    // Dropping a folder (or a file, which stands for its folder) from Explorer sets Look in.
    const stopWatching = watchFolderDrops(
      (folders) => (preferences.criteria.lookIn = folders.join('; ')),
      (over) => (draggingOver = over),
    );
    // "Search with Spelunker" in Explorer's menu starts the app (or reaches the running one) with a folder.
    void takeLaunchFolder().then((folder) => folder && useFolder(folder));
    const stopWatchingLaunches = watchOpenFolder(useFolder);
    // The column's height does not depend on the map, so watching it to decide whether the map fits cannot loop.
    const leftColumnObserver = new ResizeObserver(() => (leftColumnHeight = leftColumn?.clientHeight ?? 0));
    if (leftColumn) leftColumnObserver.observe(leftColumn);
    return () => {
      void stopWatching.then((stop) => stop());
      void stopWatchingLaunches.then((stop) => stop());
      leftColumnObserver.disconnect();
      treemap.dispose();
    };
  });

  function startSearch() {
    if (session.running || !canSearch) return;
    // Relative dates such as "last 7 days" are resolved here, at the moment the search starts.
    const request = buildSearchRequest($state.snapshot(preferences.criteria), Date.now());
    if (!request.ok) return;
    preferences.rememberFolders();
    preferences.save();
    changeSelection(EMPTY_SELECTION);
    searchedCriteria = $state.snapshot(preferences.criteria);
    session.start(request.value);
  }

  function say(kind: 'info' | 'error', text: string) {
    notice = { kind, text };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), kind === 'error' ? 9000 : 4000);
  }

  /** Which pane keyboard focus is in, or null when it is in none of them. */
  function currentPane(): PaneId | null {
    const pane = document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane');
    return PANE_ORDER.find((id) => id === pane) ?? null;
  }

  function focusPane(pane: PaneId) {
    if (pane === 'search') searchBar.focusText();
    else if (pane === 'preview') previewPane?.focus();
    else if (pane === 'map') resultsMap?.focus();
    else document.querySelector<HTMLElement>('[data-pane="results"] [role="grid"]')?.focus();
  }

  function onWindowKeydown(event: KeyboardEvent) {
    // Modal dialogs own the keyboard, so shortcuts must not move focus to the page behind them.
    if (session.stoppingNoticeVisible || settingsOpen) return;
    if (event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      void togglePreview();
      return;
    }
    if (event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      toggleMap();
      return;
    }
    if (event.ctrlKey && !event.shiftKey && !event.altKey) {
      const actions: Record<string, () => void> = {
        l: () => searchBar.focusLookIn(),
        n: () => searchBar.focusName(),
        t: () => searchBar.focusText(),
        f: () => searchBar.focusText(),
        e: () => searchBar.showExport(),
        ',': () => (settingsOpen = true),
      };
      const action = actions[event.key.toLowerCase()];
      if (action) {
        event.preventDefault();
        action();
      }
      return;
    }
    if (event.key === 'Escape' && session.running) {
      event.preventDefault();
      session.stop();
    } else if (event.key === 'F3') {
      event.preventDefault();
      previewPane?.stepHit(event.shiftKey ? -1 : 1);
    } else if (event.key === 'F6') {
      event.preventDefault();
      focusPane(nextPane(currentPane(), event.shiftKey ? -1 : 1, shownPanes));
    } else if (event.key === 'F1') {
      event.preventDefault();
      searchBar.showShortcuts();
    }
  }

  /**
   * Shows or hides the preview. Focus only moves when it was inside the preview (or on the strip that
   * brings it back), so a shortcut pressed elsewhere never steals it.
   */
  async function togglePreview() {
    const focusWasInPreview = currentPane() === 'preview';
    preferences.previewCollapsed = !preferences.previewCollapsed;
    preferences.save();
    await tick();
    if (focusWasInPreview) focusPane(preferences.previewCollapsed ? 'results' : 'preview');
  }

  /**
   * Shows or hides the map. Like the Map button, it does nothing while the window is too short for
   * the map, so the saved choice never flips without a visible change.
   */
  function toggleMap() {
    if (mapTooShort) return;
    preferences.mapCollapsed = !preferences.mapCollapsed;
    preferences.save();
  }

  // However the map goes away (its toggle, a cleared search, a window too short), focus that was in
  // it moves to the results. This runs before the map leaves the page, while focus can still be seen in it.
  $effect.pre(() => {
    if (mapShown) return;
    untrack(() => {
      if (currentPane() === 'map') void tick().then(() => focusPane('results'));
    });
  });

  const copy = (text: string) => copyText(text).catch((error) => say('error', `Could not copy: ${error}`));

  /** The lines of a file that matched the search, one per line, for pasting somewhere. */
  async function copyMatchingLines(row: DisplayRow) {
    const query = session.query;
    if (!query || query.text === '') return;
    try {
      const found = await previewFile(row.path, query, 0, session.includeBinary);
      await copy(found.filter((line) => line.isMatch).map((line) => line.text).join('\r\n'));
    } catch (error) {
      say('error', `Could not read the matching lines: ${error}`);
    }
  }

  /**
   * The entries Spelunker adds above Windows' own menu. Several rows share only the copy entries,
   * which copy `liveRows()` when chosen, so rows dropped while the menu was open are left out.
   */
  function extraActions(rows: DisplayRow[], liveRows: () => DisplayRow[] = () => rows): { label: string; run: () => void }[] {
    if (rows.length > 1) {
      return [
        { label: 'Copy paths', run: () => void copy(liveRows().map((row) => row.path).join('\r\n')) },
        { label: 'Copy names', run: () => void copy(liveRows().map((row) => row.name).join('\r\n')) },
      ];
    }
    const row = rows[0];
    const actions = [
      { label: 'Open containing folder', run: () => void revealPath(row.path) },
      { label: 'Copy path', run: () => void copy(row.path) },
      { label: 'Copy name', run: () => void copy(row.name) },
    ];
    if (row.hits > 0) actions.push({ label: 'Copy matching lines', run: () => void copyMatchingLines(row) });
    return actions;
  }

  /**
   * The menu for `row`, which covers the whole selection when the row is part of it. `origin` is the
   * pane the menu was asked for from, which gets focus back when the menu closes.
   */
  async function showRowMenu(row: DisplayRow, x: number, y: number, origin: PaneId = 'results') {
    const rows = menuRowsFor(selection, session.sortedRows, row);
    if (!hasShellMenu) {
      menu = { rows, x, y };
      return;
    }
    let liveRows = rows;
    const actions = extraActions(rows, () => liveRows);
    const paths = rows.map((chosen) => chosen.path);
    try {
      const result = await showShellMenu(paths, x, y, actions.map((action) => action.label));
      // The shell left these out of the menu. Some are gone, and others it could not handle (a long
      // path, an offline share), which keep their rows.
      const skipped = new Set(result.skipped);
      if (skipped.size > 0) {
        const gone = new Set(await removeGone(result.skipped));
        liveRows = rows.filter((chosen) => !gone.has(chosen.path));
        const notice = skippedNotice(gone.size, skipped.size - gone.size);
        if (notice) say('info', notice);
      }
      if (result.extra !== null) actions[result.extra]?.run();
      // A shell command such as Delete or Rename can remove files, so drop the rows whose files are gone.
      if (result.ranShellCommand) await removeGone(paths.filter((path) => !skipped.has(path)));
    } catch (error) {
      // The menu fails when none of the files exist, and the command can fail part way. Either way the
      // rows of files that are gone would repeat the error on every later right-click, so drop them.
      const gone = await removeGone(paths);
      if (gone.length === paths.length) say('info', goneNotice(gone.length));
      else say('error', String(error));
    }
    // The system menu takes focus with it. Put it back where the menu came from so the keyboard keeps
    // working. The map may have gone meanwhile (its last file removed), and then the results take it.
    await tick();
    if (document.activeElement === document.body) focusPane(shownPanes.includes(origin) ? origin : 'results');
  }

  function openAtLine(path: string, line: number) {
    openInEditor(editorTemplate(preferences.editor), path, line).catch((error) => say('error', String(error)));
  }

  async function exportResults(format: ExportFormat) {
    const rows = session.sortedRows;
    try {
      const saved = await saveTextFile(exportFileName(format, new Date()), format, formatResults(rows, format));
      if (saved) say('info', `Saved ${rows.length.toLocaleString('en-US')} results`);
    } catch (error) {
      say('error', `Could not save the file: ${error}`);
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet welcome()}
  <WelcomePanel
    recentFolders={preferences.recentFolders}
    savedSearches={savedSearches.searches}
    onRecipe={useRecipe}
    onFolder={useFolder}
    onSavedSearch={(search) => recallSearch(search.criteria)}
  />
{/snippet}

<div class="app">
  <SearchBar
    bind:this={searchBar}
    {preferences}
    savedSearches={savedSearches.searches}
    savedNotice={savedSearches.notice}
    running={session.running}
    stopping={session.stopping}
    failure={(preferences.filtersOpen ? null : filterError) ?? session.failure}
    contentError={contentValidator.error}
    nameError={nameValidator.error}
    {canSearch}
    {canExport}
    onSearch={startSearch}
    onStop={() => session.stop()}
    onSaveSearch={(name) => savedSearches.save(name, $state.snapshot(preferences.criteria))}
    onRecallSearch={recallSearch}
    onDeleteSearch={(name) => savedSearches.remove(name)}
    onExport={exportResults}
    onOpenSettings={() => (settingsOpen = true)}
  />

  <main
    bind:this={mainElement}
    style:--preview-width={previewTrack}
    style:grid-template-columns={preferences.previewCollapsed ? 'minmax(0, 1fr) 36px' : `minmax(0, 1fr) ${previewTrack}`}
  >
    <div
      class="left"
      bind:this={leftColumn}
      style:grid-template-rows={mapShown ? `minmax(0, 1fr) ${mapTrack}` : 'minmax(0, 1fr)'}
    >
      <section class="results" data-pane="results" aria-label="Results">
        <ResultsList
          rows={session.sortedRows}
          {selection}
          {revealRequest}
          sortColumn={session.sortColumn}
          sortDirection={session.sortDirection}
          running={session.running}
          empty={emptyState}
          welcome={idle ? welcome : undefined}
          layout={preferences.columns}
          onLayout={(layout) => {
            preferences.columns = layout;
            preferences.saveSoon();
          }}
          onSort={(column) => session.toggleSort(column)}
          onPress={(_, index, modifiers) => pressResultRow(index, modifiers)}
          onRelease={(_, index, modifiers, pressedOnSelected) => releaseResultRow(index, modifiers, pressedOnSelected)}
          onMove={moveCurrentRow}
          onToggleCurrent={toggleCurrentRow}
          onSelectAll={selectAllRows}
          onDragOut={dragFilesOut}
          onOpen={(row) => openPath(row.path)}
          onContextMenu={showRowMenu}
        />
      </section>
      <!-- Mounted only while shown: a hidden map does no work, and each mount needs fresh canvases. -->
      {#if mapShown}
        <!-- The splitter belongs to the map's pane, so focus on it counts as focus in the map. -->
        <div class="map-panel" data-pane="map">
          <HorizontalSplitter
            measure={() => ({
              map: leftColumn?.querySelector('.map-panel')?.getBoundingClientRect().height ?? 0,
              container: leftColumn?.clientHeight ?? 0,
            })}
            onResize={(height) => (preferences.mapHeight = height)}
            onCommit={() => preferences.save()}
            onReset={() => {
              preferences.mapHeight = null;
              preferences.save();
            }}
            onToggle={toggleMap}
          />
          <ResultsMap
            bind:this={resultsMap}
            client={treemap}
            {session}
            paletteId={preferences.palette}
            themeVersion={`${preferences.theme}|${preferences.palette}|${preferences.highlightColor}`}
            metric={effectiveMetric}
            colorMode={preferences.mapColor}
            shading={preferences.mapShading}
            {canUseMatches}
            {selectedPath}
            onMetric={(metric) => {
              preferences.mapMetric = metric;
              preferences.save();
            }}
            onColorMode={(mode) => {
              preferences.mapColor = mode;
              preferences.save();
            }}
            onSelect={(row) => {
              changeSelection(selectOnly(row.path));
              revealRequest = { path: row.path, token: ++revealToken };
            }}
            onOpen={(row) => openPath(row.path)}
            onContextMenu={(row, x, y) => showRowMenu(row, x, y, 'map')}
            onCollapse={toggleMap}
          />
        </div>
      {/if}
    </div>
    {#if preferences.previewCollapsed}
      <div class="rail" data-pane="preview">
        <button
          type="button"
          class="tool icon"
          aria-label="Show the preview"
          title={withShortcut('Show the preview', 'Ctrl+Shift+P')}
          onclick={togglePreview}
        >
          <Icon name="chevron-left" />
        </button>
        <span class="rail-label" aria-hidden="true">Preview</span>
      </div>
    {:else}
      <Splitter
        measure={() => ({
          preview: mainElement?.querySelector('aside.preview')?.getBoundingClientRect().width ?? 0,
          container: mainElement?.clientWidth ?? 0,
        })}
        onResize={(width) => (preferences.previewWidth = width)}
        onCommit={() => preferences.save()}
        onReset={() => {
          preferences.previewWidth = null;
          preferences.save();
        }}
        onToggle={togglePreview}
      />
    <PreviewPane
      bind:this={previewPane}
      file={selectedRow}
      query={session.query}
      includeBinary={session.includeBinary}
      contextLines={preferences.contextLines}
      onContextLinesChange={(value) => {
        preferences.contextLines = value;
        preferences.save();
      }}
      onOpenInEditor={openAtLine}
      onOpen={(row) => openPath(row.path)}
      onReveal={(row) => revealPath(row.path)}
      onCollapse={togglePreview}
    />
    {/if}
  </main>

  <StatusBar
    running={session.running}
    stopping={session.stopping}
    filesScanned={session.filesScanned}
    matches={session.rows.length}
    elapsedMs={session.elapsedMs}
    errors={session.errors}
    summary={session.summary}
    selection={selectionText}
    mapOn={!preferences.mapCollapsed}
    {mapTooShort}
    onToggleMap={toggleMap}
  />
</div>

<!-- Screen readers only announce text that changes inside a live region that was already there, so
     the notice is spoken through these two, and the visible toast below is hidden from them. -->
<div class="sr-only" role="status" aria-live="polite">{notice?.kind === 'info' ? notice.text : ''}</div>
<div class="sr-only" role="alert">{notice?.kind === 'error' ? notice.text : ''}</div>

{#if notice}
  <div class="notice" class:error={notice.kind === 'error'} aria-hidden="true">
    {notice.text}
    <button type="button" aria-label="Dismiss" tabindex="-1" onclick={() => (notice = null)}>&times;</button>
  </div>
{/if}

{#if draggingOver}
  <div class="drop-hint" aria-hidden="true"><span>Drop a folder to search it</span></div>
{/if}

<div class="sr-only" id="search-announcement" role="status" aria-live="polite">{announcement}</div>
<!-- Separate from the search's region, which is derived from the search state alone. -->
<div class="sr-only" id="selection-announcement" role="status" aria-live="polite">{selectionAnnouncementText}</div>

<StoppingDialog visible={session.stoppingNoticeVisible} onHide={() => session.hideStoppingNotice()} />

{#if settingsOpen}
  <SettingsDialog {preferences} onClose={() => (settingsOpen = false)} />
{/if}

{#if menu}
  {@const rows = menu.rows}
  {@const ownEntries = extraActions(rows).map((action) => ({ label: action.label, action: action.run }))}
  <!-- Opening is offered for one file only. Several files share just the copy entries. -->
  <ContextMenu
    x={menu.x}
    y={menu.y}
    onClose={() => (menu = null)}
    items={rows.length === 1 ? [{ label: 'Open', action: () => openPath(rows[0].path) }, ...ownEntries] : ownEntries}
  />
{/if}

<style>
  .app {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr auto;
  }
  main {
    position: relative;
    display: grid;
    /* Without a bounded row, a long list in the preview would stretch both panes over the status bar. */
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
  }
  /* The strip that stands in for a hidden preview and brings it back. */
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    background: var(--header-bg);
    border-left: 1px solid var(--border);
  }
  .rail-label {
    writing-mode: vertical-rl;
    color: var(--text-muted);
    font-size: var(--text-small);
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  /* The results grid, with the map below it when it is shown. Its rows come from the markup. */
  .left {
    display: grid;
    min-width: 0;
    min-height: 0;
  }
  .results {
    min-width: 0;
    min-height: 0;
  }
  /* A positioned box, since the splitter sits in its top edge. */
  .map-panel {
    position: relative;
    min-width: 0;
    min-height: 0;
    border-top: 1px solid var(--border);
  }
  .drop-hint {
    position: fixed;
    inset: 8px;
    z-index: 25;
    display: grid;
    place-items: center;
    border: 2px dashed var(--accent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    pointer-events: none;
  }
  .drop-hint span {
    padding: 8px 16px;
    border-radius: var(--radius);
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    font-weight: 600;
  }
  .notice {
    position: fixed;
    left: 50%;
    bottom: 40px;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(640px, calc(100vw - 32px));
    padding: 8px 8px 8px 14px;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .notice.error {
    border-color: var(--danger);
    color: var(--danger);
    font-weight: 600;
  }
  .notice button {
    border: 0;
    background: none;
    color: inherit;
    font-size: 18px;
    line-height: 1;
    padding: 0 6px;
  }
</style>

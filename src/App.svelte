<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    copyText,
    hasShellMenu,
    openInEditor,
    openPath,
    pathExists,
    previewFile,
    revealPath,
    saveTextFile,
    showShellMenu,
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
  import Icon from './lib/Icon.svelte';
  import { PANE_ORDER, nextPane, type PaneId } from './lib/paneCycle';
  import { applyTheme, Preferences } from './lib/preferences.svelte';
  import { findRowIndex } from './lib/rowLookup';
  import PreviewPane from './lib/PreviewPane.svelte';
  import { applyRecipe, type Recipe } from './lib/recipes';
  import { buildSearchRequest, firstFilterError } from './lib/request';
  import ResultsList from './lib/ResultsList.svelte';
  import WelcomePanel from './lib/WelcomePanel.svelte';
  import SearchBar from './lib/SearchBar.svelte';
  import { SavedSearchStore } from './lib/savedSearchStore.svelte';
  import { describeSearchState } from './lib/searchAnnouncement';
  import { SearchSession } from './lib/search.svelte';
  import SettingsDialog from './lib/SettingsDialog.svelte';
  import { withShortcut } from './lib/shortcuts';
  import Splitter from './lib/Splitter.svelte';
  import StatusBar from './lib/StatusBar.svelte';
  import StoppingDialog from './lib/StoppingDialog.svelte';
  import type { DisplayRow } from './lib/types';
  import { createValidator } from './lib/validation.svelte';

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
  const shownPanes = $derived<PaneId[]>(preferences.previewCollapsed ? ['search', 'results'] : PANE_ORDER);
  let selectedPath = $state<string | null>(null);
  /** The criteria of the search whose results are on screen, used to explain an empty list. */
  let searchedCriteria = $state.raw<Criteria | null>(null);
  /** The app's own file menu, used only where Windows' menu is unavailable (a plain browser). */
  let menu = $state<{ row: DisplayRow; x: number; y: number } | null>(null);
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
    return () => {
      void stopWatching.then((stop) => stop());
      void stopWatchingLaunches.then((stop) => stop());
    };
  });

  function startSearch() {
    if (session.running || !canSearch) return;
    // Relative dates such as "last 7 days" are resolved here, at the moment the search starts.
    const request = buildSearchRequest($state.snapshot(preferences.criteria), Date.now());
    if (!request.ok) return;
    preferences.rememberFolders();
    preferences.save();
    selectedPath = null;
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
    return pane === 'search' || pane === 'results' || pane === 'preview' ? pane : null;
  }

  function focusPane(pane: PaneId) {
    if (pane === 'search') searchBar.focusText();
    else if (pane === 'preview') previewPane?.focus();
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

  /** The entries Spelunker adds above Windows' own menu. */
  function extraActions(row: DisplayRow): { label: string; run: () => void }[] {
    const actions = [
      { label: 'Open containing folder', run: () => void revealPath(row.path) },
      { label: 'Copy path', run: () => void copy(row.path) },
      { label: 'Copy name', run: () => void copy(row.name) },
    ];
    if (row.hits > 0) actions.push({ label: 'Copy matching lines', run: () => void copyMatchingLines(row) });
    return actions;
  }

  async function showRowMenu(row: DisplayRow, x: number, y: number) {
    if (!hasShellMenu) {
      menu = { row, x, y };
      return;
    }
    const actions = extraActions(row);
    try {
      const result = await showShellMenu(row.path, x, y, actions.map((action) => action.label));
      if (result.extra !== null) actions[result.extra]?.run();
      // A shell command such as Delete or Rename can remove the file, so drop its row if it is gone.
      if (result.ranShellCommand && !(await pathExists(row.path))) session.removeRow(row.path);
    } catch (error) {
      say('error', String(error));
    }
    // The system menu takes focus with it. Put it back on the results so the keyboard keeps working.
    await tick();
    if (document.activeElement === document.body) focusPane('results');
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
    <section class="results" data-pane="results" aria-label="Results">
      <ResultsList
        rows={session.sortedRows}
        {selectedPath}
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
        onSelect={(row) => (selectedPath = row.path)}
        onOpen={(row) => openPath(row.path)}
        onContextMenu={showRowMenu}
      />
    </section>
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

<StoppingDialog visible={session.stoppingNoticeVisible} onHide={() => session.hideStoppingNotice()} />

{#if settingsOpen}
  <SettingsDialog {preferences} onClose={() => (settingsOpen = false)} />
{/if}

{#if menu}
  {@const row = menu.row}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    onClose={() => (menu = null)}
    items={[{ label: 'Open', action: () => openPath(row.path) }, ...extraActions(row).map((action) => ({ label: action.label, action: action.run }))]}
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
  .results {
    min-width: 0;
    min-height: 0;
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

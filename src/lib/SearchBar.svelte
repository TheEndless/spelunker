<script lang="ts">
  import { tick } from 'svelte';
  import { pickFolder } from './backend';
  import { countActiveFilters, type Criteria } from './criteria';
  import ExportMenu from './ExportMenu.svelte';
  import type { ExportFormat } from './exportResults';
  import FilterChips from './FilterChips.svelte';
  import FiltersPanel from './FiltersPanel.svelte';
  import { clearAllFilters, clearFilter, summarizeFilters, type FilterId } from './filterSummary';
  import FolderCombo from './FolderCombo.svelte';
  import { ALL_DRIVES_LABEL, isAllDrives, toggleAllDrives } from './folderCombo';
  import Icon from './Icon.svelte';
  import type { Preferences } from './preferences.svelte';
  import SavedSearchesMenu from './SavedSearchesMenu.svelte';
  import ShortcutsPopover from './ShortcutsPopover.svelte';
  import { withShortcut } from './shortcuts';
  import ThemeMenu from './ThemeMenu.svelte';
  import type { SavedSearch } from './savedSearches';

  interface Props {
    preferences: Preferences;
    savedSearches: SavedSearch[];
    savedNotice: string | null;
    running: boolean;
    /** Stop was requested and is still being carried out. */
    stopping: boolean;
    /** Why a search cannot start or just failed, shown inline. Never a popup. */
    failure: string | null;
    contentError: string | null;
    nameError: string | null;
    canSearch: boolean;
    /** There are results to export. */
    canExport: boolean;
    onSearch: () => void;
    onStop: () => void;
    onSaveSearch: (name: string) => void;
    onRecallSearch: (criteria: Criteria) => void;
    onDeleteSearch: (name: string) => void;
    onExport: (format: ExportFormat) => void;
    onOpenSettings: () => void;
  }

  let {
    preferences,
    savedSearches,
    savedNotice,
    running,
    stopping,
    failure,
    contentError,
    nameError,
    canSearch,
    canExport,
    onSearch,
    onStop,
    onSaveSearch,
    onRecallSearch,
    onDeleteSearch,
    onExport,
    onOpenSettings,
  }: Props = $props();

  /** Fixed choices at the top of the Look in list. The backend expands this to every local drive. */
  const PLACES = [ALL_DRIVES_LABEL];


  const criteria = $derived(preferences.criteria);

  /** What Look in held before "all drives" was switched on, so switching it off puts it back. */
  let folderBeforeAllDrives = '';
  const allDrivesOn = $derived(isAllDrives(criteria.lookIn));

  function switchAllDrives() {
    const next = toggleAllDrives(criteria.lookIn, folderBeforeAllDrives);
    criteria.lookIn = next.value;
    folderBeforeAllDrives = next.remembered;
  }
  const filterCount = $derived(countActiveFilters(criteria));

  const filterItems = $derived(summarizeFilters(criteria));

  let nameInput: HTMLInputElement;
  let textInput: HTMLInputElement;
  let lookInCombo: FolderCombo;
  let shortcutsPopover: ShortcutsPopover;
  let exportMenu: ExportMenu;
  let filtersToggle: HTMLButtonElement;

  export function focusName() {
    nameInput.focus();
    nameInput.select();
  }
  export function focusText() {
    textInput.focus();
    textInput.select();
  }
  export function focusLookIn() {
    lookInCombo.focus();
    lookInCombo.select();
  }
  export function showShortcuts() {
    shortcutsPopover.show();
  }
  export function showExport() {
    exportMenu.show();
  }

  function submitOnEnter(event: KeyboardEvent) {
    if (event.key === 'Enter' && !running && canSearch) {
      event.preventDefault();
      onSearch();
    }
  }

  async function browse() {
    const folder = await pickFolder();
    if (folder) criteria.lookIn = folder;
  }

  function removeRecentFolder(folder: string) {
    preferences.recentFolders = preferences.recentFolders.filter((recent) => recent !== folder);
    preferences.save();
  }

  /** Removing a chip destroys the button that had focus, so focus moves to a neighbour that still exists. */
  async function keepFocusAfterRemoving(update: () => void) {
    update();
    await tick();
    const remaining = document.querySelector<HTMLElement>('ul[aria-label="Active filters"] button');
    (remaining ?? filtersToggle).focus();
  }

  function removeFilter(id: FilterId) {
    void keepFocusAfterRemoving(() => (preferences.criteria = clearFilter(preferences.criteria, id)));
  }

  function removeAllFilters() {
    void keepFocusAfterRemoving(() => (preferences.criteria = clearAllFilters(preferences.criteria)));
  }

  function toggleFilters() {
    preferences.filtersOpen = !preferences.filtersOpen;
    preferences.save();
  }
</script>

<div class="top" role="search" aria-label="Search" data-pane="search">
<header class="bar">
  <!-- The two questions a search is made of, in reading order, and one lamp to switch on. -->
  <div class="brief">
    <section class="card where" aria-labelledby="where-heading">
      <h2 class="eyebrow" id="where-heading">Where to look</h2>
      <div class="group">
        <label class="affix" id="lookin-label" for="lookin-input">Look in</label>
        <FolderCombo
          bind:this={lookInCombo}
          bind:value={criteria.lookIn}
          recents={preferences.recentFolders}
          places={PLACES}
          onRemoveRecent={removeRecentFolder}
          onSubmit={() => {
            if (!running && canSearch) onSearch();
          }}
          placeholder="Folder; another folder; or This PC"
          inputId="lookin-input"
          labelledby="lookin-label"
          title={withShortcut('Look in', 'Ctrl+L')}
        />
        <button type="button" class="chip icon" aria-label="Browse for a folder" title="Browse for a folder" onclick={browse}>
          <Icon name="folder" />
        </button>
        <button
          type="button"
          class="chip icon"
          class:on={allDrivesOn}
          aria-pressed={allDrivesOn}
          aria-label="Search all drives"
          title={allDrivesOn ? 'Searching every drive on this PC. Press to go back to your folders.' : 'Search every drive on this PC'}
          onclick={switchAllDrives}
        >
          <Icon name="computer" />
        </button>
      </div>
      <div class="switches" role="group" aria-label="Scope">
        <label title="Look inside the folders below the chosen one"
          ><input type="checkbox" bind:checked={criteria.subfolders} /> Subfolders</label
        >
        <label title="Files and folders marked hidden or system"
          ><input type="checkbox" bind:checked={criteria.includeHidden} /> Hidden</label
        >
        <label title="Search inside folders reached through junctions and symbolic links. Loops are skipped and reported."
          ><input type="checkbox" bind:checked={criteria.followLinks} /> Links</label
        >
      </div>
    </section>

    <section class="card what" aria-labelledby="what-heading">
      <h2 class="eyebrow" id="what-heading">What to find</h2>
      <div class="fields">
        <div class="group name">
          <label class="affix" for="name-input">{criteria.nameIsRegex ? 'Name regex' : 'Name'}</label>
          <input
            type="text"
            id="name-input"
            bind:this={nameInput}
            bind:value={criteria.namePatterns}
            onkeydown={submitOnEnter}
            title={withShortcut('Name', 'Ctrl+N')}
            placeholder={criteria.nameIsRegex ? String.raw`^invoice_\d+\.pdf$` : '*.log; *.txt; -*.min.js'}
            aria-invalid={criteria.nameIsRegex && nameError !== null}
            spellcheck="false"
          />
        </div>
        <div class="group text">
          <label class="affix" for="text-input">Containing</label>
          <input
            type="text"
            id="text-input"
            bind:this={textInput}
            bind:value={criteria.text}
            onkeydown={submitOnEnter}
            title={withShortcut('Containing text', 'Ctrl+T or Ctrl+F')}
            placeholder="Text to find"
            aria-invalid={contentError !== null}
            spellcheck="false"
          />
          <button
            type="button"
            class="chip"
            class:on={criteria.matchCase}
            aria-pressed={criteria.matchCase}
            title="Match case"
            onclick={() => (criteria.matchCase = !criteria.matchCase)}>Aa</button
          >
          <button
            type="button"
            class="chip"
            class:on={criteria.wholeWord}
            aria-pressed={criteria.wholeWord}
            title="Whole word"
            onclick={() => (criteria.wholeWord = !criteria.wholeWord)}>ab</button
          >
          <button
            type="button"
            class="chip mono"
            class:on={criteria.regex}
            aria-pressed={criteria.regex}
            title="Regular expression"
            onclick={() => (criteria.regex = !criteria.regex)}>.*</button
          >
        </div>
      </div>
      {#if criteria.nameIsRegex && nameError}<small class="problem" role="alert">{nameError}</small>{/if}
      {#if contentError}<small class="problem" role="alert">{contentError}</small>{/if}
      <div class="switches">
        <button
          type="button"
          class="tool"
          bind:this={filtersToggle}
          aria-expanded={preferences.filtersOpen}
          aria-controls="filters-panel"
          onclick={toggleFilters}
        >
          <Icon name="filter" />
          Filters
          {#if filterCount > 0}<span class="badge" aria-label="{filterCount} active">{filterCount}</span>{/if}
          <Icon name={preferences.filtersOpen ? 'chevron-up' : 'chevron-down'} size={12} />
        </button>
        {#if filterItems.length > 0 && !preferences.filtersOpen}
          <FilterChips items={filterItems} onRemove={removeFilter} onClearAll={removeAllFilters} />
        {/if}
        {#if failure}
          <span class="problem" role="alert">{failure}</span>
        {/if}
        <label class="binary" title="Also search inside binary files, not only text"
          ><input type="checkbox" bind:checked={criteria.includeBinary} /> Binary files</label
        >
      </div>
      {#if preferences.filtersOpen}
        <div id="filters-panel">
          <FiltersPanel {criteria} />
        </div>
      {/if}
    </section>

    <!-- One button for both, so keyboard focus stays on it when a search starts and ends. It uses
         aria-disabled (not disabled) so it keeps focus while a stop is in progress. -->
    <div class="go-slot">
      <button
        type="button"
        class="go"
        class:stop={running}
        aria-disabled={running ? stopping : !canSearch}
        title={running ? withShortcut('Stop the search', 'Esc') : withShortcut('Search', 'Enter')}
        onclick={() => {
          if (running) {
            if (!stopping) onStop();
          } else if (canSearch) {
            onSearch();
          }
        }}
      >
        <Icon name={running ? 'stop' : 'search'} size={20} />
        <span>{running ? (stopping ? 'Stopping...' : 'Stop') : 'Search'}</span>
      </button>
    </div>
  </div>

  <!-- Things used between searches, not for every search, sit in the quiet corner. -->
  <div class="tools">
    <SavedSearchesMenu
      searches={savedSearches}
      notice={savedNotice}
      onRecall={(search) => onRecallSearch(search.criteria)}
      onSave={onSaveSearch}
      onDelete={onDeleteSearch}
    />
    <ExportMenu bind:this={exportMenu} disabled={!canExport} {onExport} />
    <span class="divider" aria-hidden="true"></span>
    <button type="button" class="tool icon" aria-label="Settings" title={withShortcut('Settings', 'Ctrl+,')} onclick={onOpenSettings}>
      <Icon name="settings" />
    </button>
    <ThemeMenu {preferences} />
    <ShortcutsPopover bind:this={shortcutsPopover} />
  </div>
</header>

<!-- A lamp beam that sweeps while a search runs. Purely visual, so hidden from assistive tech. -->
<div class="beam" class:active={running} class:stopping aria-hidden="true"></div>
</div>

<style>
  .top {
    position: relative;
  }

  .bar {
    position: relative;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: 8px 14px 10px;
  }

  /* Cards keep their own height, so an open Filters panel grows only the card it belongs to. */
  .brief {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .card {
    display: grid;
    gap: 6px;
    align-content: start;
    min-width: 0;
    padding: 4px 10px 8px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .where {
    flex: 1 1 34%;
  }
  .what {
    flex: 1.8 1 52%;
  }

  .eyebrow {
    display: flex;
    align-items: center;
    height: 26px;
    margin: 0;
    font-size: var(--text-small);
    font-weight: 600;
    color: var(--text-muted);
  }

  .fields {
    display: flex;
    gap: 8px;
    min-width: 0;
  }
  .fields .name {
    flex: 1 1 36%;
  }
  .fields .text {
    flex: 1.6 1 64%;
  }

  /* A field group: a leading label, the box, and the toggles that belong to it, in one frame. */
  .group {
    display: flex;
    align-items: stretch;
    height: var(--control-height);
    min-width: 0;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    transition: border-color 120ms;
  }
  .group:hover {
    border-color: var(--text-muted);
  }
  .group:focus-within {
    border-color: var(--focus-ring);
    box-shadow: 0 0 0 1px var(--focus-ring);
  }
  .group:has([aria-invalid='true']) {
    border-color: var(--danger);
  }
  .affix {
    display: flex;
    align-items: center;
    flex: none;
    padding: 0 8px;
    border-right: 1px solid var(--border);
    border-radius: 5px 0 0 5px;
    background: var(--header-bg);
    color: var(--text-muted);
    font-size: var(--text-small);
    font-weight: 600;
    white-space: nowrap;
    cursor: text;
  }
  .group :global(input[type='text']) {
    flex: 1;
    height: 100%;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .group :global(input[type='text']:focus-visible) {
    outline: none;
  }
  .group :global(.combo) {
    display: flex;
  }

  .chip {
    flex: none;
    min-width: 30px;
    padding: 0 7px;
    border: 0;
    border-left: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-small);
    font-weight: 600;
    transition: color 120ms, background-color 120ms;
  }
  .chip:last-child {
    border-radius: 0 5px 5px 0;
  }
  .chip.icon {
    display: inline-grid;
    place-items: center;
    padding: 0 8px;
  }
  .chip:hover {
    color: var(--text);
    background: var(--row-hover);
  }
  .chip.on {
    background: var(--accent);
    border-left-color: var(--accent);
    color: var(--on-accent);
  }
  .chip:focus-visible {
    outline-offset: -2px;
  }

  .switches {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 14px;
    min-height: 24px;
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .switches label {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    white-space: nowrap;
    cursor: pointer;
  }
  .switches label:hover {
    color: var(--text);
  }
  .switches .tool {
    height: 24px;
  }
  .binary {
    margin-left: auto;
  }

  /* The lamp. It spans the two field rows so it is the largest and brightest thing on screen. */
  .go-slot {
    display: flex;
    flex: none;
    align-items: flex-start;
    padding-top: calc(4px + 26px + 6px);
  }
  .go {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 4px;
    width: 96px;
    /* The field row plus the switches row, so the button spans both and no more. */
    height: calc(var(--control-height) + 6px + 24px);
    border: 0;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    transition: background-color 120ms;
  }
  .go:hover:not([aria-disabled='true']) {
    background: var(--accent-hover);
  }
  .go[aria-disabled='true'] {
    background: var(--disabled-bg);
    color: var(--disabled-text);
    cursor: not-allowed;
  }
  .go.stop {
    background: var(--danger);
    color: var(--surface);
  }
  .go.stop[aria-disabled='true'] {
    background: var(--disabled-bg);
    color: var(--disabled-text);
  }

  .tools {
    position: absolute;
    top: 12px;
    right: 24px;
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .divider {
    width: 1px;
    height: 18px;
    background: var(--border);
  }

  .problem {
    color: var(--danger);
    font-weight: 600;
    font-size: var(--text-small);
  }

  .badge {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: var(--text-small);
    font-weight: 700;
    text-align: center;
  }

  /* Below about 1060 px the two What fields stack, so neither becomes too narrow to read. */
  @media (max-width: 1060px) {
    .fields {
      flex-direction: column;
      gap: 6px;
    }
    /* Stacked, each group keeps its full height instead of sharing the column. */
    .fields .name,
    .fields .text {
      flex: none;
    }
  }

  /* The beam: a lamp sweeping along the bottom edge while a search runs. */
  .beam {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  }
  .beam.active {
    opacity: 1;
  }
  .beam::before {
    content: '';
    position: absolute;
    inset: 0;
    width: 30%;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    transform: translateX(-100%);
  }
  .beam.active::before {
    animation: sweep 1.4s ease-in-out infinite;
  }
  .beam.stopping::before {
    animation-duration: 3s;
    opacity: 0.45;
  }
  @keyframes sweep {
    to {
      transform: translateX(340%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .beam.active::before {
      animation: none;
      transform: none;
      width: 100%;
      opacity: 0.55;
    }
  }
</style>

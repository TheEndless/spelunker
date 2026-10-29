<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { pickFolder, thisPcLabel } from './backend';
  import { countActiveFilters, type Criteria } from './criteria';
  import ExportMenu from './ExportMenu.svelte';
  import type { ExportFormat } from './exportResults';
  import FilterChips from './FilterChips.svelte';
  import FiltersPanel from './FiltersPanel.svelte';
  import { clearAllFilters, clearFilter, summarizeFilters, type FilterId } from './filterSummary';
  import FolderCombo from './FolderCombo.svelte';
  import { ALL_DRIVES_LABEL } from './folderCombo';
  import Icon from './Icon.svelte';
  import type { Preferences } from './preferences.svelte';
  import SavedSearchesMenu from './SavedSearchesMenu.svelte';
  import ShortcutsDialog from './ShortcutsDialog.svelte';
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

  /** This PC with the letters of its drives, offered at the top of the Look in list. The backend expands it to those drives. */
  let thisPc = $state(ALL_DRIVES_LABEL);
  const places = $derived([thisPc]);

  onMount(() => {
    void thisPcLabel().then((label) => (thisPc = label));
  });

  const criteria = $derived(preferences.criteria);
  const filterCount = $derived(countActiveFilters(criteria));

  const filterItems = $derived(summarizeFilters(criteria));

  let nameInput: HTMLInputElement;
  let textInput: HTMLInputElement;
  let lookInCombo: FolderCombo;
  let shortcutsDialog: ShortcutsDialog;
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
    shortcutsDialog.show();
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
  <!-- One panel read top to bottom: where to look, what to find, then the extras. The lamp ends the first two rows. -->
  <div class="panel">
    <div class="rows">
      <div class="row">
        <h2 class="rail" id="where-heading">Where to look</h2>
        <div class="body">
          <div class="group lookin">
            <label class="affix" id="lookin-label" for="lookin-input">Look in</label>
            <FolderCombo
              bind:this={lookInCombo}
              bind:value={criteria.lookIn}
              recents={preferences.recentFolders}
              {places}
              onRemoveRecent={removeRecentFolder}
              onSubmit={() => {
                if (!running && canSearch) onSearch();
              }}
              placeholder="Folder; another folder; or This PC"
              inputId="lookin-input"
              labelledby="lookin-label"
              title={withShortcut('Look in', 'Ctrl+L')}
            />
            <button type="button" class="chip icon" aria-label="Browse for a folder" title="Browse for a folder, or choose This PC" onclick={browse}>
              <Icon name="folder" />
            </button>
          </div>
          <div class="switches" role="group" aria-labelledby="scope-label">
            <span class="options-label" id="scope-label">Include</span>
            <label class="option" title="Look inside the folders below the chosen one"
              ><input type="checkbox" bind:checked={criteria.subfolders} /><span class="mark" aria-hidden="true"><Icon name="check" size={11} /></span>Subfolders</label
            >
            <label class="option" title="Files and folders marked hidden or system"
              ><input type="checkbox" bind:checked={criteria.includeHidden} /><span class="mark" aria-hidden="true"><Icon name="check" size={11} /></span>Hidden</label
            >
            <label class="option" title="Search inside folders reached through junctions and symbolic links. Loops are skipped and reported."
              ><input type="checkbox" bind:checked={criteria.followLinks} /><span class="mark" aria-hidden="true"><Icon name="check" size={11} /></span>Links</label
            >
            <label class="option" title="Also search inside binary files, not only text"
              ><input type="checkbox" bind:checked={criteria.includeBinary} /><span class="mark" aria-hidden="true"><Icon name="check" size={11} /></span>Binary files</label
            >
          </div>
        </div>
      </div>

      <div class="row">
        <h2 class="rail" id="what-heading">What to find</h2>
        <div class="body">
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
            <button
              type="button"
              class="chip mono"
              class:on={criteria.nameIsRegex}
              aria-pressed={criteria.nameIsRegex}
              title="Name is a regular expression"
              onclick={() => (criteria.nameIsRegex = !criteria.nameIsRegex)}>.*</button
            >
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
              title="Text is a regular expression"
              onclick={() => (criteria.regex = !criteria.regex)}>.*</button
            >
          </div>
        </div>
      </div>
      {#if criteria.nameIsRegex && nameError}<small class="problem" role="alert">{nameError}</small>{/if}
      {#if contentError}<small class="problem" role="alert">{contentError}</small>{/if}
    </div>

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

    <!-- The last row: Filters on the rail, what is active beside it, and the things used between searches at the end. -->
    <div class="row extras">
      <button
        type="button"
        class="tool rail-button"
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
      <div class="body">
        {#if filterItems.length > 0 && !preferences.filtersOpen}
          <FilterChips items={filterItems} onRemove={removeFilter} onClearAll={removeAllFilters} />
        {/if}
        {#if failure}
          <span class="problem" role="alert">{failure}</span>
        {/if}
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
          <ShortcutsDialog bind:this={shortcutsDialog} />
        </div>
      </div>
    </div>
    {#if preferences.filtersOpen}
      <div id="filters-panel" class="filters">
        <FiltersPanel {criteria} activeCount={filterCount} onClearAll={removeAllFilters} />
      </div>
    {/if}
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

  /* One raised panel. The rail down its left holds the row heads, the fields line up to its right,
     and the lamp ends the first two rows. */
  .panel {
    --rail-width: 100px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 10px;
    row-gap: 6px;
    padding: 8px 10px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .rows {
    display: grid;
    gap: 6px;
    align-content: start;
    min-width: 0;
  }
  .row {
    display: grid;
    grid-template-columns: var(--rail-width) minmax(0, 1fr);
    gap: 10px;
    align-items: start;
    min-width: 0;
  }
  .rail {
    display: flex;
    align-items: center;
    min-height: var(--control-height);
    margin: 0;
    font-size: var(--text-small);
    font-weight: 600;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-width: 0;
  }
  .body .lookin {
    flex: 1 1 280px;
  }
  .body .name {
    flex: 1 1 200px;
  }
  .body .text {
    flex: 1.6 1 280px;
  }
  .body .option {
    flex: none;
  }
  .rows > .problem {
    margin-left: calc(var(--rail-width) + 10px);
  }
  .extras {
    /* The rail's width, unless the Filters button with its count is wider, and then the chips start after it. */
    grid-template-columns: minmax(var(--rail-width), auto) minmax(0, 1fr);
    grid-column: 1 / -1;
    align-items: center;
  }
  /* The height of the other tools, and as wide as its words and the count when there is one. The rail
     is wider than that, so the chips beside it are never crowded. */
  .rail-button {
    justify-self: start;
    gap: 6px;
    padding: 0 8px;
  }
  .tools {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    margin-left: auto;
  }
  .divider {
    width: 1px;
    height: 18px;
    background: var(--border);
  }
  .filters {
    grid-column: 1 / -1;
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
  /* Look in and Name are stacked, so their labels are one width. A longer one, such as Name regex, widens its own. */
  .lookin .affix,
  .name .affix {
    min-width: 58px;
  }
  .affix {
    display: flex;
    align-items: center;
    flex: none;
    padding: 0 8px;
    border-right: 1px solid var(--border);
    border-radius: 3px 0 0 3px;
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
    border-radius: 0 3px 3px 0;
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
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 2px;
    min-height: var(--tool-height);
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .options-label {
    color: var(--text-muted);
    font-size: var(--text-small);
  }

  /* A toggle that reads as one: a real checkbox kept under a chip, so the keyboard and screen readers see the same control. */
  .option {
    position: relative;
    display: inline-flex;
    gap: 6px;
    align-items: center;
    height: var(--tool-height);
    padding: 0 6px 0 3px;
    border-radius: var(--radius);
    color: var(--text-muted);
    white-space: nowrap;
    cursor: pointer;
    transition: color 120ms;
  }
  .option input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .mark {
    display: grid;
    place-items: center;
    flex: none;
    width: 14px;
    height: 14px;
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    color: transparent;
    transition: color 120ms, background-color 120ms, border-color 120ms;
  }
  .option:hover {
    color: var(--text);
  }
  .option:hover .mark {
    border-color: var(--text-muted);
  }
  .option:has(input:checked) {
    color: var(--text);
  }
  .option:has(input:checked) .mark {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .option:has(input:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  /* The lamp. It stands beside the first two rows, so it is the largest and brightest thing on screen. */
  .go-slot {
    display: flex;
    grid-column: 2;
    grid-row: 1;
  }
  .go {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 4px;
    /* As wide as the three icon buttons under it (settings, appearance, help) and the gaps between them. */
    width: calc(var(--tool-height) * 3 + 6px * 2);
    /* As tall as the two rows beside it, and never shorter than they usually are. */
    height: 100%;
    min-height: calc(var(--control-height) * 2 + 6px);
    border: 0;
    border-radius: 6px;
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

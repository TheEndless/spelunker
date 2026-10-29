<script lang="ts">
  import ErrorsPopover from './ErrorsPopover.svelte';
  import { formatDuration } from './format';
  import Icon from './Icon.svelte';
  import { withShortcut } from './shortcuts';
  import { describeFind, statusPhase } from './statusSummary';
  import type { ErrorRow, Summary } from './types';

  interface Props {
    running: boolean;
    stopping: boolean;
    filesScanned: number;
    /** The folder the search is in right now. Shown only while it runs. */
    folder?: string;
    /** Files in the results list. */
    matches: number;
    elapsedMs: number;
    errors: ErrorRow[];
    summary: Summary | null;
    /** The selection when it is more than one row, for example "3 selected, 12.4 MB". Empty hides it. */
    selection?: string;
    /** The user wants the results map, which shows the Map button as pressed. */
    mapOn?: boolean;
    /** The window is too short for the map, so it is collapsed and the button cannot bring it back yet. */
    mapTooShort?: boolean;
    /** Shows or hides the map. Without it there is no Map button. */
    onToggleMap?: () => void;
  }

  let {
    running,
    stopping,
    filesScanned,
    folder = '',
    matches,
    elapsedMs,
    errors,
    summary,
    selection = '',
    mapOn = false,
    mapTooShort = false,
    onToggleMap,
  }: Props = $props();

  const TOO_SHORT_REASON = 'The window is too short for the map';

  let errorsOpen = $state(false);

  const phase = $derived(statusPhase({ running, stopping, summary }));
  /** The find in the user's words. While running only the file count is known. */
  const find = $derived(describeFind({ filesMatched: matches, totalHits: summary?.totalHits ?? 0 }));
  const errorLabel = $derived(`${errors.length.toLocaleString()} ${errors.length === 1 ? 'error' : 'errors'} skipped`);

  // The list is only meaningful while there is something in it. A new search clears it.
  $effect(() => {
    if (errors.length === 0) errorsOpen = false;
  });
</script>

<!-- Not a live region. The counters change many times a second, so screen readers are told about
     the search through one separate, calmer announcement instead. -->
<footer class="status">
  <span class="state" class:busy={running}>{phase}</span>
  {#if running || summary}
    <span class="find" class:quiet={!summary || matches === 0}>{find}</span>
  {/if}
  {#if selection}
    <span class="selection">{selection}</span>
  {/if}
  {#if running && folder}
    <!-- Not announced: it changes many times a second, like the counters beside it. -->
    <span class="folder" title={folder}>{folder}</span>
  {/if}
  <span class="mechanics">
    <span>{filesScanned.toLocaleString()} files scanned</span>
    <span>{formatDuration(elapsedMs)}</span>
    <span class="errors">
      {#if errors.length > 0}
        <button
          type="button"
          class="link problem"
          aria-haspopup="dialog"
          aria-expanded={errorsOpen}
          title="Show the files and folders that could not be read"
          onpointerdown={(event) => event.stopPropagation()}
          onclick={() => (errorsOpen = !errorsOpen)}>{errorLabel}</button
        >
        {#if errorsOpen}
          <ErrorsPopover {errors} onClose={() => (errorsOpen = false)} />
        {/if}
      {:else}
        <span>{errorLabel}</span>
      {/if}
    </span>
    {#if summary && summary.binarySkipped > 0}
      <span>{summary.binarySkipped.toLocaleString()} binary skipped</span>
    {/if}
  </span>
  {#if onToggleMap}
    <!-- Unavailable rather than disabled while the window is too short: a disabled button cannot be
         focused, so the reason would never be read out. It is not pressed then, since no map shows. -->
    <button
      type="button"
      class="map-toggle"
      aria-pressed={mapOn && !mapTooShort}
      aria-disabled={mapTooShort ? 'true' : undefined}
      aria-describedby={mapTooShort ? 'map-toggle-reason' : undefined}
      title={mapTooShort ? TOO_SHORT_REASON : withShortcut('Show or hide the results map', 'Ctrl+Shift+M')}
      onclick={() => {
        if (!mapTooShort) onToggleMap();
      }}
    >
      <Icon name="map" size={14} />
      Map
    </button>
    {#if mapTooShort}<span class="sr-only" id="map-toggle-reason">{TOO_SHORT_REASON}</span>{/if}
  {/if}
</footer>

<style>
  .status {
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 0 12px;
    height: 26px;
    background: var(--header-bg);
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .state {
    font-weight: 600;
    color: var(--text);
  }
  .state.busy {
    color: var(--accent-text);
  }
  /* The find is the headline of the ledger: the one figure that answers the question. */
  .find {
    font-weight: 600;
    color: var(--text);
  }
  .find.quiet {
    font-weight: 400;
    color: var(--text-muted);
  }
  .selection {
    color: var(--text);
  }
  /* Takes the room between the find and the counters. Long paths are cut at the end, so the drive
     and the first folders, which show where in the order the search is, stay visible. */
  .folder {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mechanics {
    display: flex;
    gap: 14px;
    margin-left: auto;
  }
  .errors {
    position: relative;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link:hover {
    color: var(--text);
  }
  .problem {
    color: var(--danger);
  }
  .map-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 7px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--text-muted);
    font: inherit;
  }
  .map-toggle:hover:not([aria-disabled='true']) {
    border-color: var(--border-strong);
    color: var(--text);
  }
  .map-toggle[aria-pressed='true'] {
    border-color: var(--border-strong);
    background: var(--surface);
    color: var(--text);
  }
  .map-toggle[aria-disabled='true'] {
    color: var(--disabled-text);
    cursor: not-allowed;
  }
</style>

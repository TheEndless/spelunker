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
    /** Files in the results list. */
    matches: number;
    elapsedMs: number;
    errors: ErrorRow[];
    summary: Summary | null;
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
    matches,
    elapsedMs,
    errors,
    summary,
    mapOn = false,
    mapTooShort = false,
    onToggleMap,
  }: Props = $props();

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
    <button
      type="button"
      class="map-toggle"
      aria-pressed={mapOn}
      disabled={mapTooShort}
      title={mapTooShort ? 'The window is too short for the map' : withShortcut('Show or hide the results map', 'Ctrl+Shift+M')}
      onclick={onToggleMap}
    >
      <Icon name="map" size={14} />
      Map
    </button>
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
  .map-toggle:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--text);
  }
  .map-toggle[aria-pressed='true'] {
    border-color: var(--border-strong);
    background: var(--surface);
    color: var(--text);
  }
  .map-toggle:disabled {
    color: var(--disabled-text);
    cursor: not-allowed;
  }
</style>

<script lang="ts">
  import { focusScope } from './focusScope';
  import type { Criteria } from './criteria';
  import Icon from './Icon.svelte';
  import { searchLabel } from './searchHistory';
  import { searchNameExists, validateSearchName, type SavedSearch } from './savedSearches';

  interface Props {
    searches: SavedSearch[];
    /** The searches run lately, newest first. */
    recent: Criteria[];
    notice: string | null;
    onRecall: (search: SavedSearch) => void;
    onRecallRecent: (criteria: Criteria) => void;
    onClearRecent: () => void;
    onSave: (name: string) => void;
    onDelete: (name: string) => void;
  }

  let { searches, recent, notice, onRecall, onRecallRecent, onClearRecent, onSave, onDelete }: Props = $props();

  let open = $state(false);
  let name = $state('');
  let root: HTMLDivElement;

  // Deleting a saved search, or clearing the recent ones, destroys the button that had focus. Move focus to a neighbour that remains.
  let previousCount = 0;
  $effect(() => {
    const count = searches.length + recent.length;
    const lostOne = open && count < previousCount;
    previousCount = count;
    if (!lostOne) return;
    queueMicrotask(() => {
      if (root.contains(document.activeElement)) return;
      (root.querySelector<HTMLElement>('.recall') ?? root.querySelector<HTMLElement>('.save input'))?.focus();
    });
  });

  const nameProblem = $derived(name === '' ? null : validateSearchName(name));
  const replaces = $derived(name.trim() !== '' && searchNameExists(searches, name));

  function save() {
    if (validateSearchName(name) !== null) return;
    onSave(name);
    name = '';
  }

  function onWindowPointerDown(event: PointerEvent) {
    if (open && !root.contains(event.target as Node)) open = false;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      open = false;
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydowncapture={onKeydown} />

<div class="saved" bind:this={root}>
  <button
    type="button"
    class="tool"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label="Saved searches"
    title="Saved searches"
    onclick={() => (open = !open)}
  >
    <Icon name="bookmark" />
    Saved
  </button>

  {#if open}
    <div class="popover" role="dialog" aria-label="Saved searches" tabindex="-1" use:focusScope={{ onLeave: () => (open = false) }}>
      {#if searches.length === 0}
        <p class="empty">Nothing saved yet.</p>
      {:else}
        <ul>
          {#each searches as search (search.name)}
            <li>
              <button
                type="button"
                class="recall"
                title="Run with these criteria loaded"
                onclick={() => {
                  onRecall(search);
                  open = false;
                }}>{search.name}</button
              >
              <button type="button" class="delete" aria-label="Delete {search.name}" title="Delete" onclick={() => onDelete(search.name)}
                >&times;</button
              >
            </li>
          {/each}
        </ul>
      {/if}

      {#if recent.length > 0}
        <div class="recent">
          <div class="recent-head">
            <span>Recent</span>
            <button type="button" class="clear" title="Forget the recent searches" onclick={onClearRecent}>Clear</button>
          </div>
          <ul>
            {#each recent as search, position (position)}
              <li>
                <button
                  type="button"
                  class="recall"
                  title="Load this search: {search.lookIn}"
                  onclick={() => {
                    onRecallRecent(search);
                    open = false;
                  }}>{searchLabel(search)} <span class="where">{search.lookIn}</span></button
                >
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <form
        class="save"
        onsubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input type="text" bind:value={name} placeholder="Name for the current search" aria-label="Name for the current search" maxlength="80" />
        <button type="submit" disabled={name.trim() === '' || nameProblem !== null}>{replaces ? 'Replace' : 'Save'}</button>
      </form>
      {#if nameProblem}<p class="problem">{nameProblem}</p>{/if}
      {#if replaces && !nameProblem}<p class="hint">A saved search with this name will be replaced.</p>{/if}
      {#if notice}<p class="problem">{notice}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .saved {
    position: relative;
  }
  .popover {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 15;
    width: 320px;
    padding: 8px;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    box-shadow: var(--shadow);
    display: grid;
    gap: 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 220px;
    overflow: auto;
  }
  li {
    display: flex;
    align-items: center;
  }
  .recall {
    flex: 1;
    text-align: left;
    background: none;
    border: 0;
    padding: 5px 8px;
    border-radius: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recall:hover {
    background: var(--row-selected);
  }
  .delete {
    background: none;
    border: 0;
    color: var(--text-muted);
    font-size: 16px;
    padding: 0 8px;
  }
  .delete:hover {
    color: var(--danger);
  }
  .empty {
    margin: 0;
    padding: 6px 8px;
    color: var(--text-muted);
  }
  .recent {
    display: grid;
    gap: 2px;
    border-top: 1px solid var(--border);
    padding-top: 6px;
  }
  .recent-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .clear {
    background: none;
    border: 0;
    padding: 2px 4px;
    color: var(--text-muted);
    text-decoration: underline;
  }
  .clear:hover {
    color: var(--text);
  }
  .where {
    color: var(--text-muted);
  }
  .save {
    display: flex;
    gap: 6px;
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
  .save input {
    flex: 1;
  }
  .save button {
    background: var(--accent);
    color: var(--on-accent);
    border: 0;
    border-radius: 3px;
    padding: 0 12px;
    font-weight: 600;
  }
  .save button:disabled {
    background: var(--disabled-bg);
    color: var(--disabled-text);
    cursor: not-allowed;
  }
  .problem {
    margin: 0;
    color: var(--danger);
    font-weight: 600;
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
  }
</style>

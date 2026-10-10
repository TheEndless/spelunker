<script lang="ts">
  import type { FilterId, FilterSummaryItem } from './filterSummary';

  interface Props {
    items: FilterSummaryItem[];
    onRemove: (id: FilterId) => void;
    onClearAll: () => void;
  }

  let { items, onRemove, onClearAll }: Props = $props();
</script>

{#if items.length > 0}
  <ul class="chips" aria-label="Active filters">
    {#each items as item (item.id)}
      <li class="pill">
        <span class="label">{item.label}</span>
        <button
          type="button"
          class="remove"
          aria-label="Remove filter: {item.label}"
          onclick={() => onRemove(item.id)}>{'×'}</button
        >
      </li>
    {/each}
    {#if items.length >= 2}
      <li class="clear-item">
        <button type="button" class="clear-all" onclick={onClearAll}>Clear filters</button>
      </li>
    {/if}
  </ul>
{/if}

<style>
  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 24px;
    padding: 0 2px 0 10px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    color: var(--text);
    font-size: var(--text-small);
    white-space: nowrap;
  }

  .remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1;
  }
  .remove:hover {
    background: var(--row-hover);
    color: var(--text);
  }

  .clear-all {
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .clear-all:hover {
    color: var(--text);
    text-decoration: underline;
  }
</style>

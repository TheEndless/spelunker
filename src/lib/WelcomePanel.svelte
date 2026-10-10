<script lang="ts">
  import Icon from './Icon.svelte';
  import { RECIPES, type Recipe } from './recipes';
  import type { SavedSearch } from './savedSearches';

  interface Props {
    recentFolders: string[];
    savedSearches: SavedSearch[];
    /** Fills the fields with the example. The search is not started, so the user sees what was filled in. */
    onRecipe: (recipe: Recipe) => void;
    onFolder: (folder: string) => void;
    onSavedSearch: (search: SavedSearch) => void;
  }

  let { recentFolders, savedSearches, onRecipe, onFolder, onSavedSearch }: Props = $props();

  const MAX_LISTED = 5;
</script>

<!-- Shown inside the empty results grid before the first search. Everything here is a start, not a lesson. -->
<div class="welcome">
  <section aria-labelledby="examples-heading">
    <h3 id="examples-heading">Try one of these</h3>
    <ul>
      {#each RECIPES as recipe (recipe.title)}
        <li>
          <button type="button" class="start recipe" onclick={() => onRecipe(recipe)}>
            <span class="title">{recipe.title}</span>
            <span class="detail">{recipe.detail}</span>
          </button>
        </li>
      {/each}
    </ul>
  </section>

  <section aria-labelledby="recent-heading">
    <h3 id="recent-heading">Recent folders</h3>
    {#if recentFolders.length === 0}
      <p class="none">Folders you search will be listed here.</p>
    {:else}
      <ul>
        {#each recentFolders.slice(0, MAX_LISTED) as folder (folder)}
          <li>
            <button type="button" class="start" title={folder} onclick={() => onFolder(folder)}>
              <span class="mark"><Icon name="folder" size={14} /></span>
              <span class="title path"><bdi dir="ltr">{folder}</bdi></span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section aria-labelledby="saved-heading">
    <h3 id="saved-heading">Saved searches</h3>
    {#if savedSearches.length === 0}
      <p class="none">Name a search in Saved to keep it.</p>
    {:else}
      <ul>
        {#each savedSearches.slice(0, MAX_LISTED) as search (search.name)}
          <li>
            <button type="button" class="start" title="Load this search" onclick={() => onSavedSearch(search)}>
              <span class="mark"><Icon name="bookmark" size={14} /></span>
              <span class="title">{search.name}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .welcome {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 24px;
    width: min(760px, 100%);
    margin: 26px auto 0;
    text-align: left;
  }
  h3 {
    margin: 0 0 6px;
    font-size: var(--text-small);
    font-weight: 600;
    color: var(--text-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    /* A bounded column, so a long path is clipped with an ellipsis instead of widening the panel. */
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .start {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    text-align: left;
    transition: background-color 120ms, border-color 120ms;
  }
  .start:hover {
    background: var(--row-hover);
    border-color: var(--border);
  }
  .recipe {
    flex-direction: column;
    align-items: stretch;
    gap: 1px;
    padding: 6px 10px;
    background: var(--surface-raised);
    border-color: var(--border);
  }
  .recipe:hover {
    border-color: var(--accent);
  }
  .title {
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .path {
    font-weight: 400;
    direction: rtl;
    text-align: left;
  }
  .detail {
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .mark {
    display: inline-flex;
    flex: none;
    color: var(--accent);
  }
  .none {
    margin: 0;
    padding: 6px 8px;
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  @media (max-width: 1060px) {
    .welcome {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>

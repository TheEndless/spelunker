<script lang="ts">
  import type { Criteria } from './criteria';
  import { DATE_UNITS, SIZE_UNITS, resolveDateFilter, resolveSizeFilter, type DateFilter } from './filters';

  interface Props {
    criteria: Criteria;
  }

  let { criteria }: Props = $props();

  // Relative dates are re-evaluated when the search starts, so this only checks the inputs.
  const sizeProblem = $derived.by(() => {
    const result = resolveSizeFilter(criteria.size);
    return result.ok ? null : result.error;
  });
  const dateProblem = (filter: DateFilter) => {
    const result = resolveDateFilter(filter, Date.now());
    return result.ok ? null : result.error;
  };
</script>

{#snippet dateRow(label: string, filter: DateFilter, hint: string)}
  {@const problem = dateProblem(filter)}
  <div class="row">
    <span class="name">{label}</span>
    <select bind:value={filter.mode} aria-label="{label} filter" title={hint}>
      <option value="any">Any time</option>
      <option value="within">Within the last</option>
      <option value="before">Before</option>
      <option value="after">After</option>
      <option value="between">Between</option>
    </select>
    {#if filter.mode === 'within'}
      <input class="number" type="text" inputmode="decimal" bind:value={filter.amount} aria-label="{label} amount" />
      <select bind:value={filter.unit} aria-label="{label} unit">
        {#each DATE_UNITS as unit (unit)}<option value={unit}>{unit}</option>{/each}
      </select>
    {:else if filter.mode !== 'any'}
      <input type="date" bind:value={filter.date} aria-label="{label} date" />
      {#if filter.mode === 'between'}
        <span class="joiner">and</span>
        <input type="date" bind:value={filter.date2} aria-label="{label} end date" />
      {/if}
    {/if}
    {#if filter.mode !== 'any' && problem}<span class="problem">{problem}</span>{/if}
  </div>
{/snippet}

<section class="filters" aria-label="Filters">
  <div class="row">
    <span class="name">Size</span>
    <select bind:value={criteria.size.mode} aria-label="Size filter">
      <option value="any">Any size</option>
      <option value="larger">Larger than</option>
      <option value="smaller">Smaller than</option>
      <option value="between">Between</option>
    </select>
    {#if criteria.size.mode !== 'any'}
      <input class="number" type="text" inputmode="decimal" bind:value={criteria.size.value} aria-label="Size" />
      <select bind:value={criteria.size.unit} aria-label="Size unit">
        {#each SIZE_UNITS as unit (unit)}<option value={unit}>{unit}</option>{/each}
      </select>
      {#if criteria.size.mode === 'between'}
        <span class="joiner">and</span>
        <input class="number" type="text" inputmode="decimal" bind:value={criteria.size.value2} aria-label="Second size" />
        <select bind:value={criteria.size.unit2} aria-label="Second size unit">
          {#each SIZE_UNITS as unit (unit)}<option value={unit}>{unit}</option>{/each}
        </select>
      {/if}
      {#if sizeProblem}<span class="problem">{sizeProblem}</span>{/if}
    {/if}
  </div>

  {@render dateRow(
    'Modified',
    criteria.modified,
    '"Within the last" is measured from when you press Search. Before excludes the chosen day, After starts the day after it, Between includes both days.',
  )}
  {@render dateRow(
    'Created',
    criteria.created,
    '"Within the last" is measured from when you press Search. Before excludes the chosen day, After starts the day after it, Between includes both days.',
  )}

  <div class="row">
    <span class="name">Regex</span>
    <label>
      <input type="checkbox" bind:checked={criteria.nameIsRegex} />
      Use the Name box as a regular expression on the file name
    </label>
  </div>

  <div class="row">
    <span class="name"></span>
    <label title="Lets a text regex match across line breaks. The whole file is read into memory, so files over 200 MB are reported as errors.">
      <input type="checkbox" bind:checked={criteria.multiLine} disabled={!criteria.regex} />
      Multi-line: let the text regex match across line breaks
      {#if !criteria.regex}<span class="aside">(turn on the .* chip first)</span>{/if}
    </label>
  </div>
</section>

<style>
  /* Lives inside the "What to find" card, under its switches, so it reads as part of that question. */
  .filters {
    display: grid;
    gap: 6px;
    margin-top: 4px;
    padding: 8px 0 2px;
    border-top: 1px solid var(--border);
    font-size: 12px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 26px;
  }
  .name {
    width: 64px;
    color: var(--text-muted);
    font-weight: 600;
  }
  select,
  input[type='date'],
  .number {
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    padding: 3px 6px;
  }
  .number {
    width: 80px;
  }
  .joiner {
    color: var(--text-muted);
  }
  label {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .aside {
    color: var(--text-muted);
  }
  .problem {
    color: var(--danger);
    font-weight: 600;
  }
</style>

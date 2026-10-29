<script lang="ts">
  import { untrack } from 'svelte';
  import type { Criteria } from './criteria';
  import { DATE_UNITS, SIZE_UNITS, resolveDateFilter, resolveSizeFilter, type DateFilter, type SizeFilter } from './filters';

  interface Props {
    criteria: Criteria;
    /** How many filters are switched on. The Clear filters button shows only while there are some. */
    activeCount: number;
    onClearAll: () => void;
  }

  let { criteria, activeCount, onClearAll }: Props = $props();

  type SizeMode = Exclude<SizeFilter['mode'], 'any'>;
  type DateMode = Exclude<DateFilter['mode'], 'any'>;

  // A filter is on while its mode is not "any". Switching one off keeps the values typed into it, and
  // switching it back on restores the mode it had, so nothing has to be entered twice.
  // The panel reads where each filter stands once, when it opens, and keeps its own record after that.
  const modeOnOpen = <T extends string>(mode: T | 'any', fallback: T): T => (mode === 'any' ? fallback : mode);
  let lastSizeMode: SizeMode = untrack(() => modeOnOpen(criteria.size.mode, 'larger'));
  const lastDateMode: Record<'modified' | 'created', DateMode> = untrack(() => ({
    modified: modeOnOpen(criteria.modified.mode, 'within'),
    created: modeOnOpen(criteria.created.mode, 'within'),
  }));

  const sizeOn = $derived(criteria.size.mode !== 'any');
  const shownSizeMode = $derived<SizeMode>(criteria.size.mode === 'any' ? lastSizeMode : criteria.size.mode);

  function setSizeOn(on: boolean) {
    criteria.size.mode = on ? lastSizeMode : 'any';
  }

  function setSizeMode(mode: SizeMode) {
    lastSizeMode = mode;
    criteria.size.mode = mode;
  }

  function setDateOn(key: 'modified' | 'created', on: boolean) {
    criteria[key].mode = on ? lastDateMode[key] : 'any';
  }

  function setDateMode(key: 'modified' | 'created', mode: DateMode) {
    lastDateMode[key] = mode;
    criteria[key].mode = mode;
  }

  // Relative dates are re-evaluated when the search starts, so this only checks the inputs.
  const sizeProblem = $derived.by(() => {
    const result = resolveSizeFilter(criteria.size);
    return result.ok ? null : result.error;
  });
  const dateProblem = (filter: DateFilter) => {
    const result = resolveDateFilter(filter, Date.now());
    return result.ok ? null : result.error;
  };

  const DATE_HINT =
    '"Within the last" is measured from when you press Search. Before excludes the chosen day, After starts the day after it, Between includes both days.';
</script>

{#snippet dateRow(key: 'modified' | 'created', label: string)}
  {@const filter = criteria[key]}
  {@const on = filter.mode !== 'any'}
  {@const mode = filter.mode === 'any' ? lastDateMode[key] : filter.mode}
  {@const problem = on ? dateProblem(filter) : null}
  <div class="row">
    <label class="head">
      <input type="checkbox" checked={on} onchange={(event) => setDateOn(key, event.currentTarget.checked)} />
      {label}
    </label>
    <div class="controls">
      <select
        class="mode"
        value={mode}
        disabled={!on}
        aria-label="{label} filter"
        title={DATE_HINT}
        onchange={(event) => setDateMode(key, event.currentTarget.value as DateMode)}
      >
        <option value="within">Within the last</option>
        <option value="before">Before</option>
        <option value="after">After</option>
        <option value="between">Between</option>
      </select>
      {#if mode === 'within'}
        <input class="number" type="text" inputmode="decimal" disabled={!on} bind:value={filter.amount} aria-label="{label} amount" />
        <select class="unit" disabled={!on} bind:value={filter.unit} aria-label="{label} unit">
          {#each DATE_UNITS as unit (unit)}<option value={unit}>{unit}</option>{/each}
        </select>
      {:else}
        <input class="date" type="date" disabled={!on} bind:value={filter.date} aria-label="{label} date" />
        {#if mode === 'between'}
          <span class="joiner">and</span>
          <input class="date" type="date" disabled={!on} bind:value={filter.date2} aria-label="{label} end date" />
        {/if}
      {/if}
      {#if problem}<span class="problem">{problem}</span>{/if}
    </div>
  </div>
{/snippet}

<section class="filters" aria-label="Filters">
  <div class="row">
    <label class="head">
      <input type="checkbox" checked={sizeOn} onchange={(event) => setSizeOn(event.currentTarget.checked)} />
      Size
    </label>
    <div class="controls">
      <select
        class="mode"
        value={shownSizeMode}
        disabled={!sizeOn}
        aria-label="Size filter"
        onchange={(event) => setSizeMode(event.currentTarget.value as SizeMode)}
      >
        <option value="larger">Larger than</option>
        <option value="smaller">Smaller than</option>
        <option value="between">Between</option>
      </select>
      <input class="number" type="text" inputmode="decimal" disabled={!sizeOn} bind:value={criteria.size.value} aria-label="Size" />
      <select class="unit" disabled={!sizeOn} bind:value={criteria.size.unit} aria-label="Size unit">
        {#each SIZE_UNITS as unit (unit)}<option value={unit}>{unit}</option>{/each}
      </select>
      {#if shownSizeMode === 'between'}
        <span class="joiner">and</span>
        <input class="number" type="text" inputmode="decimal" disabled={!sizeOn} bind:value={criteria.size.value2} aria-label="Second size" />
        <select class="unit" disabled={!sizeOn} bind:value={criteria.size.unit2} aria-label="Second size unit">
          {#each SIZE_UNITS as unit (unit)}<option value={unit}>{unit}</option>{/each}
        </select>
      {/if}
      {#if sizeOn && sizeProblem}<span class="problem">{sizeProblem}</span>{/if}
    </div>
  </div>

  {@render dateRow('modified', 'Modified')}
  {@render dateRow('created', 'Created')}

  <div class="row">
    <label class="head" title="Lets a text regex match across line breaks. The whole file is read into memory, so files over 200 MB are reported as errors.">
      <input type="checkbox" bind:checked={criteria.multiLine} disabled={!criteria.regex} />
      Multi-line
    </label>
    <div class="controls">
      <span class="note">Let the Containing regex match across line breaks{#if !criteria.regex}<span class="aside">(turn on the .* chip beside Containing first)</span>{/if}</span>
    </div>
  </div>

  {#if activeCount > 0}
    <div class="footer">
      <button type="button" class="clear" onclick={onClearAll}>Clear filters</button>
    </div>
  {/if}
</section>

<style>
  /* Lives inside the search panel, under the Filters row. Its label column is the panel's rail, so
     the controls start where the fields above them do. */
  .filters {
    display: grid;
    gap: 6px;
    margin-top: 2px;
    padding: 8px 0 0;
    border-top: 1px solid var(--border);
    font-size: var(--text-small);
  }
  .row {
    display: grid;
    grid-template-columns: var(--rail-width, 104px) minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    min-height: 28px;
  }
  .head {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    color: var(--text);
    font-weight: 600;
    cursor: pointer;
  }
  .head:has(input:disabled) {
    color: var(--text-muted);
    cursor: default;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 8px;
    align-items: center;
    min-width: 0;
  }

  /* Every control is the same height, and each kind has one width, so the rows line up in columns. */
  select,
  input[type='date'],
  .number {
    height: 28px;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: 0 8px;
    color: var(--text);
  }
  .mode {
    width: 150px;
  }
  .number {
    width: 90px;
  }
  .unit {
    width: 76px;
  }
  .date {
    width: 150px;
  }
  select:disabled,
  input:disabled.number,
  input[type='date']:disabled {
    color: var(--disabled-text);
    background: var(--disabled-bg);
    cursor: not-allowed;
  }
  .aside {
    margin-left: 4px;
  }
  .joiner,
  .note {
    color: var(--text-muted);
  }
  .problem {
    color: var(--danger);
    font-weight: 600;
  }
  .footer {
    display: flex;
    justify-content: flex-end;
  }
  .clear {
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-small);
  }
  .clear:hover {
    border-color: var(--text-muted);
  }
</style>

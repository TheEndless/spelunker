<script lang="ts">
  import PaletteSwatch from './PaletteSwatch.svelte';
  import { PALETTES, versionNames, type Palette } from './palettes';
  import type { Preferences } from './preferences.svelte';
  import type { ThemePreference } from './types';

  /**
   * The choice of mode (Auto, Light, Dark) and of color theme, which is the same wherever it is
   * shown: in the toolbar's Appearance menu and on the Appearance tab of Settings. The color
   * themes are a radio group, so the arrow keys move to the neighbour and check it, and only the
   * checked one is a tab stop. `compact` lays the themes out in two columns, for a wide place.
   */
  interface Props {
    preferences: Preferences;
    compact?: boolean;
  }

  let { preferences, compact = false }: Props = $props();

  const spelunker = PALETTES.filter((palette) => palette.group === 'spelunker');
  const editor = PALETTES.filter((palette) => palette.group === 'editor');
  const modes: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  let root: HTMLDivElement;

  function choosePalette(id: string) {
    preferences.palette = id;
    preferences.save();
  }

  function chooseMode(value: ThemePreference) {
    preferences.theme = value;
    preferences.save();
  }

  function onPaletteKeydown(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (!(event.target instanceof HTMLElement) || !event.target.classList.contains('item')) return;
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const index = PALETTES.findIndex((palette) => palette.id === preferences.palette);
    const next = PALETTES[(index + (forward ? 1 : -1) + PALETTES.length) % PALETTES.length];
    choosePalette(next.id);
    queueMicrotask(() => root.querySelector<HTMLButtonElement>(`.item[data-id="${next.id}"]`)?.focus());
    event.preventDefault();
  }
</script>

{#snippet entry(palette: Palette)}
  {@const selected = palette.id === preferences.palette}
  <button
    type="button"
    class="item"
    class:selected
    role="radio"
    aria-checked={selected}
    tabindex={selected ? 0 : -1}
    data-id={palette.id}
    title={versionNames(palette) ? `${palette.label}: ${versionNames(palette)}` : palette.label}
    onclick={() => choosePalette(palette.id)}
  >
    <PaletteSwatch {palette} />
    <span class="label">{palette.label}</span>
    {#if !compact && versionNames(palette)}<span class="versions">{versionNames(palette)}</span>{/if}
  </button>
{/snippet}

<div class="choices" class:compact bind:this={root}>
  <div class="section">
    <span class="heading" id="mode-heading">Mode</span>
    <div class="modes" role="group" aria-labelledby="mode-heading">
      {#each modes as mode (mode.value)}
        <button
          type="button"
          class:on={preferences.theme === mode.value}
          aria-pressed={preferences.theme === mode.value}
          onclick={() => chooseMode(mode.value)}>{mode.label}</button
        >
      {/each}
    </div>
    <span class="hint">Auto follows Windows.</span>
  </div>

  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="section palettes" role="radiogroup" aria-label="Color theme" onkeydown={onPaletteKeydown}>
    <span class="heading">Spelunker</span>
    {#each spelunker as palette (palette.id)}{@render entry(palette)}{/each}
    <span class="heading spaced">Editor themes</span>
    {#each editor as palette (palette.id)}{@render entry(palette)}{/each}
  </div>
</div>

<style>
  .choices {
    display: grid;
    gap: 12px;
  }
  .section {
    display: grid;
    gap: 2px;
  }
  .heading {
    font-size: var(--text-small);
    font-weight: 600;
    color: var(--text-muted);
    padding: 0 4px 4px;
  }
  .heading.spaced {
    margin-top: 8px;
  }
  .hint {
    font-size: var(--text-small);
    color: var(--text-muted);
    padding: 4px 4px 0;
  }

  .modes {
    display: inline-flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .modes button {
    flex: 1;
    height: var(--tool-height);
    background: var(--surface);
    border: 0;
    color: var(--text-muted);
  }
  .modes button + button {
    border-left: 1px solid var(--border-strong);
  }
  .modes button:hover:not(.on) {
    color: var(--text);
  }
  .modes button.on {
    background: var(--accent);
    color: var(--on-accent);
  }

  .compact .palettes {
    grid-template-columns: 1fr 1fr;
    column-gap: 8px;
  }
  .compact .heading {
    grid-column: 1 / -1;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
    padding: 5px 8px;
    border: 0;
    border-left: 3px solid transparent;
    border-radius: 3px;
    background: none;
    text-align: left;
  }
  .item:hover {
    background: var(--row-hover);
  }
  .item.selected {
    background: var(--row-selected);
    border-left-color: var(--row-selected-edge);
  }
  .label {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .versions {
    margin-left: auto;
    font-size: var(--text-small);
    color: var(--text-muted);
    white-space: nowrap;
  }
</style>

<script lang="ts">
  import { focusScope } from './focusScope';
  import { PALETTES, findPalette, versionNames, type Palette } from './palettes';
  import type { Preferences } from './preferences.svelte';
  import type { ThemePreference } from './types';

  interface Props {
    preferences: Preferences;
  }

  let { preferences }: Props = $props();

  let open = $state(false);
  let root: HTMLDivElement;

  const current = $derived(findPalette(preferences.palette));
  const spelunker = PALETTES.filter((palette) => palette.group === 'spelunker');
  const editor = PALETTES.filter((palette) => palette.group === 'editor');
  const modes: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  function choosePalette(id: string) {
    preferences.palette = id;
    preferences.save();
  }

  function chooseMode(value: ThemePreference) {
    preferences.theme = value;
    preferences.save();
  }

  const isArrow = (key: string) => ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(key);

  function onWindowPointerDown(event: PointerEvent) {
    if (open && !root.contains(event.target as Node)) open = false;
  }

  function onKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      open = false;
    } else if (isArrow(event.key) && (document.activeElement as HTMLElement | null)?.classList.contains('item')) {
      // A radio group: arrow keys move to the neighbour and check it, and only the checked one is a tab stop.
      const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
      const index = PALETTES.findIndex((palette) => palette.id === preferences.palette);
      const next = PALETTES[(index + (forward ? 1 : -1) + PALETTES.length) % PALETTES.length];
      choosePalette(next.id);
      queueMicrotask(() => root.querySelector<HTMLButtonElement>(`.item[data-id="${next.id}"]`)?.focus());
      event.preventDefault();
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydowncapture={onKeydown} />

{#snippet swatch(palette: Palette)}
  <span class="swatch" aria-hidden="true">
    {#each ['light', 'dark'] as const as mode (mode)}
      <span class="half" style:background={palette[mode].surface} style:border-color={palette[mode].border}>
        <i class="dot" style:background={palette[mode].accent}></i>
        <i class="bar" style:background={palette[mode].text}></i>
      </span>
    {/each}
  </span>
{/snippet}

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
    onclick={() => choosePalette(palette.id)}
  >
    {@render swatch(palette)}
    <span class="label">{palette.label}</span>
    {#if versionNames(palette)}<span class="versions">{versionNames(palette)}</span>{/if}
  </button>
{/snippet}

<div class="theme" bind:this={root}>
  <button
    type="button"
    class="tool icon"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label="Appearance, {current.label}"
    title="Appearance: {current.label}"
    onclick={() => (open = !open)}
  >
    {@render swatch(current)}
  </button>

  {#if open}
    <div
      class="popover"
      role="dialog"
      aria-label="Appearance"
      tabindex="-1"
      use:focusScope={{ initial: '.item.selected', onLeave: () => (open = false) }}
    >
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

      <div class="section" role="radiogroup" aria-label="Color theme">
        <span class="heading">Spelunker</span>
        {#each spelunker as palette (palette.id)}{@render entry(palette)}{/each}
        <span class="heading spaced">Editor themes</span>
        {#each editor as palette (palette.id)}{@render entry(palette)}{/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .theme {
    position: relative;
  }
  .popover {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 15;
    width: 300px;
    max-height: min(70vh, 520px);
    overflow: auto;
    padding: 10px;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: var(--shadow);
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

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-left: 3px solid transparent;
    border-radius: 4px;
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
  }
  .versions {
    margin-left: auto;
    font-size: var(--text-small);
    color: var(--text-muted);
    white-space: nowrap;
  }

  /* A theme's light and dark versions side by side: surface, accent dot, and a line of text. */
  /* Inside the compact toolbar button the two-tone swatch is scaled down to fit. */
  .tool .swatch {
    zoom: 0.62;
  }
  .swatch {
    display: inline-flex;
    flex: none;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .half {
    display: grid;
    align-content: center;
    gap: 3px;
    width: 18px;
    height: 18px;
    padding: 0 3px;
    border-width: 0;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .bar {
    width: 10px;
    height: 2px;
    border-radius: 1px;
    opacity: 0.8;
  }
</style>

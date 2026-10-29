<script lang="ts">
  import { focusScope } from './focusScope';
  import PaletteSwatch from './PaletteSwatch.svelte';
  import { findPalette } from './palettes';
  import type { Preferences } from './preferences.svelte';
  import ThemeChoices from './ThemeChoices.svelte';

  interface Props {
    preferences: Preferences;
  }

  let { preferences }: Props = $props();

  let open = $state(false);
  let root: HTMLDivElement;

  const current = $derived(findPalette(preferences.palette));

  function onWindowPointerDown(event: PointerEvent) {
    if (open && !root.contains(event.target as Node)) open = false;
  }

  function onKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      event.stopPropagation();
      open = false;
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydowncapture={onKeydown} />

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
    <PaletteSwatch palette={current} />
  </button>

  {#if open}
    <div
      class="popover"
      role="dialog"
      aria-label="Appearance"
      tabindex="-1"
      use:focusScope={{ initial: '.item.selected', onLeave: () => (open = false) }}
    >
      <ThemeChoices {preferences} />
    </div>
  {/if}
</div>

<style>
  .theme {
    position: relative;
    /* A block wrapper puts the button on a text line, which is taller than the button and pushes it off the row's line. */
    display: flex;
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
    border-radius: 6px;
    box-shadow: var(--shadow);
  }
  /* Inside the compact toolbar button the two-tone swatch is scaled down to fit. */
  .tool :global(.swatch) {
    zoom: 0.62;
  }
</style>

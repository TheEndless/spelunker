<script lang="ts">
  import type { Palette } from './palettes';

  interface Props {
    palette: Palette;
  }

  let { palette }: Props = $props();
</script>

<!-- A theme's light and dark versions side by side: surface, accent dot, and a line of text. -->
<span class="swatch" aria-hidden="true">
  {#each ['light', 'dark'] as const as mode (mode)}
    <span class="half" style:background={palette[mode].surface} style:border-color={palette[mode].border}>
      <i class="dot" style:background={palette[mode].accent}></i>
      <i class="bar" style:background={palette[mode].text}></i>
    </span>
  {/each}
</span>

<style>
  .swatch {
    display: inline-flex;
    flex: none;
    border-radius: 3px;
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

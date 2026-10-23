<script lang="ts">
  import { onMount } from 'svelte';
  import { startPointerDrag } from './dragHandle';
  import { clampPreviewWidth, PREVIEW_MIN_WIDTH, resizePreviewWithKey, RESULTS_MIN_WIDTH } from './paneSplit';

  interface Props {
    /**
     * The widths right now, read from the page when asked. The preview's size is set by CSS, so the
     * real number only exists in the layout, and it is read fresh each time it is needed.
     */
    measure: () => { preview: number; container: number };
    onResize: (width: number) => void;
    /** The user finished a drag or a key press, so the width can be saved. */
    onCommit: () => void;
    /** Double-click: go back to the default share. */
    onReset: () => void;
    /** Enter: hide the preview, as the window splitter pattern describes. */
    onToggle: () => void;
  }

  let { measure, onResize, onCommit, onReset, onToggle }: Props = $props();

  let dragging = $state(false);
  /** What assistive technology is told. It is refreshed when the splitter takes focus or changes. */
  let valueNow = $state(PREVIEW_MIN_WIDTH);
  let valueMax = $state(PREVIEW_MIN_WIDTH);

  function refreshValues() {
    const { preview, container } = measure();
    valueNow = Math.round(preview);
    valueMax = Math.max(PREVIEW_MIN_WIDTH, Math.round(container - RESULTS_MIN_WIDTH));
  }

  // The preview's size is set by CSS, so the numbers read out are measured: when the splitter appears,
  // and whenever the window changes size, not only when it is used.
  onMount(refreshValues);

  function onPointerDown(event: PointerEvent) {
    startPointerDrag(event, {
      axis: 'x',
      startSize: () => measure().preview,
      onStart: () => {
        dragging = true;
      },
      // Dragging left moves the preview's edge left, which makes it wider.
      onMove: (startWidth, distance) => onResize(clampPreviewWidth(startWidth - distance, measure().container)),
      onStop: () => {
        dragging = false;
        onCommit();
        refreshValues();
      },
    });
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      onToggle();
      return;
    }
    const { preview, container } = measure();
    const next = resizePreviewWithKey(preview, event.key, event.shiftKey, container);
    if (next === null) return;
    event.preventDefault();
    onResize(next);
    onCommit();
    valueNow = next;
  }
</script>

<svelte:window onresize={refreshValues} />

<!-- The W3C window splitter pattern: a separator that takes focus and is moved with the arrow keys.
     The lint rules treat any separator as static, which this one is not. It is the preview's edge, so
     focus on it counts as focus in the preview (hiding the preview from here moves focus to the results). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="splitter"
  class:dragging
  data-pane="preview"
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize the preview. Left and Right change the width, Enter hides it."
  aria-valuemin={PREVIEW_MIN_WIDTH}
  aria-valuemax={valueMax}
  aria-valuenow={valueNow}
  tabindex="0"
  title="Drag to resize the preview. Double-click to reset."
  onpointerdown={onPointerDown}
  onkeydown={onKeydown}
  onfocus={refreshValues}
  ondblclick={onReset}
></div>

<style>
  .splitter {
    position: absolute;
    top: 0;
    bottom: 0;
    /* Straddles the border between the panes: half on each side of the preview's left edge. */
    right: calc(var(--preview-width) - 4px);
    width: 9px;
    z-index: 6;
    cursor: col-resize;
    touch-action: none;
  }
  /* The visible line: a hairline that thickens and takes the accent while it is the thing being used. */
  .splitter::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 1px;
    background: transparent;
    transition: background-color 0.12s;
  }
  .splitter:hover::after,
  .splitter:focus-visible::after,
  .splitter.dragging::after {
    left: 3px;
    width: 3px;
    background: var(--accent);
  }
  .splitter:focus-visible {
    outline: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .splitter::after {
      transition: none;
    }
  }
</style>

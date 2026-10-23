<script lang="ts">
  import { onMount } from 'svelte';
  import { startPointerDrag } from './dragHandle';
  import { clampMapHeight, GRID_MIN_HEIGHT, MAP_MIN_HEIGHT, resizeMapWithKey } from './paneSplit';

  interface Props {
    /**
     * The heights right now, read from the page when asked. The map's size can be set by CSS, so the
     * real number only exists in the layout, and it is read fresh each time it is needed.
     */
    measure: () => { map: number; container: number };
    onResize: (height: number) => void;
    /** The user finished a drag or a key press, so the height can be saved. */
    onCommit: () => void;
    /** Double-click: go back to the default height. */
    onReset: () => void;
    /** Enter: hide the map, as the window splitter pattern describes. */
    onToggle: () => void;
  }

  let { measure, onResize, onCommit, onReset, onToggle }: Props = $props();

  let dragging = $state(false);
  /** What assistive technology is told. It is refreshed when the splitter takes focus or changes. */
  let valueNow = $state(MAP_MIN_HEIGHT);
  let valueMax = $state(MAP_MIN_HEIGHT);

  function refreshValues() {
    const { map, container } = measure();
    valueNow = Math.round(map);
    valueMax = Math.max(MAP_MIN_HEIGHT, Math.round(container - GRID_MIN_HEIGHT));
  }

  // The map's size can come from CSS, so the numbers read out are measured: when the splitter appears,
  // and whenever the window changes size, not only when it is used.
  onMount(refreshValues);

  function onPointerDown(event: PointerEvent) {
    startPointerDrag(event, {
      axis: 'y',
      startSize: () => measure().map,
      onStart: () => {
        dragging = true;
      },
      // Dragging up moves the map's top edge up, which makes it taller.
      onMove: (startHeight, distance) => onResize(clampMapHeight(startHeight - distance, measure().container)),
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
    const { map, container } = measure();
    const next = resizeMapWithKey(map, event.key, event.shiftKey, container);
    if (next === null) return;
    event.preventDefault();
    onResize(next);
    onCommit();
    valueNow = next;
  }
</script>

<svelte:window onresize={refreshValues} />

<!-- The W3C window splitter pattern: a separator that takes focus and is moved with the arrow keys.
     The lint rules treat any separator as static, which this one is not. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="splitter"
  class:dragging
  role="separator"
  aria-orientation="horizontal"
  aria-label="Resize the map. Up and Down change the height, Enter hides it."
  aria-valuemin={MAP_MIN_HEIGHT}
  aria-valuemax={valueMax}
  aria-valuenow={valueNow}
  tabindex="0"
  title="Drag to resize the map. Double-click to reset."
  onpointerdown={onPointerDown}
  onkeydown={onKeydown}
  onfocus={refreshValues}
  ondblclick={onReset}
></div>

<style>
  .splitter {
    /* Placed in the map panel's top edge, which must be a positioned box. */
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 9px;
    z-index: 6;
    cursor: row-resize;
    touch-action: none;
  }
  /* The visible line: a hairline that thickens and takes the accent while it is the thing being used. */
  .splitter::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 1px;
    background: transparent;
    transition: background-color 0.12s;
  }
  .splitter:hover::after,
  .splitter:focus-visible::after,
  .splitter.dragging::after {
    height: 3px;
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

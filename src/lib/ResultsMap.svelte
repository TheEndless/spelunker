<script module lang="ts">
  /** What the end-to-end scripts can ask the map in development builds. Coordinates are viewport CSS pixels. */
  export interface MapProbe {
    rects(count: number): { fileId: number; x: number; y: number; width: number; height: number }[];
    indexAt(x: number, y: number): { index: number; kind: 'file' | 'small-files' | 'folder-block' | null };
    timings(): { layout: number; paint: number; index: number } | null;
  }

  declare global {
    interface Window {
      __spMapProbe?: MapProbe;
    }
  }
</script>

<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { bestTextOn } from './colors';
  import { formatSize } from './format';
  import Icon from './Icon.svelte';
  import { effectiveFilter, fileTooltip, groupTooltip, legendEntries, summaryText, type TooltipText } from './mapText';
  import { tokensFor, type Mode } from './palettes';
  import { findRowIndex } from './rowLookup';
  import type { SearchSession } from './search.svelte';
  import { withShortcut } from './shortcuts';
  import type { TreemapClient } from './treemapClient.svelte';
  import { forcedMapColors, mapColors } from './treemapColors';
  import type { Direction } from './treemapIndex';
  import { RectKind, type Layout, type Metric } from './treemapLayout';
  import { paintLayout, snapToDevicePixel, type ColorMode } from './treemapPaint';
  import type { DisplayRow } from './types';

  interface Props {
    client: TreemapClient;
    session: SearchSession;
    paletteId: string;
    /** Changes whenever the theme, palette, or highlight color does, so the map repaints. */
    themeVersion: string;
    metric: Metric;
    colorMode: ColorMode;
    /** Matches needs Containing text. */
    canUseMatches: boolean;
    selectedPath: string | null;
    onMetric: (metric: Metric) => void;
    onColorMode: (mode: ColorMode) => void;
    onSelect: (row: DisplayRow) => void;
    onOpen: (row: DisplayRow) => void;
    onContextMenu: (row: DisplayRow, x: number, y: number) => void | Promise<void>;
    onCollapse: () => void;
  }

  let {
    client,
    session,
    paletteId,
    themeVersion,
    metric,
    colorMode,
    canUseMatches,
    selectedPath,
    onMetric,
    onColorMode,
    onSelect,
    onOpen,
    onContextMenu,
    onCollapse,
  }: Props = $props();

  const ANNOUNCE_DELAY_MS = 250;
  /** The hover outline: a light line with a dark line inside it. Selection uses a thicker pair. */
  const HOVER_LIGHT_WIDTH = 2;
  const HOVER_DARK_WIDTH = 1;
  const SELECTED_LIGHT_WIDTH = 3;
  const SELECTED_DARK_WIDTH = 2;
  const FRAME_DASH = [4, 4];
  const NO_DASH: number[] = [];
  const NOTHING_DIMMED: ReadonlySet<number> = new Set();
  const KIND_NAMES = ['file', 'small-files', 'folder-block'] as const;

  let stage: HTMLDivElement;
  let baseCanvas: HTMLCanvasElement;
  let overlayCanvas: HTMLCanvasElement;

  let attached = $state(false);
  let stageWidth = $state(0);
  let stageHeight = $state(0);
  let pixelRatio = $state(window.devicePixelRatio || 1);
  let font = $state('12px sans-serif');

  // ---- colors

  const readMode = (): Mode => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  /**
   * The resolved mode. Watched on the document because the app sets it in its own effect, which may
   * run after this component's, and because Auto mode follows Windows without any prop changing.
   */
  let documentMode = $state<Mode>(readMode());
  let forcedActive = $state(window.matchMedia('(forced-colors: active)').matches);

  const colors = $derived.by(() => {
    void themeVersion;
    return mapColors(tokensFor(paletteId, documentMode), documentMode);
  });
  const forced = $derived.by(() => {
    void themeVersion;
    void documentMode;
    return forcedActive ? forcedMapColors() : null;
  });

  // ---- legend filter

  const layout = $derived(client.layout);
  const hasRectangles = $derived(layout !== null && layout.count > 0);
  const legend = $derived(layout ? legendEntries(layout, colorMode, colors, metric) : []);

  /** The buckets the user picked in the legend. A choice is kept per color mode, since buckets differ. */
  let legendFilter = $state.raw<{ mode: ColorMode; buckets: ReadonlySet<number> }>({ mode: 'type', buckets: NOTHING_DIMMED });
  const chosenBuckets = $derived(legendFilter.mode === colorMode ? legendFilter.buckets : NOTHING_DIMMED);
  /** The choices still in the legend. Everything else is dimmed, and an empty set dims nothing. */
  const shownBuckets = $derived(effectiveFilter(chosenBuckets, legend));
  /**
   * The same set as a string, which compares by value. The set is rebuilt with every layout, and
   * sending the worker a "new" filter each time would start another layout, endlessly.
   */
  const shownKey = $derived([...shownBuckets].join(','));

  function toggleBucket(bucket: number) {
    const buckets = new Set(shownBuckets);
    if (buckets.has(bucket)) buckets.delete(bucket);
    else buckets.add(bucket);
    legendFilter = { mode: colorMode, buckets };
  }

  // Choices that have all left the view are dropped, so they cannot come back to dim a later view.
  $effect(() => {
    if (chosenBuckets.size > 0 && shownBuckets.size === 0) {
      untrack(() => (legendFilter = { mode: colorMode, buckets: NOTHING_DIMMED }));
    }
  });
  // Shown even when nothing has area, since it then says how many files have no weight in this view.
  const summary = $derived(layout && layout.totalFiles > 0 ? summaryText(layout, metric, client.largestFolder) : '');

  // ---- setup

  onMount(() => {
    // The base canvas goes to the worker before anything sizes it: once transferred, only the worker can.
    client.attach(baseCanvas);
    attached = true;
    font = `12px ${getComputedStyle(document.body).fontFamily}`;

    const resizeObserver = new ResizeObserver(() => {
      stageWidth = Math.floor(stage.clientWidth);
      stageHeight = Math.floor(stage.clientHeight);
    });
    resizeObserver.observe(stage);

    const themeObserver = new MutationObserver(() => (documentMode = readMode()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const forcedQuery = window.matchMedia('(forced-colors: active)');
    const onForcedChange = () => (forcedActive = forcedQuery.matches);
    forcedQuery.addEventListener('change', onForcedChange);

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      forcedQuery.removeEventListener('change', onForcedChange);
    };
  });

  // A resolution query matches only the current ratio, so it reports the next change (zoom, another monitor).
  $effect(() => {
    const query = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
    const update = () => (pixelRatio = window.devicePixelRatio || 1);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });

  onDestroy(() => {
    client.detach();
    clearTimeout(announceTimer);
    if (import.meta.env.DEV) delete window.__spMapProbe;
  });

  // Everything that decides the picture goes to the worker, which lays out and paints again.
  $effect(() => {
    if (!attached || stageWidth <= 0 || stageHeight <= 0) return;
    const view = {
      width: stageWidth,
      height: stageHeight,
      devicePixelRatio: pixelRatio,
      metric,
      colorMode,
      colors,
      forced,
      font,
      dimmed: shownKey === '' ? null : shownKey.split(',').map(Number),
    };
    untrack(() => client.setView(view));
  });

  // The overlay is the page's own canvas, so its backing store follows the stage and the pixel ratio.
  $effect(() => {
    overlayCanvas.width = Math.round(stageWidth * pixelRatio);
    overlayCanvas.height = Math.round(stageHeight * pixelRatio);
  });

  // ---- fallback painting, only when the canvas could not be handed to the worker

  $effect(() => {
    const current = layout;
    if (!attached || client.workerPaints || !current) return;
    const width = stageWidth;
    const height = stageHeight;
    baseCanvas.width = Math.round(width * pixelRatio);
    baseCanvas.height = Math.round(height * pixelRatio);
    const context = baseCanvas.getContext('2d');
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const style = { colors, colorMode, forced, font, labelColorFor: bestTextOn, pixelRatio };
    const dimmed = shownBuckets.size > 0 ? shownBuckets : null;
    paintLayout(context, current, width, height, style, dimmed, (rect) => session.rowById(current.id[rect])?.name ?? '');
  });

  // ---- selection

  let selectedRect = $state(-1);
  /** Where the arrow keys move from: the selected file, or a group or block reached with the keys. */
  let cursorRect = -1;
  let rowHint = -1;
  let locateToken = 0;
  /** The path the selection logic last saw, so a zoom-out happens for a new selection and not on every layout. */
  let handledPath: string | null = null;

  function selectedRow(): DisplayRow | undefined {
    rowHint = findRowIndex(session.sortedRows, selectedPath, rowHint);
    return rowHint >= 0 ? session.sortedRows[rowHint] : undefined;
  }

  async function followSelection(path: string | null) {
    const token = ++locateToken;
    const isNewSelection = path !== handledPath;
    handledPath = path;
    const row = selectedRow();
    const index = client.index;
    if (!row || !index) {
      selectedRect = cursorRect = -1;
      return;
    }
    const direct = index.firstWithFileId(row.id);
    if (direct >= 0) {
      selectedRect = cursorRect = direct;
      return;
    }
    // Folded into a group or block, or outside the zoomed folder: only the worker knows.
    const answer = await client.locate(row.id);
    if (token !== locateToken) return;
    if (answer.zoomFolderId !== null) {
      selectedRect = cursorRect = -1;
      // The next layout runs this again, and then the file is in view.
      if (isNewSelection) client.zoomTo(answer.zoomFolderId);
      return;
    }
    selectedRect = cursorRect = answer.rect < (client.layout?.count ?? 0) ? answer.rect : -1;
  }

  // Runs when the selection changes and after every layout, since rectangle numbers change with each one.
  $effect(() => {
    const path = selectedPath;
    void client.index;
    untrack(() => void followSelection(path));
  });

  // ---- announcements

  let announcement = $state('');
  let announceTimer: ReturnType<typeof setTimeout> | undefined;

  /** Held back while a key repeats, so a screen reader reads where the keys stopped. */
  function announce(text: string) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => (announcement = text), ANNOUNCE_DELAY_MS);
  }

  // The list announces its own selection, so the map speaks only while it has focus.
  $effect(() => {
    void selectedPath;
    untrack(() => {
      if (document.activeElement !== stage) return;
      const row = selectedRow();
      if (row) announce(`${row.name}, ${formatSize(row.size)}, in ${row.folder}`);
    });
  });

  // ---- hover and tooltip

  let hoverRect = $state(-1);
  let tooltipText = $state.raw<TooltipText | null>(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let pointerInside = false;
  let pointerX = 0;
  let pointerY = 0;
  let describeToken = 0;
  let describedFolderId = -1;
  let describedPath = '';

  function setHover(rect: number) {
    if (rect === hoverRect) return;
    hoverRect = rect;
    tooltipText = pointerInside ? tooltipFor(rect) : null;
  }

  function tooltipFor(rect: number): TooltipText | null {
    const current = client.layout;
    if (rect < 0 || !current || rect >= current.count) return null;
    if (current.kind[rect] === RectKind.File) {
      const row = session.rowById(current.id[rect]);
      return row ? fileTooltip(row) : null;
    }
    // A group's id is the folder it belongs to, and a block's id is the folder it stands for.
    const folderId = current.id[rect];
    const fileCount = current.fileCount[rect];
    const weight = current.weight[rect];
    if (folderId !== describedFolderId) {
      const token = ++describeToken;
      void client.describeFolder(folderId).then((path) => {
        if (token !== describeToken) return;
        describedFolderId = folderId;
        describedPath = path;
        if (hoverRect === rect && pointerInside) tooltipText = groupTooltip(fileCount, weight, metric, path);
      });
    }
    return groupTooltip(fileCount, weight, metric, folderId === describedFolderId ? describedPath : '');
  }

  /** Pointer position relative to the stage, read once per event. */
  function stagePoint(event: MouseEvent): { x: number; y: number } {
    const box = stage.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function rectAt(event: MouseEvent): number {
    const index = client.index;
    if (!index) return -1;
    const { x, y } = stagePoint(event);
    return index.at(x, y);
  }

  function onPointerMove(event: PointerEvent) {
    const box = stage.getBoundingClientRect();
    pointerInside = true;
    pointerX = event.clientX - box.left;
    pointerY = event.clientY - box.top;
    tooltipX = pointerX;
    tooltipY = pointerY;
    setHover(client.index ? client.index.at(pointerX, pointerY) : -1);
  }

  function onPointerLeave() {
    pointerInside = false;
    hoverRect = -1;
    tooltipText = null;
  }

  // A new layout renumbers the rectangles, so what is under a resting pointer is looked up again.
  $effect(() => {
    const index = client.index;
    untrack(() => {
      hoverRect = -1;
      tooltipText = null;
      if (pointerInside && index) setHover(index.at(pointerX, pointerY));
    });
  });

  const tooltipFlipX = $derived(tooltipX > stageWidth / 2);
  const tooltipFlipY = $derived(tooltipY > stageHeight / 2);

  // ---- overlay

  /** A rectangle's edges on whole device pixels, matching the painted fill, so outlines are crisp. */
  function snappedBox(x: number, y: number, w: number, h: number, ratio: number) {
    const left = snapToDevicePixel(x, ratio);
    const top = snapToDevicePixel(y, ratio);
    return { x: left, y: top, w: snapToDevicePixel(x + w, ratio) - left, h: snapToDevicePixel(y + h, ratio) - top };
  }

  function strokeTwoTone(
    context: CanvasRenderingContext2D,
    current: Layout,
    rect: number,
    ratio: number,
    lightWidth: number,
    darkWidth: number,
    light: string,
    dark: string,
  ) {
    let { x, y, w, h } = snappedBox(current.x[rect], current.y[rect], current.w[rect], current.h[rect], ratio);
    const total = lightWidth + darkWidth;
    // Too small to hold the outline inside, so it goes around the rectangle instead.
    if (w < 2 * total + 2 || h < 2 * total + 2) {
      x -= total;
      y -= total;
      w += 2 * total;
      h += 2 * total;
    }
    context.lineWidth = lightWidth;
    context.strokeStyle = light;
    context.strokeRect(x + lightWidth / 2, y + lightWidth / 2, w - lightWidth, h - lightWidth);
    context.lineWidth = darkWidth;
    context.strokeStyle = dark;
    const inset = lightWidth + darkWidth / 2;
    context.strokeRect(x + inset, y + inset, w - 2 * inset, h - 2 * inset);
  }

  /** The hovered rectangle's folder, as a dashed line alternating the two outline colors. */
  function strokeParentFrame(context: CanvasRenderingContext2D, current: Layout, rect: number, ratio: number, light: string, dark: string) {
    const folderId = current.folderId[rect];
    for (let frame = 0; frame < current.frameCount; frame++) {
      if (current.frameFolderId[frame] !== folderId) continue;
      const box = snappedBox(current.frameX[frame], current.frameY[frame], current.frameW[frame], current.frameH[frame], ratio);
      const x = box.x + 0.5;
      const y = box.y + 0.5;
      const w = box.w - 1;
      const h = box.h - 1;
      context.lineWidth = 1;
      context.setLineDash(FRAME_DASH);
      context.strokeStyle = light;
      context.lineDashOffset = 0;
      context.strokeRect(x, y, w, h);
      context.strokeStyle = dark;
      context.lineDashOffset = FRAME_DASH[0];
      context.strokeRect(x, y, w, h);
      context.setLineDash(NO_DASH);
      context.lineDashOffset = 0;
      return;
    }
  }

  $effect(() => {
    const current = layout;
    const hover = hoverRect;
    const selected = selectedRect;
    const width = stageWidth;
    const height = stageHeight;
    const ratio = pixelRatio;
    const light = forced ? forced.highlight : colors.outlineLight;
    const dark = forced ? forced.canvas : colors.outlineDark;
    const context = overlayCanvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!current) return;
    if (hover >= 0 && hover < current.count) {
      strokeParentFrame(context, current, hover, ratio, light, dark);
      if (hover !== selected) strokeTwoTone(context, current, hover, ratio, HOVER_LIGHT_WIDTH, HOVER_DARK_WIDTH, light, dark);
    }
    if (selected >= 0 && selected < current.count) {
      strokeTwoTone(context, current, selected, ratio, SELECTED_LIGHT_WIDTH, SELECTED_DARK_WIDTH, light, dark);
    }
  });

  // ---- actions

  function rowOfRect(rect: number): DisplayRow | undefined {
    const current = client.layout;
    if (!current || rect < 0 || rect >= current.count || current.kind[rect] !== RectKind.File) return undefined;
    return session.rowById(current.id[rect]);
  }

  /** The folder to zoom into for a rectangle: a file's or a group's own folder, or the folder a block stands for. */
  function zoomTargetOf(current: Layout, rect: number): number {
    return current.kind[rect] === RectKind.FolderBlock ? current.id[rect] : current.folderId[rect];
  }

  function zoomInto(rect: number) {
    const current = client.layout;
    if (!current || rect < 0 || rect >= current.count) return;
    client.zoomTo(zoomTargetOf(current, rect));
  }

  function zoomOut() {
    const crumbs = client.crumbs;
    if (crumbs.length >= 2) client.zoomTo(crumbs[crumbs.length - 2].folderId);
  }

  function onStageClick(event: MouseEvent) {
    const rect = rectAt(event);
    if (rect < 0) return;
    if (event.ctrlKey) {
      zoomInto(rect);
      return;
    }
    const row = rowOfRect(rect);
    if (row) onSelect(row);
    else setHover(rect);
  }

  function onStageDoubleClick(event: MouseEvent) {
    const row = rowOfRect(rectAt(event));
    if (row) onOpen(row);
  }

  function openMenuAtSelection(): void | Promise<void> {
    const current = client.layout;
    const row = selectedRow();
    if (!row || !current || selectedRect < 0 || selectedRect >= current.count) return;
    const box = stage.getBoundingClientRect();
    const x = box.left + current.x[selectedRect] + current.w[selectedRect] / 2;
    const y = box.top + current.y[selectedRect] + current.h[selectedRect] / 2;
    return onContextMenu(row, x, y);
  }

  /**
   * When the menu for a key press started, and again when it closed. The browser sends its own
   * contextmenu event for the same key press, which can arrive after a modal menu has closed.
   * The same rule as the results list.
   */
  let keyboardMenuAt = -Infinity;
  const KEY_ECHO_MS = 500;

  function onStageContextMenu(event: MouseEvent) {
    event.preventDefault();
    if (performance.now() - keyboardMenuAt < KEY_ECHO_MS) return;
    // A keyboard request whose key the stage did not see (button is not 2) is for the selected file.
    if (event.button !== 2) {
      void openMenuAtSelection();
      return;
    }
    const row = rowOfRect(rectAt(event));
    if (!row) return;
    onSelect(row);
    void onContextMenu(row, event.clientX, event.clientY);
  }

  const ARROW_DIRECTIONS: Record<string, Direction> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  };

  /** Moves the keyboard to a rectangle: a file is selected, a group or block is outlined and read out. */
  function moveTo(rect: number) {
    const current = client.layout;
    if (!current || rect < 0 || rect >= current.count) return;
    cursorRect = rect;
    const row = rowOfRect(rect);
    if (row) {
      hoverRect = -1;
      tooltipText = null;
      onSelect(row);
      return;
    }
    hoverRect = rect;
    announce(groupTooltip(current.fileCount[rect], current.weight[rect], metric, '').title);
  }

  function onStageKeydown(event: KeyboardEvent) {
    const current = client.layout;
    const index = client.index;
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction && plain && !event.shiftKey) {
      event.preventDefault();
      if (!current || !index || current.count === 0) return;
      const from = cursorRect >= 0 && cursorRect < current.count ? cursorRect : selectedRect;
      const target = from >= 0 ? index.nearest(from, direction) : 0;
      if (target >= 0) moveTo(target);
    } else if ((event.key === 'Home' || event.key === 'End') && plain) {
      event.preventDefault();
      if (current && current.count > 0) moveTo(event.key === 'Home' ? 0 : current.count - 1);
    } else if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      zoomInto(selectedRect);
    } else if (event.key === 'Enter' && plain) {
      event.preventDefault();
      const row = selectedRow();
      if (row) onOpen(row);
    } else if (event.key === 'Backspace' && plain) {
      event.preventDefault();
      zoomOut();
    } else if ((event.key === 'z' || event.key === 'Z') && plain && !event.shiftKey) {
      event.preventDefault();
      zoomInto(selectedRect);
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      keyboardMenuAt = performance.now();
      void Promise.resolve(openMenuAtSelection()).finally(() => (keyboardMenuAt = performance.now()));
    }
  }

  // ---- toolbar radio groups

  /** Left and Right (or Up and Down) move the choice within a group, skipping a disabled option. */
  function onRadioKeydown<T>(event: KeyboardEvent, options: { value: T; disabled: boolean }[], current: T, choose: (value: T) => void) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const enabled = options.filter((option) => !option.disabled);
    const position = enabled.findIndex((option) => option.value === current);
    const next = enabled[(position + step + enabled.length) % enabled.length];
    if (!next || next.value === current) return;
    choose(next.value);
    const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]');
    queueMicrotask(() => group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  }

  const metricOptions = $derived([
    { value: 'size' as Metric, label: 'Size', disabled: false },
    { value: 'matches' as Metric, label: 'Matches', disabled: !canUseMatches },
  ]);
  const colorOptions: { value: ColorMode; label: string; disabled: boolean }[] = [
    { value: 'type', label: 'File type', disabled: false },
    { value: 'age', label: 'Age', disabled: false },
  ];

  // ---- public

  export function focus() {
    stage.focus();
  }

  // ---- end-to-end probe, development builds only

  if (import.meta.env.DEV) {
    window.__spMapProbe = {
      rects(count) {
        const current = client.layout;
        if (!current) return [];
        const box = stage.getBoundingClientRect();
        const found = [];
        for (let i = 0; i < current.count && found.length < count; i++) {
          if (current.kind[i] !== RectKind.File) continue;
          found.push({ fileId: current.id[i], x: box.left + current.x[i], y: box.top + current.y[i], width: current.w[i], height: current.h[i] });
        }
        return found;
      },
      indexAt(x, y) {
        const current = client.layout;
        const index = client.index;
        if (!current || !index) return { index: -1, kind: null };
        const box = stage.getBoundingClientRect();
        const rect = index.at(x - box.left, y - box.top);
        return { index: rect, kind: rect >= 0 ? KIND_NAMES[current.kind[rect]] : null };
      },
      timings: () => client.lastTimings,
    };
  }
</script>

<section class="map" data-pane="map" aria-label="Results map">
  <div class="toolbar">
    <div class="modes" role="radiogroup" aria-label="Area">
      {#each metricOptions as option (option.value)}
        <button
          type="button"
          role="radio"
          class:on={metric === option.value}
          aria-checked={metric === option.value}
          tabindex={metric === option.value ? 0 : -1}
          disabled={option.disabled}
          title={option.disabled ? 'Matches needs Containing text' : undefined}
          onclick={() => onMetric(option.value)}
          onkeydown={(event) => onRadioKeydown(event, metricOptions, metric, onMetric)}>{option.label}</button
        >
      {/each}
    </div>
    <div class="modes" role="radiogroup" aria-label="Color">
      {#each colorOptions as option (option.value)}
        <button
          type="button"
          role="radio"
          class:on={colorMode === option.value}
          aria-checked={colorMode === option.value}
          tabindex={colorMode === option.value ? 0 : -1}
          onclick={() => onColorMode(option.value)}
          onkeydown={(event) => onRadioKeydown(event, colorOptions, colorMode, onColorMode)}>{option.label}</button
        >
      {/each}
    </div>
    <nav class="crumbs" aria-label="Map location">
      {#each client.crumbs as crumb, position (position)}
        {@const last = position === client.crumbs.length - 1}
        {#if position > 0}<span class="separator" aria-hidden="true"><Icon name="chevron-right" size={12} /></span>{/if}
        <button
          type="button"
          class="crumb"
          aria-current={last ? 'location' : undefined}
          title={crumb.label}
          onclick={() => client.zoomTo(crumb.folderId)}>{crumb.label}</button
        >
      {/each}
    </nav>
    <button
      type="button"
      class="tool"
      disabled={selectedRect < 0}
      title={withShortcut('Zoom to the selected file\'s folder', 'Z')}
      onclick={() => zoomInto(selectedRect)}>Zoom to folder</button
    >
    <button
      type="button"
      class="tool icon"
      aria-label="Hide the map"
      title={withShortcut('Hide the map', 'Ctrl+Shift+M')}
      onclick={onCollapse}
    >
      <Icon name="chevron-down" />
    </button>
  </div>

  <!-- A canvas is one element to assistive technology, so the stage takes the keys itself and the
       list stays the accessible form of the same results. The lint rules treat a group as static. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="stage"
    data-map-stage
    role="group"
    tabindex="0"
    aria-label="Results map. Arrow keys move between files, Enter opens one."
    aria-describedby="map-summary"
    bind:this={stage}
    onpointermove={onPointerMove}
    onpointerleave={onPointerLeave}
    onclick={onStageClick}
    ondblclick={onStageDoubleClick}
    oncontextmenu={onStageContextMenu}
    onkeydown={onStageKeydown}
  >
    <canvas class="base" class:hidden={!hasRectangles} aria-hidden="true" bind:this={baseCanvas} style:width="{stageWidth}px" style:height="{stageHeight}px"></canvas>
    <canvas class="overlay" class:hidden={!hasRectangles} aria-hidden="true" bind:this={overlayCanvas} style:width="{stageWidth}px" style:height="{stageHeight}px"></canvas>
    {#if !hasRectangles}
      <p class="empty">{session.running ? 'Searching...' : 'No results to map'}</p>
    {/if}
    {#if tooltipText && hasRectangles}
      <div
        class="tooltip"
        class:flip-x={tooltipFlipX}
        class:flip-y={tooltipFlipY}
        style:left="{tooltipX}px"
        style:top="{tooltipY}px"
        aria-hidden="true"
      >
        <strong>{tooltipText.title}</strong>
        {#each tooltipText.lines as line, position (position)}<span>{line}</span>{/each}
      </div>
    {/if}
  </div>

  <div class="footer">
    <p class="summary" id="map-summary">{summary}</p>
    {#if legend.length > 0}
      <div class="legend" role="group" aria-label="Legend. Choose colors to pick them out.">
        {#each legend as entry (entry.bucket)}
          <button type="button" class="entry" aria-pressed={shownBuckets.has(entry.bucket)} onclick={() => toggleBucket(entry.bucket)}>
            <span class="chip" style:background={entry.color} aria-hidden="true"></span>
            {entry.label}
            <span class="total">{entry.total}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="sr-only" role="status" aria-live="polite">{announcement}</div>
</section>

<style>
  .map {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: 100%;
    min-height: 0;
    background: var(--surface);
    color: var(--text);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    /* The splitter's 9 px drag zone lies over the top of the toolbar, so the controls start below it. */
    padding: 9px 8px 6px;
    background: var(--header-bg);
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }
  .modes {
    display: inline-flex;
    flex: none;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .modes button {
    height: 24px;
    padding: 0 9px;
    border: 0;
    background: var(--surface);
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .modes button + button {
    border-left: 1px solid var(--border-strong);
  }
  .modes button:hover:not(.on):not(:disabled) {
    color: var(--text);
  }
  .modes button.on {
    background: var(--accent);
    color: var(--on-accent);
  }
  .modes button:disabled {
    color: var(--disabled-text);
    cursor: not-allowed;
  }
  .modes button:focus-visible {
    outline-offset: -2px;
  }
  .crumbs {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--text-small);
  }
  .crumb {
    min-width: 0;
    max-width: 24ch;
    flex: 0 1 auto;
    padding: 2px 4px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* The first segment is the whole collapsed path, so it gives way first. */
  .crumb:first-of-type {
    flex-shrink: 4;
    max-width: none;
  }
  .crumb:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .crumb[aria-current='location'] {
    color: var(--text);
    font-weight: 600;
  }
  .separator {
    display: inline-flex;
    flex: none;
    color: var(--text-muted);
  }
  .tool {
    flex: none;
    font-size: var(--text-small);
  }
  .tool:disabled {
    color: var(--disabled-text);
    border-color: var(--border);
    cursor: not-allowed;
  }
  .stage {
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: var(--surface);
    cursor: default;
  }
  .stage:focus-visible {
    outline-offset: -2px;
  }
  .stage canvas {
    position: absolute;
    left: 0;
    top: 0;
    display: block;
  }
  .stage canvas.hidden {
    visibility: hidden;
  }
  .overlay {
    pointer-events: none;
  }
  .empty {
    margin: 0;
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-muted);
  }
  .tooltip {
    position: absolute;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-width: min(420px, 70%);
    padding: 6px 8px;
    margin: 14px 0 0 14px;
    /* Past the middle of the stage the tooltip sits on the other side of the pointer, so it stays inside. */
    translate: var(--shift-x, 0) var(--shift-y, 0);
    pointer-events: none;
    background: var(--surface-raised);
    color: var(--text-muted);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    font-size: var(--text-small);
  }
  .tooltip.flip-x {
    margin-left: -14px;
    --shift-x: -100%;
  }
  .tooltip.flip-y {
    margin-top: -14px;
    --shift-y: -100%;
  }
  .tooltip strong {
    color: var(--text);
    font-weight: 600;
  }
  .tooltip strong,
  .tooltip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding: 4px 8px;
    border-top: 1px solid var(--border);
    background: var(--header-bg);
    font-size: var(--text-small);
  }
  .summary {
    margin: 0;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .entry {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 7px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font-size: var(--text-small);
  }
  .entry:hover {
    border-color: var(--border-strong);
  }
  .entry[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--surface);
  }
  .chip {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex: none;
  }
  .total {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>

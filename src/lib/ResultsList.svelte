<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import {
    COLUMN_DEFINITIONS,
    COLUMN_IDS,
    MAX_COLUMN_WIDTH,
    MIN_COLUMN_WIDTH,
    moveColumnBefore,
    moveColumnByStep,
    growToFill,
    resetWidths,
    resizeColumn,
    scaleToFill,
    shrinkToFit,
    toggleColumn,
    visibleColumns,
    type ColumnId,
    type ColumnLayout,
  } from './columnLayout';
  import { fitColumnWidth, resizeWithKey } from './columnResize';
  import ContextMenu from './ContextMenu.svelte';
  import type { EmptyState } from './emptyState';
  import { createDragGesture } from './fileDrag';
  import FileIcon from './FileIcon.svelte';
  import { formatSize, modifiedLabel } from './format';
  import { gridKeyAction, keyboardMenuTarget, modifiersOf, NO_MODIFIERS, type RowPress } from './listSelectionInput';
  import { findRowIndex } from './rowLookup';
  import Icon from './Icon.svelte';
  import { selectedRows, type Modifiers, type SelectionState } from './selection';
  import { canvasMeasurer, fitMiddle } from './textFit';
  import type { DisplayRow, SortColumn, SortDirection } from './types';
  import { visibleWindow } from './virtualList';

  interface Props {
    rows: DisplayRow[];
    /** Owned by the app. The list only reports presses, releases and keys. */
    selection: SelectionState;
    sortColumn: SortColumn | null;
    sortDirection: SortDirection;
    running: boolean;
    empty: EmptyState;
    /** Extra content under the empty-state text, for example the welcome's starting points. */
    welcome?: Snippet;
    layout: ColumnLayout;
    onLayout: (layout: ColumnLayout) => void;
    onSort: (column: SortColumn) => void;
    /** A left-button press on row `index`, or the press half of a right-click or a scripted click. */
    onPress: (row: DisplayRow, index: number, modifiers: Modifiers) => void;
    /** The click that ends a press on the same row, when the press did not turn into a drag. */
    onRelease: (row: DisplayRow, index: number, modifiers: Modifiers, pressedOnSelected: boolean) => void;
    /** A movement key moved the current row to `targetIndex`. */
    onMove: (targetIndex: number, modifiers: Modifiers) => void;
    onToggleCurrent: () => void;
    onSelectAll: () => void;
    /**
     * A press on a row became a drag of files out of the window: the whole selection in list order
     * when the pressed row was selected, otherwise just that row. Resolves when the drag has ended.
     */
    onDragOut: (paths: string[]) => Promise<void>;
    /** Enter opens the current row, a double-click the clicked one. */
    onOpen: (row: DisplayRow) => void;
    /** The app decides whether the menu applies to the selection or to this row alone. */
    onContextMenu: (row: DisplayRow, x: number, y: number) => void | Promise<void>;
    /** Scrolls the list to a row picked elsewhere (the map). A new token asks again for the same path. */
    revealRequest?: { path: string; token: number } | null;
  }

  let {
    rows,
    selection,
    sortColumn,
    sortDirection,
    running,
    empty,
    welcome,
    layout,
    onLayout,
    onSort,
    onPress,
    onRelease,
    onMove,
    onToggleCurrent,
    onSelectAll,
    onDragOut,
    onOpen,
    onContextMenu,
    revealRequest = null,
  }: Props = $props();

  const ROW_HEIGHT = 26;
  const HEADER_HEIGHT = 28;
  const CELL_PADDING = 20;
  const FIT_SLACK = 8;
  /** The transparent left edge of a row, which takes room from its columns. */
  const ROW_EDGE = 3;
  /** The corner button covers the right end of the header, so fitted columns leave room for it. */
  const CORNER_WIDTH = 28;
  /** Room for the sort arrow beside a heading when fitting a column. */
  const HEADING_EXTRA = 24;
  /** Room for the file icon in front of a name. */
  const ICON_EXTRA = 24;
  /** How far the pointer must travel before a press on a heading or a row counts as a drag. */
  const DRAG_THRESHOLD = 5;

  interface Column {
    id: ColumnId;
    label: string;
    width: number;
    align: 'left' | 'right';
  }

  const columns = $derived<Column[]>(
    visibleColumns(layout).map((id) => ({
      id,
      label: COLUMN_DEFINITIONS[id].label,
      align: COLUMN_DEFINITIONS[id].align,
      width: layout.widths[id],
    })),
  );

  // Set after mount, once the grid's real font is known.
  let measureText = $state<((text: string) => number) | null>(null);
  onMount(() => {
    measureText = canvasMeasurer(getComputedStyle(scroller).font);
  });

  /** Folder paths keep their start and end and lose the middle, since both ends are informative. */
  function fitFolder(folder: string, columnWidth: number): string {
    return measureText ? fitMiddle(folder, columnWidth - CELL_PADDING, measureText) : folder;
  }

  let scrollTop = $state(0);
  let viewportHeight = $state(400);
  let scrollerWidth = $state(0);
  let scrollerClientWidth = $state(0);
  let scroller: HTMLDivElement;
  let header: HTMLDivElement;
  let headerFocus = $state(0);
  /** The heading that is the tab stop. It never points past the last column, so hiding columns cannot lose it. */
  const focusedHeading = $derived(Math.min(headerFocus, Math.max(0, columns.length - 1)));
  let cornerButton: HTMLButtonElement;
  let columnMenu = $state<{ x: number; y: number } | null>(null);

  const gridTemplate = $derived(columns.map((column) => `${column.width}px`).join(' '));
  const totalWidth = $derived(columns.reduce((sum, column) => sum + column.width, 0));
  /** The room the columns share: the pane, less the row's left edge and the corner button. */
  const availableWidth = $derived(scrollerClientWidth - ROW_EDGE - CORNER_WIDTH);
  const scrollbarWidth = $derived(Math.max(0, scrollerWidth - scrollerClientWidth));
  const scrollWindow = $derived(
    visibleWindow({
      scrollTop,
      viewportHeight: Math.max(0, viewportHeight - HEADER_HEIGHT),
      rowHeight: ROW_HEIGHT,
      rowCount: rows.length,
      overscan: 8,
    }),
  );
  const rendered = $derived(rows.slice(scrollWindow.start, scrollWindow.end));
  /** Where the current row was last time, so a growing list is not searched again from the start. */
  let currentIndexHint = -1;
  const currentIndex = $derived.by(() => {
    currentIndexHint = findRowIndex(rows, selection.current, currentIndexHint);
    return currentIndexHint;
  });

  const rowId = (index: number) => `result-row-${index}`;
  /** Screen readers follow the current row only while it is on screen, since off-screen rows are not rendered. */
  const activeDescendant = $derived(
    currentIndex >= scrollWindow.start && currentIndex < scrollWindow.end ? rowId(currentIndex) : undefined,
  );

  function cell(row: DisplayRow, id: ColumnId): string {
    switch (id) {
      case 'name':
        return row.name;
      case 'folder':
        return row.folder;
      case 'hits':
        return row.hits > 0 ? String(row.hits) : '';
      case 'size':
        return formatSize(row.size);
      case 'modified':
        return modifiedLabel(row);
      case 'type':
        return row.typeName;
    }
  }

  // ---- sizing

  /**
   * A hand-made resize. The room comes from or goes to the neighbouring columns, so the columns
   * still fill the pane, and automatic content fitting is switched off since the user took over.
   * `from` is the widths when a drag began, so each pointer move is worked out from the same start.
   */
  function resizeTo(id: ColumnId, width: number, from: Record<ColumnId, number> = layout.widths) {
    onLayout({ ...layout, widths: resizeColumn(from, visibleColumns(layout), id, width), autoSize: false });
  }

  /**
   * Follows the pointer across the whole window until the button is released or the press is
   * cancelled. `finish` hears the event that ended it, or none when the caller stopped it. Returns
   * that stop function.
   */
  function trackPointer(move: (event: PointerEvent) => void, finish?: (event?: PointerEvent) => void): () => void {
    const stop = (event?: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      finish?.(event);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return stop;
  }

  function startResize(event: PointerEvent, column: Column) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = column.width;
    const startWidths = { ...layout.widths };
    trackPointer((moveEvent) => resizeTo(column.id, startWidth + moveEvent.clientX - startX, startWidths));
  }

  /** The width that shows a column's widest visible cell. Only rows on screen are measured, which keeps it instant. */
  function widthToFit(column: Column): number | null {
    const measure = measureText;
    if (!measure) return null;
    const texts = rendered.map((row) => cell(row, column.id));
    return fitColumnWidth({
      cellWidths: texts.map((text) => measure(text) + (column.id === 'name' ? ICON_EXTRA : 0)),
      headerWidth: measure(column.label) + HEADING_EXTRA,
      // A little slack: tabular digits in right-aligned columns are wider than the measurement says.
      padding: CELL_PADDING + FIT_SLACK,
      min: MIN_COLUMN_WIDTH,
      max: MAX_COLUMN_WIDTH,
    });
  }

  function fitColumn(column: Column) {
    const width = widthToFit(column);
    if (width !== null) resizeTo(column.id, width);
  }

  /** Fits every column, as a single change so the layout is saved once. */
  function fitAllColumns({ automatic }: { automatic: boolean }) {
    const fitted = { ...layout.widths };
    for (const column of columns) {
      const width = widthToFit(column);
      if (width !== null) fitted[column.id] = width;
    }
    // Fill the pane exactly: the least important columns give way when it is too narrow, and Folder
    // takes up the room when it is wide.
    const visible = visibleColumns(layout);
    applyWidths(growToFill(shrinkToFit(fitted, visible, availableWidth), visible, availableWidth), automatic);
  }

  /** Saves a new set of widths, unless they are what is already there, which is most fits while a search runs. */
  function applyWidths(widths: Record<ColumnId, number>, autoSize = layout.autoSize) {
    const unchanged = visibleColumns(layout).every((id) => widths[id] === layout.widths[id]);
    if (unchanged && autoSize === layout.autoSize) return;
    onLayout({ ...layout, widths, autoSize });
  }

  // While automatic sizing is on, columns keep fitting. They fit as results start arriving and
  // while a search runs, when it finishes, and whenever the pane changes size (the window, the
  // splitter, the preview hiding) or a column is shown or hidden.
  const visibleKey = $derived(visibleColumns(layout).join(','));
  let refitTimer: ReturnType<typeof setTimeout> | undefined;

  /** Keeps the columns exactly filling the pane after the user has sized some by hand. */
  function fillPane() {
    applyWidths(scaleToFill(layout.widths, visibleColumns(layout), availableWidth));
  }

  /** Brings the columns in line with the pane: fitted to content when automatic, rescaled otherwise. */
  function refitSoon(delay = 60) {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => {
      // Before the pane has been measured there is nothing sensible to fit to.
      if (!measureText || availableWidth < 200) return;
      if (layout.autoSize) fitAllColumns({ automatic: true });
      else fillPane();
    }, delay);
  }

  $effect(() => {
    void scrollerClientWidth;
    void visibleKey;
    void measureText;
    untrack(() => refitSoon());
    return () => clearTimeout(refitTimer);
  });

  $effect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      if (layout.autoSize && rows.length > 0) fitAllColumns({ automatic: true });
    }, 1200);
    return () => clearInterval(interval);
  });

  let wasRunning = false;
  $effect(() => {
    const isRunning = running;
    const finished = wasRunning && !isRunning;
    wasRunning = isRunning;
    if (finished) untrack(() => layout.autoSize && refitSoon(0));
  });

  // ---- reordering by dragging a heading

  let drag = $state<{ id: ColumnId; active: boolean; indicatorX: number } | null>(null);
  /** A drag ends in a click event on the heading, which must not also sort the column. */
  let suppressNextSort = false;

  /** Where a column dropped at screen position `pointerX` would land: before which column, and the line to draw. */
  function dropTarget(pointerX: number): { beforeId: ColumnId | null; indicatorX: number } {
    let left = 0;
    const headerLeft = header.getBoundingClientRect().left;
    for (const column of columns) {
      if (pointerX < headerLeft + left + column.width / 2) return { beforeId: column.id, indicatorX: left };
      left += column.width;
    }
    return { beforeId: null, indicatorX: left };
  }

  function startHeadingDrag(event: PointerEvent, column: Column) {
    if (event.button !== 0 || columns.length < 2) return;
    const startX = event.clientX;
    let target = dropTarget(startX);
    drag = { id: column.id, active: false, indicatorX: target.indicatorX };
    const move = (moveEvent: PointerEvent) => {
      if (!drag) return;
      if (!drag.active && Math.abs(moveEvent.clientX - startX) < DRAG_THRESHOLD) return;
      target = dropTarget(moveEvent.clientX);
      drag = { id: column.id, active: true, indicatorX: target.indicatorX };
    };
    trackPointer(move, () => {
      if (drag?.active) {
        suppressNextSort = true;
        onLayout(moveColumnBefore(layout, column.id, target.beforeId));
      }
      drag = null;
    });
  }

  function onHeadingClick(column: Column) {
    if (suppressNextSort) {
      suppressNextSort = false;
      return;
    }
    onSort(column.id);
  }

  // ---- scrolling and keyboard

  function revealIndex(index: number) {
    const top = index * ROW_HEIGHT;
    const visibleHeight = viewportHeight - HEADER_HEIGHT;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_HEIGHT > scroller.scrollTop + visibleHeight) {
      scroller.scrollTop = top + ROW_HEIGHT - visibleHeight;
    }
    // The scroll event arrives a frame later. Update now so the selected row is rendered at once.
    scrollTop = scroller.scrollTop;
  }

  // After the user sorts, the current row has moved. Bring it back into view so it stays reachable.
  let lastSort: string | undefined;
  $effect(() => {
    const currentSort = `${sortColumn}/${sortDirection}`;
    const changed = lastSort !== undefined && currentSort !== lastSort;
    lastSort = currentSort;
    if (!changed) return;
    queueMicrotask(() => {
      if (currentIndex >= 0) revealIndex(currentIndex);
    });
  });

  // A row selected outside the list is scrolled into view, once per request.
  let lastRevealToken = -1;
  $effect(() => {
    const request = revealRequest;
    if (!request || request.token === lastRevealToken) return;
    lastRevealToken = request.token;
    queueMicrotask(() => {
      const index = findRowIndex(rows, request.path, -1);
      if (index >= 0) revealIndex(index);
    });
  });

  /**
   * The keyboard's menu, doing what a right-click on its row does: on the current row (selected alone
   * first when it is not selected), or without one on the first selected row on screen. The app
   * decides whether it covers the selection.
   */
  function openContextMenuAtCurrent(): void | Promise<void> {
    const firstOnScreen = Math.floor(scroller.scrollTop / ROW_HEIGHT);
    const endOnScreen = Math.ceil((scroller.scrollTop + viewportHeight - HEADER_HEIGHT) / ROW_HEIGHT);
    const target = keyboardMenuTarget(selection, rows, firstOnScreen, endOnScreen, currentIndex);
    if (!target) return;
    const row = rows[target.index];
    if (target.selectFirst) onPress(row, target.index, NO_MODIFIERS);
    revealIndex(target.index);
    const anchor = document.getElementById(rowId(target.index)) ?? scroller;
    const box = anchor.getBoundingClientRect();
    return onContextMenu(row, box.left + 32, box.bottom);
  }

  /**
   * When the menu for a key press started, and again when it closed. The browser sends its own
   * contextmenu event for the same key press, which can arrive after a modal menu has closed.
   */
  let keyboardMenuAt = -Infinity;
  const KEY_ECHO_MS = 500;

  /**
   * A context menu requested from the keyboard also arrives here (the target is the grid itself,
   * since focus is on it). Without this, Windows would also show the browser's own menu. The key
   * handler has already opened the menu for that key press, so its echo is ignored.
   */
  function onGridContextMenu(event: MouseEvent) {
    event.preventDefault();
    if (event.target !== scroller) return;
    // A mouse right-click on the empty space below the rows is not a request for the current file's menu.
    if (event.button === 2) return;
    if (performance.now() - keyboardMenuAt < KEY_ECHO_MS) return;
    openContextMenuAtCurrent();
  }

  function onKeydown(event: KeyboardEvent) {
    // Keys pressed on a column heading belong to the heading, not to the rows. That also keeps
    // Ctrl+A for the grid alone, so the text boxes keep their own select all.
    if (event.target !== scroller) return;
    const page = Math.max(1, Math.floor((viewportHeight - HEADER_HEIGHT) / ROW_HEIGHT) - 1);
    const action = gridKeyAction(event, currentIndex, rows.length, page);
    if (!action) return;
    event.preventDefault();
    if (action.kind === 'move') {
      onMove(action.targetIndex, action.modifiers);
      revealIndex(action.targetIndex);
    } else if (action.kind === 'selectAll') {
      onSelectAll();
    } else if (action.kind === 'toggleCurrent') {
      onToggleCurrent();
    } else if (action.kind === 'open') {
      const current = rows[currentIndex];
      if (current) onOpen(current);
    } else if (action.kind === 'menu') {
      keyboardMenuAt = performance.now();
      void Promise.resolve(openContextMenuAtCurrent()).finally(() => (keyboardMenuAt = performance.now()));
    }
  }

  // ---- pressing and clicking rows

  /** The last left-button press on a row, until its click. Plain data: nothing renders from it. */
  let rowPress: RowPress | null = null;
  /** Decides when a press becomes a file drag, and which files it carries. */
  const fileDrag = createDragGesture({ threshold: DRAG_THRESHOLD });
  /** Stops following the pointer for the last press, while it is still followed. */
  let stopFollowingPress: (() => void) | null = null;

  /**
   * Selects at once what a press selects (an unselected row, a Shift range), and watches for a drag.
   * No preventDefault here: `user-select: none` on the rows is what keeps text from being selected.
   */
  function onRowPointerDown(event: PointerEvent, row: DisplayRow, index: number) {
    if (event.button !== 0) return;
    // A native drag takes the release, so the page may never have seen the last press end. Whatever
    // is left of it ends here, so nothing from it outlives into this press.
    stopFollowingPress?.();
    const press: RowPress = {
      path: row.path,
      index,
      pressedOnSelected: selection.paths.has(row.path),
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
    };
    rowPress = press;
    onPress(row, index, modifiersOf(event));
    fileDrag.press({ x: event.clientX, y: event.clientY }, row.path, press.pressedOnSelected, () =>
      selectedRows(selection, rows).map((selectedRow) => selectedRow.path),
    );
    const forget = () => {
      if (rowPress === press) rowPress = null;
    };
    const stop = trackPointer(
      (moveEvent) => {
        const step = fileDrag.move({ x: moveEvent.clientX, y: moveEvent.clientY }, moveEvent.buttons);
        // The button went up where the page did not see it (outside the window, or a modal loop took it).
        if ((moveEvent.buttons & 1) === 0) return stop();
        if (step.kind === 'start') {
          // The gesture has already forgotten the press, so it cannot start a second drag. The
          // press no longer ends in a release on its row: it stays only until the page sees the
          // button up (the release, a move with the button up, or the next press), so a click
          // that does follow it in a browser does not count as a new press.
          press.dragged = true;
          void onDragOut(step.paths);
        }
      },
      // The row's click follows a release in the same input event, after this. The press is kept for
      // it and forgotten one task later. A cancelled press, or a release the page never saw, has no click.
      (endEvent) => {
        if (stopFollowingPress === stop) stopFollowingPress = null;
        if (endEvent?.type === 'pointerup') {
          fileDrag.release();
          setTimeout(forget);
        } else {
          fileDrag.cancel();
          forget();
        }
      },
    );
    stopFollowingPress = stop;
  }

  /** Finishes a press with the release rules, unless the press became a drag. */
  function onRowClick(event: MouseEvent, row: DisplayRow, index: number) {
    const press = rowPress;
    rowPress = null;
    const modifiers = modifiersOf(event);
    if (press?.path !== row.path) {
      // A click with no press before it (a script's element.click()) is a whole press and release.
      const pressedOnSelected = selection.paths.has(row.path);
      onPress(row, index, modifiers);
      onRelease(row, index, modifiers, pressedOnSelected);
    } else if (!press.dragged) {
      onRelease(row, index, modifiers, press.pressedOnSelected);
    }
  }

  /** A right-click on an unselected row selects it alone. On a selected row the selection stays. */
  function onRowContextMenu(event: MouseEvent, row: DisplayRow, index: number) {
    event.preventDefault();
    onPress(row, index, NO_MODIFIERS);
    onContextMenu(row, event.clientX, event.clientY);
  }

  function openColumnMenuAt(element: Element) {
    if (columnMenu) {
      columnMenu = null;
      return;
    }
    const box = element.getBoundingClientRect();
    columnMenu = { x: box.left, y: box.bottom };
  }

  /** Closing the chooser can destroy the heading that had focus (a hidden column), so focus lands somewhere real. */
  async function closeColumnMenu() {
    columnMenu = null;
    await tick();
    if (document.activeElement === document.body || !document.activeElement) cornerButton.focus();
  }

  /**
   * Keys on a column heading. Left and Right move between headings (the header is one tab stop),
   * Ctrl+Left and Ctrl+Right resize the column, Ctrl+Enter fits it to its content, and
   * Alt+Shift+Left and Alt+Shift+Right move the column. The Menu key opens the column chooser.
   */
  function onHeadingKeydown(event: KeyboardEvent, column: Column, index: number) {
    // Only keys the heading uses are claimed, so app shortcuts (F6, F1, Esc, Ctrl+L) still work.
    if (event.key === 'ArrowDown') {
      scroller.focus();
      event.preventDefault();
      return;
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      openColumnMenuAt(event.currentTarget as Element);
      event.preventDefault();
      return;
    }
    if (event.altKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const moved = moveColumnByStep(layout, column.id, event.key === 'ArrowLeft' ? -1 : 1);
      if (moved !== layout) {
        onLayout(moved);
        const target = visibleColumns(moved).indexOf(column.id);
        headerFocus = target;
        // The headings are re-rendered in their new order, so focus the moved one afterwards.
        queueMicrotask(() => scroller.querySelectorAll<HTMLButtonElement>('.head button')[target]?.focus());
      }
      event.preventDefault();
      return;
    }
    if (event.ctrlKey && event.key === 'Enter') {
      fitColumn(column);
      event.preventDefault();
      return;
    }
    if (event.ctrlKey) {
      const width = resizeWithKey(column.width, event.key, event.shiftKey, MIN_COLUMN_WIDTH);
      if (width !== null) {
        resizeTo(column.id, width);
        event.preventDefault();
      }
      return;
    }
    const buttons = [...scroller.querySelectorAll<HTMLButtonElement>('.head button')];
    const target =
      event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
    if (target !== null && buttons[target]) {
      buttons[target].focus();
      event.preventDefault();
    }
  }

  function headingHint(column: Column): string {
    const sortNote = running ? 'Sorting applies when the search finishes. ' : '';
    return `${sortNote}Sort by ${column.label}. Drag to move. Ctrl+Left or Ctrl+Right resizes, Ctrl+Enter fits, Alt+Shift+Left or Right moves.`;
  }

  function resetColumns(): ColumnLayout {
    return resetWidths({ ...layout, order: [...COLUMN_IDS], hidden: [] });
  }

  /** Every column in the user's order, hidden ones included, so the chooser mirrors the grid. */
  const columnMenuItems = $derived([
    ...layout.order.map((id) => ({
      label: COLUMN_DEFINITIONS[id].label,
      checked: !layout.hidden.includes(id),
      keepOpen: true,
      action: () => onLayout(toggleColumn(layout, id)),
    })),
    {
      label: 'Size columns to fit automatically',
      checked: layout.autoSize,
      keepOpen: true,
      separatorBefore: true,
      action: () => (layout.autoSize ? onLayout({ ...layout, autoSize: false }) : fitAllColumns({ automatic: true })),
    },
    { label: 'Fit columns to content now', action: () => fitAllColumns({ automatic: false }) },
    { label: 'Reset columns', action: () => onLayout(resetColumns()) },
  ]);
</script>

<!-- A second source for the pane width besides the element's size observer, so a missed
     notification can never leave the columns sized for an older window. -->
<svelte:window onresize={() => scroller && (scrollerClientWidth = scroller.clientWidth)} />

<div class="wrap">
  <div
    class="scroller"
    role="grid"
    aria-label="Search results"
    aria-multiselectable="true"
    aria-rowcount={Math.max(rows.length, 1) + 1}
    aria-colcount={columns.length}
    aria-activedescendant={activeDescendant}
    tabindex="0"
    bind:this={scroller}
    bind:clientHeight={viewportHeight}
    bind:offsetWidth={scrollerWidth}
    bind:clientWidth={scrollerClientWidth}
    onscroll={() => (scrollTop = scroller.scrollTop)}
    onkeydown={onKeydown}
    oncontextmenu={onGridContextMenu}
  >
    <!-- Right-click and dragging are mouse shortcuts. The heading buttons offer the same through the keyboard
         (Menu key opens the column chooser, Alt+Shift+Arrow moves a column). -->
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div
      class="header"
      role="row"
      aria-rowindex="1"
      bind:this={header}
      style:grid-template-columns={gridTemplate}
      style:width="{totalWidth}px"
      oncontextmenu={(event) => {
        event.preventDefault();
        columnMenu = { x: event.clientX, y: event.clientY };
      }}
    >
      {#each columns as column, index (column.id)}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div
          class="head"
          role="columnheader"
          aria-colindex={index + 1}
          class:right={column.align === 'right'}
          class:dragged={drag?.active && drag.id === column.id}
          aria-sort={sortColumn === column.id ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
          onpointerdown={(event) => startHeadingDrag(event, column)}
        >
          <button
            type="button"
            tabindex={index === focusedHeading ? 0 : -1}
            aria-keyshortcuts="Control+ArrowLeft Control+ArrowRight Control+Enter Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
            title={headingHint(column)}
            onfocus={() => (headerFocus = index)}
            onkeydown={(event) => onHeadingKeydown(event, column, index)}
            onclick={() => onHeadingClick(column)}
          >
            {column.label}
            {#if sortColumn === column.id}<span class="arrow"><Icon name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'} size={12} /></span>{/if}
          </button>
          <!-- The drag handle is for the mouse. Keyboard users resize from the heading itself. -->
          <div
            class="resizer"
            aria-hidden="true"
            onpointerdown={(event) => startResize(event, column)}
            ondblclick={() => fitColumn(column)}
          ></div>
        </div>
      {/each}
      {#if drag?.active}<div class="drop-line" style:left="{drag.indicatorX}px" aria-hidden="true"></div>{/if}
    </div>

    {#if rows.length === 0}
      <div class="empty" class:lit={welcome !== undefined} role="row" aria-rowindex="2">
        <div role="gridcell" aria-colspan={columns.length}>
          <strong>{empty.title}</strong>
          {#each empty.lines as line (line)}<p>{line}</p>{/each}
          {#if welcome}{@render welcome()}{/if}
        </div>
      </div>
    {:else}
      <div class="body" style:height="{scrollWindow.totalHeight}px" style:width="{totalWidth}px">
        <div class="window" style:transform="translateY({scrollWindow.offsetY}px)">
          {#each rendered as row, offset (row.path)}
            {@const index = scrollWindow.start + offset}
            {@const selected = selection.paths.has(row.path)}
            <!-- Keyboard access is handled once on the grid (arrows, Enter, Menu key), not per row. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
            <div
              class="row"
              role="row"
              id={rowId(index)}
              aria-rowindex={index + 2}
              aria-selected={selected}
              class:selected
              class:current={index === currentIndex}
              style:grid-template-columns={gridTemplate}
              style:height="{ROW_HEIGHT}px"
              onpointerdown={(event) => onRowPointerDown(event, row, index)}
              onclick={(event) => onRowClick(event, row, index)}
              ondblclick={() => onOpen(row)}
              oncontextmenu={(event) => onRowContextMenu(event, row, index)}
            >
              {#each columns as column, columnIndex (column.id)}
                <div
                  class="cell"
                  class:with-icon={column.id === 'name'}
                  role="gridcell"
                  aria-colindex={columnIndex + 1}
                  class:right={column.align === 'right'}
                  title={column.id === 'folder' ? row.folder : ''}
                >
                  {#if column.id === 'name'}<FileIcon name={row.name} />{/if}
                  <span class="text" class:count={column.id === 'hits'} class:quiet={column.id === 'folder'}
                    >{column.id === 'folder' ? fitFolder(row.folder, column.width) : cell(row, column.id)}</span
                  >
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- Sits over the top-right corner, beside the scroll bar, so there is always a visible way to
       choose columns. The right-click and Menu-key routes do the same. -->
  <button
    type="button"
    class="corner"
    bind:this={cornerButton}
    style:right="{scrollbarWidth}px"
    aria-label="Choose columns"
    title="Choose columns"
    aria-haspopup="menu"
    aria-expanded={columnMenu !== null}
    onpointerdown={(event) => columnMenu && event.stopPropagation()}
    onclick={(event) => openColumnMenuAt(event.currentTarget)}
  >
    <Icon name="columns" size={14} />
  </button>
</div>

{#if columnMenu}
  <ContextMenu x={columnMenu.x} y={columnMenu.y} items={columnMenuItems} label="Columns" onClose={closeColumnMenu} />
{/if}

<style>
  .wrap {
    position: relative;
    height: 100%;
  }
  .scroller {
    height: 100%;
    overflow: auto;
    background: var(--surface);
    position: relative;
  }
  /* The grid scrolls, so its focus ring must sit inside it or the scroll box clips it. */
  .scroller:focus-visible {
    outline-offset: -2px;
  }
  .header {
    display: grid;
    position: sticky;
    top: 0;
    z-index: 2;
    height: 28px;
    background: var(--header-bg);
    border-bottom: 1px solid var(--border);
  }
  .head {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: stretch;
    touch-action: none;
  }
  .head.dragged {
    opacity: 0.45;
  }
  .head button {
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    text-align: left;
    padding: 0 10px;
    color: var(--text-muted);
    font-weight: 600;
    font-size: var(--text-small);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .head button:focus-visible {
    outline-offset: -2px;
  }
  .head.right button {
    text-align: right;
  }
  .head button:hover {
    color: var(--text);
  }
  .arrow {
    display: inline-flex;
    vertical-align: middle;
    margin-left: 4px;
    color: var(--accent-text);
  }
  .resizer {
    width: 7px;
    margin-right: -3px;
    cursor: col-resize;
    position: relative;
    z-index: 3;
  }
  .resizer::after {
    content: '';
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 3px;
    width: 1px;
    background: var(--border-strong);
  }
  .drop-line {
    position: absolute;
    top: 2px;
    bottom: 2px;
    width: 2px;
    margin-left: -1px;
    background: var(--accent);
    z-index: 4;
    pointer-events: none;
  }
  .corner {
    position: absolute;
    top: 0;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    padding: 0;
    z-index: 5;
    border: 0;
    border-left: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: var(--header-bg);
    color: var(--text-muted);
  }
  .corner:hover,
  .corner[aria-expanded='true'] {
    color: var(--text);
    background: var(--row-hover);
  }
  .corner:focus-visible {
    outline-offset: -2px;
  }
  .body {
    position: relative;
    overflow: hidden;
  }
  .window {
    will-change: transform;
  }
  .row {
    display: grid;
    align-items: center;
    border-left: 3px solid transparent;
    cursor: default;
    /* Pressing and dragging across rows selects rows or files, never a sweep of page text. */
    user-select: none;
  }
  .row:hover {
    background: var(--row-hover);
  }
  .row.selected {
    background: var(--row-selected);
    border-left-color: color-mix(in srgb, var(--row-selected-edge) 35%, transparent);
  }
  /* The current row has the full edge, also when Ctrl moved it onto an unselected row. */
  .row.current {
    border-left-color: var(--row-selected-edge);
  }
  .cell {
    padding: 0 10px;
    white-space: nowrap;
    overflow: hidden;
    min-width: 0;
  }
  .cell.with-icon {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .cell .text {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .cell:not(.with-icon) .text {
    display: block;
  }
  .cell.right {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  /* The name is what was found. The folder says where, more quietly. The count says how much, in the accent. */
  .cell .quiet {
    color: var(--text-muted);
  }
  .cell .count {
    color: var(--accent-text);
    font-weight: 600;
  }
  .row.selected .cell .quiet {
    color: var(--text);
  }
  .empty {
    padding: 36px 28px;
    color: var(--text-muted);
    text-align: center;
  }
  /* Before the first search, a soft beam of light falls on the title from above. */
  .empty.lit {
    padding-top: 48px;
    background: radial-gradient(ellipse 40% 60% at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%);
  }
  .empty strong {
    display: block;
    margin-bottom: 6px;
    color: var(--text);
    font-size: 15px;
  }
  .empty.lit strong {
    font-size: 20px;
    font-weight: 600;
  }
  .empty p {
    margin: 2px auto;
    max-width: 52ch;
  }
</style>

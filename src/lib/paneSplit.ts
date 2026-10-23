/** The narrowest the preview can be made. Narrower than this its tools no longer fit. */
export const PREVIEW_MIN_WIDTH = 280;
/** The results always keep at least this much, so the grid stays usable. */
export const RESULTS_MIN_WIDTH = 360;
const SMALL_STEP = 16;
const LARGE_STEP = 48;

const widest = (containerWidth: number) => Math.max(PREVIEW_MIN_WIDTH, containerWidth - RESULTS_MIN_WIDTH);

/** Keeps a preview width between the minimum and what leaves the results their minimum, in whole pixels. */
export function clampPreviewWidth(width: number, containerWidth: number): number {
  return Math.round(Math.min(widest(containerWidth), Math.max(PREVIEW_MIN_WIDTH, width)));
}

/**
 * The new preview width after a key on the splitter, or null for a key it does not use. The
 * splitter sits on the preview's left edge, so Left moves the edge left and widens the preview.
 */
export function resizePreviewWithKey(width: number, key: string, shift: boolean, containerWidth: number): number | null {
  const step = shift ? LARGE_STEP : SMALL_STEP;
  switch (key) {
    case 'ArrowLeft':
      return clampPreviewWidth(width + step, containerWidth);
    case 'ArrowRight':
      return clampPreviewWidth(width - step, containerWidth);
    case 'Home':
      return PREVIEW_MIN_WIDTH;
    case 'End':
      return widest(containerWidth);
    default:
      return null;
  }
}

/** The shortest the results map can be made. */
export const MAP_MIN_HEIGHT = 140;
/** The results grid always keeps at least this much height, so it stays usable. */
export const GRID_MIN_HEIGHT = 200;

const tallest = (containerHeight: number) => Math.max(MAP_MIN_HEIGHT, containerHeight - GRID_MIN_HEIGHT);

/** Keeps a map height between the minimum and what leaves the grid its minimum, in whole pixels. */
export function clampMapHeight(height: number, containerHeight: number): number {
  return Math.round(Math.min(tallest(containerHeight), Math.max(MAP_MIN_HEIGHT, height)));
}

/** The new map height after a key on the splitter, or null for a key it does not use. Up moves the map's top edge up, which makes it taller. */
export function resizeMapWithKey(height: number, key: string, shift: boolean, containerHeight: number): number | null {
  const step = shift ? LARGE_STEP : SMALL_STEP;
  switch (key) {
    case 'ArrowUp':
      return clampMapHeight(height + step, containerHeight);
    case 'ArrowDown':
      return clampMapHeight(height - step, containerHeight);
    case 'Home':
      return MAP_MIN_HEIGHT;
    case 'End':
      return tallest(containerHeight);
    default:
      return null;
  }
}

/** A stored map height is used only if it is a sensible number. Otherwise the default applies. */
export function normalizeMapHeight(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= MAP_MIN_HEIGHT ? Math.round(raw) : null;
}

/** Whether a container this tall has room for the grid and the map at their minimums. */
export function mapFits(containerHeight: number): boolean {
  return containerHeight >= GRID_MIN_HEIGHT + MAP_MIN_HEIGHT;
}

/** A stored width is used only if it is a sensible number. Otherwise the default share applies. */
export function normalizePreviewWidth(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= PREVIEW_MIN_WIDTH ? Math.round(raw) : null;
}

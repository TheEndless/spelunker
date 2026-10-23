import { describe, expect, it } from 'vitest';
import {
  clampMapHeight,
  GRID_MIN_HEIGHT,
  MAP_MIN_HEIGHT,
  mapFits,
  normalizeMapHeight,
  resizeMapWithKey,
  clampPreviewWidth,
  normalizePreviewWidth,
  PREVIEW_MIN_WIDTH,
  RESULTS_MIN_WIDTH,
  resizePreviewWithKey,
} from './paneSplit';

describe('clampPreviewWidth', () => {
  it('keeps a width that already fits', () => {
    expect(clampPreviewWidth(500, 1280)).toBe(500);
  });

  it('raises a width that is too narrow to the minimum', () => {
    expect(clampPreviewWidth(50, 1280)).toBe(PREVIEW_MIN_WIDTH);
  });

  it('lowers a width that would squeeze the results below their minimum', () => {
    expect(clampPreviewWidth(1200, 1280)).toBe(1280 - RESULTS_MIN_WIDTH);
  });

  it('prefers the minimum preview width when the window is too small for both', () => {
    expect(clampPreviewWidth(400, 500)).toBe(PREVIEW_MIN_WIDTH);
  });

  it('rounds to whole pixels', () => {
    expect(clampPreviewWidth(400.6, 1280)).toBe(401);
  });
});

describe('resizePreviewWithKey', () => {
  it('Left makes the preview wider, since its edge moves left', () => {
    expect(resizePreviewWithKey(400, 'ArrowLeft', false, 1280)).toBe(416);
  });

  it('Right makes it narrower', () => {
    expect(resizePreviewWithKey(400, 'ArrowRight', false, 1280)).toBe(384);
  });

  it('Shift takes bigger steps', () => {
    expect(resizePreviewWithKey(400, 'ArrowLeft', true, 1280)).toBe(448);
  });

  it('Home and End jump to the narrowest and widest', () => {
    expect(resizePreviewWithKey(400, 'Home', false, 1280)).toBe(PREVIEW_MIN_WIDTH);
    expect(resizePreviewWithKey(400, 'End', false, 1280)).toBe(1280 - RESULTS_MIN_WIDTH);
  });

  it('stays inside the limits', () => {
    expect(resizePreviewWithKey(PREVIEW_MIN_WIDTH, 'ArrowRight', false, 1280)).toBe(PREVIEW_MIN_WIDTH);
    expect(resizePreviewWithKey(1280 - RESULTS_MIN_WIDTH, 'ArrowLeft', false, 1280)).toBe(1280 - RESULTS_MIN_WIDTH);
  });

  it('ignores other keys', () => {
    expect(resizePreviewWithKey(400, 'a', false, 1280)).toBeNull();
    expect(resizePreviewWithKey(400, 'ArrowUp', false, 1280)).toBeNull();
  });
});

describe('map height', () => {
  it('clamps between the minimum and what leaves the grid its minimum', () => {
    expect(clampMapHeight(10, 800)).toBe(MAP_MIN_HEIGHT);
    expect(clampMapHeight(9999, 800)).toBe(800 - GRID_MIN_HEIGHT);
    expect(clampMapHeight(300, 800)).toBe(300);
  });
  it('keeps the minimum when the container is too short for both', () => {
    expect(clampMapHeight(300, 200)).toBe(MAP_MIN_HEIGHT);
  });
  it('grows with ArrowUp and shrinks with ArrowDown', () => {
    expect(resizeMapWithKey(300, 'ArrowUp', false, 800)).toBe(316);
    expect(resizeMapWithKey(300, 'ArrowDown', true, 800)).toBe(252);
    expect(resizeMapWithKey(300, 'Home', false, 800)).toBe(MAP_MIN_HEIGHT);
    expect(resizeMapWithKey(300, 'End', false, 800)).toBe(800 - GRID_MIN_HEIGHT);
    expect(resizeMapWithKey(300, 'x', false, 800)).toBeNull();
  });
  it('normalizes a stored height', () => {
    expect(normalizeMapHeight(260.4)).toBe(260);
    expect(normalizeMapHeight(10)).toBeNull();
    expect(normalizeMapHeight('x')).toBeNull();
  });
  it('knows when the map fits', () => {
    expect(mapFits(GRID_MIN_HEIGHT + MAP_MIN_HEIGHT)).toBe(true);
    expect(mapFits(GRID_MIN_HEIGHT + MAP_MIN_HEIGHT - 1)).toBe(false);
  });
});

describe('normalizePreviewWidth', () => {
  it('keeps a usable stored width', () => {
    expect(normalizePreviewWidth(512)).toBe(512);
  });

  it('treats anything else as "not chosen yet", so the default applies', () => {
    expect(normalizePreviewWidth(null)).toBeNull();
    expect(normalizePreviewWidth('wide')).toBeNull();
    expect(normalizePreviewWidth(Number.NaN)).toBeNull();
    expect(normalizePreviewWidth(10)).toBeNull();
    expect(normalizePreviewWidth(-5)).toBeNull();
  });
});

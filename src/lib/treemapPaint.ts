// The worker paints with this module too. textFit only touches the document in canvasMeasurer,
// which is not used here, so it is safe to load in a worker.
import { fitMiddle } from './textFit';
import type { ForcedColors, MapColors } from './treemapColors';
import { RectKind, type Layout } from './treemapLayout';

export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ColorMode = 'type' | 'age';

export interface PaintStyle {
  colors: MapColors;
  colorMode: ColorMode;
  /** Set under forced-colors mode: no fills, only outlines in system colors. */
  forced: ForcedColors | null;
  font: string;
  labelColorFor: (fill: string) => string;
  /** Device pixels per CSS pixel, so edges can be put on whole device pixels. */
  pixelRatio: number;
}

/**
 * The nearest whole device pixel, in CSS pixels. Layout positions are fractional, and an edge
 * between two device pixels is drawn as a blend of both colors, which looks soft.
 */
export function snapToDevicePixel(value: number, pixelRatio: number): number {
  return Math.round(value * pixelRatio) / pixelRatio;
}

const MIN_LABEL_WIDTH = 64;
const MIN_LABEL_HEIGHT = 16;
const DIMMED_ALPHA = 0.18;

export function paintLayout(
  context: Context2D,
  layout: Layout,
  width: number,
  height: number,
  style: PaintStyle,
  dimmed: ReadonlySet<number> | null,
  nameOf: ((rect: number) => string) | null,
): void {
  const { colors, colorMode, forced, pixelRatio } = style;
  const devicePixel = 1 / pixelRatio;
  // About one CSS pixel between neighbours, in whole device pixels.
  const seam = Math.max(1, Math.round(pixelRatio)) / pixelRatio;
  context.globalAlpha = 1;
  context.fillStyle = forced ? forced.canvas : colors.background;
  context.fillRect(0, 0, width, height);

  context.font = style.font;
  context.textBaseline = 'middle';
  const measure = (text: string) => context.measureText(text).width;

  for (let i = 0; i < layout.count; i++) {
    if (layout.w[i] < 0.5 || layout.h[i] < 0.5) continue;
    // Both edges are snapped, so a shared edge lands on the same pixel for both neighbours. A
    // rectangle never shrinks to nothing: it keeps at least one device pixel.
    const rectX = snapToDevicePixel(layout.x[i], pixelRatio);
    const rectY = snapToDevicePixel(layout.y[i], pixelRatio);
    const rectWidth = Math.max(snapToDevicePixel(layout.x[i] + layout.w[i], pixelRatio) - rectX, devicePixel);
    const rectHeight = Math.max(snapToDevicePixel(layout.y[i] + layout.h[i], pixelRatio) - rectY, devicePixel);

    if (forced) {
      if (rectWidth >= 3 && rectHeight >= 3) {
        context.strokeStyle = forced.text;
        context.lineWidth = 1;
        context.strokeRect(rectX + 0.5, rectY + 0.5, rectWidth - 1, rectHeight - 1);
      }
      continue;
    }

    const bucket = colorMode === 'type' ? layout.category[i] : layout.age[i];
    const fill = colorMode === 'type' ? colors.category[bucket] : colors.age[bucket];
    const isDimmed = dimmed !== null && !dimmed.has(bucket);
    context.globalAlpha = isDimmed ? DIMMED_ALPHA : 1;
    context.fillStyle = fill;
    // A seam on the right and bottom keeps neighbouring files apart without drawing outlines.
    const gap = rectWidth >= 2 && rectHeight >= 2 ? seam : 0;
    context.fillRect(rectX, rectY, rectWidth - gap, rectHeight - gap);

    if (
      nameOf &&
      !isDimmed &&
      layout.kind[i] === RectKind.File &&
      rectWidth >= MIN_LABEL_WIDTH &&
      rectHeight >= MIN_LABEL_HEIGHT
    ) {
      // The list's own middle cut, which keeps the extension and never splits a character.
      const label = fitMiddle(nameOf(i), rectWidth - 8, measure);
      if (label !== '') {
        context.fillStyle = style.labelColorFor(fill);
        context.fillText(label, rectX + 4, rectY + 9);
      }
    }
  }
  context.globalAlpha = 1;
}

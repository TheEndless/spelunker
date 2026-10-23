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
}

const MIN_LABEL_WIDTH = 64;
const MIN_LABEL_HEIGHT = 16;
const DIMMED_ALPHA = 0.18;

/**
 * Shortens a label to fit `maxWidth`, cutting from the middle so the extension stays visible.
 * Three plain dots stand in for the cut. Returns an empty string when not even the dots fit.
 */
export function fittedLabel(measure: (text: string) => number, text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  const dots = '...';
  let low = 0;
  let high = text.length;
  let best = '';
  while (low <= high) {
    const keep = Math.floor((low + high) / 2);
    const tail = Math.ceil(keep / 2);
    const head = keep - tail;
    const candidate = `${text.slice(0, head)}${dots}${text.slice(text.length - tail)}`;
    if (measure(candidate) <= maxWidth) {
      best = candidate;
      low = keep + 1;
    } else {
      high = keep - 1;
    }
  }
  return best;
}

export function paintLayout(
  context: Context2D,
  layout: Layout,
  width: number,
  height: number,
  style: PaintStyle,
  dimmed: ReadonlySet<number> | null,
  nameOf: ((rect: number) => string) | null,
): void {
  const { colors, colorMode, forced } = style;
  context.globalAlpha = 1;
  context.fillStyle = forced ? forced.canvas : colors.background;
  context.fillRect(0, 0, width, height);

  context.font = style.font;
  context.textBaseline = 'middle';
  const measure = (text: string) => context.measureText(text).width;

  for (let i = 0; i < layout.count; i++) {
    const rectX = layout.x[i];
    const rectY = layout.y[i];
    const rectWidth = layout.w[i];
    const rectHeight = layout.h[i];
    if (rectWidth < 0.5 || rectHeight < 0.5) continue;

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
    // A half-pixel seam on each side keeps neighbouring files apart without drawing outlines.
    const seam = rectWidth >= 2 && rectHeight >= 2 ? 0.5 : 0;
    context.fillRect(rectX + seam, rectY + seam, rectWidth - 2 * seam, rectHeight - 2 * seam);

    if (
      nameOf &&
      !isDimmed &&
      layout.kind[i] === RectKind.File &&
      rectWidth >= MIN_LABEL_WIDTH &&
      rectHeight >= MIN_LABEL_HEIGHT
    ) {
      const label = fittedLabel(measure, nameOf(i), rectWidth - 8);
      if (label !== '') {
        context.fillStyle = style.labelColorFor(fill);
        context.fillText(label, rectX + 4, rectY + 9);
      }
    }
  }
  context.globalAlpha = 1;
}

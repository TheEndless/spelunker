// The worker paints with this module too. textFit only touches the document in canvasMeasurer,
// which is not used here, so it is safe to load in a worker.
import { channels } from './colors';
import { fitMiddle } from './textFit';
import { labelColorOn, type ForcedColors, type MapColors } from './treemapColors';
import { brightnessAt, brightnessOfNormal, shadeChannel, surfaceNormal } from './treemapCushion';
import { RectKind, type Layout } from './treemapLayout';

export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ColorMode = 'type' | 'age';
export type Shading = 'cushion' | 'flat';

export interface PaintStyle {
  colors: MapColors;
  colorMode: ColorMode;
  /** Set under forced-colors mode: no fills, only outlines in system colors. */
  forced: ForcedColors | null;
  font: string;
  /** The label color on a flat fill. Cushion labels are judged on the shaded row instead. */
  labelColorFor: (fill: string) => string;
  /** Device pixels per CSS pixel, so edges can be put on whole device pixels. */
  pixelRatio: number;
  /** Cushion lights every tile per pixel, flat fills each with one color. Forced colors ignores it. */
  shading: Shading;
}

/**
 * The nearest whole device pixel, in CSS pixels. Layout positions are fractional, and an edge
 * between two device pixels is drawn as a blend of both colors, which looks soft.
 */
export function snapToDevicePixel(value: number, pixelRatio: number): number {
  return Math.round(value * pixelRatio) / pixelRatio;
}

/** The snapped size of a span that starts at `start`, never under one device pixel, in CSS pixels. */
function snappedExtent(start: number, size: number, pixelRatio: number): number {
  return Math.max(snapToDevicePixel(start + size, pixelRatio) - snapToDevicePixel(start, pixelRatio), 1 / pixelRatio);
}

const MIN_LABEL_WIDTH = 64;
const MIN_LABEL_HEIGHT = 16;
/** Where a label's text starts, and the middle of its line, from the rectangle's top-left corner. */
const LABEL_LEFT = 4;
const LABEL_MIDDLE = 9;
const DIMMED_ALPHA = 0.18;

/** The label for a file rectangle big enough to hold one, cut in the middle to fit, or '' for none. */
function fittedLabel(
  layout: Layout,
  rect: number,
  rectWidth: number,
  rectHeight: number,
  nameOf: (rect: number) => string,
  measure: (text: string) => number,
): string {
  if (layout.kind[rect] !== RectKind.File || rectWidth < MIN_LABEL_WIDTH || rectHeight < MIN_LABEL_HEIGHT) return '';
  // The list's own middle cut, which keeps the extension and never splits a character.
  return fitMiddle(nameOf(rect), rectWidth - 2 * LABEL_LEFT, measure);
}

/**
 * Paints with cushion lighting or flat fills by `style.shading`. Forced colors always gets the
 * outline-only painter. A flat paint lets go of the cushion image, so only cushion shading keeps
 * an image the size of the canvas alive between paints.
 */
export function paintMap(
  context: Context2D,
  layout: Layout,
  width: number,
  height: number,
  style: PaintStyle,
  dimmed: ReadonlySet<number> | null,
  nameOf: ((rect: number) => string) | null,
): void {
  if (style.forced || style.shading === 'flat') {
    releaseCushionImage();
    paintLayout(context, layout, width, height, style, dimmed, nameOf);
  } else {
    paintCushion(context, layout, width, height, style, dimmed, nameOf);
  }
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
  const { colors, colorMode, forced, pixelRatio } = style;
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
    const rectWidth = snappedExtent(layout.x[i], layout.w[i], pixelRatio);
    const rectHeight = snappedExtent(layout.y[i], layout.h[i], pixelRatio);

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

    if (nameOf && !isDimmed) {
      const label = fittedLabel(layout, i, rectWidth, rectHeight, nameOf, measure);
      if (label !== '') {
        context.fillStyle = style.labelColorFor(fill);
        context.fillText(label, rectX + LABEL_LEFT, rectY + LABEL_MIDDLE);
      }
    }
  }
  context.globalAlpha = 1;
}

/** Whether a Uint32 write lays its low byte first, which the packed-pixel writes below rely on. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** The image the cushion painter fills, kept while the backing size is unchanged so a repaint allocates nothing. */
let cushionImage: ImageData | null = null;
/** The same pixels as cushionImage, one opaque RGBA pixel per element. */
let cushionPixels = new Uint32Array(0);
/** The x part of the surface normal for each device column, and the y part for each device row, of the rectangle being shaded. */
let columnNormals = new Float64Array(0);
let rowNormals = new Float64Array(0);

function cushionImageOfSize(context: Context2D, width: number, height: number): ImageData {
  if (!cushionImage || cushionImage.width !== width || cushionImage.height !== height) {
    cushionImage = context.createImageData(width, height);
    cushionPixels = new Uint32Array(cushionImage.data.buffer, cushionImage.data.byteOffset, width * height);
    if (columnNormals.length < width) columnNormals = new Float64Array(width);
    if (rowNormals.length < height) rowNormals = new Float64Array(height);
  }
  return cushionImage;
}

function releaseCushionImage(): void {
  cushionImage = null;
  cushionPixels = new Uint32Array(0);
}

/** An opaque pixel as one little-endian Uint32: red in the low byte, alpha in the high one. */
function packedPixel(red: number, green: number, blue: number): number {
  return 0xff000000 | (blue << 16) | (green << 8) | red;
}

/** Writes one opaque pixel at element `index` of the image, as packed Uint32s or (big-endian only) as bytes. */
function writePixel(pixels: Uint32Array, bytes: Uint8ClampedArray, index: number, red: number, green: number, blue: number): void {
  if (LITTLE_ENDIAN) {
    pixels[index] = packedPixel(red, green, blue);
  } else {
    const offset = index * 4;
    bytes[offset] = red;
    bytes[offset + 1] = green;
    bytes[offset + 2] = blue;
    bytes[offset + 3] = 255;
  }
}

/**
 * Paints the layout with cushion lighting into `context` at `style.pixelRatio`. Works in whole device
 * pixels with one reused ImageData (the context's transform and globalAlpha do not apply to putImageData),
 * then draws labels with the transform. `dimmed` and `nameOf` behave as in paintLayout.
 */
export function paintCushion(
  context: Context2D,
  layout: Layout,
  width: number,
  height: number,
  style: PaintStyle,
  dimmed: ReadonlySet<number> | null,
  nameOf: ((rect: number) => string) | null,
): void {
  const devicePixelRatio = style.pixelRatio;
  const bufferWidth = Math.round(width * devicePixelRatio);
  const bufferHeight = Math.round(height * devicePixelRatio);
  // An empty image cannot be created, and there is nothing to show.
  if (bufferWidth < 1 || bufferHeight < 1) return;
  const image = cushionImageOfSize(context, bufferWidth, bufferHeight);
  const bytes = image.data;
  const pixels = cushionPixels;

  const { colors, colorMode } = style;
  const fills = colorMode === 'type' ? colors.category : colors.age;
  const buckets = colorMode === 'type' ? layout.category : layout.age;
  const fillChannels = fills.map(channels);
  const [backgroundRed, backgroundGreen, backgroundBlue] = channels(colors.background);
  if (LITTLE_ENDIAN) pixels.fill(packedPixel(backgroundRed, backgroundGreen, backgroundBlue));
  else for (let index = 0; index < bufferWidth * bufferHeight; index++) writePixel(pixels, bytes, index, backgroundRed, backgroundGreen, backgroundBlue);
  // A dimmed pixel is the background at 1 - alpha plus the shaded color at alpha, as flat mode's fade looks.
  const fadedRed = backgroundRed * (1 - DIMMED_ALPHA);
  const fadedGreen = backgroundGreen * (1 - DIMMED_ALPHA);
  const fadedBlue = backgroundBlue * (1 - DIMMED_ALPHA);
  const surface = layout.surface;

  for (let i = 0; i < layout.count; i++) {
    if (layout.w[i] < 0.5 || layout.h[i] < 0.5) continue;
    // Edges on whole device pixels by the same rounding as snapToDevicePixel, so neighbours share an
    // edge, and at least one device pixel each way. Then cut to the image: a write past the right
    // edge would land at the start of the next row.
    const left = Math.round(layout.x[i] * devicePixelRatio);
    const top = Math.round(layout.y[i] * devicePixelRatio);
    const right = Math.min(Math.max(Math.round((layout.x[i] + layout.w[i]) * devicePixelRatio), left + 1), bufferWidth);
    const bottom = Math.min(Math.max(Math.round((layout.y[i] + layout.h[i]) * devicePixelRatio), top + 1), bufferHeight);
    const firstColumn = Math.max(left, 0);
    const firstRow = Math.max(top, 0);
    if (firstColumn >= right || firstRow >= bottom) continue;

    const bucket = buckets[i];
    const channels = fillChannels[bucket];
    const red = channels[0];
    const green = channels[1];
    const blue = channels[2];
    const isDimmed = dimmed !== null && !dimmed.has(bucket);

    // The coefficients are in CSS pixels, so each device pixel is sampled at its center in CSS pixels.
    const offset = i * 4;
    const linearX = surface[offset];
    const quadraticX = surface[offset + 1];
    const linearY = surface[offset + 2];
    const quadraticY = surface[offset + 3];
    for (let column = firstColumn; column < right; column++) columnNormals[column] = surfaceNormal(linearX, quadraticX, (column + 0.5) / devicePixelRatio);
    for (let row = firstRow; row < bottom; row++) rowNormals[row] = surfaceNormal(linearY, quadraticY, (row + 0.5) / devicePixelRatio);

    for (let row = firstRow; row < bottom; row++) {
      const normalY = rowNormals[row];
      let index = row * bufferWidth + firstColumn;
      for (let column = firstColumn; column < right; column++, index++) {
        const brightness = brightnessOfNormal(columnNormals[column], normalY);
        let shadedRed = shadeChannel(red, brightness);
        let shadedGreen = shadeChannel(green, brightness);
        let shadedBlue = shadeChannel(blue, brightness);
        if (isDimmed) {
          // Both parts are at least 0 and sum to at most 255, so adding a half and truncating rounds.
          shadedRed = (fadedRed + shadedRed * DIMMED_ALPHA + 0.5) | 0;
          shadedGreen = (fadedGreen + shadedGreen * DIMMED_ALPHA + 0.5) | 0;
          shadedBlue = (fadedBlue + shadedBlue * DIMMED_ALPHA + 0.5) | 0;
        }
        writePixel(pixels, bytes, index, shadedRed, shadedGreen, shadedBlue);
      }
    }
  }
  context.putImageData(image, 0, 0);

  if (!nameOf) return;
  context.globalAlpha = 1;
  context.font = style.font;
  context.textBaseline = 'middle';
  const measure = (text: string) => context.measureText(text).width;
  for (let i = 0; i < layout.count; i++) {
    if (layout.w[i] < 0.5 || layout.h[i] < 0.5) continue;
    const bucket = buckets[i];
    if (dimmed !== null && !dimmed.has(bucket)) continue;
    const rectX = snapToDevicePixel(layout.x[i], devicePixelRatio);
    const rectY = snapToDevicePixel(layout.y[i], devicePixelRatio);
    const rectWidth = snappedExtent(layout.x[i], layout.w[i], devicePixelRatio);
    const rectHeight = snappedExtent(layout.y[i], layout.h[i], devicePixelRatio);
    const label = fittedLabel(layout, i, rectWidth, rectHeight, nameOf, measure);
    if (label === '') continue;
    // The text color that reads best over the shaded row the label sits on, judged at both of its ends.
    const textX = rectX + LABEL_LEFT;
    const textY = rectY + LABEL_MIDDLE;
    const offset = i * 4;
    const brightnessOnRow = (x: number) => brightnessAt(surface[offset], surface[offset + 1], surface[offset + 2], surface[offset + 3], x, textY);
    const startBrightness = brightnessOnRow(textX);
    const endBrightness = brightnessOnRow(textX + measure(label));
    context.fillStyle = labelColorOn(fills[bucket], startBrightness, endBrightness);
    context.fillText(label, textX, textY);
  }
}

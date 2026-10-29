// The worker paints with this module too. textFit only touches the document in canvasMeasurer,
// which is not used here, so it is safe to load in a worker.
import { channels } from './colors';
import type { ForcedColors, MapColors } from './treemapColors';
import { brightnessOfNormal, shadeChannel, surfaceNormal } from './treemapCushion';
import { RectKind, type Layout } from './treemapLayout';

export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ColorMode = 'type' | 'age' | 'size';

/** The bucket each rectangle falls in under a color mode. */
export function colorBuckets(layout: Layout, mode: ColorMode): Uint8Array {
  return mode === 'type' ? layout.category : mode === 'age' ? layout.age : layout.sizeClass;
}

/** The fill of each bucket under a color mode. */
export function colorFills(colors: MapColors, mode: ColorMode): string[] {
  return mode === 'type' ? colors.category : mode === 'age' ? colors.age : colors.size;
}
export type Shading = 'cushion' | 'facet' | 'flat';

export interface PaintStyle {
  colors: MapColors;
  colorMode: ColorMode;
  /** Set under forced-colors mode: no fills, only outlines in system colors. */
  forced: ForcedColors | null;
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

const DIMMED_ALPHA = 0.18;

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
): void {
  if (style.forced || style.shading === 'flat') {
    releaseCushionImage();
    paintLayout(context, layout, width, height, style, dimmed);
  } else {
    paintCushion(context, layout, width, height, style, dimmed);
  }
}

export function paintLayout(
  context: Context2D,
  layout: Layout,
  width: number,
  height: number,
  style: PaintStyle,
  dimmed: ReadonlySet<number> | null,
): void {
  const { colors, colorMode, forced, pixelRatio } = style;
  const fills = colorFills(colors, colorMode);
  const buckets = colorBuckets(layout, colorMode);
  // About one CSS pixel between neighbours, in whole device pixels.
  const seam = Math.max(1, Math.round(pixelRatio)) / pixelRatio;
  context.globalAlpha = 1;
  context.fillStyle = forced ? forced.canvas : colors.background;
  context.fillRect(0, 0, width, height);

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

    const bucket = buckets[i];
    const fill = fills[bucket];
    const isDimmed = dimmed !== null && !dimmed.has(bucket);
    context.globalAlpha = isDimmed ? DIMMED_ALPHA : 1;
    context.fillStyle = fill;
    // A seam on the right and bottom keeps neighbouring files apart without drawing outlines.
    const gap = rectWidth >= 2 && rectHeight >= 2 ? seam : 0;
    context.fillRect(rectX, rectY, rectWidth - gap, rectHeight - gap);
  }
  context.globalAlpha = 1;
}

/** Whether a Uint32 write lays its low byte first, which the packed-pixel writes below rely on. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Facet shading: each tile is a gentle slope from light at the top left to darker at the bottom right, with a lit top and left edge and a shadowed bottom and right edge. */
const FACET_LIGHT = 1.04;
const FACET_DARK = 0.74;
const FACET_LIT_EDGE = 0.18;
const FACET_SHADOWED_EDGE = 0.22;
/** A tile needs this many device pixels each way to get edges, and a smaller one only gets the slope. */
const FACET_MIN_EDGE_SPAN = 5;

function facetBrightness(column: number, row: number, left: number, top: number, right: number, bottom: number): number {
  const across = (column + 0.5 - left) / (right - left);
  const down = (row + 0.5 - top) / (bottom - top);
  let brightness = FACET_LIGHT + (FACET_DARK - FACET_LIGHT) * ((across + down) / 2);
  if (right - left >= FACET_MIN_EDGE_SPAN && bottom - top >= FACET_MIN_EDGE_SPAN) {
    if (column === left || row === top) brightness += FACET_LIT_EDGE;
    else if (column === right - 1 || row === bottom - 1) brightness -= FACET_SHADOWED_EDGE;
  }
  return brightness;
}

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
 * pixels with one reused ImageData (the context's transform and globalAlpha do not apply to putImageData).
 * `dimmed` behaves as in paintLayout.
 */
export function paintCushion(
  context: Context2D,
  layout: Layout,
  width: number,
  height: number,
  style: PaintStyle,
  dimmed: ReadonlySet<number> | null,
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
  const fills = colorFills(colors, colorMode);
  const buckets = colorBuckets(layout, colorMode);
  const fillChannels = fills.map(channels);
  const [backgroundRed, backgroundGreen, backgroundBlue] = channels(colors.background);
  if (LITTLE_ENDIAN) pixels.fill(packedPixel(backgroundRed, backgroundGreen, backgroundBlue));
  else for (let index = 0; index < bufferWidth * bufferHeight; index++) writePixel(pixels, bytes, index, backgroundRed, backgroundGreen, backgroundBlue);
  // A dimmed pixel is the background at 1 - alpha plus the shaded color at alpha, as flat mode's fade looks.
  const fadedRed = backgroundRed * (1 - DIMMED_ALPHA);
  const fadedGreen = backgroundGreen * (1 - DIMMED_ALPHA);
  const fadedBlue = backgroundBlue * (1 - DIMMED_ALPHA);
  const surface = layout.surface;
  const facet = style.shading === 'facet';

  for (let i = 0; i < layout.count; i++) {
    // Edges on whole device pixels by the same rounding as snapToDevicePixel, so neighbours share an
    // edge, and at least one device pixel each way. A sliver under half a CSS pixel gets no such
    // minimum, so it covers only the pixels its own edges round to. Those belong to no neighbour, and
    // there is no gap between tiles to hide them, so skipping it would leave a background speck. Then
    // cut to the image: a write past the right edge would land at the start of the next row.
    const minimumSpan = layout.w[i] < 0.5 || layout.h[i] < 0.5 ? 0 : 1;
    const left = Math.round(layout.x[i] * devicePixelRatio);
    const top = Math.round(layout.y[i] * devicePixelRatio);
    const right = Math.min(Math.max(Math.round((layout.x[i] + layout.w[i]) * devicePixelRatio), left + minimumSpan), bufferWidth);
    const bottom = Math.min(Math.max(Math.round((layout.y[i] + layout.h[i]) * devicePixelRatio), top + minimumSpan), bufferHeight);
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
        const brightness = facet ? facetBrightness(column, row, left, top, right, bottom) : brightnessOfNormal(columnNormals[column], normalY);
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
}

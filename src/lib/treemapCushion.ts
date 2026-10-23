/** The surface of a cushion treemap tile (van Wijk and van de Wetering): each nesting level adds a parabolic ridge. */
export const CUSHION_HEIGHT = 0.38;
/** Each level of nesting bulges by this fraction of its parent's height. */
export const CUSHION_SCALE = 0.91;
export const CUSHION_AMBIENT = 0.18;
export const CUSHION_DIFFUSE = 0.9;
/** The darkest a shaded pixel gets, so deep corners stay readable. */
export const CUSHION_MIN_BRIGHTNESS = 0.3;

const LIGHT_LENGTH = Math.hypot(-1, -1, 10);
const LIGHT_X = -1 / LIGHT_LENGTH;
const LIGHT_Y = -1 / LIGHT_LENGTH;
const LIGHT_Z = 10 / LIGHT_LENGTH;

/**
 * Adds a ridge of `height` over the rectangle to the four coefficients [linearX, quadraticX, linearY, quadraticY] stored at
 * `offset`. A side with no extent adds nothing, so degenerate rectangles never produce infinities.
 */
export function addRidge(
  coefficients: Float32Array | Float64Array | number[],
  offset: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  height: number,
): void {
  const width = right - left;
  const tall = bottom - top;
  const scaled = 4 * height;
  if (width > 0) {
    coefficients[offset] += (scaled * (right + left)) / width;
    coefficients[offset + 1] -= scaled / width;
  }
  if (tall > 0) {
    coefficients[offset + 2] += (scaled * (bottom + top)) / tall;
    coefficients[offset + 3] -= scaled / tall;
  }
}

/**
 * One axis of the surface normal at `coordinate`, from that axis's two coefficients ([linearX, quadraticX]
 * or [linearY, quadraticY]). It depends on that axis alone, so a painter can work it out once per column and once per row.
 */
export function surfaceNormal(linear: number, quadratic: number, coordinate: number): number {
  return -(2 * quadratic * coordinate + linear);
}

/** How lit a surface with the normal (normalX, normalY, 1) is. The one shading formula: brightnessAt and the painter both use it. */
export function brightnessOfNormal(normalX: number, normalY: number): number {
  const cosine = (normalX * LIGHT_X + normalY * LIGHT_Y + LIGHT_Z) / Math.sqrt(normalX * normalX + normalY * normalY + 1);
  return Math.max(CUSHION_MIN_BRIGHTNESS, CUSHION_AMBIENT + CUSHION_DIFFUSE * Math.max(cosine, 0));
}

/** How lit the surface is at (x, y), between the minimum brightness and ambient plus diffuse. */
export function brightnessAt(linearX: number, quadraticX: number, linearY: number, quadraticY: number, x: number, y: number): number {
  return brightnessOfNormal(surfaceNormal(linearX, quadraticX, x), surfaceNormal(linearY, quadraticY, y));
}

/**
 * `base * brightness` rounded half up and clamped to 0..255. The painter calls this for every channel of
 * every pixel, and `(value + 0.5) | 0` is about twice as fast there as Math.round with Math.min and
 * Math.max. The bounds are checked first, so `| 0` never sees a value it would wrap. The two agree
 * everywhere except two cases. A product within one rounding step under 0.5 rounds to 1 here. A NaN
 * product gives 0 here, where the Math form would give NaN.
 */
export function shadeChannel(base: number, brightness: number): number {
  const scaled = base * brightness;
  return scaled >= 254.5 ? 255 : scaled > 0 ? (scaled + 0.5) | 0 : 0;
}

/** The average brightness of a lone ridge, which is the same at any tile size. Tests use this, not a hard-coded number. */
export function loneRidgeMeanBrightness(): number {
  const size = 64;
  const coefficients = [0, 0, 0, 0];
  addRidge(coefficients, 0, 0, 0, size, size, CUSHION_HEIGHT);
  let sum = 0;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      sum += brightnessAt(coefficients[0], coefficients[1], coefficients[2], coefficients[3], column + 0.5, row + 0.5);
    }
  }
  return sum / (size * size);
}

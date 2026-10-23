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
 * Adds a ridge of `height` over the rectangle to the four coefficients [sx1, sx2, sy1, sy2] stored at
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

/** How lit the surface is at (x, y), between the minimum brightness and ambient plus diffuse. */
export function brightnessAt(sx1: number, sx2: number, sy1: number, sy2: number, x: number, y: number): number {
  const normalX = -(2 * sx2 * x + sx1);
  const normalY = -(2 * sy2 * y + sy1);
  const cosine = (normalX * LIGHT_X + normalY * LIGHT_Y + LIGHT_Z) / Math.sqrt(normalX * normalX + normalY * normalY + 1);
  return Math.max(CUSHION_MIN_BRIGHTNESS, CUSHION_AMBIENT + CUSHION_DIFFUSE * Math.max(cosine, 0));
}

export function shadeChannel(base: number, brightness: number): number {
  return Math.min(255, Math.max(0, Math.round(base * brightness)));
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

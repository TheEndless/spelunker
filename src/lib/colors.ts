/** Color math for building and checking themes. Colors are `#RRGGBB` strings. */

export function normalizeHex(color: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  throw new Error(`Not a hex color: "${color}"`);
}

/** [red, green, blue] of a #RGB or #RRGGBB color, each 0 to 255. */
export function channels(color: string): [number, number, number] {
  const hex = normalizeHex(color);
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}

/** The #RRGGBB form of [red, green, blue], each rounded and held to 0 to 255. */
export function toHex([red, green, blue]: number[]): string {
  return (
    '#' +
    [red, green, blue]
      .map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** Blends `from` toward `to`. `amount` 0 is `from`, 1 is `to`. */
export function mix(from: string, to: string, amount: number): string {
  const start = channels(from);
  const end = channels(to);
  return toHex(start.map((value, index) => value + (end[index] - value) * amount));
}

function luminance(color: string): number {
  const [red, green, blue] = channels(color).map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Moves `foreground` toward black or white, as little as needed, until it reaches `minimum`
 * contrast against every background. Direction follows the backgrounds: toward black on light
 * ones and toward white on dark ones. If the target cannot be reached it returns the extreme.
 */
export function ensureContrast(foreground: string, backgrounds: string[], minimum: number): string {
  const passes = (color: string) => backgrounds.every((background) => contrast(color, background) >= minimum);
  if (passes(foreground)) return normalizeHex(foreground);

  const averageLuminance = backgrounds.reduce((sum, background) => sum + luminance(background), 0) / backgrounds.length;
  const target = averageLuminance > 0.4 ? '#000000' : '#FFFFFF';
  let best = normalizeHex(foreground);
  for (let step = 1; step <= 100; step++) {
    best = mix(foreground, target, step / 100);
    if (passes(best)) return best;
  }
  return best;
}

const toLinear = (unit: number) => (unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4);
const fromLinear = (linear: number) => (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055);

/**
 * The color in OKLab (Bjorn Ottosson, 2020): lightness from 0 to 1, then the green-red and
 * blue-yellow axes. Equal distances in it look about equally different, which RGB does not.
 */
export function oklab(color: string): [number, number, number] {
  const [red, green, blue] = channels(color).map((value) => toLinear(value / 255));
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ];
}

/** The hex color for an OKLab value, clamped to what a screen can show. */
export function fromOklab([lightness, greenRed, blueYellow]: [number, number, number]): string {
  const long = (lightness + 0.3963377774 * greenRed + 0.2158037573 * blueYellow) ** 3;
  const medium = (lightness - 0.1055613458 * greenRed - 0.0638541728 * blueYellow) ** 3;
  const short = (lightness - 0.0894841775 * greenRed - 1.291485548 * blueYellow) ** 3;
  const linear = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
  return toHex(linear.map((value) => fromLinear(Math.min(1, Math.max(0, value))) * 255));
}

/** How different two colors look: the straight-line distance in OKLab, 1 for black against white. */
export function perceptualDistance(first: string, second: string): number {
  const [firstL, firstA, firstB] = oklab(first);
  const [secondL, secondA, secondB] = oklab(second);
  return Math.hypot(firstL - secondL, firstA - secondA, firstB - secondB);
}

/** Near-black or white, whichever reads better on `fill`. */
export function bestTextOn(fill: string): string {
  return contrast('#111111', fill) >= contrast('#FFFFFF', fill) ? '#111111' : '#FFFFFF';
}

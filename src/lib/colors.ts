/** Color math for building and checking themes. Colors are `#RRGGBB` strings. */

export function normalizeHex(color: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  throw new Error(`Not a hex color: "${color}"`);
}

function channels(color: string): [number, number, number] {
  const hex = normalizeHex(color);
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}

function toHex([red, green, blue]: number[]): string {
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

/** Near-black or white, whichever reads better on `fill`. */
export function bestTextOn(fill: string): string {
  return contrast('#111111', fill) >= contrast('#FFFFFF', fill) ? '#111111' : '#FFFFFF';
}

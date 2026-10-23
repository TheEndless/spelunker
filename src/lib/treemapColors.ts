import { contrast, ensureContrast, fromOklab, normalizeHex, oklab } from './colors';
import type { Mode, Tokens } from './palettes';

/** Hue in degrees for each category, in FILE_CATEGORIES order. "Other" is a neutral. */
const CATEGORY_HUES = [212, 172, 62, 318, 4, 282, 248, 34, 192, 128, 340, 20, 0];
/** Alternating lightness nudges so neighbouring hues stay apart. */
const CATEGORY_LIGHTNESS_SHIFT = [0, 0.06, 0, 0.06, 0, 0.06, -0.04, 0, 0.06, -0.04, 0, 0.06, 0];
const OTHER_INDEX = CATEGORY_HUES.length - 1;

export const CATEGORY_LABELS: readonly string[] = [
  'Code', 'Text', 'Data', 'Images', 'PDF', 'Audio', 'Video', 'Archives', 'Documents', 'Spreadsheets', 'Slides', 'Programs', 'Other',
];

export const AGE_LABELS: readonly string[] = ['Today', 'This week', 'This month', 'This year', 'Older', 'Unknown'];

export interface MapColors {
  background: string;
  category: string[];
  age: string[];
  outlineLight: string;
  outlineDark: string;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (hue % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] =
    sector < 1 ? [chroma, second, 0]
    : sector < 2 ? [second, chroma, 0]
    : sector < 3 ? [0, chroma, second]
    : sector < 4 ? [0, second, chroma]
    : sector < 5 ? [second, 0, chroma]
    : [chroma, 0, second];
  const offset = lightness - chroma / 2;
  const toHex = (value: number) => Math.round((value + offset) * 255).toString(16).padStart(2, '0');
  return normalizeHex(`#${toHex(red)}${toHex(green)}${toHex(blue)}`);
}

export function mapColors(tokens: Tokens, mode: Mode): MapColors {
  const background = normalizeHex(tokens.surface);
  const baseLightness = mode === 'dark' ? 0.6 : 0.42;
  const category = CATEGORY_HUES.map((hue, index) =>
    ensureContrast(
      hslToHex(hue, index === OTHER_INDEX ? 0.08 : 0.55, baseLightness + CATEGORY_LIGHTNESS_SHIFT[index]),
      [background],
      3,
    ),
  );
  return { background, category, age: ageRamp(tokens.accent, background, mode), outlineLight: '#FFFFFF', outlineDark: '#000000' };
}

/** OKLab lightness of the Today color: deep on a light map, bright on a dark one, so it stands out most. */
const RECENT_LIGHTNESS: Record<Mode, number> = { light: 0.33, dark: 0.92 };
const RECENT_CHROMA_MIN = 0.1;
const RECENT_CHROMA_MAX = 0.16;
/** The Older color keeps a trace of the accent's hue. */
const OLD_CHROMA = 0.03;
const FILL_CONTRAST = 3;
/** A little above the minimum, so the faintest step does not need nudging back over it. */
const OLD_CONTRAST_TARGET = 3.1;
const LIGHTNESS_STEP = 0.005;
const DATED_BUCKETS = 5;

/**
 * Today to Older, then Unknown. A single-hue ramp in OKLab (where equal steps look equal): Today is
 * the accent's hue at its strongest and farthest from the background, and each older bucket moves
 * evenly toward the background and toward gray, ending at Older, the faintest fill that still keeps
 * 3:1. Mixing the accent with the muted text color instead gave steps too close to tell apart in
 * palettes where the two are about as light. Unknown is a plain gray halfway along.
 */
function ageRamp(accent: string, background: string, mode: Mode): string[] {
  const [, accentGreenRed, accentBlueYellow] = oklab(accent);
  const hue = Math.atan2(accentBlueYellow, accentGreenRed);
  const recentChroma = Math.min(RECENT_CHROMA_MAX, Math.max(RECENT_CHROMA_MIN, Math.hypot(accentGreenRed, accentBlueYellow)));
  const colorAt = (lightness: number, chroma: number) => fromOklab([lightness, chroma * Math.cos(hue), chroma * Math.sin(hue)]);

  const recentLightness = RECENT_LIGHTNESS[mode];
  // Toward the background: lighter on a light map, darker on a dark one.
  const towardBackground = mode === 'dark' ? -LIGHTNESS_STEP : LIGHTNESS_STEP;
  let oldLightness = recentLightness;
  while (
    oldLightness > 0 &&
    oldLightness < 1 &&
    contrast(colorAt(oldLightness + towardBackground, OLD_CHROMA), background) >= OLD_CONTRAST_TARGET
  ) {
    oldLightness += towardBackground;
  }

  const ramp = Array.from({ length: DATED_BUCKETS }, (_, bucket) => {
    const progress = bucket / (DATED_BUCKETS - 1);
    const lightness = recentLightness + (oldLightness - recentLightness) * progress;
    const chroma = recentChroma + (OLD_CHROMA - recentChroma) * progress;
    return ensureContrast(colorAt(lightness, chroma), [background], FILL_CONTRAST);
  });
  const unknown = ensureContrast(colorAt((recentLightness + oldLightness) / 2, 0), [background], FILL_CONTRAST);
  return [...ramp, unknown];
}

export interface ForcedColors {
  canvas: string;
  text: string;
  highlight: string;
}

/** The system colors in effect under forced-colors mode, read through a probe because canvas cannot use CSS keywords. */
export function forcedMapColors(): ForcedColors {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;color:CanvasText;background-color:Canvas;border-color:Highlight;border-style:solid';
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const colors = { canvas: style.backgroundColor, text: style.color, highlight: style.borderTopColor };
  probe.remove();
  return colors;
}

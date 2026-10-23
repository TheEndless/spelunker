import { contrast, fromOklab, mix, normalizeHex, oklab, perceptualDistance } from './colors';
import type { Mode, Tokens } from './palettes';
import { loneRidgeMeanBrightness, shadeChannel } from './treemapCushion';

const CATEGORY_SATURATION = 0.7;
const FILL_CONTRAST = 3;
const LABEL_CONTRAST = 4.5;

/** Hue in degrees for each category, in FILE_CATEGORIES order. "Other" is a neutral. */
const CATEGORY_HUES = [212, 172, 78, 319, 14, 281, 247, 48, 192, 128, 345, 32, 0];
/** Per-category lightness nudges, tuned so every pair stays at least 0.05 apart in OKLab after shading pulls dark-mode colors together. */
const CATEGORY_LIGHTNESS_SHIFT = [0, 0.06, 0, 0.112, 0.014, 0.081, -0.046, 0, 0.06, -0.04, 0.028, 0.06, 0];
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

const LONE_RIDGE_MEAN_BRIGHTNESS = loneRidgeMeanBrightness();

/** The color of a lone-ridge tile at its mean brightness: what the 3:1 rule is measured on. */
export function shadedMean(base: string): string {
  return shadeBase(base, LONE_RIDGE_MEAN_BRIGHTNESS);
}

const DARK_TEXT = '#111111';
const LIGHT_TEXT = '#FFFFFF';

/**
 * Near-black or white, whichever has the better worst-case contrast over a label's row, judged on
 * the base color shaded at the brightness where the label starts and where it ends.
 */
export function labelColorOn(base: string, leftBrightness: number, rightBrightness: number): string {
  const shadedRow = [leftBrightness, rightBrightness].map((brightness) => shadeBase(base, brightness));
  const worstContrast = (text: string) => Math.min(...shadedRow.map((shaded) => contrast(text, shaded)));
  return worstContrast(DARK_TEXT) >= worstContrast(LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
}

function shadeBase(base: string, brightness: number): string {
  const hex = normalizeHex(base);
  const shaded = [1, 3, 5].map((start) => shadeChannel(parseInt(hex.slice(start, start + 2), 16), brightness).toString(16).padStart(2, '0'));
  return `#${shaded.join('')}`.toUpperCase();
}

/** Whether a label on the shaded mean of `base` reaches the text contrast. Fills in a thin middle band fail it with both text colors. */
function labelReadsOnMean(base: string): boolean {
  const mean = LONE_RIDGE_MEAN_BRIGHTNESS;
  return contrast(labelColorOn(base, mean, mean), shadedMean(base)) >= LABEL_CONTRAST;
}

const SEARCH_STEPS = 100;
/** How far one search step moves a category's HSL lightness. */
const CATEGORY_LIGHTNESS_STEP = 0.005;

/**
 * Whether a fill is acceptable. Its base color (Flat mode and the legend paint it as is) keeps 3:1
 * against the map background, and so does its shaded mean (what cushion mode shows on average).
 * On a light map the base rule binds, on a dark map the shaded rule does. A fill that carries a
 * label must also let a label reach the text contrast.
 */
function fillPasses(base: string, background: string, carriesLabel: boolean, minimumContrast = FILL_CONTRAST): boolean {
  return (
    contrast(base, background) >= minimumContrast &&
    contrast(shadedMean(base), background) >= minimumContrast &&
    (!carriesLabel || labelReadsOnMean(base))
  );
}

/**
 * The first candidate whose fill passes (step 0 is the starting color, each step goes further toward
 * a more visible color), or undefined when none of the steps does.
 */
function firstPassingFill(
  candidateAt: (step: number) => string,
  background: string,
  carriesLabel: boolean,
  minimumContrast = FILL_CONTRAST,
): string | undefined {
  for (let step = 0; step <= SEARCH_STEPS; step++) {
    const candidate = normalizeHex(candidateAt(step));
    if (fillPasses(candidate, background, carriesLabel, minimumContrast)) return candidate;
  }
  return undefined;
}

/** Moves `base` toward white (dark map) or black (light map) until its fill passes, which loses some saturation. */
function ensureFill(base: string, background: string, mode: Mode, carriesLabel: boolean): string | undefined {
  const target = mode === 'dark' ? '#FFFFFF' : '#000000';
  return firstPassingFill((step) => mix(base, target, step / SEARCH_STEPS), background, carriesLabel);
}

export function mapColors(tokens: Tokens, mode: Mode): MapColors {
  const background = normalizeHex(tokens.surface);
  const baseLightness = mode === 'dark' ? 0.6 : 0.42;
  const searchDirection = mode === 'dark' ? 1 : -1;
  const category = CATEGORY_HUES.map((hue, index) => {
    const saturation = index === OTHER_INDEX ? 0.08 : CATEGORY_SATURATION;
    const startLightness = baseLightness + CATEGORY_LIGHTNESS_SHIFT[index];
    // Raising HSL lightness keeps more of the hue's saturation than mixing toward white would.
    const fill = firstPassingFill(
      (step) => hslToHex(hue, saturation, Math.min(1, Math.max(0, startLightness + searchDirection * step * CATEGORY_LIGHTNESS_STEP))),
      background,
      true,
    );
    if (fill === undefined) throw new Error(`No ${mode} fill for category ${CATEGORY_LABELS[index]} on ${background} reaches the contrast rules`);
    return fill;
  });
  return { background, category, age: ageRamp(tokens.accent, background, mode), outlineLight: '#FFFFFF', outlineDark: '#000000' };
}

/** OKLab lightness of the Today color: deep on a light map, bright on a dark one, so it stands out most. */
const RECENT_LIGHTNESS: Record<Mode, number> = { light: 0.33, dark: 0.96 };
const RECENT_CHROMA_MIN = 0.1;
const RECENT_CHROMA_MAX = 0.16;
/** The Older color keeps only a trace of the accent's hue, so it stays muted. */
const OLD_CHROMA = 0.03;
/** The smallest OKLab distance between neighbouring age colors (see the age step test). */
const MIN_AGE_STEP = 0.06;
/**
 * Where the plain single-hue ramp cannot give four clear steps (the dark map of Nord has only
 * about 0.17 of lightness room once its shaded mean must keep 3:1), the ramp is allowed to turn its
 * hue from Today to Older, by the smallest of these spans that works, trying each span in both
 * directions, and then to keep a little more chroma at Older, smallest first.
 * RAMP_HUE_SPAN_STEP_DEGREES and RAMP_HUE_SPAN_MAX_DEGREES bound that search.
 * Measured palettes that needed it (every other palette and mode keeps the single-hue ramp):
 * Nord dark turns the hue 95 degrees (-95) and keeps Older chroma 0.10, and One dark turns 5 degrees
 * (+5) with Older chroma 0.07. Nord dark could not be made valid with Older chroma at or under 0.05
 * at any span up to 180 degrees, so its Older is more vivid than the others.
 */
const RAMP_HUE_SPAN_STEP_DEGREES = 5;
const RAMP_HUE_SPAN_MAX_DEGREES = 180;
const OLD_CHROMA_OPTIONS = [OLD_CHROMA, 0.05, 0.07, 0.1];
/** A little above the minimum, so the faintest step does not need nudging back over it. */
const OLD_CONTRAST_TARGET = 3.1;
const LIGHTNESS_STEP = 0.005;
const LIGHTNESS_TOLERANCE = 0.004;
const CHROMA_STEP = 0.005;
const DATED_BUCKETS = 5;

/**
 * Today to Older, then Unknown. A ramp in OKLab (where equal steps look equal): Today is the
 * accent's hue at its strongest and farthest from the background, and each older bucket moves
 * evenly toward the background, ending at Older, the faintest fill whose SHADED mean still keeps
 * 3:1. Mixing the accent with the muted text color instead gave steps too close to tell apart in
 * palettes where the two are about as light. Unknown is a plain gray halfway along.
 *
 * Every fill keeps 3:1 on its base and on its shaded mean and lets a label reach 4.5:1 (age colors
 * carry labels too). If the single-hue ramp misses a step, monotonic lightness or a label, the
 * ramp's hue is turned as little as needed (see RAMP_HUE_SPAN_STEP_DEGREES for which palettes do).
 * Ramps that cannot be made valid fall back to the single-hue ramp and the age tests report them.
 */
function ageRamp(accent: string, background: string, mode: Mode): string[] {
  const plain = rampFor(accent, background, mode, 0, OLD_CHROMA);
  if (rampIsValid(plain, background, mode)) return plain;
  for (let degrees = RAMP_HUE_SPAN_STEP_DEGREES; degrees <= RAMP_HUE_SPAN_MAX_DEGREES; degrees += RAMP_HUE_SPAN_STEP_DEGREES) {
    for (const oldChroma of OLD_CHROMA_OPTIONS) {
      for (const direction of [-1, 1]) {
        const turned = rampFor(accent, background, mode, direction * degrees, oldChroma);
        if (rampIsValid(turned, background, mode)) return turned;
      }
    }
  }
  return plain;
}

/** Neighbouring dated colors at least MIN_AGE_STEP apart, strictly monotonic in lightness, Unknown apart from all, labels readable. */
function rampIsValid(ramp: string[], background: string, mode: Mode): boolean {
  const dated = ramp.slice(0, DATED_BUCKETS);
  const unknown = ramp[DATED_BUCKETS];
  const lightness = dated.map((color) => oklab(color)[0]);
  const monotonic = lightness.every((value, bucket) => bucket === 0 || (mode === 'dark' ? value < lightness[bucket - 1] : value > lightness[bucket - 1]));
  const stepsClear = dated.every((color, bucket) => bucket === 0 || perceptualDistance(color, dated[bucket - 1]) >= MIN_AGE_STEP);
  const unknownApart = dated.every((color) => perceptualDistance(color, unknown) >= MIN_AGE_STEP);
  return monotonic && stepsClear && unknownApart && ramp.every((color) => fillPasses(color, background, true));
}

function rampFor(accent: string, background: string, mode: Mode, hueSpanDegrees: number, oldChroma: number): string[] {
  const [, accentGreenRed, accentBlueYellow] = oklab(accent);
  const hue = Math.atan2(accentBlueYellow, accentGreenRed);
  const recentChroma = Math.min(RECENT_CHROMA_MAX, Math.max(RECENT_CHROMA_MIN, Math.hypot(accentGreenRed, accentBlueYellow)));
  const hueSpan = (hueSpanDegrees * Math.PI) / 180;
  // A color the screen cannot show would be clamped and lose lightness, so it gives up chroma instead.
  const colorAt = (lightness: number, chroma: number, progress = 0) => {
    const rotated = hue + hueSpan * progress;
    let shown = chroma;
    let color = fromOklab([lightness, shown * Math.cos(rotated), shown * Math.sin(rotated)]);
    while (shown > 0 && Math.abs(oklab(color)[0] - lightness) > LIGHTNESS_TOLERANCE) {
      shown = Math.max(0, shown - CHROMA_STEP);
      color = fromOklab([lightness, shown * Math.cos(rotated), shown * Math.sin(rotated)]);
    }
    return color;
  };

  const recentLightness = RECENT_LIGHTNESS[mode];
  // Toward the background: lighter on a light map, darker on a dark one.
  const towardBackground = mode === 'dark' ? -LIGHTNESS_STEP : LIGHTNESS_STEP;
  let oldLightness = recentLightness;
  while (
    oldLightness > 0 &&
    oldLightness < 1 &&
    fillPasses(colorAt(oldLightness + towardBackground, oldChroma, 1), background, false, OLD_CONTRAST_TARGET)
  ) {
    oldLightness += towardBackground;
  }

  // A fill that misses a rule is moved toward white or black. Falling back to the unmoved color
  // keeps the ramp complete, and rampIsValid then rejects it.
  const adjusted = (color: string) => ensureFill(color, background, mode, true) ?? color;
  const ramp = Array.from({ length: DATED_BUCKETS }, (_, bucket) => {
    const progress = bucket / (DATED_BUCKETS - 1);
    const lightness = recentLightness + (oldLightness - recentLightness) * progress;
    const chroma = recentChroma + (oldChroma - recentChroma) * progress;
    return adjusted(colorAt(lightness, chroma, progress));
  });
  const unknown = adjusted(colorAt((recentLightness + oldLightness) / 2, 0));
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

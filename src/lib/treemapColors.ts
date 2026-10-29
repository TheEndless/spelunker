import { channels, contrast, fromOklab, mix, normalizeHex, oklab, perceptualDistance, toHex } from './colors';
import type { Mode, Tokens } from './palettes';
import { loneRidgeMeanBrightness, shadeChannel } from './treemapCushion';

const CATEGORY_SATURATION = 0.9;
const FILL_CONTRAST = 3;
const LABEL_CONTRAST = 4.5;

/**
 * Other is a cool blue-gray neutral, read as "unclassified". The earlier warm gray (hue 0) shaded to
 * a muddy brown over large areas. Its hue sits near Code's (212), so it is told apart from Code by
 * its low saturation alone: an OKLab chroma of 0.02 to 0.036 against Code's 0.085 to 0.16, at least
 * 0.065 apart in every palette (Nord dark is the closest).
 */
const OTHER_HUE = 218;
const OTHER_SATURATION = 0.14;
/** The accent hue the category and size hue tables were written for (Slate's amber), so Slate keeps them as they are. */
const REFERENCE_ACCENT_HUE = 36;
/** The shares of the way to the accent's hue that the palette is tried at, in order. */
const ACCENT_TURN_SHARES = [1, 0.75, 0.5, 0.25, 0];
/** An accent or surface this gray has no hue worth following. */
const MIN_HUE_SATURATION = 0.12;
/** Hue in degrees for each category except the neutral Other, in FILE_CATEGORIES order. */
const CATEGORY_HUES = [212, 172, 78, 319, 14, 281, 247, 48, 192, 128, 345, 32];
/** Other comes last and has no hue of its own in the table. */
const OTHER_INDEX = CATEGORY_HUES.length;
/** Per-category lightness nudges, tuned so every pair stays at least 0.05 apart in OKLab after shading pulls dark-mode colors together. */
const CATEGORY_LIGHTNESS_SHIFT = [0, 0.06, 0, 0.112, 0.014, 0.081, -0.046, 0, 0.06, -0.04, 0.028, 0.06, 0];
/** The size classes run cool to hot, small to huge, so the big files stand out as warm patches. */
const SIZE_HUES = [225, 185, 130, 62, 28, 355];

export const CATEGORY_LABELS: readonly string[] = [
  'Code', 'Text', 'Data', 'Images', 'PDF', 'Audio', 'Video', 'Archives', 'Documents', 'Spreadsheets', 'Slides', 'Programs', 'Other',
];

export const AGE_LABELS: readonly string[] = ['Today', 'This week', 'This month', 'This year', 'Older', 'Unknown'];

export const SIZE_LABELS: readonly string[] = ['Under 16 KB', '16 KB to 256 KB', '256 KB to 4 MB', '4 MB to 64 MB', '64 MB to 1 GB', '1 GB or more'];

export interface MapColors {
  background: string;
  category: string[];
  age: string[];
  size: string[];
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
  return toHex(channels(base).map((channel) => shadeChannel(channel, brightness)));
}

/** Whether a label on the shaded mean of `base` reaches the text contrast. Fills in a thin middle band fail it with both text colors. */
function labelReadsOnMean(base: string): boolean {
  const mean = LONE_RIDGE_MEAN_BRIGHTNESS;
  return contrast(labelColorOn(base, mean, mean), shadedMean(base)) >= LABEL_CONTRAST;
}

const SEARCH_STEPS = 180;
/** The smallest OKLab distance between two category (or two size) base colors. */
const MIN_CATEGORY_DISTANCE = 0.05;
/** How far, and in what steps, a fill's start lightness may move to get clear of the colors before it. */
const NUDGE_LIGHTNESS = 0.01;
const MAX_NUDGE_STEPS = 12;
/** The same for the hue, tried only after the lightness alone could not do it. */
const NUDGE_HUE_DEGREES = 6;
const MAX_HUE_NUDGE_STEPS = 4;
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

/** The signed angle in degrees, between -180 and 180, to turn from hue `from` to hue `to` the short way round. */
function shortestTurn(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** The hue of a color in degrees, or null when it is too gray to have one. */
function hueOf(color: string): number | null {
  const [red, green, blue] = channels(color).map((channel) => channel / 255);
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const spread = high - low;
  const lightness = (high + low) / 2;
  const saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * lightness - 1));
  if (saturation < MIN_HUE_SATURATION) return null;
  const sector = high === red ? ((green - blue) / spread) % 6 : high === green ? (blue - red) / spread + 2 : (red - green) / spread + 4;
  return (sector * 60 + 360) % 360;
}

/**
 * The category and size fills for hues turned by `hueShift` degrees, or null when some fill cannot
 * be made to pass the contrast rules and stay apart from the fills before it. Raising HSL lightness
 * keeps more of the hue's saturation than mixing toward white would.
 */
function turnedFills(hueShift: number, background: string, mode: Mode): { category: string[]; size: string[] } | null {
  // The light search starts high and darkens only until a fill passes, so light fills land just past
  // the 3:1 base rule (about 3.0 to 3.9:1) instead of far darker than the dark map's.
  const baseLightness = mode === 'dark' ? 0.6 : 0.72;
  const searchDirection = mode === 'dark' ? 1 : -1;
  const turned = (hue: number) => (hue + hueShift + 360) % 360;

  /**
   * A fill of `hue` that passes the contrast rules and sits at least `MIN_CATEGORY_DISTANCE` from
   * every color in `apart`. The start color is tried first, then the lightness is nudged both ways,
   * and when that is not enough the hue is turned a little and the lightness tried again.
   */
  const fillOf = (hue: number, saturation: number, startLightness: number, apart: readonly string[]): string | undefined => {
    for (let hueNudge = 0; hueNudge <= MAX_HUE_NUDGE_STEPS; hueNudge++) {
      for (const hueDirection of hueNudge === 0 ? [0] : [1, -1]) {
        const nudgedHue = (hue + hueDirection * hueNudge * NUDGE_HUE_DEGREES + 360) % 360;
        for (let nudge = 0; nudge <= MAX_NUDGE_STEPS; nudge++) {
          for (const direction of nudge === 0 ? [0] : [1, -1]) {
            const lightness = startLightness + direction * nudge * NUDGE_LIGHTNESS;
            const fill = firstPassingFill(
              (step) => hslToHex(nudgedHue, saturation, Math.min(1, Math.max(0, lightness + searchDirection * step * CATEGORY_LIGHTNESS_STEP))),
              background,
              true,
            );
            if (fill !== undefined && apart.every((other) => perceptualDistance(fill, other) >= MIN_CATEGORY_DISTANCE)) return fill;
          }
        }
      }
    }
    return undefined;
  };

  const category: string[] = [];
  for (let index = 0; index < CATEGORY_LABELS.length; index++) {
    const isOther = index === OTHER_INDEX;
    const hue = isOther ? OTHER_HUE : turned(CATEGORY_HUES[index]);
    const fill = fillOf(hue, isOther ? OTHER_SATURATION : CATEGORY_SATURATION, baseLightness + CATEGORY_LIGHTNESS_SHIFT[index], category);
    if (fill === undefined) return null;
    category.push(fill);
  }
  const size: string[] = [];
  for (const hue of SIZE_HUES) {
    const fill = fillOf(turned(hue), CATEGORY_SATURATION, baseLightness, size);
    if (fill === undefined) return null;
    size.push(fill);
  }
  return { category, size };
}

const mapColorsCache = new Map<string, MapColors>();

/**
 * The map's colors for a theme. The category and size hues turn toward the theme's accent hue, so
 * each theme's map has its accent's family in it. Turning all the way can leave some light themes
 * with hues that cannot be told apart once darkened enough to read, so the turn is tried at full,
 * three quarters, half, a quarter, and none (the hues as first written, which always work), and the
 * first that fits every color is used. A gray accent turns nothing. Other stays a cool neutral
 * whatever the theme, since a warm gray shades to brown.
 */
export function mapColors(tokens: Tokens, mode: Mode): MapColors {
  const cacheKey = `${mode}|${tokens.accent}|${tokens.surface}`;
  const cached = mapColorsCache.get(cacheKey);
  if (cached) return cached;
  const background = normalizeHex(tokens.surface);
  const accentHue = hueOf(tokens.accent);
  const fullTurn = accentHue === null ? 0 : shortestTurn(REFERENCE_ACCENT_HUE, accentHue);
  let fills: ReturnType<typeof turnedFills> = null;
  for (const share of ACCENT_TURN_SHARES) {
    fills = turnedFills(fullTurn * share, background, mode);
    if (fills) break;
  }
  if (!fills) throw new Error(`No ${mode} category and size fills on ${background} reach the contrast and distance rules`);
  const colors = { background, ...fills, age: ageRamp(tokens.accent, background, mode), outlineLight: '#FFFFFF', outlineDark: '#000000' };
  mapColorsCache.set(cacheKey, colors);
  return colors;
}

/**
 * OKLab lightness of the Today color: deep on a light map, bright on a dark one, so it stands out most.
 * A lighter light Today leaves less room before Older. At 0.37 and 0.38 Tokyo night light has to
 * turn its ramp (5 and 10 degrees), and at 0.40 or above Nord, Solarized, Tokyo night and Verdigris
 * turn by 27 to 70 degrees and look garish, so 0.36 is the lightest that keeps every light ramp one hue.
 */
const RECENT_LIGHTNESS: Record<Mode, number> = { light: 0.36, dark: 0.96 };
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
 * The palettes that need it, pinned by the ageRampShape test (every other palette and mode keeps the
 * single-hue ramp): Nord dark turns the hue 95 degrees (-95) and keeps Older chroma 0.10, and One
 * dark turns 5 degrees (+5) with Older chroma 0.07. Nord dark could not be made valid with Older
 * chroma at or under 0.05 at any span up to 180 degrees, so its Older is more vivid than the others.
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
  const { hueSpanDegrees, oldChroma } = ageRampShape(accent, background, mode);
  return rampFor(accent, background, mode, hueSpanDegrees, oldChroma);
}

/**
 * How far the age ramp turns its hue from Today to Older, and the chroma it keeps at Older: no turn
 * and OLD_CHROMA when the single-hue ramp is valid or when nothing is. Exported so a test can pin
 * which palettes turn.
 */
export function ageRampShape(accent: string, background: string, mode: Mode): { hueSpanDegrees: number; oldChroma: number } {
  const plain = { hueSpanDegrees: 0, oldChroma: OLD_CHROMA };
  if (rampIsValid(rampFor(accent, background, mode, 0, OLD_CHROMA), background, mode)) return plain;
  for (let degrees = RAMP_HUE_SPAN_STEP_DEGREES; degrees <= RAMP_HUE_SPAN_MAX_DEGREES; degrees += RAMP_HUE_SPAN_STEP_DEGREES) {
    for (const oldChroma of OLD_CHROMA_OPTIONS) {
      for (const direction of [-1, 1]) {
        const hueSpanDegrees = direction * degrees;
        if (rampIsValid(rampFor(accent, background, mode, hueSpanDegrees, oldChroma), background, mode)) return { hueSpanDegrees, oldChroma };
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

import { ensureContrast, mix, normalizeHex } from './colors';
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
  const age = [0, 1, 2, 3, 4].map((step) => ensureContrast(mix(tokens.accent, tokens['text-muted'], step / 4), [background], 3));
  age.push(ensureContrast(tokens['border-strong'], [background], 3));
  return { background, category, age, outlineLight: '#FFFFFF', outlineDark: '#000000' };
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

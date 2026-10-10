const ELLIPSIS = '…';

type MeasureWidth = (text: string) => number;

/** Splits into code points so truncation never lands inside a surrogate pair. */
function codePoints(text: string): string[] {
  return Array.from(text);
}

/**
 * Shortens `text` to fit `maxWidth` by replacing its middle with an ellipsis. The end keeps one
 * more character than the start when the split is uneven, because the end of a path names the folder.
 */
export function fitMiddle(text: string, maxWidth: number, measureWidth: MeasureWidth): string {
  if (measureWidth(text) <= maxWidth) return text;
  if (measureWidth(ELLIPSIS) > maxWidth) return '';

  const characters = codePoints(text);
  const candidate = (kept: number) => {
    const endCount = Math.ceil(kept / 2);
    const startCount = kept - endCount;
    return (
      characters.slice(0, startCount).join('') +
      ELLIPSIS +
      characters.slice(characters.length - endCount).join('')
    );
  };

  // Widths grow with `kept`, so binary search for the largest count that still fits.
  let low = 0;
  let high = characters.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measureWidth(candidate(middle)) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return candidate(low);
}

/** Measures text in a given CSS font using an offscreen canvas. */
export function canvasMeasurer(font: string): MeasureWidth {
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = font;
  return (text) => context.measureText(text).width;
}

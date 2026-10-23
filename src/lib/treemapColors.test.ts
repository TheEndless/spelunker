import { describe, expect, it } from 'vitest';
import { contrast, oklab, perceptualDistance } from './colors';
import { FILE_CATEGORIES } from './fileKinds';
import { PALETTES, type Mode } from './palettes';
import { shadeChannel, loneRidgeMeanBrightness } from './treemapCushion';
import { AGE_LABELS, CATEGORY_LABELS, labelColorOn, mapColors, shadedMean } from './treemapColors';
import { AGE_BUCKET_COUNT } from './treemapLayout';

const HEX = /^#[0-9A-F]{6}$/;
/** Shading makes neighbours harder to tell apart, so category base colors keep a clear OKLab gap. */
const MIN_CATEGORY_DISTANCE = 0.05;
/**
 * The smallest OKLab distance between neighbouring age colors. A just-noticeable difference is
 * about 0.02, and small rectangles side by side need a few of those to be told apart at a glance.
 */
const MIN_AGE_STEP = 0.06;
/** Today to Older are dated, in order. Unknown comes last. */
const LAST_DATED_BUCKET = 4;
const UNKNOWN_BUCKET = 5;

describe('mapColors', () => {
  for (const palette of PALETTES) {
    for (const mode of ['light', 'dark'] as Mode[]) {
      describe(`${palette.id} ${mode}`, () => {
        const colors = mapColors(palette[mode], mode);

        it('defines every category and age color as hex', () => {
          expect(colors.category).toHaveLength(FILE_CATEGORIES.length);
          expect(colors.age).toHaveLength(AGE_BUCKET_COUNT);
          for (const color of [...colors.category, ...colors.age, colors.background]) expect(color).toMatch(HEX);
        });

        it('keeps every base fill at least 3:1 against the map background (Flat mode and the legend paint it as is)', () => {
          for (const color of [...colors.category, ...colors.age]) {
            expect(contrast(color, colors.background)).toBeGreaterThanOrEqual(3);
          }
        });

        it('runs the dated ages monotonically in OKLab lightness', () => {
          const lightness = colors.age.slice(0, LAST_DATED_BUCKET + 1).map((color) => oklab(color)[0]);
          for (let bucket = 0; bucket < LAST_DATED_BUCKET; bucket++) {
            if (mode === 'dark') expect(lightness[bucket + 1]).toBeLessThan(lightness[bucket]);
            else expect(lightness[bucket + 1]).toBeGreaterThan(lightness[bucket]);
          }
        });

        it('lets a label reach 4.5:1 on every age fill at the shaded mean', () => {
          const typical = loneRidgeMeanBrightness();
          colors.age.forEach((base, bucket) => {
            const reached = contrast(labelColorOn(base, typical, typical), shadedMean(base));
            expect(reached, `age ${bucket} ${base}`).toBeGreaterThanOrEqual(4.5 - 1e-9);
          });
        });

        it('keeps the shaded mean of every fill at least 3:1 against the map background', () => {
          for (const base of [...colors.category, ...colors.age]) {
            expect(contrast(shadedMean(base), colors.background)).toBeGreaterThanOrEqual(3);
          }
        });

        it('keeps category base colors clearly apart', () => {
          for (let i = 0; i < colors.category.length; i++) {
            for (let j = i + 1; j < colors.category.length; j++) {
              expect(perceptualDistance(colors.category[i], colors.category[j])).toBeGreaterThanOrEqual(MIN_CATEGORY_DISTANCE);
            }
          }
        });

        it('gives each category its own color', () => {
          expect(new Set(colors.category).size).toBe(colors.category.length);
        });

        it('orders the ages from the accent to the muted end without repeats', () => {
          expect(new Set(colors.age).size).toBe(colors.age.length);
        });

        it('makes each age step clearly visible, not just different', () => {
          for (let bucket = 0; bucket < LAST_DATED_BUCKET; bucket++) {
            expect(perceptualDistance(colors.age[bucket], colors.age[bucket + 1])).toBeGreaterThanOrEqual(MIN_AGE_STEP);
          }
        });

        it('keeps Unknown apart from every dated bucket', () => {
          for (let bucket = 0; bucket <= LAST_DATED_BUCKET; bucket++) {
            expect(perceptualDistance(colors.age[UNKNOWN_BUCKET], colors.age[bucket])).toBeGreaterThanOrEqual(MIN_AGE_STEP);
          }
        });

        it('runs the ramp from the most to the least prominent against the background', () => {
          const prominence = colors.age.slice(0, LAST_DATED_BUCKET + 1).map((color) => contrast(color, colors.background));
          for (let bucket = 0; bucket < LAST_DATED_BUCKET; bucket++) expect(prominence[bucket]).toBeGreaterThan(prominence[bucket + 1]);
        });

        it('has a two-tone outline that reads against every fill', () => {
          for (const fill of [...colors.category, ...colors.age]) {
            const best = Math.max(contrast(colors.outlineLight, fill), contrast(colors.outlineDark, fill));
            expect(best).toBeGreaterThanOrEqual(3);
          }
        });
      });
    }
  }

  it('has a label for every category and age bucket', () => {
    expect(CATEGORY_LABELS).toHaveLength(FILE_CATEGORIES.length);
    expect(AGE_LABELS).toHaveLength(AGE_BUCKET_COUNT);
  });
});

describe('shadedMean', () => {
  it('uses the measured lone-ridge mean, not a hard-coded one', () => {
    const channel = shadeChannel(128, loneRidgeMeanBrightness()).toString(16).padStart(2, '0');
    expect(shadedMean('#808080')).toBe(`#${channel}${channel}${channel}`.toUpperCase());
  });
});

describe('labelColorOn', () => {
  it('prefers the text color with the better worst-case contrast', () => {
    expect(labelColorOn('#FFFFFF', 1, 0.6)).toBe('#111111');
    expect(labelColorOn('#101010', 1, 0.6)).toBe('#FFFFFF');
  });

  it('reaches 4.5:1 on every category fill in every theme at a typical label brightness', () => {
    const typical = loneRidgeMeanBrightness();
    for (const palette of PALETTES) {
      for (const mode of ['light', 'dark'] as Mode[]) {
        mapColors(palette[mode], mode).category.forEach((base, index) => {
          const text = labelColorOn(base, typical, typical);
          const reached = contrast(text, shadedMean(base));
          expect(reached, `${palette.id} ${mode} ${CATEGORY_LABELS[index]} ${base}`).toBeGreaterThanOrEqual(4.5 - 1e-9);
        });
      }
    }
  });
});

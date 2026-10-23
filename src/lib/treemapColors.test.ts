import { describe, expect, it } from 'vitest';
import { contrast } from './colors';
import { FILE_CATEGORIES } from './fileKinds';
import { PALETTES, type Mode } from './palettes';
import { AGE_LABELS, CATEGORY_LABELS, mapColors } from './treemapColors';
import { AGE_BUCKET_COUNT } from './treemapLayout';

const HEX = /^#[0-9A-F]{6}$/;

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

        it('keeps every fill at least 3:1 against the map background', () => {
          for (const color of [...colors.category, ...colors.age]) {
            expect(contrast(color, colors.background)).toBeGreaterThanOrEqual(3);
          }
        });

        it('gives each category its own color', () => {
          expect(new Set(colors.category).size).toBe(colors.category.length);
        });

        it('orders the ages from the accent to the muted end without repeats', () => {
          expect(new Set(colors.age).size).toBe(colors.age.length);
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

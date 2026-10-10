import { describe, expect, it } from 'vitest';
import { contrast } from './colors';
import {
  CONTRAST_CHECKS,
  PALETTES,
  TOKEN_NAMES,
  accentTextFor,
  placeholderColorFor,
  findPalette,
  tokensFor,
  tokensFromSeed,
  versionNames,
  type Seed,
} from './palettes';

const everyVariant = PALETTES.flatMap((palette) =>
  (['light', 'dark'] as const).map((mode) => ({ palette, mode, tokens: palette[mode] })),
);

describe('the palette list', () => {
  it('has unique ids and non-empty labels', () => {
    const ids = PALETTES.map((palette) => palette.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const palette of PALETTES) expect(palette.label.trim()).not.toBe('');
  });

  it('starts with the original slate palette, which is the default', () => {
    expect(PALETTES[0].id).toBe('slate');
    expect(PALETTES[0].label).toBe('Slate');
    expect(findPalette('slate').light?.accent).toBe('#A85A00');
    expect(findPalette('slate').dark?.accent).toBe('#F2A33A');
  });

  it('includes the common editor themes', () => {
    const ids = PALETTES.map((palette) => palette.id);
    for (const expected of ['solarized', 'github', 'one', 'nord', 'gruvbox', 'catppuccin', 'tokyo-night', 'dracula']) {
      expect(ids).toContain(expected);
    }
  });

  it('gives every theme both a light and a dark version, and names them', () => {
    for (const palette of PALETTES) {
      expect(palette.light, `${palette.id} light`).toBeDefined();
      expect(palette.dark, `${palette.id} dark`).toBeDefined();
      expect(palette.names.light.trim(), `${palette.id} light name`).not.toBe('');
      expect(palette.names.dark.trim(), `${palette.id} dark name`).not.toBe('');
    }
  });

  it('leaves out themes that lack a light or a dark version', () => {
    expect(PALETTES.map((palette) => palette.id)).not.toContain('monokai');
  });

  it('pairs Dracula with its official light version, Alucard', () => {
    const dracula = findPalette('dracula');
    expect(dracula.names).toEqual({ light: 'Alucard', dark: 'Dracula' });
    expect(dracula.light.bg).not.toBe(dracula.dark.bg);
  });
});

describe('every theme and mode', () => {
  it('defines every token as a valid hex color', () => {
    for (const { palette, mode, tokens } of everyVariant) {
      for (const name of TOKEN_NAMES) {
        expect(tokens[name], `${palette.id}/${mode} ${name}`).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it.each(CONTRAST_CHECKS)('keeps $label readable', ({ foreground, background, minimum }) => {
    for (const { palette, mode, tokens } of everyVariant) {
      const ratio = contrast(tokens[foreground], tokens[background]);
      expect(ratio, `${palette.id}/${mode}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum);
    }
  });

  it('keeps accent-colored text readable on every surface it is drawn on', () => {
    for (const { palette, mode, tokens } of everyVariant) {
      const text = accentTextFor(tokens);
      for (const surface of ['surface', 'row-hover', 'row-selected', 'header-bg', 'surface-raised'] as const) {
        expect(contrast(text, tokens[surface]), `${palette.id}/${mode}: accent text on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('makes hint text softer than muted text but still readable on the field background', () => {
    for (const { palette, mode, tokens } of everyVariant) {
      const hint = contrast(placeholderColorFor(tokens), tokens.surface);
      expect(hint, `${palette.id}/${mode}: hint on surface`).toBeGreaterThanOrEqual(3);
      expect(hint, `${palette.id}/${mode}: softer than muted text`).toBeLessThan(contrast(tokens['text-muted'], tokens.surface));
    }
  });

  it('keeps accent text recognisably the accent, not a different color', () => {
    for (const { palette, mode, tokens } of everyVariant) {
      // A nudge toward black or white must not wander far from the accent's own hue family.
      expect(contrast(accentTextFor(tokens), tokens.accent), `${palette.id}/${mode}`).toBeLessThan(4);
    }
  });

  it('keeps light themes lighter than their text and dark themes darker', () => {
    for (const { palette, mode, tokens } of everyVariant) {
      const surfaceVsText = contrast(tokens.surface, tokens.text);
      expect(surfaceVsText, `${palette.id}/${mode}`).toBeGreaterThan(7);
    }
  });
});

describe('tokensFor', () => {
  it('returns the tokens for the requested mode', () => {
    expect(tokensFor('nord', 'light')).toBe(findPalette('nord').light);
    expect(tokensFor('nord', 'dark')).toBe(findPalette('nord').dark);
  });

  it('falls back to slate for an unknown theme id, such as a removed theme', () => {
    expect(findPalette('does-not-exist').id).toBe('slate');
    expect(findPalette('monokai').id).toBe('slate');
    expect(tokensFor('does-not-exist', 'dark')).toBe(findPalette('slate').dark);
  });
});

describe('tokensFromSeed', () => {
  const lowContrast: Seed = {
    mode: 'light',
    page: '#EEE8D5',
    surface: '#FDF6E3',
    raised: '#F7F0DC',
    text: '#93A1A1',
    muted: '#B0BABA',
    border: '#D9D2BC',
    accent: '#B5D6F0',
    danger: '#F5A0A0',
    highlight: '#F6E7B0',
  };

  it('nudges text, muted text, danger, and the accent label until they are readable', () => {
    const tokens = tokensFromSeed(lowContrast);
    expect(contrast(tokens.text, tokens.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(tokens['text-muted'], tokens.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.danger, tokens.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens['on-accent'], tokens.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves a seed that already passes essentially unchanged', () => {
    const good: Seed = { ...lowContrast, text: '#1A1A1A', muted: '#555555', accent: '#1D4ED8', danger: '#B91C1C' };
    const tokens = tokensFromSeed(good);
    expect(tokens.text).toBe('#1A1A1A');
    expect(tokens.accent).toBe('#1D4ED8');
  });

  it('uses the seed selection color when given and derives one otherwise', () => {
    expect(tokensFromSeed({ ...lowContrast, selection: '#CCDDEE' })['row-selected']).toBe('#CCDDEE');
    expect(tokensFromSeed(lowContrast)['row-selected']).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('versionNames', () => {
  it('is empty when the names only repeat the theme name or say Light and Dark', () => {
    for (const id of ['slate', 'geode', 'solarized', 'github', 'one', 'gruvbox']) {
      expect(versionNames(findPalette(id)), id).toBe('');
    }
  });

  it('lists both names when they say something new', () => {
    expect(versionNames(findPalette('catppuccin'))).toBe('Latte and Mocha');
    expect(versionNames(findPalette('nord'))).toBe('Snow Storm and Polar Night');
    expect(versionNames(findPalette('tokyo-night'))).toBe('Day and Night');
    expect(versionNames(findPalette('dracula'))).toBe('Alucard and Dracula');
  });
});

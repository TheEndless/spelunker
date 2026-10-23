import { describe, expect, it } from 'vitest';
import { bestTextOn, contrast, ensureContrast, fromOklab, mix, normalizeHex, oklab, perceptualDistance } from './colors';

describe('oklab', () => {
  it('puts white at lightness 1 and black at 0, with no color', () => {
    const [whiteL, whiteA, whiteB] = oklab('#FFFFFF');
    expect(whiteL).toBeCloseTo(1, 3);
    expect(Math.abs(whiteA) + Math.abs(whiteB)).toBeLessThan(0.001);
    expect(oklab('#000000')[0]).toBeCloseTo(0, 6);
  });

  it('matches the published value for pure red', () => {
    const [lightness, greenRed, blueYellow] = oklab('#FF0000');
    expect(lightness).toBeCloseTo(0.628, 3);
    expect(greenRed).toBeCloseTo(0.2249, 3);
    expect(blueYellow).toBeCloseTo(0.1258, 3);
  });

  it('round-trips through fromOklab', () => {
    for (const color of ['#A85A00', '#0F766E', '#5E81AC', '#ECEFF4', '#191D23']) expect(fromOklab(oklab(color))).toBe(color);
  });

  it('clamps colors outside the screen gamut', () => {
    expect(fromOklab([1.2, 0, 0])).toBe('#FFFFFF');
  });
});

describe('perceptualDistance', () => {
  it('is 0 for the same color, 1 for black and white, and symmetric', () => {
    expect(perceptualDistance('#336699', '#336699')).toBe(0);
    expect(perceptualDistance('#000000', '#FFFFFF')).toBeCloseTo(1, 3);
    expect(perceptualDistance('#A85A00', '#5A6573')).toBeCloseTo(perceptualDistance('#5A6573', '#A85A00'), 9);
  });
});

describe('normalizeHex', () => {
  it('upper-cases and expands short hex', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('#1e1e2e')).toBe('#1E1E2E');
  });
  it('rejects anything that is not a hex color', () => {
    for (const bad of ['red', '#12', '#12345', '1e1e2e', '#gggggg', '']) {
      expect(() => normalizeHex(bad)).toThrow();
    }
  });
});

describe('contrast', () => {
  it('is 21 for black on white and 1 for identical colors', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#336699', '#336699')).toBeCloseTo(1, 5);
  });
  it('is symmetric', () => {
    expect(contrast('#123456', '#fedcba')).toBeCloseTo(contrast('#fedcba', '#123456'), 8);
  });
  it('matches a known pair', () => {
    // #767676 on white is the classic 4.54:1 AA threshold gray.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
  });
});

describe('mix', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(mix('#102030', '#f0e0d0', 0)).toBe('#102030');
    expect(mix('#102030', '#f0e0d0', 1)).toBe('#F0E0D0');
  });
  it('blends halfway', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('ensureContrast', () => {
  it('leaves a color alone when it already passes', () => {
    expect(ensureContrast('#000000', ['#ffffff'], 4.5)).toBe('#000000');
  });
  it('darkens text on light backgrounds until it passes', () => {
    const adjusted = ensureContrast('#93a1a1', ['#fdf6e3'], 4.5);
    expect(contrast(adjusted, '#fdf6e3')).toBeGreaterThanOrEqual(4.5);
  });
  it('lightens text on dark backgrounds until it passes', () => {
    const adjusted = ensureContrast('#4c566a', ['#2e3440'], 4.5);
    expect(contrast(adjusted, '#2e3440')).toBeGreaterThanOrEqual(4.5);
  });
  it('satisfies every background at once', () => {
    const backgrounds = ['#fdf6e3', '#eee8d5', '#e4dcc4'];
    const adjusted = ensureContrast('#93a1a1', backgrounds, 4.5);
    for (const background of backgrounds) {
      expect(contrast(adjusted, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('changes the color as little as it can', () => {
    const original = '#8a8a8a';
    const adjusted = ensureContrast(original, ['#ffffff'], 4.5);
    expect(contrast(adjusted, '#ffffff')).toBeLessThan(5.2);
  });
});

describe('bestTextOn', () => {
  it('picks dark text on light fills and light text on dark fills', () => {
    expect(bestTextOn('#fabd2f')).toBe('#111111');
    expect(bestTextOn('#1e66f5')).toBe('#FFFFFF');
  });
  it('picks whichever contrasts more on a mid tone', () => {
    const pick = bestTextOn('#7aa2f7');
    expect(contrast(pick, '#7aa2f7')).toBeGreaterThanOrEqual(contrast(pick === '#FFFFFF' ? '#111111' : '#FFFFFF', '#7aa2f7'));
  });
});

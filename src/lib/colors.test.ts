import { describe, expect, it } from 'vitest';
import { bestTextOn, contrast, ensureContrast, mix, normalizeHex } from './colors';

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

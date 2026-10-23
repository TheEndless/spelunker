import { describe, expect, it } from 'vitest';
import {
  addRidge, brightnessAt, CUSHION_AMBIENT, CUSHION_DIFFUSE, CUSHION_HEIGHT, CUSHION_MIN_BRIGHTNESS,
  loneRidgeMeanBrightness, shadeChannel,
} from './treemapCushion';

function loneRidge(width: number, height: number): [number, number, number, number] {
  const coefficients = [0, 0, 0, 0];
  addRidge(coefficients, 0, 0, 0, width, height, CUSHION_HEIGHT);
  return coefficients as [number, number, number, number];
}

describe('addRidge', () => {
  it('matches the cushion construction for one ridge', () => {
    const [sx1, sx2, sy1, sy2] = loneRidge(100, 50);
    expect(sx1).toBeCloseTo((4 * CUSHION_HEIGHT * 100) / 100, 6); // 4h (x2 + x1) / (x2 - x1) = 4h at x1 = 0
    expect(sx2).toBeCloseTo((-4 * CUSHION_HEIGHT) / 100, 6);
    expect(sy1).toBeCloseTo((4 * CUSHION_HEIGHT * 50) / 50, 6);
    expect(sy2).toBeCloseTo((-4 * CUSHION_HEIGHT) / 50, 6);
  });

  it('adds onto existing coefficients and honours the offset', () => {
    const buffer = new Float32Array(8);
    addRidge(buffer, 4, 0, 0, 10, 10, 0.5);
    addRidge(buffer, 4, 0, 0, 10, 10, 0.5);
    const single = new Float32Array(4);
    addRidge(single, 0, 0, 0, 10, 10, 1.0);
    expect(Array.from(buffer.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) expect(buffer[4 + i]).toBeCloseTo(single[i], 5);
  });

  it('adds nothing for a degenerate side and stays finite', () => {
    const coefficients = [0, 0, 0, 0];
    addRidge(coefficients, 0, 5, 5, 5, 20, 0.4);
    expect(coefficients.every(Number.isFinite)).toBe(true);
  });
});

describe('brightnessAt', () => {
  it('is the ambient floor value with no surface only when facing away, and the top value when level', () => {
    // A level surface faces mostly along +z, toward the light's z component.
    const level = brightnessAt(0, 0, 0, 0, 5, 5);
    expect(level).toBeCloseTo(CUSHION_AMBIENT + (CUSHION_DIFFUSE * 10) / Math.hypot(-1, -1, 10), 4);
  });

  it('lights the top-left of a tile more than the bottom-right', () => {
    const [sx1, sx2, sy1, sy2] = loneRidge(100, 100);
    expect(brightnessAt(sx1, sx2, sy1, sy2, 5, 5)).toBeGreaterThan(brightnessAt(sx1, sx2, sy1, sy2, 95, 95));
  });

  it('never goes below the minimum brightness and never above ambient plus diffuse', () => {
    const [sx1, sx2, sy1, sy2] = loneRidge(40, 40);
    for (let x = 0.5; x < 40; x += 1) {
      for (let y = 0.5; y < 40; y += 1) {
        const value = brightnessAt(sx1, sx2, sy1, sy2, x, y);
        expect(value).toBeGreaterThanOrEqual(CUSHION_MIN_BRIGHTNESS);
        expect(value).toBeLessThanOrEqual(CUSHION_AMBIENT + CUSHION_DIFFUSE + 1e-9);
      }
    }
  });

  it('shades one tile the same at any size (the coordinate space is relative to the tile)', () => {
    const small = loneRidge(20, 20);
    const large = loneRidge(200, 200);
    const quarterSmall = brightnessAt(...small, 5, 5);
    const quarterLarge = brightnessAt(...large, 50, 50);
    expect(quarterSmall).toBeCloseTo(quarterLarge, 4);
  });

  it('gets darker where ridges stack (a nested tile in a bottom-right corner)', () => {
    const outer = [0, 0, 0, 0];
    addRidge(outer, 0, 0, 0, 100, 100, CUSHION_HEIGHT);
    const nested = [...outer];
    addRidge(nested, 0, 70, 70, 100, 100, CUSHION_HEIGHT * 0.91);
    const [a, b, c, d] = nested;
    expect(brightnessAt(a, b, c, d, 95, 95)).toBeLessThan(brightnessAt(outer[0], outer[1], outer[2], outer[3], 95, 95));
  });
});

describe('shadeChannel', () => {
  it('scales and clamps to a whole 0..255 value', () => {
    expect(shadeChannel(100, 1)).toBe(100);
    expect(shadeChannel(200, 1.08)).toBe(216);
    expect(shadeChannel(250, 1.08)).toBe(255);
    expect(shadeChannel(100, 0)).toBe(0);
  });
});

describe('loneRidgeMeanBrightness', () => {
  it('lies in the band the contrast tests rely on', () => {
    const mean = loneRidgeMeanBrightness();
    expect(mean).toBeGreaterThanOrEqual(0.74);
    expect(mean).toBeLessThanOrEqual(0.8);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA } from './criteria';
import { RECIPES, applyRecipe } from './recipes';

describe('example searches', () => {
  it('offers three examples, each with a title and an explanation', () => {
    expect(RECIPES).toHaveLength(3);
    for (const recipe of RECIPES) {
      expect(recipe.title).not.toBe('');
      expect(recipe.detail).not.toBe('');
    }
  });

  it('keeps the folder the user already chose', () => {
    const before = { ...DEFAULT_CRITERIA, lookIn: 'D:\\Projects' };
    for (const recipe of RECIPES) {
      expect(applyRecipe(before, recipe).lookIn).toBe('D:\\Projects');
    }
  });

  it('fills the name and text fields for the code example', () => {
    const after = applyRecipe(DEFAULT_CRITERIA, RECIPES[0]);
    expect(after.namePatterns).toContain('*.');
    expect(after.text).toBe('TODO');
    expect(after.wholeWord).toBe(true);
  });

  it('switches on a date filter for the recent documents example', () => {
    const after = applyRecipe(DEFAULT_CRITERIA, RECIPES[1]);
    expect(after.modified.mode).toBe('within');
    expect(after.text).toBe('');
  });

  it('switches on a size filter for the large files example', () => {
    const after = applyRecipe(DEFAULT_CRITERIA, RECIPES[2]);
    expect(after.size.mode).toBe('larger');
    expect(after.size.unit).toBe('MB');
  });

  it('starts from a clean slate so an earlier filter cannot leak into the example', () => {
    const before = { ...DEFAULT_CRITERIA, text: 'old', regex: true, size: { ...DEFAULT_CRITERIA.size, mode: 'smaller' as const, value: '5' } };
    const after = applyRecipe(before, RECIPES[0]);
    expect(after.regex).toBe(false);
    expect(after.size.mode).toBe('any');
  });

  it('does not change the criteria it was given', () => {
    const before = { ...DEFAULT_CRITERIA };
    applyRecipe(before, RECIPES[2]);
    expect(before).toEqual(DEFAULT_CRITERIA);
  });
});

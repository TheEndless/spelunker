import { describe, expect, it } from 'vitest';
import { tabAfterKey } from './tabKeys';

describe('tabAfterKey', () => {
  it('steps to the next and the previous tab', () => {
    expect(tabAfterKey('ArrowRight', 0, 3)).toBe(1);
    expect(tabAfterKey('ArrowLeft', 2, 3)).toBe(1);
  });

  it('wraps round at both ends', () => {
    expect(tabAfterKey('ArrowRight', 2, 3)).toBe(0);
    expect(tabAfterKey('ArrowLeft', 0, 3)).toBe(2);
  });

  it('goes to the first and last tab with Home and End', () => {
    expect(tabAfterKey('Home', 2, 3)).toBe(0);
    expect(tabAfterKey('End', 0, 3)).toBe(2);
  });

  it('leaves every other key alone', () => {
    for (const key of ['Enter', ' ', 'Tab', 'ArrowDown', 'ArrowUp', 'a', 'Escape']) {
      expect(tabAfterKey(key, 1, 3), key).toBeNull();
    }
  });

  it('stays on the only tab, and does nothing with no tabs', () => {
    expect(tabAfterKey('ArrowRight', 0, 1)).toBe(0);
    expect(tabAfterKey('ArrowLeft', 0, 1)).toBe(0);
    expect(tabAfterKey('ArrowRight', 0, 0)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { matchPosition, stepMatch } from './matchNavigation';

describe('stepMatch', () => {
  it('moves to the next and previous match', () => {
    expect(stepMatch(1, 5, 1)).toBe(2);
    expect(stepMatch(3, 5, -1)).toBe(2);
  });

  it('wraps around at both ends', () => {
    expect(stepMatch(4, 5, 1)).toBe(0);
    expect(stepMatch(0, 5, -1)).toBe(4);
  });

  it('goes to the first match when going forward from none, and the last when going back', () => {
    expect(stepMatch(-1, 5, 1)).toBe(0);
    expect(stepMatch(-1, 5, -1)).toBe(4);
  });

  it('has nothing to step to without matches', () => {
    expect(stepMatch(-1, 0, 1)).toBe(-1);
    expect(stepMatch(0, 0, -1)).toBe(-1);
  });

  it('stays on the only match', () => {
    expect(stepMatch(0, 1, 1)).toBe(0);
    expect(stepMatch(0, 1, -1)).toBe(0);
  });
});

describe('matchPosition', () => {
  it('describes the current match for display and speech', () => {
    expect(matchPosition(0, 5)).toBe('Match 1 of 5');
    expect(matchPosition(4, 5)).toBe('Match 5 of 5');
  });

  it('describes the count when no match is selected yet', () => {
    expect(matchPosition(-1, 5)).toBe('5 matches');
    expect(matchPosition(-1, 1)).toBe('1 match');
  });

  it('says so when there are no matching lines', () => {
    expect(matchPosition(-1, 0)).toBe('No matches');
  });
});

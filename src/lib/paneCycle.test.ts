import { describe, expect, it } from 'vitest';
import { PANE_ORDER, nextPane, type PaneId } from './paneCycle';

describe('nextPane', () => {
  it('cycles forward through search, results, preview and back to search', () => {
    expect(PANE_ORDER).toEqual(['search', 'results', 'preview']);
    expect(nextPane('search', 1)).toBe('results');
    expect(nextPane('results', 1)).toBe('preview');
    expect(nextPane('preview', 1)).toBe('search');
  });

  it('cycles backward', () => {
    expect(nextPane('search', -1)).toBe('preview');
    expect(nextPane('preview', -1)).toBe('results');
    expect(nextPane('results', -1)).toBe('search');
  });

  it('starts at the first pane going forward and the last going backward when focus is in no pane', () => {
    expect(nextPane(null, 1)).toBe('search');
    expect(nextPane(null, -1)).toBe('preview');
  });
});

describe('nextPane with a hidden pane', () => {
  const withoutPreview: PaneId[] = ['search', 'results'];

  it('skips the pane that is not shown', () => {
    expect(nextPane('results', 1, withoutPreview)).toBe('search');
    expect(nextPane('search', -1, withoutPreview)).toBe('results');
  });

  it('moves on normally between the panes that are shown', () => {
    expect(nextPane('search', 1, withoutPreview)).toBe('results');
  });

  it('starts at the first and last shown pane when focus is in none', () => {
    expect(nextPane(null, 1, withoutPreview)).toBe('search');
    expect(nextPane(null, -1, withoutPreview)).toBe('results');
  });

  it('treats a focus in the hidden pane as being at its place in the order', () => {
    expect(nextPane('preview', 1, withoutPreview)).toBe('search');
    expect(nextPane('preview', -1, withoutPreview)).toBe('results');
  });
});

import { describe, expect, it } from 'vitest';
import {
  defaultLayout,
  moveColumnBefore,
  growToFill,
  moveColumnByStep,
  normalizeLayout,
  resetWidths,
  resizeColumn,
  scaleToFill,
  shrinkToFit,
  toggleColumn,
  visibleColumns,
} from './columnLayout';

describe('default layout', () => {
  it('shows every column in the classic order', () => {
    const layout = defaultLayout();
    expect(visibleColumns(layout)).toEqual(['name', 'folder', 'hits', 'size', 'modified', 'type']);
    expect(layout.autoSize).toBe(true);
  });
});

describe('visibility', () => {
  it('hides and shows a column without losing its place', () => {
    const hidden = toggleColumn(defaultLayout(), 'size');
    expect(visibleColumns(hidden)).toEqual(['name', 'folder', 'hits', 'modified', 'type']);
    expect(visibleColumns(toggleColumn(hidden, 'size'))).toEqual(['name', 'folder', 'hits', 'size', 'modified', 'type']);
  });

  it('never hides the last visible column', () => {
    let layout = defaultLayout();
    for (const id of ['folder', 'hits', 'size', 'modified', 'type'] as const) layout = toggleColumn(layout, id);
    expect(visibleColumns(layout)).toEqual(['name']);
    expect(visibleColumns(toggleColumn(layout, 'name'))).toEqual(['name']);
  });
});

describe('reordering', () => {
  it('moves a column before another', () => {
    const layout = moveColumnBefore(defaultLayout(), 'type', 'folder');
    expect(visibleColumns(layout)).toEqual(['name', 'type', 'folder', 'hits', 'size', 'modified']);
  });

  it('moves a column to the end when dropped past the last one', () => {
    const layout = moveColumnBefore(defaultLayout(), 'name', null);
    expect(visibleColumns(layout)).toEqual(['folder', 'hits', 'size', 'modified', 'type', 'name']);
  });

  it('dropping a column on itself changes nothing', () => {
    expect(moveColumnBefore(defaultLayout(), 'size', 'size')).toEqual(defaultLayout());
  });

  it('moves one step left or right among the visible columns, skipping hidden ones', () => {
    const layout = toggleColumn(defaultLayout(), 'hits');
    expect(visibleColumns(moveColumnByStep(layout, 'size', -1))).toEqual(['name', 'size', 'folder', 'modified', 'type']);
    expect(visibleColumns(moveColumnByStep(layout, 'folder', 1))).toEqual(['name', 'size', 'folder', 'modified', 'type']);
  });

  it('stops at the ends', () => {
    expect(moveColumnByStep(defaultLayout(), 'name', -1)).toEqual(defaultLayout());
    expect(moveColumnByStep(defaultLayout(), 'type', 1)).toEqual(defaultLayout());
  });
});

describe('resetWidths', () => {
  it('restores the default widths and turns automatic sizing back on', () => {
    const sized = { ...defaultLayout(), widths: { ...defaultLayout().widths, name: 400 }, autoSize: false };
    const reset = resetWidths(sized);
    expect(reset.widths).toEqual(defaultLayout().widths);
    expect(reset.autoSize).toBe(true);
  });
});

describe('loading a stored layout', () => {
  it('falls back to the default for garbage', () => {
    expect(normalizeLayout(null)).toEqual(defaultLayout());
    expect(normalizeLayout('x')).toEqual(defaultLayout());
    expect(normalizeLayout({ order: 5 })).toEqual(defaultLayout());
  });

  it('keeps a valid stored order and drops unknown ids', () => {
    const layout = normalizeLayout({ order: ['type', 'bogus', 'name'], hidden: ['bogus', 'size'], widths: {}, autoSize: false });
    expect(visibleColumns(layout)).toEqual(['type', 'name', 'folder', 'hits', 'modified']);
    expect(layout.autoSize).toBe(false);
  });

  it('adds columns a stored layout does not know about, so new columns appear after an upgrade', () => {
    const layout = normalizeLayout({ order: ['name', 'size'], hidden: [], widths: {}, autoSize: true });
    expect(visibleColumns(layout)).toEqual(['name', 'size', 'folder', 'hits', 'modified', 'type']);
  });

  it('ignores a duplicate id', () => {
    const layout = normalizeLayout({ order: ['name', 'name', 'folder'], hidden: [], widths: {}, autoSize: true });
    expect(visibleColumns(layout).filter((id) => id === 'name')).toHaveLength(1);
  });

  it('never loads a layout with every column hidden', () => {
    const layout = normalizeLayout({ order: [], hidden: ['name', 'folder', 'hits', 'size', 'modified', 'type'], widths: {}, autoSize: true });
    expect(visibleColumns(layout)).toEqual(['name']);
  });

  it('replaces non-numeric and out-of-range widths', () => {
    const layout = normalizeLayout({ order: [], hidden: [], widths: { name: 'wide', folder: -5, size: 90 }, autoSize: true });
    expect(layout.widths.name).toBe(defaultLayout().widths.name);
    expect(layout.widths.folder).toBe(48);
    expect(layout.widths.size).toBe(90);
  });
});

describe('shrinkToFit', () => {
  const wide = { name: 300, folder: 500, hits: 80, size: 80, modified: 140, type: 180 };
  const visible = ['name', 'folder', 'hits', 'size', 'modified', 'type'] as const;

  it('leaves widths alone when they already fit', () => {
    expect(shrinkToFit(wide, [...visible], 2000)).toEqual(wide);
  });

  it('takes the overflow from the folder column first', () => {
    const total = Object.values(wide).reduce((sum, width) => sum + width, 0);
    const result = shrinkToFit(wide, [...visible], total - 100);
    expect(result.folder).toBe(400);
    expect(result.name).toBe(300);
    expect(result.type).toBe(180);
  });

  it('moves on to the next column once the first reaches its floor', () => {
    const result = shrinkToFit(wide, [...visible], 800);
    const total = Object.values(result).reduce((sum, width) => sum + width, 0);
    expect(total).toBeLessThanOrEqual(800);
    expect(result.folder).toBeLessThan(wide.folder);
    expect(result.type).toBeLessThan(wide.type);
    expect(result.hits).toBe(80);
  });

  it('never goes below a column floor, even when there is no room', () => {
    const result = shrinkToFit(wide, [...visible], 100);
    expect(result.folder).toBeGreaterThanOrEqual(90);
    expect(result.name).toBeGreaterThanOrEqual(100);
    expect(result.size).toBeGreaterThanOrEqual(56);
  });

  it('only counts and changes the visible columns', () => {
    const result = shrinkToFit(wide, ['name', 'folder'], 500);
    expect(result.name + result.folder).toBeLessThanOrEqual(500);
    expect(result.type).toBe(180);
  });
});

describe('growToFill', () => {
  const narrow = { name: 150, folder: 150, hits: 80, size: 80, modified: 130, type: 120 };
  const visible = ['name', 'folder', 'hits', 'size', 'modified', 'type'] as const;
  const total = (widths: Record<string, number>) => Object.values(widths).reduce((sum, width) => sum + width, 0);

  it('leaves widths alone when they already fill or exceed the space', () => {
    expect(growToFill(narrow, [...visible], 700)).toEqual(narrow);
    expect(growToFill(narrow, [...visible], 500)).toEqual(narrow);
  });

  it('gives all the spare room to the folder column, which holds the longest text', () => {
    const result = growToFill(narrow, [...visible], total(narrow) + 200);
    expect(total(result)).toBe(total(narrow) + 200);
    expect(result.folder).toBe(narrow.folder + 200);
    expect(result.name).toBe(narrow.name);
    expect(result.hits).toBe(80);
    expect(result.size).toBe(80);
  });

  it('falls back to the name column when the folder column is hidden', () => {
    const result = growToFill(narrow, ['name', 'hits', 'size', 'modified', 'type'], 900);
    expect(result.name).toBeGreaterThan(narrow.name);
    expect(result.modified).toBe(narrow.modified);
    expect(result.type).toBe(narrow.type);
  });

  it('then to the type column, and never to the numeric ones, while a text column is shown', () => {
    const result = growToFill(narrow, ['hits', 'size', 'modified', 'type'], 600);
    expect(result.type).toBeGreaterThan(narrow.type);
    expect(result.hits).toBe(80);
    expect(result.size).toBe(80);
  });

  it('grows the only column when just one is shown', () => {
    const result = growToFill(narrow, ['hits'], 400);
    expect(result.hits).toBe(400);
  });

  it('never changes a hidden column', () => {
    const result = growToFill(narrow, ['name', 'folder'], 900);
    expect(result.type).toBe(120);
    expect(result.name + result.folder).toBe(900);
  });
});

describe('scaleToFill', () => {
  const base = { name: 200, folder: 300, hits: 80, size: 80, modified: 120, type: 120 };
  const visible = ['name', 'folder', 'hits', 'size', 'modified', 'type'] as const;
  const sum = (widths: Record<string, number>, ids: readonly string[] = visible) => ids.reduce((total, id) => total + widths[id], 0);

  it('makes the visible columns exactly fill the space when it grows', () => {
    const result = scaleToFill(base, [...visible], 1600);
    expect(sum(result)).toBe(1600);
  });

  it('keeps the proportions between columns', () => {
    const result = scaleToFill(base, [...visible], 1800);
    expect(result.folder / result.name).toBeCloseTo(1.5, 1);
    expect(result.hits).toBeGreaterThan(base.hits);
  });

  it('makes them fit when the space shrinks', () => {
    const result = scaleToFill(base, [...visible], 700);
    expect(sum(result)).toBe(700);
  });

  it('never narrows a column below the minimum, even when there is not enough room', () => {
    const result = scaleToFill(base, [...visible], 200);
    for (const id of visible) expect(result[id]).toBeGreaterThanOrEqual(48);
  });

  it('leaves hidden columns alone', () => {
    const result = scaleToFill(base, ['name', 'folder'], 1000);
    expect(result.name + result.folder).toBe(1000);
    expect(result.type).toBe(120);
  });

  it('does nothing when the widths already fill the space', () => {
    expect(scaleToFill(base, [...visible], sum(base))).toEqual(base);
  });
});

describe('resizeColumn', () => {
  const filled = { name: 300, folder: 300, hits: 100, size: 100, modified: 200, type: 200 };
  const visible = ['name', 'folder', 'hits', 'size', 'modified', 'type'] as const;
  const sum = (widths: Record<string, number>) => visible.reduce((total, id) => total + widths[id], 0);

  it('widening a column takes the room from the next one, so the total stays the same', () => {
    const result = resizeColumn(filled, [...visible], 'name', 360);
    expect(result.name).toBe(360);
    expect(result.folder).toBe(240);
    expect(sum(result)).toBe(sum(filled));
  });

  it('narrowing a column gives the room to the next one', () => {
    const result = resizeColumn(filled, [...visible], 'name', 250);
    expect(result.name).toBe(250);
    expect(result.folder).toBe(350);
    expect(sum(result)).toBe(sum(filled));
  });

  it('keeps taking from further columns once the next one is at its minimum', () => {
    const result = resizeColumn(filled, [...visible], 'name', 300 + 300 - 48 + 40);
    expect(result.folder).toBe(48);
    expect(result.hits).toBeLessThan(100);
    expect(sum(result)).toBe(sum(filled));
  });

  it('cannot widen past what the others can give up', () => {
    const result = resizeColumn(filled, [...visible], 'name', 99999);
    expect(sum(result)).toBe(sum(filled));
    for (const id of ['folder', 'hits', 'size', 'modified', 'type'] as const) expect(result[id]).toBe(48);
  });

  it('the last column trades with the one before it', () => {
    const result = resizeColumn(filled, [...visible], 'type', 260);
    expect(result.type).toBe(260);
    expect(result.modified).toBe(140);
    expect(sum(result)).toBe(sum(filled));
  });

  it('never makes a column narrower than the minimum', () => {
    const result = resizeColumn(filled, [...visible], 'name', 5);
    expect(result.name).toBe(48);
    expect(sum(result)).toBe(sum(filled));
  });

  it('works on only the visible columns', () => {
    const result = resizeColumn(filled, ['name', 'folder'], 'name', 400);
    expect(result.folder).toBe(200);
    expect(result.type).toBe(200);
  });

  it('a single visible column cannot be resized this way', () => {
    expect(resizeColumn(filled, ['name'], 'name', 500)).toEqual(filled);
  });
});

import { describe, expect, it } from 'vitest';
import {
  defaultLayout,
  moveColumnBefore,
  growToFill,
  moveColumnByStep,
  normalizeLayout,
  resizeColumn,
  shrinkToFit,
  widthsInPane,
  toggleColumn,
  visibleColumns,
} from './columnLayout';

describe('default layout', () => {
  it('turns automatic fitting off once in a layout saved before it had to be asked for', () => {
    expect(normalizeLayout({ order: [], hidden: [], widths: {}, autoSize: true }).autoSize).toBe(false);
    expect(normalizeLayout({ order: [], hidden: [], widths: {}, autoSize: true, version: 4 }).autoSize).toBe(true);
    expect(normalizeLayout({ order: [], hidden: [], widths: {} , version: 4 }).autoSize).toBe(false);
  });

  it('hides Matches once in a layout saved before it was hidden by default, and not again', () => {
    const old = normalizeLayout({ order: [], hidden: ['size'], widths: {}, autoSize: true });
    expect(old.hidden).toEqual(['size', 'hits']);
    const shownAgain = normalizeLayout({ ...old, hidden: ['size'] });
    expect(shownAgain.hidden).toEqual(['size']);
  });

  it('shows the columns in the classic order, without Matches, which matters only for some searches', () => {
    const layout = defaultLayout();
    expect(visibleColumns(layout)).toEqual(['name', 'folder', 'size', 'modified', 'type']);
    expect(layout.hidden).toEqual(['hits']);
    expect(layout.autoSize).toBe(false);
  });

  it('gives Name and Folder the most room', () => {
    const { widths } = defaultLayout();
    expect(widths.name + widths.folder).toBeGreaterThan(widths.size + widths.modified + widths.type + widths.hits);
  });

  it('puts Matches back between Folder and Size', () => {
    expect(visibleColumns(toggleColumn(defaultLayout(), 'hits'))).toEqual(['name', 'folder', 'hits', 'size', 'modified', 'type']);
  });
});

describe('visibility', () => {
  it('hides and shows a column without losing its place', () => {
    const hidden = toggleColumn(defaultLayout(), 'size');
    expect(visibleColumns(hidden)).toEqual(['name', 'folder', 'modified', 'type']);
    expect(visibleColumns(toggleColumn(hidden, 'size'))).toEqual(['name', 'folder', 'size', 'modified', 'type']);
  });

  it('never hides the last visible column', () => {
    let layout = defaultLayout();
    for (const id of ['folder', 'size', 'modified', 'type'] as const) layout = toggleColumn(layout, id);
    expect(visibleColumns(layout)).toEqual(['name']);
    expect(visibleColumns(toggleColumn(layout, 'name'))).toEqual(['name']);
  });
});

describe('reordering', () => {
  it('moves a column before another', () => {
    const layout = moveColumnBefore(defaultLayout(), 'type', 'folder');
    expect(visibleColumns(layout)).toEqual(['name', 'type', 'folder', 'size', 'modified']);
  });

  it('moves a column to the end when dropped past the last one', () => {
    const layout = moveColumnBefore(defaultLayout(), 'name', null);
    expect(visibleColumns(layout)).toEqual(['folder', 'size', 'modified', 'type', 'name']);
  });

  it('dropping a column on itself changes nothing', () => {
    expect(moveColumnBefore(defaultLayout(), 'size', 'size')).toEqual(defaultLayout());
  });

  it('moves one step left or right among the visible columns, skipping hidden ones', () => {
    const layout = defaultLayout();
    expect(visibleColumns(moveColumnByStep(layout, 'size', -1))).toEqual(['name', 'size', 'folder', 'modified', 'type']);
    expect(visibleColumns(moveColumnByStep(layout, 'folder', 1))).toEqual(['name', 'size', 'folder', 'modified', 'type']);
  });

  it('stops at the ends', () => {
    expect(moveColumnByStep(defaultLayout(), 'name', -1)).toEqual(defaultLayout());
    expect(moveColumnByStep(defaultLayout(), 'type', 1)).toEqual(defaultLayout());
  });
});

describe('loading a stored layout', () => {
  it('falls back to the default for garbage', () => {
    expect(normalizeLayout(null)).toEqual(defaultLayout());
    expect(normalizeLayout('x')).toEqual(defaultLayout());
    expect(normalizeLayout({ order: 5 })).toEqual(defaultLayout());
  });

  it('gives a stored layout with no list of hidden columns the default one', () => {
    expect(normalizeLayout({ order: ['name', 'folder'], widths: {}, autoSize: true }).hidden).toEqual(['hits']);
  });

  it('keeps showing Matches for a layout that shows it, as the person chose', () => {
    expect(visibleColumns(normalizeLayout({ order: [], hidden: [], widths: {}, autoSize: true, version: 4 }))).toContain('hits');
  });

  it('keeps a valid stored order and drops unknown ids', () => {
    const layout = normalizeLayout({ order: ['type', 'bogus', 'name'], hidden: ['bogus', 'size'], widths: {}, autoSize: false, version: 4 });
    expect(visibleColumns(layout)).toEqual(['type', 'name', 'folder', 'hits', 'modified']);
    expect(layout.autoSize).toBe(false);
  });

  it('adds columns a stored layout does not know about, so new columns appear after an upgrade', () => {
    const layout = normalizeLayout({ order: ['name', 'size'], hidden: [], widths: {}, autoSize: true, version: 4 });
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

  it('gives a layout saved before 4 the default widths, since it kept the squeezed ones', () => {
    const layout = normalizeLayout({ order: [], hidden: [], widths: { name: 500, modified: 90, type: 70 }, autoSize: true, version: 3 });
    expect(layout.widths).toEqual(defaultLayout().widths);
    expect(layout.version).toBe(4);
  });

  it('replaces non-numeric and out-of-range widths', () => {
    const layout = normalizeLayout({ order: [], hidden: [], widths: { name: 'wide', folder: -5, size: 90 }, autoSize: true, version: 4 });
    expect(layout.widths.name).toBe(defaultLayout().widths.name);
    expect(layout.widths.folder).toBe(48);
    expect(layout.widths.size).toBe(90);
  });
});

describe('widthsInPane', () => {
  const saved = { name: 300, folder: 420, hits: 80, size: 80, modified: 150, type: 190 };
  const visible = ['name', 'folder', 'size', 'modified', 'type'] as const;
  const sum = (widths: Record<string, number>) => visible.reduce((total, id) => total + widths[id], 0);

  it('fills the pane exactly, wider or narrower than the saved widths', () => {
    expect(sum(widthsInPane(saved, [...visible], 1400))).toBe(1400);
    expect(sum(widthsInPane(saved, [...visible], 900))).toBe(900);
  });

  it('gives back what a narrow pane took, because the saved widths are not touched', () => {
    widthsInPane(saved, [...visible], 700);
    const wide = widthsInPane(saved, [...visible], 1400);
    expect(wide.modified).toBe(150);
    expect(wide.type).toBe(190);
    expect(saved.type).toBe(190);
  });

  it('leaves the saved widths alone before the pane has been measured', () => {
    expect(widthsInPane(saved, [...visible], 0)).toBe(saved);
  });
});

describe('shrinkToFit', () => {
  const wide = { name: 300, folder: 500, hits: 80, size: 80, modified: 140, type: 180 };
  const visible = ['name', 'folder', 'hits', 'size', 'modified', 'type'] as const;

  it('leaves widths alone when they already fit', () => {
    expect(shrinkToFit(wide, [...visible], 2000)).toEqual(wide);
  });

  it('takes the overflow from the type column first, so Name and Folder keep their room', () => {
    const total = Object.values(wide).reduce((sum, width) => sum + width, 0);
    const result = shrinkToFit(wide, [...visible], total - 60);
    expect(result.type).toBe(120);
    expect(result.folder).toBe(500);
    expect(result.name).toBe(300);
  });

  it('moves on to the next column once the first reaches its floor, Folder only after Type and Modified', () => {
    const result = shrinkToFit(wide, [...visible], 800);
    const total = Object.values(result).reduce((sum, width) => sum + width, 0);
    expect(total).toBeLessThanOrEqual(800);
    expect(result.type).toBe(90);
    expect(result.modified).toBe(130);
    expect(result.folder).toBeLessThan(wide.folder);
    expect(result.name).toBe(300);
    expect(result.hits).toBe(80);
  });

  it('never makes Name narrower while Folder can still give room', () => {
    for (let available = 1400; available >= 600; available -= 25) {
      const result = shrinkToFit(wide, [...visible], available);
      if (result.folder > 90) expect(result.name, `available ${available}`).toBe(300);
    }
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

  it('shares the spare room equally between the name and folder columns', () => {
    const result = growToFill(narrow, [...visible], total(narrow) + 200);
    expect(total(result)).toBe(total(narrow) + 200);
    expect(result.name).toBe(narrow.name + 100);
    expect(result.folder).toBe(narrow.folder + 100);
    expect(result.hits).toBe(80);
    expect(result.size).toBe(80);
  });

  it('gives an odd pixel to the name column', () => {
    const result = growToFill(narrow, [...visible], total(narrow) + 201);
    expect(result.name).toBe(narrow.name + 101);
    expect(result.folder).toBe(narrow.folder + 100);
  });

  it('gives it all to the name column when the folder column is hidden', () => {
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

import { describe, expect, it } from 'vitest';
import { AGE_LABELS, CATEGORY_LABELS, SIZE_LABELS, type MapColors } from './treemapColors';
import { AGE_BUCKET_COUNT, CATEGORY_COUNT, RectKind, SIZE_CLASS_COUNT } from './treemapLayout';
import { effectiveFilter, fileTooltip, formatWeight, groupTooltip, legendEntries, summaryText, zoomButton } from './mapText';
import type { DisplayRow } from './types';

const colors: MapColors = {
  background: '#FFFFFF',
  category: CATEGORY_LABELS.map((_, index) => `#0000${index.toString(16).padStart(2, '0')}`),
  age: AGE_LABELS.map((_, index) => `#00${index.toString(16).padStart(2, '0')}00`),
  size: SIZE_LABELS.map((_, index) => `#${index.toString(16).padStart(2, '0')}0000`),
  outlineLight: '#FFFFFF',
  outlineDark: '#000000',
};

function weights(count: number, entries: Record<number, number>): Float64Array {
  const values = new Float64Array(count);
  for (const [bucket, weight] of Object.entries(entries)) values[Number(bucket)] = weight;
  return values;
}

describe('formatWeight', () => {
  it('formats sizes as bytes and matches as a count', () => {
    expect(formatWeight(2048, 'size')).toBe('2.0 KB');
    expect(formatWeight(25, 'matches')).toBe('25 matches');
    expect(formatWeight(1, 'matches')).toBe('1 match');
  });
});

describe('summaryText', () => {
  it('summarizes size', () => {
    expect(summaryText({ totalFiles: 142, totalWeight: 3.1 * 1024 ** 3, omitted: 0 }, 'size', 'Logs')).toBe(
      '142 files, 3.1 GB, largest folder Logs',
    );
  });

  it('summarizes matches and mentions files without weight', () => {
    expect(summaryText({ totalFiles: 10, totalWeight: 25, omitted: 2 }, 'matches', '')).toBe(
      '10 files, 25 matches, 2 files have no weight in this view',
    );
    expect(summaryText({ totalFiles: 10, totalWeight: 25, omitted: 1 }, 'matches', '')).toBe(
      '10 files, 25 matches, 1 file has no weight in this view',
    );
  });

  it('groups thousands and uses the singular for one file', () => {
    expect(summaryText({ totalFiles: 100_000, totalWeight: 0, omitted: 0 }, 'size', '')).toBe('100,000 files, 0 B');
    expect(summaryText({ totalFiles: 2, totalWeight: 3, omitted: 12_345 }, 'matches', '')).toBe(
      '2 files, 3 matches, 12,345 files have no weight in this view',
    );
    expect(summaryText({ totalFiles: 1, totalWeight: 512, omitted: 0 }, 'size', 'src')).toBe('1 file, 512 B, largest folder src');
  });
});

describe('legendEntries', () => {
  const empty = { categoryWeight: new Float64Array(CATEGORY_COUNT), ageWeight: new Float64Array(AGE_BUCKET_COUNT), sizeWeight: new Float64Array(SIZE_CLASS_COUNT) };

  it('lists only the legend entries that have weight, largest first', () => {
    const layout = { ...empty, categoryWeight: weights(CATEGORY_COUNT, { 1: 5, [CATEGORY_COUNT - 1]: 3 }) };
    expect(legendEntries(layout, 'type', colors, 'matches')).toEqual([
      { bucket: 1, label: CATEGORY_LABELS[1], color: colors.category[1], total: '5 matches' },
      {
        bucket: CATEGORY_COUNT - 1,
        label: CATEGORY_LABELS[CATEGORY_COUNT - 1],
        color: colors.category[CATEGORY_COUNT - 1],
        total: '3 matches',
      },
    ]);
  });

  it('uses the age buckets in Age mode, newest first whatever their totals', () => {
    const layout = { ...empty, ageWeight: weights(AGE_BUCKET_COUNT, { 0: 1024, 4: 4096, 5: 8192, 2: 512 }) };
    expect(legendEntries(layout, 'age', colors, 'size')).toEqual([
      { bucket: 0, label: AGE_LABELS[0], color: colors.age[0], total: '1.0 KB' },
      { bucket: 2, label: AGE_LABELS[2], color: colors.age[2], total: '512 B' },
      { bucket: 4, label: AGE_LABELS[4], color: colors.age[4], total: '4.0 KB' },
      { bucket: 5, label: AGE_LABELS[5], color: colors.age[5], total: '8.0 KB' },
    ]);
  });

  it('keeps the bucket order for equal weights', () => {
    const layout = { ...empty, categoryWeight: weights(CATEGORY_COUNT, { 2: 7, 0: 7 }) };
    expect(legendEntries(layout, 'type', colors, 'size').map((entry) => entry.bucket)).toEqual([0, 2]);
  });

  it('is empty when nothing has weight', () => {
    expect(legendEntries(empty, 'type', colors, 'size')).toEqual([]);
  });
});

describe('effectiveFilter', () => {
  const present = (...buckets: number[]) => buckets.map((bucket) => ({ bucket }));

  it('drops a chosen bucket that is no longer in the legend', () => {
    expect([...effectiveFilter(new Set([3]), present(0, 1))]).toEqual([]);
  });

  it('keeps the chosen buckets that are still present', () => {
    expect([...effectiveFilter(new Set([1, 3, 5]), present(5, 0, 1))]).toEqual([1, 5]);
  });

  it('means nothing dimmed when nothing chosen is present', () => {
    expect(effectiveFilter(new Set([7]), present(1)).size).toBe(0);
    expect(effectiveFilter(new Set(), present(1)).size).toBe(0);
  });

  it('keeps the order the buckets were chosen in', () => {
    expect([...effectiveFilter(new Set([4, 2, 9]), present(2, 4, 9))]).toEqual([4, 2, 9]);
  });
});

describe('tooltips', () => {
  const row: DisplayRow = {
    id: 7,
    path: 'C:\\logs\\app.log',
    name: 'app.log',
    folder: 'C:\\logs',
    size: 2048,
    hits: 3,
    modifiedMs: null,
    modifiedText: '22/10/2026 09:15',
    typeName: 'Text Document',
  };

  it('describes a file with its folder, size, matches, modified time and type', () => {
    expect(fileTooltip(row)).toEqual({
      title: 'app.log',
      lines: ['C:\\logs', 'Size 2.0 KB', '3 matches', 'Modified 22/10/2026 09:15', 'Text Document'],
    });
  });

  it('leaves out matches, an unknown time and an unknown type', () => {
    expect(fileTooltip({ ...row, hits: 0, modifiedText: '', typeName: '' })).toEqual({
      title: 'app.log',
      lines: ['C:\\logs', 'Size 2.0 KB'],
    });
  });

  it('describes a group of small files by count and total, with its folder', () => {
    expect(groupTooltip(RectKind.SmallFiles, 12, 4096, 'size', 'C:\\logs\\old')).toEqual({
      title: '12 small files, 4.0 KB',
      lines: ['C:\\logs\\old'],
    });
    expect(groupTooltip(RectKind.SmallFiles, 1, 2, 'matches', '')).toEqual({ title: '1 small file, 2 matches', lines: [] });
  });

  it('describes a folder drawn as one block by its files, which need not be small', () => {
    expect(groupTooltip(RectKind.FolderBlock, 12, 4096, 'size', 'C:\\logs\\old')).toEqual({
      title: '12 files, 4.0 KB',
      lines: ['C:\\logs\\old'],
    });
    expect(groupTooltip(RectKind.FolderBlock, 1, 2, 'matches', '')).toEqual({ title: '1 file, 2 matches', lines: [] });
  });
});

describe('zoomButton', () => {
  const zoomToFolder = { label: 'Zoom to folder', title: "Zoom to the selected file's folder (Z)" };
  const zoomOut = { label: 'Zoom out', title: 'Zoom out (Backspace)', disabled: false };

  it('zooms to the folder at the top level, once a file is selected', () => {
    expect(zoomButton(false, true)).toEqual({ ...zoomToFolder, disabled: false });
  });

  it('is disabled at the top level with nothing selected', () => {
    expect(zoomButton(false, false)).toEqual({ ...zoomToFolder, disabled: true });
  });

  it('zooms out when zoomed in, whether or not a file is selected', () => {
    expect(zoomButton(true, true)).toEqual(zoomOut);
    expect(zoomButton(true, false)).toEqual(zoomOut);
  });
});

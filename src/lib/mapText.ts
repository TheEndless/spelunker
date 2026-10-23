import { formatSize, modifiedLabel } from './format';
import { AGE_LABELS, CATEGORY_LABELS, type MapColors } from './treemapColors';
import type { Layout, Metric } from './treemapLayout';
import type { ColorMode } from './treemapPaint';
import type { DisplayRow } from './types';

const counted = (count: number, singular: string, plural: string) =>
  `${count.toLocaleString()} ${count === 1 ? singular : plural}`;

/** A total in the map's current metric: bytes for Size, a match count for Matches. */
export function formatWeight(weight: number, metric: Metric): string {
  return metric === 'size' ? formatSize(weight) : counted(weight, 'match', 'matches');
}

/** The one-line summary under the map, which is also its text alternative. */
export function summaryText(
  layout: Pick<Layout, 'totalFiles' | 'totalWeight' | 'omitted'>,
  metric: Metric,
  largestFolder: string,
): string {
  const parts = [counted(layout.totalFiles, 'file', 'files'), formatWeight(layout.totalWeight, metric)];
  if (largestFolder !== '') parts.push(`largest folder ${largestFolder}`);
  if (layout.omitted > 0) parts.push(`${layout.omitted.toLocaleString()} without weight in this view`);
  return parts.join(', ');
}

export interface LegendEntry {
  /** The category or age bucket, which is also what the dim filter holds. */
  bucket: number;
  label: string;
  color: string;
  total: string;
}

/** The categories or age buckets present in the view, heaviest first. */
export function legendEntries(
  layout: Pick<Layout, 'categoryWeight' | 'ageWeight'>,
  colorMode: ColorMode,
  colors: MapColors,
  metric: Metric,
): LegendEntry[] {
  const byType = colorMode === 'type';
  const weights = byType ? layout.categoryWeight : layout.ageWeight;
  const labels = byType ? CATEGORY_LABELS : AGE_LABELS;
  const fills = byType ? colors.category : colors.age;
  const present: { bucket: number; weight: number }[] = [];
  for (let bucket = 0; bucket < weights.length; bucket++) {
    if (weights[bucket] > 0) present.push({ bucket, weight: weights[bucket] });
  }
  // The sort is stable, so equal weights keep the bucket order.
  present.sort((left, right) => right.weight - left.weight);
  return present.map(({ bucket, weight }) => ({
    bucket,
    label: labels[bucket],
    color: fills[bucket],
    total: formatWeight(weight, metric),
  }));
}

export interface TooltipText {
  title: string;
  lines: string[];
}

export function fileTooltip(row: DisplayRow): TooltipText {
  const lines = [row.folder, `Size ${formatSize(row.size)}`];
  if (row.hits > 0) lines.push(counted(row.hits, 'match', 'matches'));
  const modified = modifiedLabel(row);
  if (modified !== '') lines.push(`Modified ${modified}`);
  if (row.typeName !== '') lines.push(row.typeName);
  return { title: row.name, lines };
}

/** A small-files group or a folder drawn as one block. `folderPath` is empty until the worker has named it. */
export function groupTooltip(fileCount: number, weight: number, metric: Metric, folderPath: string): TooltipText {
  return {
    title: `${counted(fileCount, 'small file', 'small files')}, ${formatWeight(weight, metric)}`,
    lines: folderPath === '' ? [] : [folderPath],
  };
}

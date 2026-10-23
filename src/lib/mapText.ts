import { formatSize, modifiedLabel } from './format';
import { AGE_LABELS, CATEGORY_LABELS, type MapColors } from './treemapColors';
import { RectKind, type Layout, type Metric } from './treemapLayout';
import type { ColorMode } from './treemapPaint';
import { count as counted } from './statusSummary';
import type { DisplayRow } from './types';

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
  if (layout.omitted > 0) {
    const verb = layout.omitted === 1 ? 'has' : 'have';
    parts.push(`${counted(layout.omitted, 'file', 'files')} ${verb} no weight in this view`);
  }
  return parts.join(', ');
}

export interface LegendEntry {
  /** The category or age bucket, which is also what the dim filter holds. */
  bucket: number;
  label: string;
  color: string;
  total: string;
}

/**
 * The categories or age buckets present in the view. Categories come heaviest first. Age buckets
 * keep their own order, Today to Unknown, since a scale read out of order means nothing.
 */
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
  if (byType) present.sort((left, right) => right.weight - left.weight);
  return present.map(({ bucket, weight }) => ({
    bucket,
    label: labels[bucket],
    color: fills[bucket],
    total: formatWeight(weight, metric),
  }));
}

/**
 * The legend buckets that really pick something out: the user's choices that are still in the
 * legend. A choice whose bucket left the view (a zoom, a metric switch, a new search) would
 * otherwise dim the whole map with no pressed button left to clear it. Empty means nothing dimmed.
 */
export function effectiveFilter(chosen: ReadonlySet<number>, present: readonly { bucket: number }[]): Set<number> {
  const result = new Set<number>();
  for (const bucket of chosen) if (present.some((entry) => entry.bucket === bucket)) result.add(bucket);
  return result;
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

/**
 * A small-files group or a folder drawn as one block, by its RectKind. A block's files are only
 * too many to draw at this size, not small, so they are called files. `folderPath` is empty until
 * the worker has named it.
 */
export function groupTooltip(kind: number, fileCount: number, weight: number, metric: Metric, folderPath: string): TooltipText {
  const files = kind === RectKind.SmallFiles ? counted(fileCount, 'small file', 'small files') : counted(fileCount, 'file', 'files');
  return {
    title: `${files}, ${formatWeight(weight, metric)}`,
    lines: folderPath === '' ? [] : [folderPath],
  };
}

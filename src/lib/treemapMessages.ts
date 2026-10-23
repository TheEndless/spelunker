import type { ForcedColors, MapColors } from './treemapColors';
import type { Layout, Metric } from './treemapLayout';
import type { ColorMode, Shading } from './treemapPaint';
import type { TreemapRecord } from './treemapTree';

/** Everything that decides what the map looks like, apart from the results themselves. */
export interface ViewSettings {
  width: number;
  height: number;
  devicePixelRatio: number;
  metric: Metric;
  colorMode: ColorMode;
  /** The folder to show, or null for the top of the tree. */
  zoomFolderId: number | null;
  colors: MapColors;
  forced: ForcedColors | null;
  font: string;
  /** Color buckets shown at full strength, or null when nothing is dimmed. */
  dimmed: number[] | null;
  /** Cushion is laid out with no gap inside folders and lit per pixel. Flat keeps the gap and plain fills. */
  shading: Shading;
}

export type ToWorker =
  | { type: 'attach'; canvas: OffscreenCanvas }
  | { type: 'reset'; now: number }
  | { type: 'add'; records: TreemapRecord[] }
  | { type: 'remove'; ids: number[] }
  | { type: 'layout'; sequence: number; view: ViewSettings }
  | { type: 'locate'; requestId: number; fileId: number }
  | { type: 'describe'; requestId: number; folderId: number };

/** One step of the breadcrumb: a folder the map can zoom to. */
export interface Crumb {
  folderId: number;
  label: string;
}

/** Where a file is drawn, or (when `rect` is -1 and `zoomFolderId` is set) the folder to zoom out to so it can be. */
export interface Located {
  rect: number;
  zoomFolderId: number | null;
}

/** `layout` carries every Layout field with its typed arrays trimmed to `count` and `frameCount`. */
export type FromWorker =
  | {
      type: 'layout';
      sequence: number;
      layout: Layout;
      /** The metric the layout's weights are in, which the view may have moved on from. */
      metric: Metric;
      crumbs: Crumb[];
      zoomFolderId: number;
      painted: boolean;
      largestFolder: string;
      elapsedMs: { layout: number; paint: number };
    }
  /** The worker threw while laying out or painting `sequence`. The page keeps its previous picture and tries again later. */
  | { type: 'layoutFailed'; sequence: number; message: string }
  | ({ type: 'located'; requestId: number } & Located)
  | { type: 'described'; requestId: number; path: string };

// No `/// <reference lib="webworker" />` here: a triple-slash lib reference applies to the whole
// program, and the webworker lib redeclares DOM globals (`self`, `onmessage`, `postMessage`). The
// DOM lib already declares OffscreenCanvas and performance, so only the scope needs a type.
import { bestTextOn } from './colors';
import { layoutTree, RectKind, type Layout } from './treemapLayout';
import type { Crumb, FromWorker, ToWorker, ViewSettings } from './treemapMessages';
import { paintLayout, type PaintStyle } from './treemapPaint';
import { ancestorsOf, collapseChain, folderPathLabel, FolderTree, type FolderNode } from './treemapTree';

/** The parts of the dedicated worker scope this file uses. */
interface WorkerScope {
  postMessage(message: FromWorker, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

const tree = new FolderTree();
let startedAt = Date.now();
let context: OffscreenCanvasRenderingContext2D | null = null;
let offscreen: OffscreenCanvas | null = null;
/** Rectangle lookups kept after the layout arrays are transferred away. */
let lastFileRects = new Map<number, number>();
let lastFolderRects = new Map<number, number>();
let lastZoomRoot: FolderNode = tree.root;

const send = (message: FromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

/** A copy of the layout with each typed array cut to the entries in use, so only those cross to the page. */
function trim(layout: Layout): Layout {
  const { count, frameCount } = layout;
  return {
    ...layout,
    x: layout.x.slice(0, count), y: layout.y.slice(0, count), w: layout.w.slice(0, count), h: layout.h.slice(0, count),
    id: layout.id.slice(0, count), kind: layout.kind.slice(0, count), depth: layout.depth.slice(0, count),
    category: layout.category.slice(0, count), age: layout.age.slice(0, count), weight: layout.weight.slice(0, count),
    fileCount: layout.fileCount.slice(0, count), folderId: layout.folderId.slice(0, count),
    frameX: layout.frameX.slice(0, frameCount), frameY: layout.frameY.slice(0, frameCount),
    frameW: layout.frameW.slice(0, frameCount), frameH: layout.frameH.slice(0, frameCount),
    frameFolderId: layout.frameFolderId.slice(0, frameCount),
  };
}

function buffersOf(layout: Layout): ArrayBuffer[] {
  return Object.values(layout)
    .filter((value): value is ArrayBufferView => ArrayBuffer.isView(value))
    .map((view) => view.buffer as ArrayBuffer);
}

/**
 * The folder to lay out: the zoom target if it still exists, else the tree's top (a removed folder
 * zooms the map out). Single-child chains are skipped, so the result is always the tree's top or
 * something below it.
 */
function resolveRoot(zoomFolderId: number | null): FolderNode {
  const zoomed = zoomFolderId === null ? undefined : tree.folderById(zoomFolderId);
  return collapseChain(zoomed ?? tree.root);
}

/** The path from the tree's top (labelled with its whole collapsed path) down to the laid-out folder. */
function crumbsFor(root: FolderNode): Crumb[] {
  const top = collapseChain(tree.root);
  const crumbs: Crumb[] = [{ folderId: top.id, label: folderPathLabel(top) || 'All results' }];
  const belowTop = ancestorsOf(root).reverse().slice(ancestorsOf(top).length);
  for (const node of belowTop) crumbs.push({ folderId: node.id, label: node.name });
  return crumbs;
}

function layoutAndPaint(sequence: number, view: ViewSettings) {
  const layoutStarted = performance.now();
  const root = resolveRoot(view.zoomFolderId);
  lastZoomRoot = root;
  const full = layoutTree(root, { files: tree.fileCount, folders: tree.folderCount }, {
    width: view.width, height: view.height, metric: view.metric, now: startedAt,
  });
  const layoutMs = performance.now() - layoutStarted;

  let painted = false;
  let paintMs = 0;
  if (offscreen && context) {
    const paintStarted = performance.now();
    offscreen.width = Math.round(view.width * view.devicePixelRatio);
    offscreen.height = Math.round(view.height * view.devicePixelRatio);
    context.setTransform(view.devicePixelRatio, 0, 0, view.devicePixelRatio, 0, 0);
    const style: PaintStyle = { colors: view.colors, colorMode: view.colorMode, forced: view.forced, font: view.font, labelColorFor: bestTextOn };
    paintLayout(context, full, view.width, view.height, style, view.dimmed ? new Set(view.dimmed) : null, (rect) => nameOfRect(full, rect));
    painted = true;
    paintMs = performance.now() - paintStarted;
  }

  // Remember how to find a file's rectangle after the arrays are handed to the page.
  lastFileRects = new Map();
  lastFolderRects = new Map();
  for (let i = 0; i < full.count; i++) {
    if (full.kind[i] === RectKind.File) lastFileRects.set(full.id[i], i);
    else lastFolderRects.set(full.id[i], i);
  }

  // `trimmed` owns fresh copies of the per-rectangle arrays, but its summary arrays are shared with
  // `full`. Nothing below this point reads either layout, so transferring all of their buffers is safe.
  const trimmed = trim(full);
  send(
    {
      type: 'layout', sequence, layout: trimmed, crumbs: crumbsFor(root), zoomFolderId: root.id, painted,
      largestFolder: largestFolderName(root, view.metric), elapsedMs: { layout: layoutMs, paint: paintMs },
    },
    buffersOf(trimmed),
  );
}

function nameOfRect(layout: Layout, rect: number): string {
  const file = tree.folderById(layout.folderId[rect])?.files.find((candidate) => candidate.id === layout.id[rect]);
  return file?.name ?? '';
}

/** The name of the subfolder of `root` that carries the most weight, or empty when it has none. */
function largestFolderName(root: FolderNode, metric: ViewSettings['metric']): string {
  const weightOfFolder = (node: FolderNode): number => {
    let sum = 0;
    for (const file of node.files) sum += metric === 'size' ? file.size : file.hits;
    for (const child of node.folders.values()) sum += weightOfFolder(child);
    return sum;
  };
  let best: FolderNode | null = null;
  let bestWeight = -1;
  for (const child of root.folders.values()) {
    const weight = weightOfFolder(child);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = child;
    }
  }
  return best ? best.name : '';
}

function locate(requestId: number, fileId: number) {
  const direct = lastFileRects.get(fileId);
  if (direct !== undefined) {
    send({ type: 'located', requestId, rect: direct, zoomFolderId: null });
    return;
  }
  const folder = tree.folderOfFile(fileId);
  if (!folder) {
    send({ type: 'located', requestId, rect: -1, zoomFolderId: null });
    return;
  }
  // A file folded into a small-files group, or inside a folder drawn as one block, is shown by
  // that group or block. Look from its own folder up to the top.
  const lookup = [...ancestorsOf(folder), tree.root];
  for (const candidate of lookup) {
    const rect = lastFolderRects.get(candidate.id);
    if (rect !== undefined) {
      send({ type: 'located', requestId, rect, zoomFolderId: null });
      return;
    }
  }
  // Not in the zoomed view: ask the page to zoom out to the nearest folder above the file that
  // also lies above (or is) the folder now shown.
  const common = lookup.find((candidate) => isAncestorOrSelf(candidate, lastZoomRoot)) ?? tree.root;
  send({ type: 'located', requestId, rect: -1, zoomFolderId: common.id });
}

/** Whether `candidate` is `node` or one of its ancestors. */
function isAncestorOrSelf(candidate: FolderNode, node: FolderNode): boolean {
  for (let current: FolderNode | null = node; current; current = current.parent) if (current === candidate) return true;
  return false;
}

scope.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case 'attach':
      offscreen = message.canvas;
      context = offscreen.getContext('2d');
      break;
    case 'reset':
      tree.clear();
      startedAt = message.now;
      lastFileRects = new Map();
      lastFolderRects = new Map();
      lastZoomRoot = tree.root;
      break;
    case 'add':
      for (const record of message.records) tree.add(record);
      break;
    case 'remove':
      for (const id of message.ids) tree.remove(id);
      break;
    case 'layout':
      layoutAndPaint(message.sequence, message.view);
      break;
    case 'locate':
      locate(message.requestId, message.fileId);
      break;
    case 'describe': {
      const node = tree.folderById(message.folderId);
      send({ type: 'described', requestId: message.requestId, path: node ? folderPathLabel(node) : '' });
      break;
    }
  }
};

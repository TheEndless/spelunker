// No `/// <reference lib="webworker" />` here: a triple-slash lib reference applies to the whole
// program, and the webworker lib redeclares DOM globals (`self`, `onmessage`, `postMessage`). The
// DOM lib already declares OffscreenCanvas and performance, so only the scope needs a type.
import { bestTextOn } from './colors';
import { layoutTree, RectKind, type Layout, type Metric } from './treemapLayout';
import type { Crumb, FromWorker, ToWorker, ViewSettings } from './treemapMessages';
import { paintLayout, type PaintStyle } from './treemapPaint';
import { ancestorsOf, collapseChain, folderPathLabel, FolderTree, type FolderNode } from './treemapTree';

/** Posts a reply to the page, handing over the listed buffers. */
export type Send = (message: FromWorker, transfer?: Transferable[]) => void;

/** The parts of the dedicated worker scope this file uses. */
interface WorkerScope {
  postMessage(message: FromWorker, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}

const tree = new FolderTree();
let startedAt = Date.now();
let context: OffscreenCanvasRenderingContext2D | null = null;
let offscreen: OffscreenCanvas | null = null;
// Rectangle lookups from the last layout, kept after its arrays are transferred away.
let lastFileRects = new Map<number, number>();
/** FolderBlock rectangles, keyed by the folder drawn as the block. */
let lastBlockRects = new Map<number, number>();
/** SmallFiles rectangles, keyed by the folder whose items were folded into the group. */
let lastGroupRects = new Map<number, number>();
/** Folders that were framed and filled, so each of their items is drawn on its own or in their group. */
let lastFramedFolders = new Set<number>();
let lastZoomRoot: FolderNode = tree.root;
let lastMetric: Metric = 'size';

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

const isInTree = (node: FolderNode) => tree.folderById(node.id) === node;

/**
 * The folder to lay out: the zoom target if it still exists, else (when the target was the last
 * folder laid out and has since been pruned) its nearest surviving ancestor, else the tree's top.
 * Pruned folders keep their parent links and folder ids are never reused, so the walk is safe.
 * Single-child chains are skipped, so the result is always the tree's top or something below it.
 */
function resolveRoot(zoomFolderId: number | null): FolderNode {
  if (zoomFolderId === null) return collapseChain(tree.root);
  let node = tree.folderById(zoomFolderId);
  if (!node && lastZoomRoot.id === zoomFolderId) {
    let ancestor: FolderNode | null = lastZoomRoot.parent;
    while (ancestor && !isInTree(ancestor)) ancestor = ancestor.parent;
    node = ancestor ?? undefined;
  }
  return collapseChain(node ?? tree.root);
}

/** The path from the tree's top (labelled with its whole collapsed path) down to the laid-out folder. */
function crumbsFor(root: FolderNode): Crumb[] {
  const top = collapseChain(tree.root);
  const crumbs: Crumb[] = [{ folderId: top.id, label: folderPathLabel(top) || 'All results' }];
  const belowTop = ancestorsOf(root).reverse().slice(ancestorsOf(top).length);
  for (const node of belowTop) crumbs.push({ folderId: node.id, label: node.name });
  return crumbs;
}

function layoutAndPaint(sequence: number, view: ViewSettings, send: Send) {
  const layoutStarted = performance.now();
  const root = resolveRoot(view.zoomFolderId);
  lastZoomRoot = root;
  lastMetric = view.metric;
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
  lastBlockRects = new Map();
  lastGroupRects = new Map();
  lastFramedFolders = new Set();
  for (let i = 0; i < full.count; i++) {
    if (full.kind[i] === RectKind.File) lastFileRects.set(full.id[i], i);
    else if (full.kind[i] === RectKind.FolderBlock) lastBlockRects.set(full.id[i], i);
    else lastGroupRects.set(full.id[i], i);
  }
  for (let i = 0; i < full.frameCount; i++) lastFramedFolders.add(full.frameFolderId[i]);

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
function largestFolderName(root: FolderNode, metric: Metric): string {
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

function locate(requestId: number, fileId: number, send: Send) {
  const answer = (rect: number, zoomFolderId: number | null) => send({ type: 'located', requestId, rect, zoomFolderId });
  const folder = tree.folderOfFile(fileId);
  const file = folder?.files.find((candidate) => candidate.id === fileId);
  // A removed file, or one with no weight under the metric last laid out, is not drawn anywhere.
  if (!folder || !file || (lastMetric === 'size' ? file.size : file.hits) <= 0) return answer(-1, null);
  const direct = lastFileRects.get(fileId);
  if (direct !== undefined) return answer(direct, null);
  if (lastFramedFolders.size === 0) return answer(-1, null);

  // Walk up from the file's folder. A folder drawn as one block shows everything inside it. The
  // first framed folder on the way was filled, so the file (or the unframed folder the walk came
  // up from) was folded into that folder's own small-files group.
  for (let current: FolderNode | null = folder; current; current = current.parent) {
    const block = lastBlockRects.get(current.id);
    if (block !== undefined) return answer(block, null);
    if (lastFramedFolders.has(current.id)) return answer(lastGroupRects.get(current.id) ?? -1, null);
  }
  // Not in the zoomed view: ask the page to zoom out to the nearest folder above the file that
  // also lies above (or is) the folder now shown.
  const common = [...ancestorsOf(folder), tree.root].find((candidate) => isAncestorOrSelf(candidate, lastZoomRoot)) ?? tree.root;
  answer(-1, common.id);
}

/** Whether `candidate` is `node` or one of its ancestors. */
function isAncestorOrSelf(candidate: FolderNode, node: FolderNode): boolean {
  for (let current: FolderNode | null = node; current; current = current.parent) if (current === candidate) return true;
  return false;
}

/** Applies one message from the page. Exported so tests can drive the worker without a worker scope. */
export function handleMessage(message: ToWorker, send: Send): void {
  switch (message.type) {
    case 'attach':
      offscreen = message.canvas;
      context = offscreen.getContext('2d');
      break;
    case 'reset':
      tree.clear();
      startedAt = message.now;
      lastFileRects = new Map();
      lastBlockRects = new Map();
      lastGroupRects = new Map();
      lastFramedFolders = new Set();
      lastZoomRoot = tree.root;
      break;
    case 'add':
      for (const record of message.records) tree.add(record);
      break;
    case 'remove':
      for (const id of message.ids) tree.remove(id);
      break;
    case 'layout':
      layoutAndPaint(message.sequence, message.view, send);
      break;
    case 'locate':
      locate(message.requestId, message.fileId, send);
      break;
    case 'describe': {
      const node = tree.folderById(message.folderId);
      send({ type: 'described', requestId: message.requestId, path: node ? folderPathLabel(node) : '' });
      break;
    }
  }
}

// Only a worker scope has WorkerGlobalScope, so importing this module in a test wires nothing up.
if ('WorkerGlobalScope' in globalThis) {
  const scope = self as unknown as WorkerScope;
  scope.onmessage = (event) => handleMessage(event.data, (message, transfer = []) => scope.postMessage(message, transfer));
}

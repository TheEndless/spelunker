import type { SearchSession, SessionListener } from './search.svelte';
import { LayoutIndex } from './treemapIndex';
import type { Layout, Metric } from './treemapLayout';
import type { Crumb, FromWorker, Located, ToWorker, ViewSettings } from './treemapMessages';
import type { TreemapRecord } from './treemapTree';
import type { DisplayRow } from './types';

/** How often a running search is re-laid-out. The same pace as the column refit. */
export const LAYOUT_INTERVAL_MS = 1200;
const VIEW_CHANGE_DELAY_MS = 50;
/** The most records in one `add`, so no single structured clone blocks the page for long. */
export const ADD_CHUNK_SIZE = 10_000;

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
  terminate(): void;
}

const toRecord = (row: DisplayRow): TreemapRecord => ({
  id: row.id,
  folder: row.folder,
  name: row.name,
  size: row.size,
  hits: row.hits,
  modifiedMs: row.modifiedMs,
});

function createModuleWorker(): WorkerLike {
  return new Worker(new URL('./treemap.worker.ts', import.meta.url), { type: 'module' });
}

/** Feeds the map worker from the search session and holds what it answers as reactive state. */
export class TreemapClient {
  layout = $state.raw<Layout | null>(null);
  /** The metric `layout` was made with. Its weights are in this metric until the next layout arrives. */
  layoutMetric = $state<Metric>('size');
  index = $state.raw<LayoutIndex | null>(null);
  crumbs = $state.raw<Crumb[]>([]);
  largestFolder = $state('');
  zoomFolderId = $state<number | null>(null);
  /** A layout has been requested and its answer has not arrived yet. */
  busy = $state(false);
  /** Milliseconds the worker spent laying out and painting the current picture, and the page building its hit index. */
  lastTimings = $state.raw<{ layout: number; paint: number; index: number } | null>(null);
  /** The worker painted the base canvas itself. When false the page must paint from `layout`. */
  workerPaints = $state(false);

  private worker: WorkerLike | null = null;
  private attached = false;
  private view: Omit<ViewSettings, 'zoomFolderId'> | null = null;
  /** The reference time for ages: when the current search began, once a reset has been seen. */
  private startedAtMs: number | null = null;
  private sequence = 0;
  /** Bumped whenever what the map shows changes (size, metric, color, zoom, a new search). A reply made for an older view is dropped. */
  private viewVersion = 0;
  private readonly viewVersionOfSequence = new Map<number, number>();
  private requestCounter = 0;
  /**
   * The worker lays out every request it is sent and cannot drop one that a later request made
   * pointless, so only one is sent at a time. A request made meanwhile is remembered and sent, for
   * the view as it is then, when the answer arrives.
   */
  private layoutInFlight = false;
  private layoutWanted = false;
  /** Rows were added or removed since the last layout request, so the next tick lays out again. */
  private changedSinceLayout = false;
  private pendingRemoves: number[] = [];
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private viewTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly waiting = new Map<number, (answer: FromWorker) => void>();
  private readonly unsubscribe: () => void;
  private wasRunning = false;

  constructor(
    private readonly session: Pick<SearchSession, 'rows' | 'running' | 'subscribe'>,
    private readonly createWorker: () => WorkerLike = createModuleWorker,
  ) {
    // Each batch of rows goes to the worker as it arrives, so the cost of copying it is spread over
    // the search instead of piling up into one task per tick. Removals come one row at a time, so
    // while attached they wait for the next layout and go as one message. Detached, they go at once.
    const listener: SessionListener = {
      appended: (rows) => {
        if (!this.worker) return;
        this.postAdds(rows.map(toRecord));
        this.changedSinceLayout = true;
      },
      removed: (id) => {
        if (!this.worker) return;
        this.pendingRemoves.push(id);
        this.changedSinceLayout = true;
        if (!this.attached) this.flushRemoves();
      },
      reset: (startedAtMs) => {
        this.startedAtMs = startedAtMs;
        this.pendingRemoves = [];
        this.zoomFolderId = null;
        // The old picture names rows that no longer exist. The view and the attachment stay.
        this.layout = null;
        this.index = null;
        this.crumbs = [];
        this.largestFolder = '';
        this.lastTimings = null;
        this.viewVersion++;
        this.post({ type: 'reset', now: startedAtMs });
        this.scheduleLayout();
      },
    };
    this.unsubscribe = session.subscribe(listener);
  }

  /** Hands the canvas to the worker (building it and resyncing from the session on first use) and starts laying out. */
  attach(canvas: HTMLCanvasElement): void {
    if (!this.worker) {
      this.worker = this.createWorker();
      this.worker.onmessage = (event) => this.receive(event.data as FromWorker);
      this.post({ type: 'reset', now: this.startedAtMs ?? Date.now() });
      this.postAdds(this.session.rows.map(toRecord));
    }
    const supportsOffscreen = typeof canvas.transferControlToOffscreen === 'function';
    this.workerPaints = supportsOffscreen;
    if (supportsOffscreen) {
      const offscreen = canvas.transferControlToOffscreen();
      this.post({ type: 'attach', canvas: offscreen }, [offscreen]);
    }
    this.attached = true;
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.onTick(), LAYOUT_INTERVAL_MS);
    this.scheduleLayout();
  }

  /** Stops laying out and painting. The worker keeps its tree, and session changes keep reaching it. */
  detach(): void {
    this.attached = false;
    clearInterval(this.tickTimer);
    clearTimeout(this.viewTimer);
    this.flushRemoves();
  }

  setView(view: Omit<ViewSettings, 'zoomFolderId'>): void {
    this.view = view;
    this.viewVersion++;
    this.scheduleLayout();
  }

  zoomTo(folderId: number | null): void {
    this.zoomFolderId = folderId;
    this.viewVersion++;
    this.scheduleLayout();
  }

  async locate(fileId: number): Promise<Located> {
    const answer = await this.ask({ type: 'locate', fileId });
    return answer.type === 'located' ? { rect: answer.rect, zoomFolderId: answer.zoomFolderId } : { rect: -1, zoomFolderId: null };
  }

  async describeFolder(folderId: number): Promise<string> {
    const answer = await this.ask({ type: 'describe', folderId });
    return answer.type === 'described' ? answer.path : '';
  }

  dispose(): void {
    this.detach();
    this.unsubscribe();
    this.worker?.terminate();
    this.worker = null;
  }

  private onTick(): void {
    const running = this.session.running;
    // One more layout after the search finishes picks up the rows of its last batches. Changes
    // since the last layout count too: a search can start and finish between two ticks, and a row
    // can be removed after the search, and neither is ever seen running here.
    if (running || this.wasRunning || this.changedSinceLayout) this.requestLayout();
    this.wasRunning = running;
  }

  private scheduleLayout(): void {
    if (!this.attached) return;
    clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => this.requestLayout(), VIEW_CHANGE_DELAY_MS);
  }

  private requestLayout(): void {
    if (!this.attached || !this.view || !this.worker) return;
    if (this.layoutInFlight) {
      this.layoutWanted = true;
      return;
    }
    this.flushRemoves();
    this.changedSinceLayout = false;
    const sequence = ++this.sequence;
    this.viewVersionOfSequence.set(sequence, this.viewVersion);
    this.busy = true;
    this.layoutInFlight = true;
    this.post({ type: 'layout', sequence, view: { ...this.view, zoomFolderId: this.zoomFolderId } });
  }

  private receive(message: FromWorker): void {
    if (message.type === 'layout') {
      if (message.sequence === this.sequence) {
        this.layoutInFlight = false;
        if (this.layoutWanted) {
          this.layoutWanted = false;
          this.requestLayout();
        } else {
          this.busy = false;
        }
      }
      const requestedFor = this.viewVersionOfSequence.get(message.sequence);
      this.viewVersionOfSequence.delete(message.sequence);
      // Replies come back in order. One made for an earlier view is out of date, but one made
      // before a mere tick is not: dropping those would starve the map while layouts are slow.
      if (requestedFor !== this.viewVersion) return;
      const indexStarted = performance.now();
      const index = this.view ? new LayoutIndex(message.layout, this.view.width, this.view.height) : null;
      const indexMs = performance.now() - indexStarted;
      this.layout = message.layout;
      this.layoutMetric = message.metric;
      this.index = index;
      this.crumbs = message.crumbs;
      this.largestFolder = message.largestFolder;
      this.zoomFolderId = message.zoomFolderId;
      this.lastTimings = { ...message.elapsedMs, index: indexMs };
      return;
    }
    const resolve = this.waiting.get(message.requestId);
    if (resolve) {
      this.waiting.delete(message.requestId);
      resolve(message);
    }
  }

  private ask(question: { type: 'locate'; fileId: number } | { type: 'describe'; folderId: number }): Promise<FromWorker> {
    const requestId = ++this.requestCounter;
    return new Promise<FromWorker>((resolve) => {
      this.waiting.set(requestId, resolve);
      this.post({ ...question, requestId });
    });
  }

  /** Sends the queued removals to the worker. */
  private flushRemoves(): void {
    if (this.pendingRemoves.length > 0) {
      this.post({ type: 'remove', ids: this.pendingRemoves });
      this.pendingRemoves = [];
    }
  }

  private postAdds(records: TreemapRecord[]): void {
    for (let start = 0; start < records.length; start += ADD_CHUNK_SIZE) {
      this.post({ type: 'add', records: records.slice(start, start + ADD_CHUNK_SIZE) });
    }
  }

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }
}

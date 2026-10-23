import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADD_CHUNK_SIZE, TreemapClient, type WorkerLike } from './treemapClient.svelte';
import type { SessionListener } from './search.svelte';
import type { DisplayRow } from './types';

const row = (id: number, folder = 'C:\\a'): DisplayRow => ({
  id, path: `${folder}\\f${id}.txt`, name: `f${id}.txt`, folder, size: 10, modifiedMs: null, modifiedText: '', hits: 0, typeName: '',
});

const view = (width = 100) => ({
  width, height: 100, devicePixelRatio: 1, metric: 'size' as const, colorMode: 'type' as const,
  colors: {} as never, forced: null, font: '', dimmed: null,
});

const layoutReply = (sequence: number) => ({
  type: 'layout', sequence, layout: { count: 0 }, crumbs: [], zoomFolderId: 0, painted: true, largestFolder: '',
  elapsedMs: { layout: 1, paint: 1 },
});

function setup() {
  const posted: Array<{ message: any; transfer?: unknown[] }> = [];
  const worker: WorkerLike = { postMessage: (message, transfer) => posted.push({ message, transfer }), onmessage: null, terminate: vi.fn() };
  const createWorker = vi.fn(() => worker);
  let listener!: SessionListener;
  const session = {
    rows: [row(0), row(1)],
    running: true,
    subscribe: (next: SessionListener) => { listener = next; return () => {}; },
  };
  const client = new TreemapClient(session as never, createWorker);
  const canvas = { transferControlToOffscreen: () => ({}) } as unknown as HTMLCanvasElement;
  return { client, session, worker, createWorker, posted, canvas, emit: () => listener };
}

const types = (posted: Array<{ message: any }>) => posted.map((entry) => entry.message.type);

describe('TreemapClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does nothing until a canvas is attached', () => {
    const { client, posted, createWorker, emit } = setup();
    client.setView(view());
    emit().appended([row(5)]);
    vi.advanceTimersByTime(5000);
    expect(posted).toEqual([]);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('resyncs from the session rows when first attached', () => {
    const { client, posted, canvas } = setup();
    client.attach(canvas);
    expect(types(posted)).toEqual(['reset', 'add', 'attach']);
    expect(posted[1].message.records.map((record: { id: number }) => record.id)).toEqual([0, 1]);
  });

  it('measures ages from the start of the search seen before attaching', () => {
    const { client, posted, canvas, emit } = setup();
    emit().reset(456);
    client.attach(canvas);
    expect(posted[0].message).toEqual({ type: 'reset', now: 456 });
  });

  it('batches appended rows into one add per flush', () => {
    const { client, posted, canvas, emit } = setup();
    client.setView(view());
    client.attach(canvas);
    vi.advanceTimersByTime(100);
    posted.length = 0;
    emit().appended([row(2)]);
    emit().appended([row(3)]);
    vi.advanceTimersByTime(1300);
    expect(types(posted)).toEqual(['add', 'layout']);
    expect(posted[0].message.records.map((record: { id: number }) => record.id)).toEqual([2, 3]);
  });

  it('posts removals and resets', () => {
    const { client, posted, canvas, emit } = setup();
    client.setView(view());
    client.attach(canvas);
    posted.length = 0;
    emit().removed(1);
    vi.advanceTimersByTime(1300);
    expect(types(posted)).toContain('remove');
    posted.length = 0;
    emit().reset(123);
    expect(types(posted)).toEqual(['reset']);
  });

  it('forgets the previous search picture on a reset and takes the next one', () => {
    const { client, worker, posted, canvas, emit } = setup();
    client.attach(canvas);
    client.setView(view());
    vi.advanceTimersByTime(100);
    worker.onmessage!({ data: { ...layoutReply(1), crumbs: [{ folderId: 0, label: 'C:' }], largestFolder: 'a' } } as MessageEvent);
    expect(client.layout).not.toBeNull();

    emit().reset(789);
    expect(client.layout).toBeNull();
    expect(client.index).toBeNull();
    expect(client.crumbs).toEqual([]);
    expect(client.largestFolder).toBe('');
    expect(client.lastTimings).toBeNull();

    vi.advanceTimersByTime(100);
    const sequence = posted.map((entry) => entry.message).filter((message) => message.type === 'layout').at(-1).sequence;
    worker.onmessage!({ data: layoutReply(sequence) } as MessageEvent);
    expect(client.layout).not.toBeNull();
    expect(client.index).not.toBeNull();
  });

  it('ignores a layout reply older than the latest request', () => {
    const { client, worker, canvas } = setup();
    client.attach(canvas);
    client.setView(view(100));
    vi.advanceTimersByTime(100);
    client.setView(view(120));
    vi.advanceTimersByTime(100);
    worker.onmessage!({ data: layoutReply(1) } as MessageEvent);
    expect(client.layout).toBeNull();
  });

  it('keeps a reply when only a tick has happened since the request', () => {
    const { client, worker, posted, canvas, emit } = setup();
    client.attach(canvas);
    client.setView(view());
    vi.advanceTimersByTime(100);
    emit().appended([row(2)]);
    vi.advanceTimersByTime(1300); // a tick requests another layout for the same view
    expect(types(posted).filter((type) => type === 'layout')).toHaveLength(2);
    worker.onmessage!({ data: layoutReply(1) } as MessageEvent);
    expect(client.layout).not.toBeNull();
  });

  it('resolves locate from the worker answer', async () => {
    const { client, worker, posted, canvas } = setup();
    client.attach(canvas);
    const pending = client.locate(7);
    const request = posted.map((entry) => entry.message).find((message) => message.type === 'locate');
    worker.onmessage!({ data: { type: 'located', requestId: request.requestId, rect: 3, zoomFolderId: null } } as MessageEvent);
    await expect(pending).resolves.toEqual({ rect: 3, zoomFolderId: null });
  });

  it('stops requesting layouts after detach', () => {
    const { client, posted, canvas, emit } = setup();
    client.setView(view());
    client.attach(canvas);
    client.detach();
    posted.length = 0;
    emit().appended([row(9)]);
    vi.advanceTimersByTime(5000);
    expect(types(posted)).not.toContain('layout');
  });

  it('posts the first resync in chunks before any layout', () => {
    const { client, session, posted, canvas } = setup();
    session.rows = Array.from({ length: 25_000 }, (_, id) => row(id));
    client.setView(view());
    client.attach(canvas);
    expect(types(posted)).toEqual(['reset', 'add', 'add', 'add', 'attach']);
    const sizes = posted.filter((entry) => entry.message.type === 'add').map((entry) => entry.message.records.length);
    expect(sizes).toEqual([ADD_CHUNK_SIZE, ADD_CHUNK_SIZE, 5_000]);
  });

  it('forwards changes while detached without laying out', () => {
    const { client, posted, canvas, emit } = setup();
    client.setView(view());
    client.attach(canvas);
    vi.advanceTimersByTime(100);
    emit().appended([row(2)]);
    posted.length = 0;
    client.detach();
    expect(types(posted)).toEqual(['add']);
    posted.length = 0;
    emit().appended([row(3)]);
    emit().removed(0);
    expect(types(posted)).toEqual(['add', 'remove']);
    vi.advanceTimersByTime(5000);
    expect(types(posted)).not.toContain('layout');
  });

  it('does not post old rows again when re-attached', () => {
    const { client, posted, canvas } = setup();
    client.setView(view());
    client.attach(canvas);
    client.detach();
    posted.length = 0;
    client.attach({ transferControlToOffscreen: () => ({}) } as unknown as HTMLCanvasElement);
    vi.advanceTimersByTime(100);
    expect(types(posted)).toEqual(['attach', 'layout']);
  });

  it('terminates the worker on dispose', () => {
    const { client, worker, canvas } = setup();
    client.attach(canvas);
    client.dispose();
    expect(worker.terminate).toHaveBeenCalled();
  });
});

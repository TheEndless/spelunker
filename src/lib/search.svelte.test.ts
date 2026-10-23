import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchRequest } from './backend';
import type { ResultRow, SearchMessage } from './types';

const backend = vi.hoisted(() => ({
  emit: null as null | ((message: SearchMessage) => void),
  startSearch: vi.fn(),
  stopSearch: vi.fn(),
}));

vi.mock('./backend', () => ({
  startSearch: (request: SearchRequest, onMessage: (message: SearchMessage) => void) => {
    backend.emit = onMessage;
    backend.startSearch(request);
  },
  stopSearch: () => {
    backend.stopSearch();
    return Promise.resolve();
  },
}));

import { SearchSession, STOPPING_NOTICE_DELAY_MS } from './search.svelte';

const request = {
  roots: ['C:/x'],
  namePatterns: '',
  nameIsRegex: false,
  query: { text: '', matchCase: false, wholeWord: false, regex: false, multiLine: false },
  recurse: true,
  maxDepth: null,
  includeHidden: false,
  includeBinary: false,
  followLinks: false,
  minSize: null,
  maxSize: null,
  modified: { fromMs: null, toMs: null },
  created: { fromMs: null, toMs: null },
} satisfies SearchRequest;

const done: SearchMessage = {
  kind: 'done',
  error: null,
  summary: {
    filesScanned: 5,
    filesMatched: 0,
    totalHits: 0,
    errors: 0,
    binarySkipped: 0,
    elapsedMs: 10,
    cancelled: true,
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  backend.stopSearch.mockClear();
  backend.startSearch.mockClear();
});
afterEach(() => vi.useRealTimers());

function startedSession() {
  const session = new SearchSession();
  session.start(request);
  return session;
}

function resultRow(path: string): ResultRow {
  return { path, size: 1, modifiedMs: null, modifiedText: '', hits: 0, typeName: 'File' };
}

function batchOf(...paths: string[]): SearchMessage {
  return { kind: 'batch', rows: paths.map(resultRow), errors: [], filesScanned: null };
}

describe('row ids and session events', () => {
  it('gives every accepted row a unique, increasing id', () => {
    const session = startedSession();
    backend.emit!(batchOf('C:/x/a', 'C:/x/b'));
    backend.emit!(batchOf('C:/x/c', 'C:/x/d'));
    expect(session.rows.map((row) => row.id)).toEqual([0, 1, 2, 3]);
  });

  it('does not give an id to a duplicate path', () => {
    const session = startedSession();
    const appendedBatches: number[][] = [];
    session.subscribe({
      appended: (rows) => appendedBatches.push(rows.map((row) => row.id)),
      removed: () => {},
      reset: () => {},
    });
    backend.emit!(batchOf('C:/x/a'));
    backend.emit!(batchOf('C:/x/a'));
    expect(session.rows).toHaveLength(1);
    expect(appendedBatches).toEqual([[0]]);
  });

  it('finds a row by id and forgets it after removal', () => {
    const session = startedSession();
    backend.emit!(batchOf('C:/x/a', 'C:/x/b'));
    const row = session.rowById(1);
    expect(row?.path).toBe('C:/x/b');
    session.removeRow(row!.path);
    expect(session.rowById(1)).toBeUndefined();
    expect(session.rowById(0)?.path).toBe('C:/x/a');
  });

  it('tells listeners about appended rows, removals and resets in order', () => {
    const session = new SearchSession();
    const events: string[] = [];
    const stop = session.subscribe({
      appended: (rows) => events.push(`appended:${rows.map((row) => row.id).join(',')}`),
      removed: (id) => events.push(`removed:${id}`),
      reset: () => events.push('reset'),
    });
    session.start(request);
    backend.emit!(batchOf('C:/x/a', 'C:/x/b'));
    session.removeRow('C:/x/a');
    session.start(request);
    expect(events).toEqual(['reset', 'appended:0,1', 'removed:0', 'reset']);

    stop();
    backend.emit!(batchOf('C:/x/c'));
    session.start(request);
    expect(events).toHaveLength(4);
  });

  it('passes the start time to reset listeners', () => {
    vi.setSystemTime(123_456);
    const session = new SearchSession();
    const startTimes: number[] = [];
    session.subscribe({ appended: () => {}, removed: () => {}, reset: (ms) => startTimes.push(ms) });
    session.start(request);
    expect(startTimes).toEqual([123_456]);
  });

  it('keeps ids unique across searches', () => {
    const session = startedSession();
    backend.emit!(batchOf('C:/x/a', 'C:/x/b'));
    const firstSearchIds = session.rows.map((row) => row.id);
    session.start(request);
    backend.emit!(batchOf('C:/x/a'));
    expect(session.rows[0].id).toBeGreaterThan(Math.max(...firstSearchIds));
    expect(session.rowById(firstSearchIds[0])).toBeUndefined();
  });
});

describe('stopping a search', () => {
  it('marks the session as stopping right away and tells the backend once', () => {
    const session = startedSession();
    session.stop();
    session.stop();
    expect(session.stopping).toBe(true);
    expect(backend.stopSearch).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no search is running', () => {
    const session = new SearchSession();
    session.stop();
    expect(session.stopping).toBe(false);
    expect(backend.stopSearch).not.toHaveBeenCalled();
  });

  it('keeps the notice hidden at first so an instant stop never flashes a dialog', () => {
    const session = startedSession();
    session.stop();
    expect(session.stoppingNoticeVisible).toBe(false);
    vi.advanceTimersByTime(STOPPING_NOTICE_DELAY_MS - 1);
    expect(session.stoppingNoticeVisible).toBe(false);
  });

  it('shows the notice once stopping takes noticeable time', () => {
    const session = startedSession();
    session.stop();
    vi.advanceTimersByTime(STOPPING_NOTICE_DELAY_MS);
    expect(session.stoppingNoticeVisible).toBe(true);
  });

  it('never shows the notice when the backend finishes quickly', () => {
    const session = startedSession();
    session.stop();
    vi.advanceTimersByTime(STOPPING_NOTICE_DELAY_MS - 50);
    backend.emit!(done);
    vi.advanceTimersByTime(1000);
    expect(session.stoppingNoticeVisible).toBe(false);
    expect(session.stopping).toBe(false);
    expect(session.running).toBe(false);
  });

  it('hides the notice and clears stopping when the search finishes', () => {
    const session = startedSession();
    session.stop();
    vi.advanceTimersByTime(STOPPING_NOTICE_DELAY_MS + 3000);
    expect(session.stoppingNoticeVisible).toBe(true);
    backend.emit!(done);
    expect(session.stoppingNoticeVisible).toBe(false);
    expect(session.stopping).toBe(false);
    expect(session.summary?.cancelled).toBe(true);
  });

  it('lets the user hide the notice while the search is still stopping', () => {
    const session = startedSession();
    session.stop();
    vi.advanceTimersByTime(STOPPING_NOTICE_DELAY_MS);
    session.hideStoppingNotice();
    expect(session.stoppingNoticeVisible).toBe(false);
    expect(session.stopping).toBe(true);
    expect(session.running).toBe(true);
  });

  it('does not bring a hidden notice back later', () => {
    const session = startedSession();
    session.stop();
    vi.advanceTimersByTime(STOPPING_NOTICE_DELAY_MS);
    session.hideStoppingNotice();
    vi.advanceTimersByTime(60_000);
    expect(session.stoppingNoticeVisible).toBe(false);
  });

  it('a new search starts clean after a stop', () => {
    const session = startedSession();
    session.stop();
    vi.advanceTimersByTime(STOPPING_NOTICE_DELAY_MS);
    backend.emit!(done);
    session.start(request);
    expect(session.stopping).toBe(false);
    expect(session.stoppingNoticeVisible).toBe(false);
    expect(session.running).toBe(true);
  });

  it('ignores the finish message of a superseded search', () => {
    const session = startedSession();
    const staleEmit = backend.emit!;
    session.stop();
    session.start(request);
    session.stop();
    staleEmit(done);
    expect(session.running).toBe(true);
    expect(session.stopping).toBe(true);
  });
});

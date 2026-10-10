import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchRequest } from './backend';
import type { SearchMessage } from './types';

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

import { beforeEach, describe, expect, it } from 'vitest';
import { handleMessage, type Send } from './treemap.worker';
import { RectKind, type Layout } from './treemapLayout';
import type { FromWorker, ViewSettings } from './treemapMessages';
import type { TreemapRecord } from './treemapTree';

type LayoutReply = Extract<FromWorker, { type: 'layout' }>;

let replies: FromWorker[] = [];
const send: Send = (message) => replies.push(message);
let sequence = 0;
let requestId = 0;

const record = (id: number, folder: string, size: number): TreemapRecord => ({
  id, folder, name: `f${id}.txt`, size, hits: 0, modifiedMs: null,
});

function load(records: TreemapRecord[]) {
  handleMessage({ type: 'reset', now: 0 }, send);
  handleMessage({ type: 'add', records }, send);
}

function layout(zoomFolderId: number | null = null): LayoutReply {
  const view: ViewSettings = {
    width: 100, height: 100, devicePixelRatio: 1, metric: 'size', colorMode: 'type', zoomFolderId,
    colors: {} as never, forced: null, font: '', dimmed: null,
  };
  handleMessage({ type: 'layout', sequence: ++sequence, view }, send);
  return replies.at(-1) as LayoutReply;
}

function locate(fileId: number) {
  handleMessage({ type: 'locate', requestId: ++requestId, fileId }, send);
  const { rect, zoomFolderId } = replies.at(-1) as Extract<FromWorker, { type: 'located' }>;
  return { rect, zoomFolderId };
}

/** Folder ids are not reset between tests, so look them up by path. */
function folderId(path: string): number {
  for (let id = 0; id < 10_000; id++) {
    handleMessage({ type: 'describe', requestId: ++requestId, folderId: id }, send);
    if ((replies.at(-1) as Extract<FromWorker, { type: 'described' }>).path === path) return id;
  }
  throw new Error(`No folder ${path}`);
}

const describeRect = (layout: Layout, rect: number) => ({ kind: layout.kind[rect], id: layout.id[rect] });

describe('treemap worker', () => {
  beforeEach(() => {
    replies = [];
  });

  describe('zoom fallback', () => {
    beforeEach(() =>
      load([
        record(1, 'C:\\x\\y\\deep', 100),
        record(2, 'C:\\x\\y', 100),
        record(3, 'C:\\x\\y\\other', 100),
        record(4, 'C:\\z', 100),
      ]),
    );

    it('zooms out to the nearest surviving ancestor when the zoomed folder is removed', () => {
      const deep = folderId('C:\\x\\y\\deep');
      expect(layout(deep).zoomFolderId).toBe(deep);
      handleMessage({ type: 'remove', ids: [1] }, send);
      const reply = layout(deep);
      expect(reply.zoomFolderId).toBe(folderId('C:\\x\\y'));
      expect(reply.crumbs.at(-1)!.label).toBe('y');
    });

    it('falls back to the top for a folder id it does not know', () => {
      expect(layout(999_999).zoomFolderId).toBe(folderId('C:'));
    });
  });

  describe('locate', () => {
    // In a 100 by 100 map, folder a holds one huge file and two tiny ones that fold into a
    // small-files group. Folder b is a 0.2 pixel wide strip, so it is drawn as one block.
    beforeEach(() =>
      load([
        record(1, 'C:\\a', 1_000_000),
        record(2, 'C:\\a', 1),
        record(3, 'C:\\a', 1),
        record(4, 'C:\\b', 2_000),
        record(5, 'C:\\b\\sub', 10),
        record(6, 'C:\\a', 0),
      ]),
    );

    it('finds a file drawn on its own', () => {
      const reply = layout();
      const { rect, zoomFolderId } = locate(1);
      expect(describeRect(reply.layout, rect)).toEqual({ kind: RectKind.File, id: 1 });
      expect(zoomFolderId).toBeNull();
    });

    it('finds a file folded into its folder small-files group', () => {
      const reply = layout();
      const { rect } = locate(2);
      expect(describeRect(reply.layout, rect)).toEqual({ kind: RectKind.SmallFiles, id: folderId('C:\\a') });
    });

    it('finds a file inside a folder drawn as one block', () => {
      const reply = layout();
      const block = { kind: RectKind.FolderBlock, id: folderId('C:\\b') };
      expect(describeRect(reply.layout, locate(4).rect)).toEqual(block);
      expect(describeRect(reply.layout, locate(5).rect)).toEqual(block);
    });

    it('does not place a zero-size file, which is not drawn', () => {
      layout();
      expect(locate(6)).toEqual({ rect: -1, zoomFolderId: null });
    });

    it('asks to zoom out for a file outside the zoomed view', () => {
      layout(folderId('C:\\a'));
      expect(locate(4)).toEqual({ rect: -1, zoomFolderId: folderId('C:') });
    });

    it('does not place a removed file', () => {
      layout();
      handleMessage({ type: 'remove', ids: [2] }, send);
      expect(locate(2)).toEqual({ rect: -1, zoomFolderId: null });
    });
  });
});

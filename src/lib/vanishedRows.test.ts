import { describe, expect, it, vi } from 'vitest';
import { MAX_SHELL_ITEMS, goneNotice, removeGoneRows, skippedNotice } from './vanishedRows';

/** A backend existence check over a fixed set of files that are still on disk. */
function onDisk(...present: string[]) {
  return vi.fn(async (paths: string[]) => paths.filter((path) => present.includes(path)));
}

describe('removeGoneRows', () => {
  const paths = ['C:\\a.txt', 'C:\\b.txt', 'C:\\c.txt'];

  it('removes nothing when every file is still there', async () => {
    const removeRows = vi.fn();
    expect(await removeGoneRows(paths, onDisk(...paths), removeRows)).toEqual([]);
    expect(removeRows).not.toHaveBeenCalled();
  });

  it('removes only the rows whose files are gone, in one call, in order', async () => {
    const removeRows = vi.fn();
    const gone = await removeGoneRows(paths, onDisk('C:\\b.txt'), removeRows);
    expect(gone).toEqual(['C:\\a.txt', 'C:\\c.txt']);
    expect(removeRows).toHaveBeenCalledTimes(1);
    expect(removeRows).toHaveBeenCalledWith(['C:\\a.txt', 'C:\\c.txt']);
  });

  it('removes every row when every file is gone', async () => {
    const removeRows = vi.fn();
    expect(await removeGoneRows(paths, onDisk(), removeRows)).toEqual(paths);
    expect(removeRows).toHaveBeenCalledWith(paths);
  });

  it('keeps a skipped file that still exists', async () => {
    const removeRows = vi.fn();
    const skipped = ['C:\\very\\long\\path.txt', 'C:\\deleted.txt'];
    const gone = await removeGoneRows(skipped, onDisk('C:\\very\\long\\path.txt'), removeRows);
    expect(gone).toEqual(['C:\\deleted.txt']);
    expect(removeRows).toHaveBeenCalledWith(['C:\\deleted.txt']);
  });

  it('checks nothing over the menu limit, since that refusal is about the count', async () => {
    const tooMany = Array.from({ length: MAX_SHELL_ITEMS + 1 }, (_, index) => `C:\\file_${index}.txt`);
    const check = onDisk();
    const removeRows = vi.fn();
    expect(await removeGoneRows(tooMany, check, removeRows)).toEqual([]);
    expect(check).not.toHaveBeenCalled();
    expect(removeRows).not.toHaveBeenCalled();
  });

  it('checks exactly the limit', async () => {
    const atLimit = Array.from({ length: MAX_SHELL_ITEMS }, (_, index) => `C:\\file_${index}.txt`);
    const check = onDisk();
    expect(await removeGoneRows(atLimit, check, vi.fn())).toHaveLength(MAX_SHELL_ITEMS);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('checks nothing for no paths', async () => {
    const check = onDisk();
    expect(await removeGoneRows([], check, vi.fn())).toEqual([]);
    expect(check).not.toHaveBeenCalled();
  });

  it('removes nothing when the check itself fails', async () => {
    const removeRows = vi.fn();
    const failing = vi.fn(async () => {
      throw new Error('backend unavailable');
    });
    expect(await removeGoneRows(paths, failing, removeRows)).toEqual([]);
    expect(removeRows).not.toHaveBeenCalled();
  });
});

describe('notices', () => {
  it('counts gone files with the right plural', () => {
    expect(goneNotice(1)).toBe('1 file no longer exists');
    expect(goneNotice(1200)).toBe('1,200 files no longer exist');
  });

  it('says nothing when nothing was skipped', () => {
    expect(skippedNotice(0, 0)).toBeNull();
  });

  it('names the files left out of the menu that still exist', () => {
    expect(skippedNotice(0, 1)).toBe('1 file could not be included in the system menu');
    expect(skippedNotice(0, 3)).toBe('3 files could not be included in the system menu');
  });

  it('names both kinds together', () => {
    expect(skippedNotice(2, 1)).toBe('2 files no longer exist. 1 file could not be included in the system menu');
  });
});

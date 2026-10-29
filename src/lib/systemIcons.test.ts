import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileIconUrl = vi.fn<(extension: string, large: boolean) => Promise<string | null>>();
vi.mock('./backend', () => ({ fileIconUrl: (extension: string, large: boolean) => fileIconUrl(extension, large) }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('systemIconUrl', () => {
  let systemIconUrl: (name: string, large?: boolean) => string | null;

  beforeEach(async () => {
    vi.resetModules();
    fileIconUrl.mockReset();
    ({ systemIconUrl } = await import('./systemIcons.svelte'));
  });

  it('has nothing until the icon arrives, then gives its URL', async () => {
    fileIconUrl.mockResolvedValue('blob:txt');
    expect(systemIconUrl('notes.txt')).toBeNull();
    await settle();
    expect(systemIconUrl('notes.txt')).toBe('blob:txt');
  });

  it('asks once per extension, whatever the case or the name', async () => {
    fileIconUrl.mockResolvedValue('blob:txt');
    systemIconUrl('a.txt');
    systemIconUrl('b.TXT');
    systemIconUrl('c.txt');
    await settle();
    expect(fileIconUrl).toHaveBeenCalledTimes(1);
    expect(fileIconUrl).toHaveBeenCalledWith('txt', false);
    expect(systemIconUrl('d.Txt')).toBe('blob:txt');
  });

  it('keeps asking for each different extension', async () => {
    fileIconUrl.mockImplementation(async (extension, large) => `blob:${extension}:${large}`);
    systemIconUrl('a.txt');
    systemIconUrl('a.zip');
    await settle();
    expect(systemIconUrl('a.txt')).toBe('blob:txt:false');
    expect(systemIconUrl('a.zip')).toBe('blob:zip:false');
  });

  it('keeps the small and the large icon of one extension apart', async () => {
    fileIconUrl.mockImplementation(async (extension, large) => `blob:${extension}:${large}`);
    systemIconUrl('a.txt');
    systemIconUrl('a.txt', true);
    await settle();
    expect(systemIconUrl('a.txt')).toBe('blob:txt:false');
    expect(systemIconUrl('a.txt', true)).toBe('blob:txt:true');
    expect(fileIconUrl).toHaveBeenCalledTimes(2);
  });

  it('never asks for files that carry their own icon, or have no extension', async () => {
    for (const name of ['setup.exe', 'SHORTCUT.LNK', 'app.ico', 'site.url', 'saver.scr', 'Makefile', '.gitignore']) {
      expect(systemIconUrl(name)).toBeNull();
    }
    await settle();
    expect(fileIconUrl).not.toHaveBeenCalled();
  });

  it('stays empty when the system has no icon or the lookup fails, and does not ask again', async () => {
    fileIconUrl.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('no'));
    systemIconUrl('a.aaa');
    systemIconUrl('a.bbb');
    await settle();
    expect(systemIconUrl('a.aaa')).toBeNull();
    expect(systemIconUrl('a.bbb')).toBeNull();
    expect(fileIconUrl).toHaveBeenCalledTimes(2);
  });
});

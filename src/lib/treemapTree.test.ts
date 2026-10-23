import { describe, expect, it } from 'vitest';
import { ancestorsOf, collapseChain, folderPathLabel, FolderTree, type TreemapRecord } from './treemapTree';

const record = (id: number, folder: string, name = 'a.txt', size = 1, hits = 0): TreemapRecord => ({
  id, folder, name, size, hits, modifiedMs: null,
});

describe('FolderTree', () => {
  it('nests files under their folders', () => {
    const tree = new FolderTree();
    tree.add(record(1, 'C:\\proj\\src'));
    tree.add(record(2, 'C:\\proj'));
    expect(tree.fileCount).toBe(2);
    const proj = tree.root.folders.get('c:')!.folders.get('proj')!;
    expect(proj.files.map((file) => file.id)).toEqual([2]);
    expect(proj.folders.get('src')!.files.map((file) => file.id)).toEqual([1]);
  });

  it('treats folder names case-insensitively and both separators alike', () => {
    const tree = new FolderTree();
    tree.add(record(1, 'C:\\Proj\\Src'));
    tree.add(record(2, 'c:/proj/SRC'));
    const src = tree.folderOfFile(1)!;
    expect(tree.folderOfFile(2)).toBe(src);
    expect(src.name).toBe('Src'); // first-seen casing is kept for display
  });

  it('keeps two files that differ only in case as separate leaves', () => {
    const tree = new FolderTree();
    tree.add(record(1, 'C:\\a', 'File.txt'));
    tree.add(record(2, 'C:\\a', 'file.txt'));
    expect(tree.fileCount).toBe(2);
  });

  it('handles UNC paths and files at the root', () => {
    const tree = new FolderTree();
    tree.add(record(1, '\\\\server\\share\\dir'));
    tree.add(record(2, ''));
    expect(folderPathLabel(tree.folderOfFile(1)!)).toBe('server\\share\\dir');
    expect(tree.root.files.map((file) => file.id)).toEqual([2]);
  });

  it('removes a file and prunes folders that became empty', () => {
    const tree = new FolderTree();
    tree.add(record(1, 'C:\\a\\b'));
    tree.add(record(2, 'C:\\a'));
    const deepFolder = tree.folderOfFile(1)!;
    expect(tree.remove(1)).toBe(true);
    expect(tree.folderById(deepFolder.id)).toBeUndefined();
    expect(tree.fileCount).toBe(1);
    expect(tree.remove(1)).toBe(false);
  });

  it('clears everything', () => {
    const tree = new FolderTree();
    tree.add(record(1, 'C:\\a'));
    tree.clear();
    expect(tree.fileCount).toBe(0);
    expect(tree.folderCount).toBe(1);
    expect(tree.root.folders.size).toBe(0);
  });

  it('assigns the file its category index', () => {
    const tree = new FolderTree();
    tree.add(record(1, 'C:\\a', 'x.rs'));
    expect(tree.folderOfFile(1)!.files[0].category).toBe(0); // code is first
  });
});

describe('collapseChain', () => {
  it('skips single-child folders with no files of their own', () => {
    const tree = new FolderTree();
    tree.add(record(1, 'C:\\a\\b\\c'));
    tree.add(record(2, 'C:\\a\\b\\d'));
    const top = collapseChain(tree.root);
    expect(folderPathLabel(top)).toBe('C:\\a\\b');
  });
  it('stops at a folder that has files', () => {
    const tree = new FolderTree();
    tree.add(record(1, 'C:\\a'));
    tree.add(record(2, 'C:\\a\\b'));
    expect(folderPathLabel(collapseChain(tree.root))).toBe('C:\\a');
  });
});

describe('ancestorsOf', () => {
  it('lists folders nearest first and leaves out the root', () => {
    const tree = new FolderTree();
    tree.add(record(1, 'C:\\a\\b'));
    expect(ancestorsOf(tree.folderOfFile(1)!).map((node) => node.name)).toEqual(['b', 'a', 'C:']);
  });
});

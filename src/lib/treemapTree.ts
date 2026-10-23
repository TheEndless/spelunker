import { fileCategoryIndex } from './fileKinds';

/** What the map needs to know about a result. Nothing here needs the disk. */
export interface TreemapRecord {
  id: number;
  folder: string;
  name: string;
  size: number;
  hits: number;
  modifiedMs: number | null;
}

export interface TreeFile {
  id: number;
  name: string;
  size: number;
  hits: number;
  modifiedMs: number | null;
  /** Index into FILE_CATEGORIES. */
  category: number;
}

export interface FolderNode {
  id: number;
  /** The casing first seen for this folder, for display. */
  name: string;
  parent: FolderNode | null;
  /** Children keyed by lower-case name, because Windows paths are case-insensitive. */
  folders: Map<string, FolderNode>;
  files: TreeFile[];
}

export function folderSegments(folder: string): string[] {
  return folder.split(/[\\/]+/).filter((segment) => segment !== '');
}

/** Result files folded into the folders that hold them. Leaves are keyed by id, never by name. */
export class FolderTree {
  readonly root: FolderNode;
  private nextFolderId = 0;
  private readonly folderOfFileId = new Map<number, FolderNode>();
  private readonly foldersById = new Map<number, FolderNode>();

  constructor() {
    this.root = this.createFolder('', null);
  }

  get fileCount(): number {
    return this.folderOfFileId.size;
  }

  /** Folders in the tree, including the root. */
  get folderCount(): number {
    return this.foldersById.size;
  }

  add(record: TreemapRecord): void {
    let node = this.root;
    for (const segment of folderSegments(record.folder)) {
      const key = segment.toLowerCase();
      let child = node.folders.get(key);
      if (!child) {
        child = this.createFolder(segment, node);
        node.folders.set(key, child);
      }
      node = child;
    }
    node.files.push({
      id: record.id,
      name: record.name,
      size: record.size,
      hits: record.hits,
      modifiedMs: record.modifiedMs,
      category: fileCategoryIndex(record.name),
    });
    this.folderOfFileId.set(record.id, node);
  }

  /** Removes a file and any folders it leaves empty. Returns false when the id is unknown. */
  remove(id: number): boolean {
    const folder = this.folderOfFileId.get(id);
    if (!folder) return false;
    this.folderOfFileId.delete(id);
    folder.files.splice(folder.files.findIndex((file) => file.id === id), 1);
    let node = folder;
    while (node.parent && node.files.length === 0 && node.folders.size === 0) {
      node.parent.folders.delete(node.name.toLowerCase());
      this.foldersById.delete(node.id);
      node = node.parent;
    }
    return true;
  }

  clear(): void {
    this.root.folders.clear();
    this.root.files = [];
    this.folderOfFileId.clear();
    this.foldersById.clear();
    this.foldersById.set(this.root.id, this.root);
  }

  folderOfFile(id: number): FolderNode | undefined {
    return this.folderOfFileId.get(id);
  }

  folderById(id: number): FolderNode | undefined {
    return this.foldersById.get(id);
  }

  private createFolder(name: string, parent: FolderNode | null): FolderNode {
    const node: FolderNode = { id: this.nextFolderId++, name, parent, folders: new Map(), files: [] };
    this.foldersById.set(node.id, node);
    return node;
  }
}

/** Descends through folders that hold no files and have one subfolder, to the first that branches or has files. */
export function collapseChain(node: FolderNode): FolderNode {
  let current = node;
  while (current.files.length === 0 && current.folders.size === 1) {
    current = current.folders.values().next().value!;
  }
  return current;
}

/** Folders from `node` up to (but not including) the root, nearest first. */
export function ancestorsOf(node: FolderNode): FolderNode[] {
  const chain: FolderNode[] = [];
  for (let current: FolderNode | null = node; current && current.parent; current = current.parent) chain.push(current);
  return chain;
}

/** The folder's path as names joined with a backslash. Empty for the root. */
export function folderPathLabel(node: FolderNode): string {
  return ancestorsOf(node)
    .reverse()
    .map((folder) => folder.name)
    .join('\\');
}

import { describe, expect, it } from 'vitest';
import { fileCategory, previewKind } from './fileKinds';

describe('previewKind', () => {
  it('shows pictures as images', () => {
    for (const name of ['a.png', 'B.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.bmp', 'g.svg', 'h.ico', 'i.avif']) {
      expect(previewKind(name), name).toBe('image');
    }
  });

  it('plays audio and video the webview can decode', () => {
    expect(previewKind('song.mp3')).toBe('audio');
    expect(previewKind('clip.wav')).toBe('audio');
    expect(previewKind('movie.mp4')).toBe('video');
    expect(previewKind('movie.webm')).toBe('video');
  });

  it('shows PDFs in a viewer', () => {
    expect(previewKind('paper.pdf')).toBe('pdf');
  });

  it('shows source and text files as text', () => {
    for (const name of ['main.rs', 'notes.txt', 'config.json', 'page.html', 'README.md', 'Makefile', 'data.csv', 'script.ps1']) {
      expect(previewKind(name), name).toBe('text');
    }
  });

  it('tries unknown extensions as text, since the reader reports binary files itself', () => {
    expect(previewKind('weird.xyz123')).toBe('text');
    expect(previewKind('noextension')).toBe('text');
  });

  it('describes known binary formats instead of trying to read them', () => {
    for (const name of ['a.zip', 'b.exe', 'c.dll', 'd.docx', 'e.xlsx', 'f.pptx', 'g.7z', 'h.iso']) {
      expect(previewKind(name), name).toBe('other');
    }
  });

  it('is not fooled by a dot in a folder-like name or a leading dot', () => {
    expect(previewKind('.gitignore')).toBe('text');
    expect(previewKind('archive.tar.gz')).toBe('other');
  });
});

describe('fileCategory', () => {
  it('groups files for icons', () => {
    expect(fileCategory('a.rs')).toBe('code');
    expect(fileCategory('a.ts')).toBe('code');
    expect(fileCategory('a.txt')).toBe('text');
    expect(fileCategory('a.md')).toBe('text');
    expect(fileCategory('a.png')).toBe('image');
    expect(fileCategory('a.pdf')).toBe('pdf');
    expect(fileCategory('a.mp3')).toBe('audio');
    expect(fileCategory('a.mkv')).toBe('video');
    expect(fileCategory('a.zip')).toBe('archive');
    expect(fileCategory('a.docx')).toBe('document');
    expect(fileCategory('a.xlsx')).toBe('sheet');
    expect(fileCategory('a.pptx')).toBe('slides');
    expect(fileCategory('a.exe')).toBe('executable');
    expect(fileCategory('a.json')).toBe('data');
    expect(fileCategory('a.csv')).toBe('data');
    expect(fileCategory('a.log')).toBe('text');
    expect(fileCategory('a.qqq')).toBe('other');
  });
});

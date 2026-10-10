import { describe, expect, it } from 'vitest';
import { DEFAULT_EDITOR, editorTemplate, normalizeEditor } from './editors';

describe('editorTemplate', () => {
  it('has no template for the system default, which opens the file without a line', () => {
    expect(editorTemplate(DEFAULT_EDITOR)).toBeNull();
  });

  it('knows how to open VS Code and Notepad++ at a line', () => {
    expect(editorTemplate({ id: 'vscode', customTemplate: '' })).toBe('code.cmd -g "{path}:{line}"');
    expect(editorTemplate({ id: 'notepadpp', customTemplate: '' })).toBe('notepad++ -n{line} "{path}"');
  });

  it('uses the custom command, trimmed, and treats a blank one as unset', () => {
    expect(editorTemplate({ id: 'custom', customTemplate: '  ed +{line} "{path}" ' })).toBe('ed +{line} "{path}"');
    expect(editorTemplate({ id: 'custom', customTemplate: '   ' })).toBeNull();
  });
});

describe('normalizeEditor', () => {
  it('falls back to the default for junk', () => {
    expect(normalizeEditor(null)).toEqual(DEFAULT_EDITOR);
    expect(normalizeEditor({ id: 'emacs' })).toEqual(DEFAULT_EDITOR);
    expect(normalizeEditor('vscode')).toEqual(DEFAULT_EDITOR);
  });

  it('keeps a valid choice and a custom command', () => {
    expect(normalizeEditor({ id: 'custom', customTemplate: 'x {path}' })).toEqual({ id: 'custom', customTemplate: 'x {path}' });
    expect(normalizeEditor({ id: 'vscode' })).toEqual({ id: 'vscode', customTemplate: '' });
  });
});

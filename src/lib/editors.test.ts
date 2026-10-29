import { describe, expect, it } from 'vitest';
import { DEFAULT_EDITOR, editorLaunch, normalizeEditor } from './editors';

describe('editorLaunch', () => {
  it('asks for nothing for the system default, which opens the file without a line', () => {
    expect(editorLaunch(DEFAULT_EDITOR)).toBeNull();
  });

  it('names VS Code and Notepad++ and sends no command line, since the backend holds theirs', () => {
    expect(editorLaunch({ id: 'vscode', customTemplate: 'ignored' })).toEqual({ editor: 'vscode', customTemplate: '' });
    expect(editorLaunch({ id: 'notepadpp', customTemplate: '' })).toEqual({ editor: 'notepadpp', customTemplate: '' });
  });

  it('sends the custom command trimmed, and treats a blank one as unset', () => {
    expect(editorLaunch({ id: 'custom', customTemplate: '  ed +{line} "{path}" ' })).toEqual({ editor: 'custom', customTemplate: 'ed +{line} "{path}"' });
    expect(editorLaunch({ id: 'custom', customTemplate: '   ' })).toBeNull();
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

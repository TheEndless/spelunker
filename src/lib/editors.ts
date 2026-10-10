export type EditorId = 'default' | 'vscode' | 'notepadpp' | 'custom';

export interface EditorSettings {
  id: EditorId;
  /** Used when `id` is "custom". `{path}` and `{line}` are filled in. */
  customTemplate: string;
}

export const DEFAULT_EDITOR: EditorSettings = { id: 'default', customTemplate: '' };

export const EDITOR_CHOICES: { id: EditorId; label: string; hint: string }[] = [
  { id: 'default', label: 'System default', hint: 'Opens the file with the app Windows chooses. It cannot jump to a line.' },
  { id: 'vscode', label: 'Visual Studio Code', hint: 'Needs the "code" command, which the VS Code installer adds to PATH.' },
  { id: 'notepadpp', label: 'Notepad++', hint: 'Found in its usual install folder.' },
  { id: 'custom', label: 'Custom command', hint: 'Use {path} for the file and {line} for the line number.' },
];

const TEMPLATES: Record<Exclude<EditorId, 'default' | 'custom'>, string> = {
  vscode: 'code.cmd -g "{path}:{line}"',
  notepadpp: 'notepad++ -n{line} "{path}"',
};

/** The command to run for the chosen editor, or null when files should open with the system default. */
export function editorTemplate(settings: EditorSettings): string | null {
  if (settings.id === 'default') return null;
  if (settings.id === 'custom') {
    const custom = settings.customTemplate.trim();
    return custom === '' ? null : custom;
  }
  return TEMPLATES[settings.id];
}

export function normalizeEditor(raw: unknown): EditorSettings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_EDITOR;
  const source = raw as Record<string, unknown>;
  const id = EDITOR_CHOICES.find((choice) => choice.id === source.id)?.id;
  if (id === undefined) return DEFAULT_EDITOR;
  return { id, customTemplate: typeof source.customTemplate === 'string' ? source.customTemplate : '' };
}

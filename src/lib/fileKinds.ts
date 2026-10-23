/** What kind of file a name suggests, from its extension alone (the file is never opened). */
export type FileCategory =
  | 'code'
  | 'text'
  | 'data'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'archive'
  | 'document'
  | 'sheet'
  | 'slides'
  | 'executable'
  | 'other';

const words = (list: string) => list.split(' ');

const CATEGORY_EXTENSIONS: Record<Exclude<FileCategory, 'other'>, string[]> = {
  code: words(
    'rs ts tsx js jsx mjs cjs svelte vue py rb go java kt kts c h cpp cc cxx hpp cs fs vb php swift lua sh bash zsh ps1 psm1 bat cmd sql css scss sass less html htm xml xaml toml ini cfg conf',
  ),
  text: words('txt md markdown rst log text readme license nfo'),
  data: words('json jsonc yaml yml csv tsv ndjson'),
  image: words('png jpg jpeg gif webp bmp ico svg avif tif tiff heic'),
  pdf: words('pdf'),
  audio: words('mp3 wav ogg oga flac m4a aac opus wma'),
  video: words('mp4 webm m4v mov ogv mkv avi wmv'),
  archive: words('zip 7z rar tar gz tgz bz2 xz zst cab iso'),
  document: words('doc docx odt rtf pages'),
  sheet: words('xls xlsx ods numbers'),
  slides: words('ppt pptx odp key'),
  executable: words('exe dll msi sys com scr so dylib'),
};

const BY_EXTENSION = new Map<string, FileCategory>();
for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
  for (const extension of extensions) BY_EXTENSION.set(extension, category as FileCategory);
}

/** Lowercase extension without the dot. A leading dot alone (".gitignore") is a name, not an extension. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileCategory(name: string): FileCategory {
  return BY_EXTENSION.get(extensionOf(name)) ?? 'other';
}

/** Every category in a fixed order, so a category can be stored as a small integer. */
export const FILE_CATEGORIES: readonly FileCategory[] = [
  'code', 'text', 'data', 'image', 'pdf', 'audio', 'video', 'archive', 'document', 'sheet', 'slides', 'executable', 'other',
];

const CATEGORY_INDEX = new Map<FileCategory, number>(FILE_CATEGORIES.map((category, index) => [category, index]));

/** Position of the file's category in FILE_CATEGORIES. */
export function fileCategoryIndex(name: string): number {
  return CATEGORY_INDEX.get(fileCategory(name))!;
}

export type PreviewKind = 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'other';

/** Formats the webview can show as pictures, even though some are in the wider "image" category. */
const WEBVIEW_IMAGES = new Set(words('png jpg jpeg gif webp bmp ico svg avif'));
/** Audio and video the webview can decode. Other media falls back to a description card. */
const WEBVIEW_AUDIO = new Set(words('mp3 wav ogg oga flac m4a aac opus'));
const WEBVIEW_VIDEO = new Set(words('mp4 webm m4v mov ogv'));

/** How the preview pane should present a file. Unknown extensions are tried as text. */
export function previewKind(name: string): PreviewKind {
  const extension = extensionOf(name);
  if (WEBVIEW_IMAGES.has(extension)) return 'image';
  if (WEBVIEW_AUDIO.has(extension)) return 'audio';
  if (WEBVIEW_VIDEO.has(extension)) return 'video';
  if (extension === 'pdf') return 'pdf';
  const category = BY_EXTENSION.get(extension);
  if (category === undefined || category === 'code' || category === 'text' || category === 'data') return 'text';
  // Images the webview cannot decode (tif, heic), more media, archives, executables, Office files.
  return 'other';
}

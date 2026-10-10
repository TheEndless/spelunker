<script module lang="ts">
export type IconName =
    | 'search'
    | 'stop'
    | 'folder'
    | 'computer'
    | 'bookmark'
    | 'settings'
    | 'palette'
    | 'help'
    | 'columns'
    | 'export'
    | 'chevron-down'
    | 'chevron-up'
    | 'chevron-left'
    | 'chevron-right'
    | 'close'
    | 'check'
    | 'filter'
    | 'reset'
    | 'copy'
    | 'open'
    | 'file'
    | 'file-code'
    | 'file-text'
    | 'file-data'
    | 'file-image'
    | 'file-pdf'
    | 'file-audio'
    | 'file-video'
    | 'file-archive'
    | 'file-document'
    | 'file-sheet'
    | 'file-slides'
    | 'file-executable';
</script>

<script lang="ts">
  /**
   * Spelunker's own icon set: 16 px glyphs drawn with a 1.5 px round stroke so they stay crisp and
   * take the text color. File-type icons share one page outline with a mark inside.
   */
  interface Props {
    name: IconName;
    size?: number;
    /** Read aloud by assistive technology. Leave out when the icon only decorates a labeled control. */
    label?: string;
  }

  let { name, size = 16, label }: Props = $props();

  const PAGE = 'M4 1.75h5.2L12.5 5v9.25h-8.5z M9.2 1.75V5h3.3';

  const SHAPES: Record<IconName, string> = {
    search: 'M7 12.25a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5z M10.9 10.9l3.35 3.35',
    stop: 'M4 4h8v8H4z',
    folder: 'M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5a1 1 0 0 1 1 1v6.25a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1z',
    computer: 'M2.25 3h11.5v7.25H2.25z M5.5 13h5 M8 10.25V13',
    bookmark: 'M4 1.75h8v12.5L8 11.25l-4 3z',
    settings:
      'M2 4h2.5 M8.5 4H14 M4.5 4a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M2 8h6.5 M12.5 8H14 M8.5 8a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M2 12h1 M7 12h7 M3 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    palette:
      'M8 1.75a6.25 6.25 0 1 0 0 12.5c1 0 1.4-.7 1.1-1.5-.35-.9.15-1.75 1.1-1.75h1.5a2.5 2.5 0 0 0 2.5-2.5C14.2 4.9 11.4 1.75 8 1.75z',
    help: 'M8 14.25a6.25 6.25 0 1 0 0-12.5 6.25 6.25 0 0 0 0 12.5z M6.2 6.2a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.4 M8 11.4v.1',
    columns: 'M2 2.75h12v10.5H2z M6 2.75v10.5 M10 2.75v10.5',
    export: 'M8 10.5V2 M5 4.75L8 1.75l3 3 M2.5 9.5v4h11v-4',
    'chevron-down': 'M4 6.25l4 4 4-4',
    'chevron-up': 'M4 9.75l4-4 4 4',
    'chevron-left': 'M9.75 4l-4 4 4 4',
    'chevron-right': 'M6.25 4l4 4-4 4',
    close: 'M3.75 3.75l8.5 8.5 M12.25 3.75l-8.5 8.5',
    check: 'M3.25 8.5l3 3 6.5-7',
    filter: 'M2 3h12l-4.5 5.5v4.5l-3-1.5V8.5z',
    reset: 'M2.75 8a5.25 5.25 0 1 0 1.6-3.75 M2.75 2.5v2.9h2.9',
    copy: 'M5.5 5.5h7.75v8.75H5.5z M2.75 10.5V1.75h7.75',
    open: 'M6.5 2.75h-3.75v10.5h10.5V9.5 M9 2.75h4.25V7 M13.25 2.75L7.5 8.5',
    file: PAGE,
    'file-code': `${PAGE} M6.9 7.75L5.4 9.4l1.5 1.65 M9.6 7.75l1.5 1.65-1.5 1.65`,
    'file-text': `${PAGE} M6 8h4.5 M6 10h4.5 M6 12h2.75`,
    'file-data': `${PAGE} M6 8.25h4.5 M6 10.25h4.5 M6 12.25h4.5 M8.25 8.25v4`,
    'file-image': `${PAGE} M5.5 12.25l2-2.5 1.5 1.5 1.25-1.25 1.25 2.25 M6.25 7.75v.1`,
    'file-pdf': `${PAGE} M5.75 12v-3.75h1.3a.95.95 0 0 1 0 1.9h-1.3 M9 8.25v3.75 M9 8.25h1.6 M9 10.1h1.2`,
    'file-audio': `${PAGE} M7.2 11.5V8l3-.75v3.5 M7.2 11.5a.9.9 0 1 1-1.8 0 .9.9 0 0 1 1.8 0z M10.2 10.75a.9.9 0 1 1-1.8 0 .9.9 0 0 1 1.8 0z`,
    'file-video': `${PAGE} M5.5 8h3.75v3.75H5.5z M9.25 9.1l1.75-1v3.5l-1.75-1`,
    'file-archive': `${PAGE} M8 6v1 M8 8v1 M8 10v1 M7 12h2`,
    'file-document': `${PAGE} M5.75 8h4.75 M5.75 10h4.75 M5.75 12h3`,
    'file-sheet': `${PAGE} M5.5 8h5 v4h-5z M5.5 10h5 M8 8v4`,
    'file-slides': `${PAGE} M5.5 8h5v3.25h-5z M8 11.25v1.5`,
    'file-executable': `${PAGE} M5.75 7.75l2.25 2-2.25 2 M8.75 12h2.25`,
  };

  const filled = $derived(name === 'stop');
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  <path d={SHAPES[name]} />
</svg>

<script lang="ts">
  import { untrack } from 'svelte';
  import { previewFile, previewSource, readFileText } from './backend';
  import { previewKind } from './fileKinds';
  import FileIcon from './FileIcon.svelte';
  import { formatSize, modifiedLabel } from './format';
  import { highlightSegments } from './highlight';
  import Icon from './Icon.svelte';
  import { matchPosition, stepMatch } from './matchNavigation';
  import { withShortcut } from './shortcuts';
  import type { DisplayRow, FileText, PreviewLine, QueryOptions } from './types';
  import { visibleWindow } from './virtualList';

  interface Props {
    file: DisplayRow | null;
    query: QueryOptions | null;
    includeBinary: boolean;
    contextLines: number;
    onContextLinesChange: (value: number) => void;
    /** Opens the file in the editor chosen in Settings, at a line (1 when unknown). */
    onOpenInEditor: (path: string, line: number) => void;
    onOpen: (row: DisplayRow) => void;
    onReveal: (row: DisplayRow) => void;
    /** Hides the preview. A strip on the right edge brings it back. */
    onCollapse: () => void;
  }

  let { file, query, includeBinary, contextLines, onContextLinesChange, onOpenInEditor, onOpen, onReveal, onCollapse }: Props = $props();

  const MAX_LINE_LENGTH = 400;
  /** Most lines the matches view lists, so a pattern like "e" cannot build a page of millions of rows. */
  const MAX_MATCH_VIEW_LINES = 5000;
  const LINE_HEIGHT = 19;

  type ViewMode = 'matches' | 'file';

  let lines = $state.raw<PreviewLine[]>([]);
  let fileText = $state.raw<FileText | null>(null);
  let loadError = $state<string | null>(null);
  let loading = $state(false);
  let activeHit = $state(-1);
  let mode = $state<ViewMode>('matches');
  let mediaError = $state(false);
  /** Why a picture, PDF, or media file cannot be shown, when the backend refused it. */
  let mediaProblem = $state<string | null>(null);
  /** The address the webview loads the current picture, PDF, or media file from, once it is allowed. */
  let mediaSource = $state<string | null>(null);
  let imageSize = $state<string | null>(null);
  let listing: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let viewportHeight = $state(300);
  /** A line to scroll to once the whole-file view has loaded, for example the one that was clicked. */
  let pendingLine: number | null = null;

  const kind = $derived(file ? previewKind(file.name) : 'other');
  const hasContentQuery = $derived(query !== null && query.text !== '');
  const isText = $derived(file !== null && kind === 'text');
  const cappedLines = $derived(mode === 'matches' && lines.length > MAX_MATCH_VIEW_LINES ? lines.slice(0, MAX_MATCH_VIEW_LINES) : lines);
  const shownLines = $derived<PreviewLine[]>(mode === 'file' ? (fileText?.lines ?? []) : cappedLines);
  const hitLineNumbers = $derived(shownLines.filter((line) => line.isMatch).map((line) => line.lineNumber));
  const hitCount = $derived(hitLineNumbers.length);
  const fileWindow = $derived(
    visibleWindow({ scrollTop, viewportHeight, rowHeight: LINE_HEIGHT, rowCount: fileText?.lines.length ?? 0, overscan: 20 }),
  );
  const visibleFileLines = $derived((fileText?.lines ?? []).slice(fileWindow.start, fileWindow.end));

  // A different file starts fresh: matches when there is a search to show, the whole file otherwise.
  $effect(() => {
    void file?.path;
    void query;
    mode = hasContentQuery ? 'matches' : 'file';
    mediaError = false;
    mediaProblem = null;
    mediaSource = null;
    imageSize = null;
    pendingLine = null;
    activeHit = -1;
    scrollTop = 0;
    untrack(() => {
      if (listing) listing.scrollTop = 0;
    });
  });

  // Pictures, PDFs, audio, and video are loaded by the webview itself, which first needs the backend's permission.
  $effect(() => {
    const path = file?.path;
    const wantsSource = kind === 'image' || kind === 'pdf' || kind === 'audio' || kind === 'video';
    if (!path || !wantsSource) return;
    let stale = false;
    previewSource(path)
      .then((address) => {
        if (!stale) mediaSource = address;
      })
      .catch((error) => {
        if (stale) return;
        mediaError = true;
        mediaProblem = String(error);
      });
    return () => {
      stale = true;
    };
  });

  // Load what the current view needs. Reloads when the file, the search, or the context size changes.
  $effect(() => {
    const path = file?.path;
    const currentQuery = query;
    const context = contextLines;
    const binary = includeBinary;
    const wanted = mode;
    lines = [];
    fileText = null;
    loadError = null;
    loading = false;
    if (!path || !isText) return;
    if (wanted === 'matches' && (!currentQuery || currentQuery.text === '')) return;

    let stale = false;
    loading = true;
    const finished = (apply: () => void) => {
      if (stale) return;
      apply();
      loading = false;
    };
    const onError = (error: unknown) => {
      if (stale) return;
      loadError = String(error);
      loading = false;
    };

    if (wanted === 'matches' && currentQuery) {
      previewFile(path, currentQuery, context, binary)
        .then((result) =>
          finished(() => {
            lines = result;
            if (result.some((line) => line.isMatch)) goToHit(0);
          }),
        )
        .catch(onError);
    } else {
      readFileText(path, currentQuery && currentQuery.text !== '' ? currentQuery : null)
        .then((result) =>
          finished(() => {
            fileText = result;
            queueMicrotask(revealAfterLoad);
          }),
        )
        .catch(onError);
    }
    return () => {
      stale = true;
    };
  });

  function revealAfterLoad() {
    if (pendingLine !== null) {
      scrollToLine(pendingLine);
      pendingLine = null;
    } else if (hitCount > 0) {
      goToHit(0);
    }
  }

  /** F3 and Shift+F3, forwarded from the window, and the previous and next buttons. */
  export function stepHit(direction: 1 | -1) {
    if (hitCount === 0) return;
    goToHit(stepMatch(activeHit, hitCount, direction));
  }

  /** Moves keyboard focus to the lines, so they can be scrolled with the arrow keys. */
  export function focus() {
    const target = listing ?? document.querySelector<HTMLElement>('[data-pane="preview"] .media, [data-pane="preview"] .card, [data-pane="preview"] iframe');
    target?.focus();
  }

  function scrollToLine(lineNumber: number) {
    if (!listing || !fileText) return;
    const index = fileText.lines.findIndex((line) => line.lineNumber === lineNumber);
    if (index < 0) return;
    listing.scrollTop = Math.max(0, index * LINE_HEIGHT - listing.clientHeight / 2);
    scrollTop = listing.scrollTop;
  }

  function goToHit(index: number) {
    activeHit = index;
    if (mode === 'file') {
      queueMicrotask(() => scrollToLine(hitLineNumbers[index]));
    } else {
      queueMicrotask(() => listing?.querySelector('.line.active')?.scrollIntoView({ block: 'center' }));
    }
  }

  function showWholeFile(atLine: number | null) {
    pendingLine = atLine;
    if (atLine !== null) {
      const hitIndex = hitLineNumbers.indexOf(atLine);
      if (hitIndex >= 0) activeHit = hitIndex;
    }
    mode = 'file';
  }

  function startsNewBlock(list: PreviewLine[], index: number): boolean {
    return index > 0 && list[index].lineNumber !== list[index - 1].lineNumber + 1;
  }

  /** The line that "Open in editor" should jump to: the current match, else the top of the file. */
  const editorLine = $derived(hitLineNumbers[activeHit] ?? 1);

  function onImageLoad(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    imageSize = `${image.naturalWidth} × ${image.naturalHeight} px`;
  }
</script>

<aside class="preview" aria-label="Preview" data-pane="preview">
  <!-- Two tiers: what is being shown, then the tools that apply to the current view. -->
  <div class="title">
    <div class="identity">
      {#if file}<FileIcon name={file.name} />{/if}
      <span class="name" title={file?.path ?? ''}>{file ? file.name : 'Preview'}</span>
      {#if file}<span class="where" title={file.folder}><bdi dir="ltr">{file.folder}</bdi></span>{/if}
    </div>
    {#if file}
      <button
        type="button"
        class="tool icon"
        aria-label={isText ? 'Open in editor' : 'Open'}
        title={isText ? `Open in editor at line ${editorLine}` : 'Open'}
        onclick={() => (isText ? onOpenInEditor(file.path, editorLine) : onOpen(file))}
      >
        <Icon name="open" />
      </button>
    {/if}
    <button
      type="button"
      class="tool icon"
      aria-label="Hide the preview"
      title={withShortcut('Hide the preview', 'Ctrl+Shift+P')}
      onclick={onCollapse}
    >
      <Icon name="chevron-right" />
    </button>
  </div>
  {#if isText && (hasContentQuery || mode === 'matches')}
    <div class="viewtools">
      {#if hasContentQuery}
        <span class="modes" role="group" aria-label="What to show">
          <button type="button" class:on={mode === 'matches'} aria-pressed={mode === 'matches'} onclick={() => (mode = 'matches')}>Matches</button>
          <button type="button" class:on={mode === 'file'} aria-pressed={mode === 'file'} onclick={() => showWholeFile(null)}>Whole file</button>
        </span>
        <span class="position" role="status">{loading ? '' : matchPosition(activeHit, hitCount)}</span>
        <span class="steps">
          <button
            type="button"
            aria-label="Previous match"
            title={withShortcut('Previous match', 'Shift+F3')}
            disabled={hitCount === 0}
            onclick={() => stepHit(-1)}><Icon name="chevron-up" size={12} /></button
          >
          <button
            type="button"
            aria-label="Next match"
            title={withShortcut('Next match', 'F3')}
            disabled={hitCount === 0}
            onclick={() => stepHit(1)}><Icon name="chevron-down" size={12} /></button
          >
        </span>
      {/if}
      {#if mode === 'matches'}
        <label class="context">
          Context
          <input
            type="number"
            min="0"
            max="20"
            value={contextLines}
            onchange={(event) => {
              const clamped = Math.min(20, Math.max(0, Number(event.currentTarget.value) || 0));
              event.currentTarget.value = String(clamped);
              onContextLinesChange(clamped);
            }}
          />
        </label>
      {/if}
    </div>
  {/if}

  {#if !file}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="listing" role="region" aria-label="Preview" tabindex="0" bind:this={listing}>
      <p class="note">Select a result to preview it here.</p>
    </div>
  {:else if kind === 'image'}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="media image" role="region" aria-label="Image preview" tabindex="0">
      {#key file.path}
        {#if mediaError}
          <p class="note error">This image could not be displayed.</p>
        {:else}
          {#if mediaSource}<img src={mediaSource} alt={file.name} onload={onImageLoad} onerror={() => (mediaError = true)} />{/if}
        {/if}
      {/key}
      {#if imageSize}<span class="caption">{imageSize} &middot; {formatSize(file.size)}</span>{/if}
    </div>
  {:else if kind === 'pdf'}
    {#key file.path}
      {#if mediaError}
        <p class="note error">{mediaProblem ?? 'This PDF could not be shown.'}</p>
      {:else if mediaSource}
        <iframe class="pdf" title="PDF preview of {file.name}" src={mediaSource}></iframe>
      {/if}
    {/key}
  {:else if kind === 'audio' || kind === 'video'}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="media" role="region" aria-label="{kind === 'audio' ? 'Audio' : 'Video'} preview" tabindex="0">
      {#key file.path}
        {#if mediaError}
          <p class="note error">The system cannot play this file here. Use Open to play it in another app.</p>
        {:else if kind === 'audio'}
          <FileIcon name={file.name} size={48} />
          <!-- svelte-ignore a11y_media_has_caption -->
          <audio controls src={mediaSource ?? undefined} onerror={() => (mediaError = true)}></audio>
        {:else}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video controls src={mediaSource ?? undefined} onerror={() => (mediaError = true)}></video>
        {/if}
      {/key}
    </div>
  {:else if kind === 'other' || fileText?.binary}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="card" role="region" aria-label="File details" tabindex="0">
      <FileIcon name={file.name} size={56} />
      <h3>{file.name}</h3>
      <dl>
        <dt>Type</dt>
        <dd>{file.typeName}</dd>
        <dt>Size</dt>
        <dd>{formatSize(file.size)}</dd>
        <dt>Modified</dt>
        <dd>{modifiedLabel(file) || 'Unknown'}</dd>
        <dt>Location</dt>
        <dd class="path">{file.folder}</dd>
      </dl>
      <p class="note">There is no text to preview for this kind of file.</p>
      <div class="actions">
        <button type="button" class="tool" onclick={() => onOpen(file)}><Icon name="open" /> Open</button>
        <button type="button" class="tool" onclick={() => onReveal(file)}><Icon name="folder" /> Show in folder</button>
      </div>
    </div>
  {:else}
    <!-- A scrolling region must be reachable by keyboard, otherwise its content cannot be read or scrolled. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="listing mono"
      class:virtual={mode === 'file'}
      role="region"
      aria-label={mode === 'file' ? `Contents of ${file.name}` : `Matching lines in ${file.name}`}
      tabindex="0"
      bind:this={listing}
      bind:clientHeight={viewportHeight}
      onscroll={() => mode === 'file' && listing && (scrollTop = listing.scrollTop)}
    >
      {#if loadError}
        <p class="note error">{loadError}</p>
      {:else if loading}
        <p class="note">Loading...</p>
      {:else if mode === 'matches'}
        {#if lines.length === 0}
          <p class="note">No matching lines to show.</p>
        {:else}
          {#each cappedLines as line, index (line.lineNumber)}
            {#if startsNewBlock(cappedLines, index)}<div class="gap" aria-hidden="true">&middot;&middot;&middot;</div>{/if}
            <!-- Clicking a line is a shortcut for the whole-file view and double-clicking opens the editor,
                 and both have keyboard equivalents in the toolbar above. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div
              class="line"
              class:match={line.isMatch}
              class:active={line.isMatch && hitLineNumbers[activeHit] === line.lineNumber}
              title="Click to see this line in the whole file. Double-click to open it in your editor."
              onclick={() => showWholeFile(line.lineNumber)}
              ondblclick={() => onOpenInEditor(file.path, line.lineNumber)}
            >
              <span class="number">{line.lineNumber}</span>
              <span class="text">
                {#each highlightSegments(line.text, line.matchRanges, MAX_LINE_LENGTH) as segment, segmentIndex (segmentIndex)}
                  {#if segment.match}<mark>{segment.text}</mark>{:else}{segment.text}{/if}
                {/each}
              </span>
            </div>
          {/each}
          {#if lines.length > MAX_MATCH_VIEW_LINES}
            <p class="note">Showing the first {MAX_MATCH_VIEW_LINES.toLocaleString('en-US')} lines. Use Whole file to see the rest.</p>
          {/if}
        {/if}
      {:else if fileText}
        {#if fileText.lines.length === 0}
          <p class="note">This file is empty.</p>
        {:else}
          <div class="canvas" style:height="{fileWindow.totalHeight}px">
            <div class="window" style:transform="translateY({fileWindow.offsetY}px)">
              {#each visibleFileLines as line (line.lineNumber)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="line fixed"
                  class:match={line.isMatch}
                  class:active={line.isMatch && hitLineNumbers[activeHit] === line.lineNumber}
                  style:height="{LINE_HEIGHT}px"
                  ondblclick={() => onOpenInEditor(file.path, line.lineNumber)}
                >
                  <span class="number">{line.lineNumber}</span>
                  <span class="text">
                    {#each highlightSegments(line.text, line.matchRanges, MAX_LINE_LENGTH) as segment, segmentIndex (segmentIndex)}
                      {#if segment.match}<mark>{segment.text}</mark>{:else}{segment.text}{/if}
                    {/each}
                  </span>
                </div>
              {/each}
            </div>
          </div>
          {#if fileText.truncated}
            <p class="note">Only the beginning of this large file is shown.</p>
          {/if}
        {/if}
      {/if}
    </div>
  {/if}
</aside>

<style>
  .preview {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-left: 1px solid var(--border);
    min-width: 0;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    height: 38px;
    background: var(--header-bg);
    border-bottom: 1px solid var(--border);
  }
  .identity {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    min-width: 0;
  }
  .name {
    flex: none;
    max-width: 60%;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .where {
    flex: 1;
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--text-small);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }
  .viewtools {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    min-height: 32px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .position {
    color: var(--text-muted);
    font-size: var(--text-small);
    white-space: nowrap;
  }
  .steps {
    display: inline-flex;
    gap: 2px;
  }
  .context {
    margin-left: auto;
  }
  .steps button {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    color: var(--text-muted);
  }
  .steps button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--text);
  }
  .steps button:disabled {
    background: var(--disabled-bg);
    color: var(--disabled-text);
    cursor: not-allowed;
  }
  .modes {
    display: inline-flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .modes button {
    height: 24px;
    padding: 0 9px;
    border: 0;
    background: var(--surface);
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .modes button + button {
    border-left: 1px solid var(--border-strong);
  }
  .modes button.on {
    background: var(--accent);
    color: var(--on-accent);
  }
  .context {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .context input {
    width: 54px;
    padding: 2px 6px;
  }
  .listing {
    flex: 1;
    overflow: auto;
    padding: 6px 0;
    font-size: 12.5px;
    min-height: 0;
  }
  .listing.virtual {
    padding: 0;
  }
  .listing:focus-visible {
    outline-offset: -2px;
  }
  .note {
    margin: 0;
    padding: 20px 14px;
    color: var(--text-muted);
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  }
  .note.error {
    color: var(--danger);
  }
  .line {
    display: flex;
    gap: 10px;
    padding: 1px 10px;
    color: var(--context-text);
    white-space: pre;
    cursor: default;
  }
  .line.fixed {
    align-items: center;
    padding-top: 0;
    padding-bottom: 0;
  }
  .line.match {
    color: var(--text);
  }
  .line.active {
    background: var(--row-selected);
    box-shadow: inset 3px 0 0 var(--row-selected-edge);
  }
  .line:hover:not(.active) {
    background: var(--row-hover);
  }
  .number {
    flex: none;
    width: 5ch;
    text-align: right;
    color: var(--text-muted);
    user-select: none;
  }
  .gap {
    padding: 2px 10px 2px 58px;
    color: var(--text-muted);
    user-select: none;
  }
  .canvas {
    position: relative;
    min-width: max-content;
  }
  .media {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px;
    overflow: auto;
  }
  .media.image {
    /* A quiet checkerboard shows transparent areas of a picture. */
    background-color: var(--surface);
    background-image:
      linear-gradient(45deg, var(--row-hover) 25%, transparent 25%, transparent 75%, var(--row-hover) 75%),
      linear-gradient(45deg, var(--row-hover) 25%, transparent 25%, transparent 75%, var(--row-hover) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
  }
  .media img {
    max-width: 100%;
    max-height: calc(100% - 28px);
    object-fit: contain;
    border-radius: 3px;
  }
  .media video {
    max-width: 100%;
    max-height: 100%;
  }
  .media audio {
    width: 100%;
  }
  .caption {
    padding: 2px 8px;
    border-radius: var(--radius);
    background: var(--surface-raised);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .pdf {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: 0;
    background: var(--surface);
  }
  .card {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 28px 20px;
    text-align: center;
  }
  .card h3 {
    margin: 4px 0 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    font-size: 15px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 14px;
    margin: 6px 0;
    text-align: left;
    max-width: 100%;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
</style>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { countLines, previewFile, previewSource, readLines } from './backend';
  import { previewKind } from './fileKinds';
  import FileIcon from './FileIcon.svelte';
  import { formatSize, modifiedLabel } from './format';
  import { highlightSegments } from './highlight';
  import Icon from './Icon.svelte';
  import { matchPosition, stepMatch } from './matchNavigation';
  import { addLines, firstMissingLine, gapLabel, hitLineNumbers, rangeToLoad, rowIndexOfLine, rowsOf, type Expand, type Gap, type Run } from './sections';
  import { withShortcut } from './shortcuts';
  import type { DisplayRow, PreviewLine, QueryOptions } from './types';
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
  const LINE_HEIGHT = 19;
  /** The icon above a file the preview cannot show. It is the size of the system's large icon, so it stays sharp. */
  const CARD_ICON_SIZE = 32;
  /** Lines read first when there is no search. */
  const FIRST_CHUNK_LINES = 1000;
  /** A file of this many lines or fewer is loaded whole by the whole-file view. A longer one is loaded as it is scrolled or asked for. */
  const WHOLE_FILE_LINES = 50_000;
  /** Lines one click on a gap's buttons loads. */
  const EXPAND_LINES = 200;
  /** The most lines of a gap that "Show all" is offered for. */
  const SHOW_ALL_LINES = 5000;
  /** Lines loaded after the end of the file as the end of what is loaded is scrolled into view. */
  const SCROLL_LOAD_LINES = 1000;
  /** Lines loaded on each side of a line that is jumped to. */
  const AROUND_JUMPED_LINE = 100;
  /** A file needs this many lines before the line box is worth showing. */
  const LINE_BOX_MIN_LINES = 500;
  /** Loading by itself stops once this many characters are held, so a file of very long lines cannot fill memory. */
  const MAX_LOADED_CHARACTERS = 64 * 1024 * 1024;

  type ViewMode = 'matches' | 'file';

  /** The lines that are loaded. See sections.ts. */
  let runs = $state.raw<Run[]>([]);
  /** The matches with their context as the search found them, kept so the matches view can come back. */
  let matchRuns = $state.raw<Run[]>([]);
  /** How many lines the file has, once counted. */
  let totalLines = $state<number | null>(null);
  /** The search found more matches than the preview lists. */
  let matchesTruncated = $state(false);
  /** The file is not text. */
  let isBinary = $state(false);
  let loadError = $state<string | null>(null);
  /** Why lines asked for after the first load could not be read. */
  let fillError = $state<string | null>(null);
  let loading = $state(false);
  let loadingMore = $state(false);
  /** The first line being loaded, so the gap it is in can say so. */
  let loadingFromLine = $state<number | null>(null);
  /** Scrolling to the end of what is loaded found nothing more to load, so it stops trying. */
  let scrollLoadStalled = $state(false);
  let activeHit = $state(-1);
  /** The line last jumped to with the line box, marked until another hit or line is chosen. */
  let targetLine = $state<number | null>(null);
  let lineInput = $state<number | null>(null);
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
  let viewportWidth = $state(300);
  /** A line to scroll to once the whole-file view has loaded, for example the one that was clicked. */
  let pendingLine: number | null = null;
  /** Counts the files and searches shown, so an answer that comes late for an earlier one is dropped. */
  let generation = 0;
  /** The length of the file being shown, as a promise, so the first load and filling the file can share it. */
  let lengthOfFile: Promise<number | null> = Promise.resolve(null);
  let loadedCharacters = 0;

  const kind = $derived(file ? previewKind(file.name) : 'other');
  const activeQuery = $derived(query !== null && query.text !== '' ? query : null);
  const hasContentQuery = $derived(activeQuery !== null);
  const isText = $derived(file !== null && kind === 'text');
  /** Text is shown for it: a file read as text, or the words taken out of a document or an archive. */
  const showsText = $derived(isText || (file !== null && kind === 'extracted'));
  const rows = $derived(rowsOf(runs, totalLines));
  const hitNumbers = $derived(hitLineNumbers(runs));
  const hitCount = $derived(hitNumbers.length);
  /** Matches follow the ones listed, unless the whole file is loaded and so every match in it is known. */
  const moreMatches = $derived(matchesTruncated && !(totalLines !== null && firstMissingLine(runs, totalLines) === null));
  const rowWindow = $derived(visibleWindow({ scrollTop, viewportHeight, rowHeight: LINE_HEIGHT, rowCount: rows.length, overscan: 20 }));
  const visibleRows = $derived(rows.slice(rowWindow.start, rowWindow.end));
  const canGoToLine = $derived(totalLines !== null && totalLines >= LINE_BOX_MIN_LINES);
  /** The line that "Open in editor" should jump to: the line jumped to, else the current match, else the top of the file. */
  const editorLine = $derived(targetLine ?? hitNumbers[activeHit] ?? 1);

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
    targetLine = null;
    lineInput = null;
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

  // Load what the view starts with: the matches when there is a search, the start of the file otherwise.
  // Reloads when the file, the search, or the context size changes.
  $effect(() => {
    const path = file?.path;
    const searched = activeQuery;
    const context = contextLines;
    const binary = includeBinary;
    generation++;
    const mine = generation;
    runs = [];
    matchRuns = [];
    totalLines = null;
    matchesTruncated = false;
    isBinary = false;
    loadError = null;
    fillError = null;
    loading = false;
    loadingMore = false;
    loadingFromLine = null;
    scrollLoadStalled = false;
    loadedCharacters = 0;
    lengthOfFile = Promise.resolve(null);
    if (!path || !showsText) return;

    loading = true;
    lengthOfFile = countLines(path).catch(() => null);
    void lengthOfFile.then((length) => {
      if (mine === generation) totalLines = length;
    });
    const first = searched ? previewFile(path, searched, context, binary) : readLines(path, null, 1, FIRST_CHUNK_LINES);
    first
      .then((result) => {
        if (mine !== generation) return;
        isBinary = result.binary;
        runs = addLines([], result.lines);
        matchRuns = runs;
        matchesTruncated = searched !== null && result.truncated;
        loading = false;
        if (searched) void revealAfterLoad();
        else void fillWholeFile();
      })
      .catch((error) => {
        if (mine !== generation) return;
        loadError = String(error);
        loading = false;
      });
    return () => {
      generation++;
    };
  });

  // Scrolling the end of what is loaded into view loads the lines after it, so a long file can be read on down.
  $effect(() => {
    if (mode !== 'file' || loading || loadingMore || scrollLoadStalled || fillError !== null) return;
    const lastIndex = rows.length - 1;
    const last = rows[lastIndex];
    if (last?.kind !== 'gap' || lastIndex < rowWindow.start || lastIndex >= rowWindow.end) return;
    const gap: Gap = { from: last.from, to: last.to };
    untrack(() => {
      void loadRange(gap.from, Math.min(gap.to, gap.from + SCROLL_LOAD_LINES - 1)).then((added) => {
        if (added === 0) scrollLoadStalled = true;
      });
    });
  });

  /**
   * Loads lines `first` to `last` and adds them to what is shown, as many requests as the preview's size
   * limit makes it take. Resolves with how many lines came back.
   */
  async function loadRange(first: number, last: number): Promise<number> {
    const path = file?.path;
    if (!path) return 0;
    const mine = generation;
    const searched = activeQuery;
    let received = 0;
    loadingMore = true;
    loadingFromLine = first;
    try {
      let next = first;
      while (next <= last && loadedCharacters < MAX_LOADED_CHARACTERS) {
        const result = await readLines(path, searched, next, last - next + 1);
        if (mine !== generation) return received;
        if (result.lines.length === 0) break;
        received += result.lines.length;
        loadedCharacters += result.lines.reduce((sum, line) => sum + line.text.length, 0);
        runs = addLines(runs, result.lines);
        next = result.lines[result.lines.length - 1].lineNumber + 1;
        if (!result.truncated) break;
      }
    } catch (error) {
      if (mine === generation) fillError = String(error);
    } finally {
      if (mine === generation) {
        loadingMore = false;
        loadingFromLine = null;
      }
    }
    return received;
  }

  /**
   * Fills in the lines the whole-file view shows. A file that is not long is loaded whole, a long one
   * from its start, unless a line was asked for: that line is shown where it is, and the rest is a gap.
   */
  async function fillWholeFile(): Promise<void> {
    const mine = generation;
    const length = await lengthOfFile;
    if (mine !== generation) return;
    let target = Math.min(FIRST_CHUNK_LINES, length ?? FIRST_CHUNK_LINES);
    if (length !== null && length <= WHOLE_FILE_LINES) target = length;
    else if (pendingLine !== null) target = 0;
    const start = firstMissingLine(runs, target);
    if (start !== null) await loadRange(start, target);
    if (mine !== generation) return;
    await revealAfterLoad();
  }

  async function revealAfterLoad() {
    await tick();
    if (pendingLine !== null) {
      scrollToLine(pendingLine);
      pendingLine = null;
    } else if (hitCount > 0) {
      goToHit(Math.min(Math.max(activeHit, 0), hitCount - 1));
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
    if (!listing) return;
    const index = rowIndexOfLine(rows, lineNumber);
    if (index < 0) return;
    listing.scrollTop = Math.max(0, index * LINE_HEIGHT - listing.clientHeight / 2);
    scrollTop = listing.scrollTop;
  }

  function goToHit(index: number) {
    activeHit = index;
    targetLine = null;
    scrollToLine(hitNumbers[index]);
  }

  async function showMatches() {
    mode = 'matches';
    runs = matchRuns;
    await tick();
    if (listing) listing.scrollTop = 0;
    scrollTop = 0;
    if (hitCount > 0) goToHit(Math.min(Math.max(activeHit, 0), hitCount - 1));
  }

  async function showWholeFile(atLine: number | null) {
    pendingLine = atLine;
    if (atLine !== null) {
      const hitIndex = hitNumbers.indexOf(atLine);
      if (hitIndex >= 0) activeHit = hitIndex;
    }
    mode = 'file';
    await fillWholeFile();
  }

  /** Shows more of a gap: the lines after what is above it, the lines before what is below it, or all of it. */
  async function expand(gap: Gap, how: Expand) {
    const { first, count } = rangeToLoad(gap, how, EXPAND_LINES);
    const added = await loadRange(first, first + count - 1);
    // New lines above the button push it down, so scroll with them and it stays under the pointer.
    if (how === 'below' && listing) {
      await tick();
      listing.scrollTop += added * LINE_HEIGHT;
      scrollTop = listing.scrollTop;
    }
  }

  async function goToLine() {
    if (lineInput === null || !Number.isFinite(lineInput) || lineInput < 1) return;
    const target = Math.min(Math.floor(lineInput), totalLines ?? Math.floor(lineInput));
    targetLine = target;
    if (rowIndexOfLine(rows, target) < 0) {
      const last = Math.min(totalLines ?? Infinity, target + AROUND_JUMPED_LINE);
      await loadRange(Math.max(1, target - AROUND_JUMPED_LINE), last);
    }
    await tick();
    scrollToLine(target);
  }

  function isSmallGap(gap: Gap): boolean {
    return gap.to - gap.from + 1 <= EXPAND_LINES;
  }

  /** A line is a place in a text file for an editor, but an Office file has no such place, so it is simply opened. */
  function openAtLine(line: number) {
    if (!file) return;
    if (isText) onOpenInEditor(file.path, line);
    else onOpen(file);
  }

  /** How long a line that was cut to a window is in all, for its label. */
  function clippedSize(line: PreviewLine): string {
    const clip = line.clip;
    return clip ? formatSize(line.text.length + clip.beforeBytes + clip.afterBytes) : '';
  }

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
  {#if showsText && !isBinary && (hasContentQuery || canGoToLine)}
    <div class="viewtools">
      {#if hasContentQuery}
        <span class="modes" role="group" aria-label="What to show">
          <button type="button" class:on={mode === 'matches'} aria-pressed={mode === 'matches'} onclick={showMatches}>Matches</button>
          <button type="button" class:on={mode === 'file'} aria-pressed={mode === 'file'} onclick={() => showWholeFile(null)}>Whole file</button>
        </span>
        <span class="position" role="status">{loading ? '' : matchPosition(activeHit, hitCount, moreMatches)}</span>
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
      <span class="right">
        {#if canGoToLine}
          <form
            class="goto"
            onsubmit={(event) => {
              event.preventDefault();
              void goToLine();
            }}
          >
            <label>
              Line
              <input type="number" min="1" max={totalLines ?? undefined} placeholder={`1 to ${totalLines?.toLocaleString('en-US')}`} bind:value={lineInput} />
            </label>
          </form>
        {/if}
        {#if hasContentQuery && mode === 'matches'}
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
      </span>
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
        <!-- No sandbox attribute: WebView2 will not draw a PDF inside a sandboxed frame (it shows the
             blocked-content icon). What keeps a page out of this frame instead is that allow_preview
             accepts a ".pdf" only when the file begins with the PDF header, and the CSP limits frames
             to the asset origin. -->
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
          <FileIcon name={file.name} size={CARD_ICON_SIZE} />
          <!-- svelte-ignore a11y_media_has_caption -->
          <audio controls src={mediaSource ?? undefined} onerror={() => (mediaError = true)}></audio>
        {:else}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video controls src={mediaSource ?? undefined} onerror={() => (mediaError = true)}></video>
        {/if}
      {/key}
    </div>
  {:else if kind === 'other' || isBinary}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="card" role="region" aria-label="File details" tabindex="0">
      <FileIcon name={file.name} size={CARD_ICON_SIZE} />
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
      class="listing mono virtual"
      role="region"
      aria-label={mode === 'file' ? `Contents of ${file.name}` : `Matching lines in ${file.name}`}
      tabindex="0"
      bind:this={listing}
      bind:clientHeight={viewportHeight}
      bind:clientWidth={viewportWidth}
      onscroll={() => listing && (scrollTop = listing.scrollTop)}
    >
      {#if loadError}
        <p class="note error">{loadError}</p>
      {:else if loading}
        <p class="note">Loading...</p>
      {:else if runs.length === 0}
        <p class="note">{mode === 'matches' ? 'No matching lines to show.' : 'This file is empty.'}</p>
      {:else}
        <div class="canvas" style:height="{rowWindow.totalHeight}px">
          <div class="window" style:transform="translateY({rowWindow.offsetY}px)">
            {#each visibleRows as row (row.kind === 'line' ? row.line.lineNumber : `gap-${row.from}`)}
              {#if row.kind === 'gap'}
                {@const size = row.to - row.from + 1}
                {@const busy = loadingFromLine !== null && loadingFromLine >= row.from && loadingFromLine <= row.to}
                <div
                  class="gapbar"
                  class:busy
                  style:height="{LINE_HEIGHT}px"
                  style:width="{viewportWidth}px"
                  role="group"
                  aria-label={gapLabel(row)}
                  aria-busy={busy}
                >
                  <span class="number" aria-hidden="true">&middot;&middot;&middot;</span>
                  <span class="gaplabel" role={busy ? 'status' : undefined}>{busy ? 'Loading lines...' : gapLabel(row)}</span>
                  <!-- The bar says it is loading in place of its buttons, so the words have the room in a narrow pane. -->
                  {#if !busy}
                    {#if isSmallGap(row)}
                      <button type="button" disabled={loadingMore} onclick={() => expand(row, 'all')}>Show {size === 1 ? 'it' : 'all'}</button>
                    {:else}
                      <button type="button" disabled={loadingMore} onclick={() => expand(row, 'below')}>Show next {EXPAND_LINES}</button>
                      <button type="button" disabled={loadingMore} onclick={() => expand(row, 'above')}>Show previous {EXPAND_LINES}</button>
                      {#if size <= SHOW_ALL_LINES}
                        <button type="button" disabled={loadingMore} onclick={() => expand(row, 'all')}>Show all</button>
                      {/if}
                    {/if}
                  {/if}
                </div>
              {:else}
                {@const line = row.line}
                <!-- Clicking a match line is a shortcut for the whole-file view and double-clicking opens the editor,
                     and both have keyboard equivalents in the toolbar above. -->
                <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                <div
                  class="line fixed"
                  class:match={line.isMatch}
                  class:active={line.isMatch && hitNumbers[activeHit] === line.lineNumber}
                  class:target={targetLine === line.lineNumber}
                  style:height="{LINE_HEIGHT}px"
                  title={mode === 'matches'
                    ? `Click to see this line in the whole file. Double-click to open ${isText ? 'it in your editor' : 'the file'}.`
                    : undefined}
                  onclick={() => mode === 'matches' && showWholeFile(line.lineNumber)}
                  ondblclick={() => openAtLine(line.lineNumber)}
                >
                  <span class="number">{line.lineNumber}</span>
                  <span class="text">
                    {#each highlightSegments(line.text, line.matchRanges, MAX_LINE_LENGTH) as segment, segmentIndex (segmentIndex)}
                      {#if segment.match}<mark>{segment.text}</mark>{:else}{segment.text}{/if}
                    {/each}
                  </span>
                  {#if line.clip}
                    <span class="clipped" title="This line is about {clippedSize(line)} long. Only part of it is shown here. Double-click to open the file.">
                      {clippedSize(line)} line
                    </span>
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
        </div>
        {#if fillError}
          <p class="note error">{fillError}</p>
        {/if}
        {#if moreMatches}
          <p class="note">The search found more matches than are listed here. Open the file in your editor to see the rest.</p>
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
  .right {
    display: inline-flex;
    align-items: center;
    gap: 12px;
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
  .context,
  .goto label {
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
  .goto input {
    width: 96px;
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
  .line.target:not(.active) {
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .line:hover:not(.active) {
    background: var(--row-hover);
  }
  .text,
  dd,
  h3 {
    user-select: text;
  }
  .number {
    flex: none;
    width: 5ch;
    text-align: right;
    color: var(--text-muted);
    user-select: none;
  }
  /* Kept at the right edge of the visible list, since the line it labels runs far past it. */
  .clipped {
    flex: none;
    align-self: center;
    position: sticky;
    right: 0;
    margin-left: auto;
    padding: 0 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    font-size: var(--text-small);
    line-height: 15px;
    user-select: none;
  }
  /* As wide as the visible part of the list and kept at its left edge, so the buttons stay in reach
     when a long line has scrolled the list sideways. The label gives way first. */
  .gapbar {
    position: sticky;
    left: 0;
    box-sizing: border-box;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
    color: var(--text-muted);
    background: var(--header-bg);
    border-block: 1px solid var(--border);
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    font-size: var(--text-small);
    white-space: nowrap;
    user-select: none;
  }
  /* A light band sweeps along the bar while its lines load, which can take seconds in a huge file. */
  .gapbar.busy {
    background-image: linear-gradient(90deg, transparent, var(--row-selected), transparent);
    background-repeat: no-repeat;
    background-size: 40% 100%;
    animation: gap-loading 1.2s linear infinite;
  }
  @keyframes gap-loading {
    from {
      background-position: -40% 0;
    }
    to {
      background-position: 140% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .gapbar.busy {
      animation: none;
      background-position: 50% 0;
    }
  }
  .gaplabel {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gapbar button {
    flex: none;
    height: 15px;
    padding: 0 7px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 11px;
    line-height: 13px;
  }
  .gapbar button:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .gapbar button:disabled {
    background: var(--disabled-bg);
    color: var(--disabled-text);
    cursor: not-allowed;
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

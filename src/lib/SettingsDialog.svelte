<script lang="ts">
  import { onMount } from 'svelte';
  import { setShellIntegration, shellIntegrationEnabled } from './backend';
  import { EDITOR_CHOICES } from './editors';
  import { focusScope } from './focusScope';
  import Icon from './Icon.svelte';
  import type { Preferences } from './preferences.svelte';
  import type { Shading } from './treemapPaint';

  interface Props {
    preferences: Preferences;
    onClose: () => void;
  }

  let { preferences, onClose }: Props = $props();

  const FALLBACK_HIGHLIGHT = '#FFE08A';
  const SHADING_CHOICES: { id: Shading; label: string }[] = [
    { id: 'cushion', label: 'Cushion' },
    { id: 'flat', label: 'Flat' },
  ];
  const MAX_CONTEXT_LINES = 20;

  let dialog: HTMLDivElement;
  let explorerEntry = $state(false);
  let explorerReady = $state(false);
  let explorerError = $state<string | null>(null);

  const choice = $derived(EDITOR_CHOICES.find((candidate) => candidate.id === preferences.editor.id));

  onMount(() => {
    void shellIntegrationEnabled().then((enabled) => {
      explorerEntry = enabled;
      explorerReady = true;
    });
  });

  async function changeExplorerEntry(box: HTMLInputElement) {
    const enabled = box.checked;
    explorerError = null;
    try {
      await setShellIntegration(enabled);
      explorerEntry = enabled;
    } catch (error) {
      explorerError = String(error);
      // The state did not change, but the box the user just clicked has, and Svelte would not redraw it.
      box.checked = !enabled;
      explorerEntry = !enabled;
    }
  }

  function chooseEditor(id: (typeof EDITOR_CHOICES)[number]['id']) {
    preferences.editor = { ...preferences.editor, id };
    preferences.save();
  }

  function chooseShading(shading: Shading) {
    preferences.mapShading = shading;
    preferences.save();
  }

  function setCustomTemplate(customTemplate: string) {
    preferences.editor = { ...preferences.editor, customTemplate };
    preferences.save();
  }

  function setHighlight(color: string | null) {
    preferences.highlightColor = color;
    preferences.saveSoon();
  }

  function setContextLines(value: number) {
    preferences.contextLines = Math.min(MAX_CONTEXT_LINES, Math.max(0, Math.round(value) || 0));
    preferences.save();
  }

  // Escape is read in the capture phase so it closes only this dialog and never stops a running search.
  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  /** The dialog is modal, so Tab wraps inside it instead of reaching the page behind. */
  function onDialogKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])'),
    ].filter((element) => element.tabIndex >= 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  }
</script>

<svelte:window onkeydowncapture={onWindowKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onpointerdown={(event) => event.target === event.currentTarget && onClose()}>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
    tabindex="-1"
    bind:this={dialog}
    use:focusScope={{ initial: 'input' }}
    onkeydown={onDialogKeydown}
  >
    <header>
      <h2 id="settings-title">Settings</h2>
      <button type="button" class="tool icon" aria-label="Close settings" title="Close (Esc)" onclick={onClose}>
        <Icon name="close" />
      </button>
    </header>

    <section aria-labelledby="editor-heading">
      <h3 id="editor-heading">Open in editor</h3>
      <p class="help">Double-click a line in the preview to open the file at that line.</p>
      <div class="choices" role="radiogroup" aria-labelledby="editor-heading">
        {#each EDITOR_CHOICES as candidate (candidate.id)}
          <label>
            <input
              type="radio"
              name="editor"
              checked={preferences.editor.id === candidate.id}
              onchange={() => chooseEditor(candidate.id)}
            />
            {candidate.label}
          </label>
        {/each}
      </div>
      {#if preferences.editor.id === 'custom'}
        <label class="field">
          <span>Command</span>
          <input
            type="text"
            class="mono"
            spellcheck="false"
            placeholder={'myeditor.exe +{line} "{path}"'}
            value={preferences.editor.customTemplate}
            oninput={(event) => setCustomTemplate(event.currentTarget.value)}
          />
        </label>
      {/if}
      {#if choice}<p class="help">{choice.hint}</p>{/if}
    </section>

    <section aria-labelledby="highlight-heading">
      <h3 id="highlight-heading">Match highlight</h3>
      <div class="inline">
        <input
          type="color"
          aria-label="Highlight color"
          value={preferences.highlightColor ?? FALLBACK_HIGHLIGHT}
          oninput={(event) => setHighlight(event.currentTarget.value)}
        />
        <span class="sample" aria-hidden="true"><mark>match</mark></span>
        <button type="button" class="tool" disabled={preferences.highlightColor === null} onclick={() => setHighlight(null)}>
          <Icon name="reset" /> Use the theme's color
        </button>
      </div>
    </section>

    <section aria-labelledby="preview-heading">
      <h3 id="preview-heading">Preview</h3>
      <label class="inline">
        Lines of context around each match
        <input
          type="number"
          min="0"
          max={MAX_CONTEXT_LINES}
          value={preferences.contextLines}
          onchange={(event) => setContextLines(Number(event.currentTarget.value))}
        />
      </label>
    </section>

    <section aria-labelledby="shading-heading">
      <h3 id="shading-heading">Map shading</h3>
      <div class="choices" role="radiogroup" aria-labelledby="shading-heading">
        {#each SHADING_CHOICES as candidate (candidate.id)}
          <label>
            <input
              type="radio"
              name="map-shading"
              checked={preferences.mapShading === candidate.id}
              onchange={() => chooseShading(candidate.id)}
            />
            {candidate.label}
          </label>
        {/each}
      </div>
      <p class="help">Cushion lights each tile from the top left, so files and folders stand apart. Flat fills each tile with one color.</p>
    </section>

    <section aria-labelledby="explorer-heading">
      <h3 id="explorer-heading">Windows Explorer</h3>
      <label class="check">
        <input
          type="checkbox"
          checked={explorerEntry}
          disabled={!explorerReady}
          onchange={(event) => changeExplorerEntry(event.currentTarget)}
        />
        Add "Search with Spelunker" to the right-click menu of folders, drives, and This PC
      </label>
      <p class="help">
        For your account only, no administrator rights needed. On Windows 11 it appears under "Show more options".
      </p>
      {#if explorerError}<p class="problem" role="alert">{explorerError}</p>{/if}
    </section>

    <footer>
      <button type="button" class="primary" onclick={onClose}>Done</button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
  }
  .dialog {
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow: auto;
    padding: 16px 18px 14px;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: var(--shadow);
    display: grid;
    gap: 14px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  h3 {
    margin: 0 0 6px;
    font-size: var(--text-small);
    font-weight: 700;
    color: var(--text-muted);
  }
  section {
    display: grid;
    gap: 6px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .help {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 12px;
  }
  .choices label,
  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field span {
    font-size: var(--text-small);
    font-weight: 600;
    color: var(--text-muted);
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  input[type='number'] {
    width: 64px;
  }
  input[type='color'] {
    width: 40px;
    height: 28px;
    padding: 2px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    cursor: pointer;
  }
  .sample mark {
    padding: 2px 8px;
    border-radius: 3px;
  }
  .problem {
    margin: 0;
    color: var(--danger);
    font-weight: 600;
    font-size: var(--text-small);
  }
  footer {
    display: flex;
    justify-content: flex-end;
  }
  .primary {
    min-width: 88px;
    height: var(--control-height);
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .primary:hover {
    background: var(--accent-hover);
  }
</style>

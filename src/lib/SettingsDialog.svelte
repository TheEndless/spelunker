<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { appVersion, copyText, openReleasePage, setShellIntegration, shellIntegrationEnabled } from './backend';
  import { versionReport, webViewVersion } from './aboutInfo';
  import { EDITOR_CHOICES } from './editors';
  import { focusScope } from './focusScope';
  import Icon from './Icon.svelte';
  import type { Preferences } from './preferences.svelte';
  import { tabAfterKey } from './tabKeys';
  import ThemeChoices from './ThemeChoices.svelte';
  import type { Shading } from './treemapPaint';
  import type { UpdateChecker } from './updates.svelte';
  import { checkedAgo } from './updatePolicy';

  interface Props {
    preferences: Preferences;
    updates: UpdateChecker;
    onClose: () => void;
  }

  let { preferences, updates, onClose }: Props = $props();

  const SHADING_CHOICES: { id: Shading; label: string }[] = [
    { id: 'cushion', label: 'Cushion' },
    { id: 'facet', label: 'Facet' },
    { id: 'flat', label: 'Flat' },
  ];
  const MAX_CONTEXT_LINES = 20;

  const TABS = [
    { id: 'files', label: 'Files' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'about', label: 'About' },
  ] as const;
  type TabId = (typeof TABS)[number]['id'];

  let dialog: HTMLDivElement;
  let activeTab = $state<TabId>('files');
  let explorerEntry = $state(false);
  let explorerReady = $state(false);
  let explorerError = $state<string | null>(null);
  let version = $state('');
  let confirmingReset = $state(false);
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  const choice = $derived(EDITOR_CHOICES.find((candidate) => candidate.id === preferences.editor.id));
  const engine = webViewVersion(navigator.userAgent);

  onMount(() => {
    void shellIntegrationEnabled().then((enabled) => {
      explorerEntry = enabled;
      explorerReady = true;
    });
    void appVersion().then((found) => (version = found));
    return () => clearTimeout(copyTimer);
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

  let customField = $state<HTMLElement>();

  async function chooseEditor(id: (typeof EDITOR_CHOICES)[number]['id']) {
    preferences.editor = { ...preferences.editor, id };
    preferences.save();
    // The command box appears below the choices, so a panel that scrolls shows it, without moving focus off the choice.
    if (id === 'custom') {
      await tick();
      customField?.scrollIntoView({ block: 'nearest' });
    }
  }

  function chooseShading(shading: Shading) {
    preferences.mapShading = shading;
    preferences.save();
  }

  function setCustomTemplate(customTemplate: string) {
    preferences.editor = { ...preferences.editor, customTemplate };
    preferences.save();
  }

  function setContextLines(value: number) {
    preferences.contextLines = Math.min(MAX_CONTEXT_LINES, Math.max(0, Math.round(value) || 0));
    preferences.save();
  }

  function resetEverything() {
    preferences.reset();
    confirmingReset = false;
  }

  async function copyVersion() {
    try {
      await copyText(versionReport(version, engine));
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 2000);
    } catch {
      copied = false;
    }
  }

  /** Arrow keys, Home and End move between the tabs, and the tab they land on is shown and focused. */
  async function onTabKeydown(event: KeyboardEvent, index: number) {
    const target = tabAfterKey(event.key, index, TABS.length);
    if (target === null) return;
    event.preventDefault();
    activeTab = TABS[target].id;
    await tick();
    document.getElementById(`settings-tab-${TABS[target].id}`)?.focus();
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
    use:focusScope={{ initial: '[role=tab][aria-selected=true]' }}
    onkeydown={onDialogKeydown}
  >
    <header>
      <h2 id="settings-title">Settings</h2>
      <button type="button" class="tool icon" aria-label="Close settings" title="Close (Esc)" onclick={onClose}>
        <Icon name="close" />
      </button>
    </header>

    <div class="tabs" role="tablist" aria-label="Settings sections">
      {#each TABS as tab, index (tab.id)}
        <button
          type="button"
          role="tab"
          class="tab"
          id="settings-tab-{tab.id}"
          aria-selected={activeTab === tab.id}
          aria-controls="settings-panel-{tab.id}"
          tabindex={activeTab === tab.id ? 0 : -1}
          onclick={() => (activeTab = tab.id)}
          onkeydown={(event) => onTabKeydown(event, index)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <div class="panels">
      {#if activeTab === 'files'}
        <div class="panel" role="tabpanel" id="settings-panel-files" aria-labelledby="settings-tab-files">
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
              <label class="field" bind:this={customField}>
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
        </div>
      {:else if activeTab === 'appearance'}
        <div class="panel" role="tabpanel" id="settings-panel-appearance" aria-labelledby="settings-tab-appearance">
          <section aria-labelledby="theme-heading">
            <h3 id="theme-heading">Theme</h3>
            <ThemeChoices {preferences} compact />
            <p class="help">The same choices are in the Appearance menu in the toolbar.</p>
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
            <p class="help">Cushion lights each tile from the top left, so files and folders stand apart. Facet gives each tile a gentle slope and a beveled edge. Flat fills each tile with one color.</p>
          </section>
        </div>
      {:else}
        <div class="panel about" role="tabpanel" id="settings-panel-about" aria-labelledby="settings-tab-about">
          <div class="identity">
            <img class="logo" src="/favicon.svg" alt="" width="48" height="48" />
            <div>
              <p class="name">Spelunker</p>
              <p class="tagline">Fast file search for Windows</p>
            </div>
          </div>
          <dl>
            <dt>Version</dt>
            <dd>{version || '...'}</dd>
            <dt>Window engine</dt>
            <dd>WebView2 {engine ?? 'unknown'}</dd>
            <dt>License</dt>
            <dd>MIT, copyright 2026 TheEndless</dd>
          </dl>
          <p class="help">
            Built with Tauri and Svelte, and with the search libraries from the ripgrep project. Your settings and saved searches
            stay on this computer. The only thing Spelunker ever asks the network for is the newest release number on GitHub,
            and you can turn that off below.
          </p>
          <section aria-labelledby="updates-heading">
            <h3 id="updates-heading">Updates</h3>
            <div class="inline">
              <button type="button" class="tool" disabled={updates.state === 'checking'} onclick={() => updates.check()}>
                <Icon name="reset" /> Check for updates
              </button>
              <span class="status" role="status">
                {#if updates.state === 'checking'}
                  Checking...
                {:else if updates.state === 'failed'}
                  <span class="problem">{updates.failure}</span>
                {:else if updates.info?.available}
                  Version {updates.info.latest} is available.
                {:else if updates.info}
                  You have the latest version.
                {/if}
              </span>
              {#if updates.info?.available && updates.state !== 'checking'}
                <button type="button" class="tool" onclick={() => updates.info && openReleasePage(updates.info.page)}>
                  <Icon name="open" /> View release
                </button>
              {/if}
            </div>
            <p class="help">{checkedAgo(preferences.lastUpdateCheck, Date.now())}</p>
            <label class="check">
              <input
                type="checkbox"
                checked={preferences.checkForUpdates}
                onchange={(event) => {
                  preferences.checkForUpdates = event.currentTarget.checked;
                  preferences.save();
                }}
              />
              Check for updates when Spelunker starts, at most once a day
            </label>
          </section>
          <div class="inline">
            <button type="button" class="tool" onclick={copyVersion}>
              <Icon name="copy" /> Copy version info
            </button>
            <span class="copied" role="status">{copied ? 'Copied' : ''}</span>
          </div>
        </div>
      {/if}
    </div>

    <footer>
      <div class="reset">
        {#if confirmingReset}
          <button type="button" class="danger" onclick={resetEverything}>Reset everything now</button>
          <button type="button" class="tool" onclick={() => (confirmingReset = false)}>Cancel</button>
          <span class="help" role="status">Saved searches are kept.</span>
        {:else}
          <button type="button" class="tool" onclick={() => (confirmingReset = true)}>
            <Icon name="reset" /> Reset everything to defaults
          </button>
        {/if}
      </div>
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
    /* One height for every tab, so the dialog never jumps. In a short window it shrinks, and then
       only the panel scrolls: the title, the tabs and the buttons stay where they are. */
    height: min(480px, calc(100vh - 32px));
    padding: 16px 18px 14px;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: var(--shadow);
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    gap: 12px;
    overflow: hidden;
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
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--border);
  }
  .tab {
    height: 34px;
    padding: 0 14px;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    background: transparent;
    color: var(--text-muted);
    font-weight: 600;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab[aria-selected='true'] {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .panels {
    overflow: auto;
    /* Room for the focus ring of a control at the panel's edge, which the scrolling would clip. */
    margin: -3px;
    padding: 3px;
  }
  .panel {
    display: grid;
    gap: 14px;
    align-content: start;
  }
  section {
    display: grid;
    gap: 6px;
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
  .choices label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
    /* No single word is left alone on the last line. */
    text-wrap: pretty;
  }
  .check input {
    /* Level with the first line of the label, which is taller than the box. */
    margin-top: 2px;
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
  .problem {
    margin: 0;
    color: var(--danger);
    font-weight: 600;
    font-size: var(--text-small);
  }
  .about {
    gap: 16px;
  }
  .identity {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .logo {
    flex: none;
    border-radius: 8px;
  }
  .name {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
  }
  .tagline {
    margin: 2px 0 0;
    color: var(--text-muted);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    user-select: text;
  }
  .status {
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .copied {
    min-width: 5ch;
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .reset {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
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
  .danger {
    height: var(--control-height);
    padding: 0 12px;
    border: 1px solid var(--danger);
    border-radius: var(--radius);
    background: transparent;
    color: var(--danger);
    font-weight: 600;
  }
  .danger:hover {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .primary:hover {
    background: var(--accent-hover);
  }
</style>

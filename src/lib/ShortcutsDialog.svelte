<script lang="ts">
  import { focusScope } from './focusScope';
  import Icon from './Icon.svelte';
  import { SHORTCUT_COLUMNS, keyAlternatives, shortcutsInGroup, withShortcut, type Shortcut } from './shortcuts';

  /** Long keys beside a long action leave the words a narrow column, so such keys go under the action. */
  const LONG_KEYS = 26;
  const LONG_ACTION = 30;
  const isLong = (shortcut: Shortcut) => shortcut.keys.length > LONG_KEYS && shortcut.action.length > LONG_ACTION;

  let open = $state(false);
  let dialog = $state<HTMLDivElement>();

  export function show() {
    open = true;
  }

  export function toggle() {
    open = !open;
  }

  // Escape is read in the capture phase so it closes only this list and never stops a running search.
  function onWindowKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    }
  }

  /** The list is modal, so Tab wraps inside it instead of reaching the page behind. */
  function onDialogKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')];
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

<button
  type="button"
  class="tool icon"
  aria-label="Keyboard shortcuts"
  title={withShortcut('Keyboard shortcuts', 'F1')}
  aria-haspopup="dialog"
  aria-expanded={open}
  onclick={toggle}><Icon name="help" /></button
>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onpointerdown={(event) => event.target === event.currentTarget && (open = false)}>
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabindex="-1"
      bind:this={dialog}
      use:focusScope={{ initial: '.close' }}
      onkeydown={onDialogKeydown}
    >
      <header>
        <h2>Keyboard shortcuts</h2>
        <button type="button" class="tool icon close" aria-label="Close the shortcuts" title="Close (Esc)" onclick={() => (open = false)}>
          <Icon name="close" />
        </button>
      </header>

      <!-- A list that scrolls must be reachable with the keyboard, which is what tabindex gives it. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="groups" tabindex="0" role="region" aria-label="Shortcuts by area">
        {#each SHORTCUT_COLUMNS as groups, columnIndex (columnIndex)}
          <div class="column">
            {#each groups as group (group)}
          <section aria-labelledby="shortcut-group-{group.replace(/\s+/g, '-')}">
            <h3 id="shortcut-group-{group.replace(/\s+/g, '-')}">{group}</h3>
            <ul>
              {#each shortcutsInGroup(group) as shortcut (shortcut.keys + shortcut.action)}
                <li class:long={isLong(shortcut)}>
                  <span class="action">
                    {shortcut.action}
                    {#if shortcut.where}<span class="where">{shortcut.where}</span>{/if}
                  </span>
                  <span class="keys">
                    {#each keyAlternatives(shortcut.keys) as steps, index (index)}
                      {#if index > 0}<span class="or">or</span>{/if}
                      {#each steps as step, stepIndex (stepIndex)}
                        {#if stepIndex > 0}<span class="or">then</span>{/if}
                        <kbd>{step}</kbd>
                      {/each}
                    {/each}
                  </span>
                </li>
              {/each}
            </ul>
          </section>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

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
    width: min(920px, calc(100vw - 32px));
    height: min(720px, calc(100vh - 32px));
    padding: 16px 18px 14px;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: var(--shadow);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
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
  .groups {
    overflow: auto;
    /* Two columns when there is room, one under the other when there is not. Only the list scrolls, and only up and down. */
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr));
    align-items: start;
    gap: 0 28px;
    /* Room for the focus ring, which the scrolling would clip. */
    margin: -3px;
    padding: 3px;
  }
  .column {
    min-width: 0;
  }
  section {
    margin-bottom: 14px;
  }
  h3 {
    margin: 0 0 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
    font-size: var(--text-small);
    font-weight: 700;
    color: var(--text-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 4px 14px;
    padding: 3px 4px;
    border-radius: 3px;
  }
  li:hover {
    background: var(--row-hover);
  }
  li.long {
    grid-template-columns: minmax(0, 1fr);
  }
  li.long .keys {
    justify-content: flex-start;
  }
  .action {
    min-width: 0;
  }
  .where {
    display: block;
    color: var(--text-muted);
    font-size: var(--text-small);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 4px;
    /* Short keys sit beside the action, and wrap here before they take the room the words need. */
    max-width: 14.5rem;
  }
  .or {
    font-size: var(--text-small);
    color: var(--text-muted);
  }
  kbd {
    font: inherit;
    font-size: var(--text-small);
    padding: 1px 6px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: var(--radius);
    white-space: nowrap;
  }
</style>

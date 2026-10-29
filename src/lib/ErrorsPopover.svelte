<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ErrorRow } from './types';
  import { errorsHeader, formatErrorsForCopy, reasonFor, visibleErrors } from './errorsList';
  import { focusScope } from './focusScope';

  interface Props {
    errors: ErrorRow[];
    onClose: () => void;
  }

  type CopyState = 'idle' | 'copied' | 'failed';

  const COPY_FEEDBACK_MS = 1500;

  let { errors, onClose }: Props = $props();

  let panel: HTMLDivElement;
  let copyState = $state<CopyState>('idle');
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  const visible = $derived(visibleErrors(errors));
  const copyLabel = $derived(copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Could not copy' : 'Copy list');

  async function copyList() {
    let nextState: CopyState;
    try {
      await navigator.clipboard.writeText(formatErrorsForCopy(errors));
      nextState = 'copied';
    } catch {
      nextState = 'failed';
    }
    copyState = nextState;
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copyState = 'idle';
    }, COPY_FEEDBACK_MS);
  }

  function onWindowPointerDown(event: PointerEvent) {
    if (!panel.contains(event.target as Node)) onClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  }

  onDestroy(() => clearTimeout(copyResetTimer));
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydowncapture={onKeydown} />

<div
  class="popover"
  role="dialog"
  aria-label="Files and folders that could not be read"
  tabindex="-1"
  bind:this={panel}
  use:focusScope={{ onLeave: onClose }}
>
  <header>
    <p class="count">{errors.length === 0 ? 'Nothing was skipped.' : errorsHeader(errors.length)}</p>
    <div class="actions">
      {#if errors.length > 0}
        <button type="button" class="tool" onclick={copyList}>{copyLabel}</button>
      {/if}
      <button type="button" class="tool" onclick={onClose}>Close</button>
    </div>
  </header>

  {#if errors.length > 0}
    <ul>
      {#each visible.shown as error, index (index)}
        <li>
          <span class="mono path">{error.path}</span>
          <span class="reason">{reasonFor(error)}</span>
        </li>
      {/each}
      {#if visible.hidden > 0}
        <li class="more">and {visible.hidden} more. Use Copy list to get all of them.</li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .popover {
    position: absolute;
    /* The button is at the far right end of the status bar, so the list grows leftward from it. */
    right: 0;
    bottom: calc(100% + 4px);
    z-index: 15;
    width: 520px;
    max-width: calc(100vw - 32px);
    max-height: 50vh;
    display: flex;
    flex-direction: column;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    box-shadow: var(--shadow);
    font-size: var(--text-small);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-shrink: 0;
    padding: 8px;
    border-bottom: 1px solid var(--border);
  }
  .count {
    margin: 0;
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow: auto;
    min-height: 0;
  }
  li {
    display: grid;
    gap: 2px;
    padding: 6px 8px;
  }
  .path {
    overflow-wrap: anywhere;
    user-select: text;
  }
  .reason {
    color: var(--text-muted);
    user-select: text;
  }
  .more {
    color: var(--text-muted);
  }
</style>

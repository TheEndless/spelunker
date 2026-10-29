<script lang="ts">
  import { openReleasePage } from './backend';
  import Icon from './Icon.svelte';
  import type { UpdateInfo } from './types';

  /** The strip under the toolbar that announces a newer release. Dismissing it hides that version only. */
  interface Props {
    info: UpdateInfo;
    onDismiss: () => void;
  }

  let { info, onDismiss }: Props = $props();
</script>

<div class="banner" role="region" aria-label="Update available">
  <span class="message">
    <strong>Spelunker {info.latest}</strong> is available. You have {info.current}.
  </span>
  <button type="button" class="tool" onclick={() => openReleasePage(info.page)}>
    <Icon name="open" /> View release
  </button>
  <button type="button" class="dismiss" aria-label="Dismiss until the next release" title="Dismiss" onclick={onDismiss}>
    <Icon name="close" />
  </button>
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px 4px 12px;
    background: var(--row-selected);
    border-bottom: 1px solid var(--border);
    border-left: 3px solid var(--row-selected-edge);
    min-height: 34px;
  }
  .message {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tool {
    margin-left: auto;
  }
  .dismiss {
    display: grid;
    place-items: center;
    width: var(--tool-height);
    height: var(--tool-height);
    padding: 0;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text-muted);
  }
  .dismiss:hover {
    background: var(--row-hover);
    color: var(--text);
  }
</style>

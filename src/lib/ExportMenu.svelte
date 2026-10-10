<script lang="ts">
  import ContextMenu from './ContextMenu.svelte';
  import type { ExportFormat } from './exportResults';
  import Icon from './Icon.svelte';
  import { withShortcut } from './shortcuts';

  interface Props {
    /** Nothing to export yet (no results). */
    disabled: boolean;
    onExport: (format: ExportFormat) => void;
  }

  let { disabled, onExport }: Props = $props();

  let button: HTMLButtonElement;
  let position = $state<{ x: number; y: number } | null>(null);

  /** Opens the format list under the button. Also used by the Ctrl+E shortcut. */
  export function show() {
    if (disabled) return;
    // A second press on the button closes the list instead of opening it again.
    if (position) {
      position = null;
      return;
    }
    const box = button.getBoundingClientRect();
    position = { x: box.left, y: box.bottom + 4 };
  }
</script>

<button
  type="button"
  class="tool"
  bind:this={button}
  aria-haspopup="menu"
  aria-expanded={position !== null}
  aria-disabled={disabled}
  onpointerdown={(event) => position && event.stopPropagation()}
  title={disabled ? 'Export results (Ctrl+E). Run a search first.' : withShortcut('Export results', 'Ctrl+E')}
  onclick={show}
>
  <Icon name="export" />
  Export
</button>

{#if position}
  <ContextMenu
    x={position.x}
    y={position.y}
    label="Export results"
    onClose={() => (position = null)}
    items={[
      { label: 'Save as CSV (spreadsheet)', action: () => onExport('csv') },
      { label: 'Save as text (one path per line)', action: () => onExport('txt') },
    ]}
  />
{/if}

<style>
  button[aria-disabled='true'] {
    color: var(--disabled-text);
    cursor: not-allowed;
  }
  button[aria-disabled='true']:hover {
    border-color: var(--border-strong);
    color: var(--disabled-text);
  }
</style>

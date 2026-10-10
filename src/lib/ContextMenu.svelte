<script lang="ts">
  import { focusScope } from './focusScope';
  import Icon from './Icon.svelte';

  interface Item {
    label: string;
    action: () => void;
    /** When set, the item is a check item and this is its state. */
    checked?: boolean;
    /** Keep the menu open after choosing, so several check items can be changed in one visit. */
    keepOpen?: boolean;
    /** Draw a line above this item to group it with the ones below. */
    separatorBefore?: boolean;
  }

  interface Props {
    x: number;
    y: number;
    items: Item[];
    onClose: () => void;
    label?: string;
  }

  let { x, y, items, onClose, label = 'File actions' }: Props = $props();

  let menu: HTMLDivElement;

  // Keep the menu on screen when opened near the right or bottom edge.
  const left = $derived(Math.max(4, Math.min(x, window.innerWidth - 240)));
  const top = $derived(Math.max(4, Math.min(y, window.innerHeight - items.length * 30 - 16)));

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  }

  /**
   * Menu keys. Up and Down cycle through the items, which suits a popup that can open in any
   * direction. Home and End jump to the ends. Tab closes the menu, as in Windows.
   */
  function onMenuKeydown(event: KeyboardEvent) {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let target: number | null = null;
    if (event.key === 'ArrowDown') target = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') target = (index <= 0 ? buttons.length : index) - 1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = buttons.length - 1;
    else if (event.key === 'Tab') {
      // Focus returns to the grid when the menu closes, so Tab itself must not move it further.
      event.preventDefault();
      onClose();
      return;
    }
    if (target !== null) {
      buttons[target].focus();
      event.preventDefault();
    }
  }
</script>

<!-- Escape is read in the capture phase so it cannot also reach the app's own Escape (stop the search). -->
<svelte:window onkeydowncapture={onWindowKeydown} onpointerdown={onClose} onblur={onClose} />

<div
  class="menu"
  role="menu"
  aria-label={label}
  tabindex="-1"
  bind:this={menu}
  use:focusScope={{ onLeave: onClose }}
  style:left="{left}px"
  style:top="{top}px"
  onkeydown={onMenuKeydown}
  onpointerdown={(event) => event.stopPropagation()}
>
  {#each items as item (item.label)}
    {#if item.separatorBefore}<div class="separator" role="separator"></div>{/if}
    <button
      type="button"
      role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={item.checked}
      onclick={() => {
        item.action();
        if (!item.keepOpen) onClose();
      }}
    >
      <span class="mark">{#if item.checked}<Icon name="check" size={14} />{/if}</span>
      {item.label}
    </button>
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 20;
    min-width: 210px;
    padding: 4px;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    box-shadow: var(--shadow);
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    padding: 5px 10px 5px 6px;
    border: 0;
    border-radius: 4px;
    background: none;
  }
  button:hover,
  button:focus-visible {
    background: var(--row-selected);
  }
  .mark {
    display: inline-flex;
    width: 14px;
    flex: none;
    color: var(--accent);
  }
  .separator {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
</style>

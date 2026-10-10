<script lang="ts">
  import { focusScope } from './focusScope';
  import Icon from './Icon.svelte';
  import { SHORTCUT_GROUPS, shortcutsInGroup, withShortcut } from './shortcuts';

  let open = $state(false);
  let root: HTMLDivElement;

  export function show() {
    open = true;
  }

  export function toggle() {
    open = !open;
  }

  /**
   * The list can be opened with F1 while focus is in some other field, so that field, not the "?"
   * button, is the opener. Moving focus to the button (by clicking it) must not count as leaving,
   * or the click would close the list and then reopen it.
   */
  function closeUnlessInside(next: Element) {
    if (!root.contains(next)) open = false;
  }

  function onWindowPointerDown(event: PointerEvent) {
    if (open && !root.contains(event.target as Node)) open = false;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      open = false;
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydowncapture={onKeydown} />

<div class="shortcuts" bind:this={root}>
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
    <div class="popover" role="dialog" aria-label="Keyboard shortcuts" tabindex="-1" use:focusScope={{ onLeave: closeUnlessInside }}>
      {#each SHORTCUT_GROUPS as group (group)}
        <section>
          <h2 class="heading">{group}</h2>
          <ul>
            {#each shortcutsInGroup(group) as shortcut (shortcut.action)}
              <li>
                <span class="action">{shortcut.action}</span>
                <span class="keys">
                  {#each shortcut.keys.split(' or ') as key, index (index)}
                    {#if index > 0}<span class="or">or</span>{/if}
                    <kbd>{key}</kbd>
                  {/each}
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .shortcuts {
    position: relative;
  }
  .popover {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 15;
    width: 360px;
    max-height: min(85vh, 640px);
    overflow: auto;
    padding: 10px;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: var(--shadow);
    display: grid;
    gap: 12px;
  }
  .heading {
    margin: 0;
    padding: 0 4px 4px;
    font-size: var(--text-small);
    font-weight: 700;
    color: var(--text-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px;
    border-radius: 4px;
  }
  li:hover {
    background: var(--row-hover);
  }
  .keys {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 4px;
    flex: none;
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
    border-radius: var(--radius);
    white-space: nowrap;
  }
</style>

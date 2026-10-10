<script lang="ts">
  import Icon from './Icon.svelte';
  import { applyChoice, currentSegment, filterRecents, nextActiveIndex } from './folderCombo';

  interface Props {
    value: string;
    recents: string[];
    /** Fixed choices offered ahead of the recents, such as "This PC (all drives)". They cannot be removed. */
    places?: string[];
    onRemoveRecent: (folder: string) => void;
    onSubmit: () => void;
    placeholder?: string;
    /** Id for the input, so a `<label for>` can point at it. */
    inputId?: string;
    /** Id of the element that names this field. */
    labelledby?: string;
    title?: string;
  }

  let { value = $bindable(), recents, places = [], onRemoveRecent, onSubmit, placeholder, inputId, labelledby, title }: Props = $props();

  const instanceId = $props.id();
  const listboxId = `${instanceId}-listbox`;
  const hintId = `${instanceId}-hint`;
  const optionId = (index: number) => `${instanceId}-option-${index}`;

  let input: HTMLInputElement;
  let open = $state(false);
  let activeIndex = $state(-1);

  const choices = $derived([...places, ...recents.filter((recent) => !places.includes(recent))]);
  const filtered = $derived(filterRecents(choices, currentSegment(value)));
  const showList = $derived(open && filtered.length > 0);

  // Removing a recent can shrink the list under the active option.
  $effect(() => {
    if (activeIndex >= filtered.length) activeIndex = filtered.length - 1;
  });

  export function focus() {
    input.focus();
  }
  export function select() {
    input.select();
  }

  function openList() {
    open = true;
    activeIndex = -1;
  }

  function closeList() {
    open = false;
    activeIndex = -1;
  }

  function choose(folder: string) {
    value = applyChoice(value, folder);
    closeList();
    input.focus();
  }

  function onInput() {
    openList();
  }

  function onKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (!showList) openList();
        activeIndex = nextActiveIndex(activeIndex, filtered.length, event.key);
        break;
      case 'Enter':
        if (showList && activeIndex >= 0) {
          event.preventDefault();
          choose(filtered[activeIndex]);
        } else {
          onSubmit();
        }
        break;
      case 'Escape':
        if (showList) {
          event.stopPropagation();
          closeList();
        }
        break;
      case 'Delete':
        if (showList && activeIndex >= 0 && !places.includes(filtered[activeIndex])) {
          event.preventDefault();
          onRemoveRecent(filtered[activeIndex]);
        }
        break;
      case 'Tab':
        closeList();
        break;
    }
  }

  function onClick() {
    if (!open && choices.length > 0) openList();
  }

  function keepInputFocus(event: Event) {
    event.preventDefault();
  }
</script>

<div class="combo">
  <!-- Options hold a remove button, but a screen reader treats an option's children as plain text, so the
       Delete key is described here on the field instead. -->
  <span class="sr-only" id={hintId}>Press Down for places and recent folders. Press Delete to remove the highlighted one.</span>
  <input
    type="text"
    bind:this={input}
    bind:value
    role="combobox"
    aria-expanded={showList}
    aria-controls={listboxId}
    aria-autocomplete="list"
    aria-activedescendant={showList && activeIndex >= 0 ? optionId(activeIndex) : undefined}
    id={inputId}
    aria-labelledby={labelledby}
    aria-describedby={hintId}
    {title}
    {placeholder}
    spellcheck="false"
    autocomplete="off"
    oninput={onInput}
    onkeydown={onKeydown}
    onclick={onClick}
    onblur={closeList}
  />

  {#if showList}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <ul class="list" id={listboxId} role="listbox" aria-label="Places and recent folders" onmousedown={keepInputFocus}>
      {#each filtered as folder, index (folder)}
        <!-- Keyboard use goes through the input, so the options need no key handlers of their own. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={optionId(index)}
          role="option"
          aria-selected={index === activeIndex}
          class:active={index === activeIndex}
          onpointerdown={keepInputFocus}
          onmousedown={keepInputFocus}
          onclick={() => choose(folder)}
        >
          {#if places.includes(folder)}<span class="place-icon"><Icon name="computer" size={14} /></span>{/if}
          <span class="folder" title={folder}>{folder}</span>
          {#if !places.includes(folder)}<button
            type="button"
            class="remove"
            tabindex="-1"
            aria-label="Remove {folder} from recent folders"
            title="Remove from recent folders"
            onpointerdown={keepInputFocus}
            onmousedown={keepInputFocus}
            onclick={(event) => {
              event.stopPropagation();
              onRemoveRecent(folder);
            }}>&times;</button
          >{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .combo {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .combo input {
    width: 100%;
    box-sizing: border-box;
  }
  .list {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    z-index: 20;
    margin: 0;
    padding: 4px;
    list-style: none;
    max-height: 240px;
    overflow: auto;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  li {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 4px 4px 8px;
    border-radius: 4px;
    border-left: 2px solid transparent;
    font-size: var(--text-small);
    cursor: pointer;
  }
  li:hover {
    background: var(--row-hover);
  }
  li.active {
    background: var(--row-selected);
    border-left-color: var(--row-selected-edge);
  }
  .folder {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .place-icon {
    display: inline-flex;
    flex: none;
    color: var(--accent);
  }
  .remove {
    flex: none;
    background: none;
    border: 0;
    padding: 0 6px;
    color: var(--text-muted);
    font-size: 16px;
    line-height: 1;
  }
  .remove:hover {
    color: var(--danger);
  }
</style>

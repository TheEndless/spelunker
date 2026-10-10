<script lang="ts">
  import { focusScope } from './focusScope';

  interface Props {
    visible: boolean;
    onHide: () => void;
  }

  let { visible, onHide }: Props = $props();

  function onKeydown(event: KeyboardEvent) {
    if (visible && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onHide();
    }
  }

  // The dialog is modal and holds one control, so Tab keeps focus on it instead of reaching the page behind.
  function onDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Tab') event.preventDefault();
  }
</script>

<svelte:window onkeydowncapture={onKeydown} />

{#if visible}
  <div class="backdrop">
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="stopping-title"
      aria-describedby="stopping-detail"
      tabindex="-1"
      use:focusScope={{ initial: 'button' }}
      onkeydown={onDialogKeydown}
    >
      <div class="spinner" aria-hidden="true"></div>
      <div class="text">
        <h2 id="stopping-title">Stopping search</h2>
        <p id="stopping-detail">
          Waiting for the file being read to finish. Files on slow disks, network drives, or cloud folders can take a few seconds.
        </p>
      </div>
      <button type="button" onclick={onHide}>Hide</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
  }
  .dialog {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 14px;
    align-items: center;
    width: min(460px, calc(100vw - 32px));
    padding: 16px 18px;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .spinner {
    width: 22px;
    height: 22px;
    border: 3px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 3s;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  h2 {
    margin: 0 0 2px;
    font-size: 14px;
  }
  p {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  button {
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    padding: 4px 12px;
  }
  button:hover {
    border-color: var(--accent);
  }
</style>

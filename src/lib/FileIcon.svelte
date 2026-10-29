<script lang="ts">
  import { fileCategory, type FileCategory } from './fileKinds';
  import Icon, { type IconName } from './Icon.svelte';
  import { systemIconUrl } from './systemIcons.svelte';

  interface Props {
    name: string;
    size?: number;
  }

  let { name, size = 16 }: Props = $props();

  const ICONS: Record<FileCategory, IconName> = {
    code: 'file-code',
    text: 'file-text',
    data: 'file-data',
    image: 'file-image',
    pdf: 'file-pdf',
    audio: 'file-audio',
    video: 'file-video',
    archive: 'file-archive',
    document: 'file-document',
    sheet: 'file-sheet',
    slides: 'file-slides',
    executable: 'file-executable',
    other: 'file',
  };

  /** Up to this size the system's small icon is used, and above it the large one. */
  const MAX_SMALL_ICON_SIZE = 20;

  const category = $derived(fileCategory(name));
  const systemIcon = $derived(systemIconUrl(name, size > MAX_SMALL_ICON_SIZE));
</script>

<!-- The icon is decorative: the file's name sits right beside it. The drawn icon, tinted by kind, stands in until the system's arrives and where it has none. -->
{#if systemIcon}
  <img class="system" src={systemIcon} width={size} height={size} alt="" draggable="false" />
{:else}
  <span class="kind kind-{category}"><Icon name={ICONS[category]} {size} /></span>
{/if}

<style>
  .system {
    flex: none;
    object-fit: contain;
  }
  .kind {
    display: inline-flex;
    flex: none;
    color: var(--kind-other);
  }
  .kind-code { color: var(--kind-code); }
  .kind-text { color: var(--kind-text); }
  .kind-data { color: var(--kind-data); }
  .kind-image { color: var(--kind-image); }
  .kind-pdf { color: var(--kind-pdf); }
  .kind-audio { color: var(--kind-audio); }
  .kind-video { color: var(--kind-video); }
  .kind-archive { color: var(--kind-archive); }
  .kind-document { color: var(--kind-document); }
  .kind-sheet { color: var(--kind-sheet); }
  .kind-slides { color: var(--kind-slides); }
  .kind-executable { color: var(--kind-executable); }
</style>

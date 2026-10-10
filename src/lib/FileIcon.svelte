<script lang="ts">
  import { fileCategory, type FileCategory } from './fileKinds';
  import Icon, { type IconName } from './Icon.svelte';

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

  const category = $derived(fileCategory(name));
</script>

<!-- The tint is a hint only. The file's name sits right beside it, so the icon is decorative. -->
<span class="kind kind-{category}"><Icon name={ICONS[category]} {size} /></span>

<style>
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

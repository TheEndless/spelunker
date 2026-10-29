import { SvelteMap } from 'svelte/reactivity';
import { fileIconUrl } from './backend';
import { extensionOf } from './fileKinds';

/** These files each carry an icon of their own, which the one registered for the extension would get wrong. */
const OWN_ICON_EXTENSIONS = new Set(['exe', 'scr', 'ico', 'cur', 'ani', 'lnk', 'url']);

/** The icon of each extension and size asked for so far: a URL, or null when the system has none. */
const icons = new SvelteMap<string, string | null>();
const asked = new Set<string>();

/**
 * The system's registered icon for a file's type, or null while it is being fetched, when there is
 * none, and for files that have an icon of their own. Each extension and size is asked for once. Reading it
 * in a component redraws that component when the icon arrives.
 */
export function systemIconUrl(name: string, large = false): string | null {
  const extension = extensionOf(name);
  if (extension === '' || OWN_ICON_EXTENSIONS.has(extension)) return null;
  const key = `${extension}:${large ? 'large' : 'small'}`;
  if (!asked.has(key)) {
    asked.add(key);
    fileIconUrl(extension, large).then(
      (url) => icons.set(key, url),
      () => icons.set(key, null),
    );
  }
  return icons.get(key) ?? null;
}

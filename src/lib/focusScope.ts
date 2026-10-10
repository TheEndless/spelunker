import type { Action } from 'svelte/action';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface FocusScopeOptions {
  /** CSS selector, inside the scope, of the element to focus first. Defaults to the first focusable one. */
  initial?: string;
  /** Called when focus moves somewhere outside the scope (for example with Tab), with the element that took it. */
  onLeave?: (next: Element) => void;
}

/**
 * Focus handling for popovers, menus, and dialogs, following the W3C dialog pattern: focus moves
 * into the element when it appears and goes back to whatever had it when the element goes away.
 *
 * Focus is only restored when it is still inside the scope (or nowhere). If the user clicked into
 * another field to dismiss the popover, that field keeps focus.
 *
 * The element should have `tabindex="-1"` so it can take focus when it holds nothing focusable.
 */
export const focusScope: Action<HTMLElement, FocusScopeOptions | undefined> = (node, options) => {
  let current = options;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const first = current?.initial ? node.querySelector<HTMLElement>(current.initial) : node.querySelector<HTMLElement>(FOCUSABLE);
  (first ?? node).focus({ preventScroll: true });

  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (!(next instanceof Element) || node.contains(next)) return;
    // Moving to the button that opened the scope is handled by that button's own click.
    if (opener?.contains(next)) return;
    current?.onLeave?.(next);
  };
  node.addEventListener('focusout', onFocusOut);

  return {
    update(next) {
      current = next;
    },
    destroy() {
      node.removeEventListener('focusout', onFocusOut);
      const active = document.activeElement;
      const focusIsLost = !active || active === document.body || node.contains(active);
      if (focusIsLost && opener && document.contains(opener)) opener.focus({ preventScroll: true });
    },
  };
};

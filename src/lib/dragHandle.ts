export interface PointerDragOptions {
  axis: 'x' | 'y';
  /** The size being changed when the drag starts. */
  startSize: () => number;
  /** Called once, as soon as the drag begins, before any movement. */
  onStart?: () => void;
  /** The new size for a pointer that moved `distance` along the axis since the start (positive = right/down). */
  onMove: (startSize: number, distance: number) => void;
  onStop: () => void;
}

/**
 * Runs a pointer drag on the element that received `event`. The pointer is captured so the drag
 * survives leaving the thin handle and crossing an iframe.
 */
export function startPointerDrag(event: PointerEvent, options: PointerDragOptions): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const origin = options.axis === 'x' ? event.clientX : event.clientY;
  const startSize = options.startSize();
  options.onStart?.();
  const move = (moveEvent: PointerEvent) => {
    const position = options.axis === 'x' ? moveEvent.clientX : moveEvent.clientY;
    options.onMove(startSize, position - origin);
  };
  const stop = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', stop);
    handle.removeEventListener('pointercancel', stop);
    options.onStop();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

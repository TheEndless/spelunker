import { describe, expect, it, vi } from 'vitest';
import { startPointerDrag } from './dragHandle';

type Listener = (event: unknown) => void;

/** A stand-in for the handle element: it records listeners so the test can fire pointer events at it. */
function fakeHandle() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    setPointerCapture: vi.fn(),
    addEventListener: (type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
    fire: (type: string, event: object = {}) => listeners.get(type)?.forEach((listener) => listener(event)),
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}

function downEvent(handle: ReturnType<typeof fakeHandle>, overrides: object = {}) {
  return {
    button: 0,
    pointerId: 7,
    clientX: 100,
    clientY: 200,
    currentTarget: handle,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as PointerEvent;
}

describe('startPointerDrag', () => {
  it('reports the distance along the y axis from where the pointer went down', () => {
    const handle = fakeHandle();
    const onMove = vi.fn();
    startPointerDrag(downEvent(handle), { axis: 'y', startSize: () => 300, onMove, onStop: vi.fn() });
    handle.fire('pointermove', { clientX: 999, clientY: 170 });
    expect(onMove).toHaveBeenCalledWith(300, -30);
  });

  it('reports the distance along the x axis', () => {
    const handle = fakeHandle();
    const onMove = vi.fn();
    startPointerDrag(downEvent(handle), { axis: 'x', startSize: () => 400, onMove, onStop: vi.fn() });
    handle.fire('pointermove', { clientX: 140, clientY: 999 });
    expect(onMove).toHaveBeenCalledWith(400, 40);
  });

  it('captures the pointer, calls onStart at once, and reads the start size only once', () => {
    const handle = fakeHandle();
    const onStart = vi.fn();
    const startSize = vi.fn(() => 300);
    const onMove = vi.fn();
    startPointerDrag(downEvent(handle), { axis: 'y', startSize, onStart, onMove, onStop: vi.fn() });
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    expect(onStart).toHaveBeenCalledTimes(1);
    handle.fire('pointermove', { clientY: 210 });
    handle.fire('pointermove', { clientY: 220 });
    expect(startSize).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenLastCalledWith(300, 20);
  });

  it('stops on pointerup and on pointercancel, and stops listening', () => {
    for (const ending of ['pointerup', 'pointercancel']) {
      const handle = fakeHandle();
      const onStop = vi.fn();
      const onMove = vi.fn();
      startPointerDrag(downEvent(handle), { axis: 'y', startSize: () => 1, onMove, onStop });
      handle.fire(ending);
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(handle.listenerCount()).toBe(0);
      handle.fire('pointermove', { clientY: 500 });
      expect(onMove).not.toHaveBeenCalled();
    }
  });

  it('does nothing for a button other than the primary one', () => {
    const handle = fakeHandle();
    const onStart = vi.fn();
    const event = downEvent(handle, { button: 2 });
    startPointerDrag(event, { axis: 'y', startSize: () => 1, onStart, onMove: vi.fn(), onStop: vi.fn() });
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(handle.listenerCount()).toBe(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

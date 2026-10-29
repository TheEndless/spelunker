// What every end-to-end script needs: a connection to the app's page over the Chrome DevTools
// protocol, real key and mouse events, a way to fill a field, and a pass/fail tally.
import { findSpelunkerPage } from './target.mjs';

const KEY_CODES = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, ' ': 32, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38,
  ArrowRight: 39, ArrowDown: 40, Delete: 46, ContextMenu: 93,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};

/** The Windows virtual-key code for a key name such as "ArrowDown", "F6", or a letter. */
const keyCode = (name) => KEY_CODES[name] ?? name.toUpperCase().charCodeAt(0);

export const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Connects to the running app. `port` is the debug port the app was started with (see launch.ps1).
 * `webSocketDebuggerUrl` picks one page directly instead (see headless.mjs). `onEvent` receives
 * every protocol event, such as console messages once `Runtime.enable` was sent.
 * Everything returned acts on the app's own page. Nothing here sends input to the desktop.
 */
export async function openPage({ port = 9222, webSocketDebuggerUrl = null, onEvent = null } = {}) {
  let address = webSocketDebuggerUrl;
  if (!address) {
    address = (await findSpelunkerPage(port)).webSocketDebuggerUrl;
  }
  const socket = new WebSocket(address);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`could not connect to ${address}`));
  });

  let nextId = 1;
  const pending = new Map();
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) pending.get(data.id)(data);
    else if (data.method && onEvent) onEvent(data);
  };

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  // The window under test never has the real focus (the scripts must not take it from the person
  // using the machine), so the page is told to behave as a focused one: focus events, :focus-visible.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  /** Runs JavaScript in the page and returns its value, or `{ exception }` if it threw. */
  const ev = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.result.exceptionDetails) {
      return { exception: reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text };
    }
    return reply.result.result.value;
  };

  /**
   * A real key press. Enter and Space carry their character, as from a keyboard, so that a focused
   * button is clicked by them.
   */
  const key = async (name, { ctrl = false, shift = false, alt = false } = {}) => {
    const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const code = keyCode(name);
    const base = {
      key: name,
      code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      modifiers,
    };
    const text = name === 'Enter' ? String.fromCharCode(13) : name === ' ' ? ' ' : undefined;
    await send('Input.dispatchKeyEvent', text ? { type: 'keyDown', text, ...base } : { type: 'rawKeyDown', ...base });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(180);
  };

  const mouse = (type, x, y, extra = {}) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });

  /** Types a value into a field the way input events arrive from a keyboard. */
  const setField = (selector, value) =>
    ev(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );

  return { send, sleep, ev, key, mouse, setField, close: () => socket.close() };
}

/**
 * Prints PASS or FAIL for each check, and a total at the end. A failed check makes the script exit
 * with a non-zero code, so a caller can tell a red run from a green one without reading the output.
 */
export function createChecker() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: Boolean(ok) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`);
  };
  const summarize = () => {
    const failed = results.filter((result) => !result.ok);
    console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
    if (failed.length > 0) {
      console.log('FAILED: ' + failed.map((result) => result.name).join(' | '));
      process.exitCode = 1;
    }
  };
  return { check, summarize };
}

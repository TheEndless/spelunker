// Minimal CDP client for the real Spelunker window (WebView2 remote debugging on port 9222).
export async function connect() {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
  const page = targets.find((target) => target.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => (socket.onopen = resolve));
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) pending.get(data.id)(data);
  };
  const evaluate = (expression) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    }).then((reply) =>
      reply.result.exceptionDetails
        ? { exception: reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text }
        : reply.result.result.value,
    );
  return { evaluate, close: () => socket.close() };
}

/** Helpers injected into the page so scenarios can drive the UI by label. */
export const PAGE_HELPERS = `
  window.__sp = {
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    setInput(selector, value) {
      const el = document.querySelector(selector);
      if (!el) throw new Error('no element ' + selector);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    setSelect(label, value) {
      const el = document.querySelector('select[aria-label="' + label + '"]');
      if (!el) throw new Error('no select ' + label);
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    button(text) { return [...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith(text)); },
    checkbox(textFragment) {
      const label = [...document.querySelectorAll('label')].find(
        (l) => l.querySelector('input[type=checkbox]') && l.innerText.toLowerCase().includes(textFragment.toLowerCase()),
      );
      return label && label.querySelector('input[type=checkbox]');
    },
    setChecked(textFragment, on) {
      const box = window.__sp.checkbox(textFragment);
      if (!box) throw new Error('no checkbox ' + textFragment);
      if (box.checked !== on) box.click();
    },
    async search(timeoutMs = 60000) {
      const started = performance.now();
      window.__sp.button('Search').click();
      await window.__sp.wait(200);
      while (performance.now() - started < timeoutMs) {
        if (!document.querySelector('.status').innerText.startsWith('Searching')) break;
        await window.__sp.wait(100);
      }
      await window.__sp.wait(200);
      return {
        status: document.querySelector('.status').innerText.replace(/\\n/g, ' / '),
        names: [...document.querySelectorAll('.body .row')].map((r) => r.querySelector('.cell').innerText),
        problems: [...document.querySelectorAll('.problem')].map((p) => p.innerText),
      };
    },
    resetCriteria() {
      for (const t of ['Subfolders']) window.__sp.setChecked(t, true);
      for (const t of ['Hidden files', 'Binary files', 'Junctions', 'Use the Name box', 'Multi-line']) {
        const b = window.__sp.checkbox(t);
        if (b && b.checked && !b.disabled) b.click();
      }
      window.__sp.setInput('input[placeholder="Text to find"]', '');
      window.__sp.setInput('input[aria-label="Name"], input[placeholder*="log"], input[placeholder*="invoice"]', '');
      for (const l of ['Size filter']) window.__sp.setSelect(l, 'any');
      for (const l of ['Modified filter', 'Created filter']) window.__sp.setSelect(l, 'any');
    },
    /** Calls the app made for Windows' own context menu, recorded by the stub below. */
    shellMenuCalls: [],
  };
  // Inside Tauri the row context menu is the native shell menu, which is modal on the app's main
  // thread. A script cannot close it, so the app's test seam answers the request here: the request
  // is recorded and answered as "nothing chosen" without ever showing the menu.
  window.__spShellMenuHook = (request) => {
    window.__sp.shellMenuCalls.push(request);
    return { extra: null, ranShellCommand: false };
  };
  true`;

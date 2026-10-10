// Usage: node snap.mjs <out.png> [folder] [text] [name] [width] [height]
// Runs a search in the real window (optional) and saves a screenshot.
import { writeFileSync } from 'node:fs';
import { connect, PAGE_HELPERS } from './cdp.mjs';

const [out, folder, text = '', name = '', width, height] = process.argv.slice(2);
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
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.result?.value;

if (width && height) await send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: false });
if (folder) {
  await ev(PAGE_HELPERS);
  await ev(`(async () => {
    const sp = window.__sp;
    sp.setInput('[role=combobox]', ${JSON.stringify(folder)});
    sp.setInput('input[placeholder="Text to find"]', ${JSON.stringify(text)});
    sp.setInput('input[title^="Name"]', ${JSON.stringify(name)});
    await sp.wait(200);
    document.querySelector('button.go').click();
  })()`);
  for (let i = 0; i < 200; i++) {
    await sleep(150);
    const running = await ev(`!!document.querySelector('button.go.stop')`);
    if (!running) break;
  }
  await sleep(500);
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved', out);
socket.close();

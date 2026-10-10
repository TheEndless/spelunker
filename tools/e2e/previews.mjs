import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('final', { recursive: true });
import { PAGE_HELPERS } from './cdp.mjs';

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

const folder = process.argv[2];
await ev(PAGE_HELPERS);
await ev(`(async () => {
  const sp = window.__sp;
  sp.setInput('[role=combobox]', ${JSON.stringify(folder)});
  sp.setInput('input[placeholder="Text to find"]', '');
  sp.setInput('input[title^="Name"]', '');
  await sp.wait(200);
  document.querySelector('button.go').click();
  await sp.wait(1200);
})()`);

const names = await ev(`[...document.querySelectorAll('.body .row .cell:first-child')].map((cell) => cell.innerText.trim())`);
console.log('files:', JSON.stringify(names));
for (const name of names) {
  await ev(`(async () => {
    const cell = [...document.querySelectorAll('.body .row .cell:first-child')].find((c) => c.innerText.trim() === ${JSON.stringify(name)});
    cell.closest('.row').click();
    await new Promise((r) => setTimeout(r, 1500));
  })()`);
  const info = await ev(`({ title: document.querySelector('.preview .title .name').innerText, kind: document.querySelector('.preview img') ? 'img' : document.querySelector('.preview iframe') ? 'iframe' : document.querySelector('.preview .card') ? 'card' : document.querySelector('.preview .listing') ? 'listing' : '?', lines: document.querySelectorAll('.preview .line').length })`);
  console.log(JSON.stringify(info));
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 790, y: 100, width: 490, height: 660, scale: 1 } });
  writeFileSync(`final/preview-${name}.png`, Buffer.from(shot.result.data, 'base64'));
}
socket.close();

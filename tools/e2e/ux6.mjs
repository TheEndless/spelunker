// Real-window check: every popover, menu and dialog stays fully inside the window, at several sizes.
import { PAGE_HELPERS } from './cdp.mjs';
import { createChecker, openPage } from './page.mjs';

const { send, sleep, ev, key, mouse, setField, close } = await openPage();
const { check, summarize } = createChecker();

await send('Page.reload');
await sleep(2500);
await ev(`localStorage.removeItem('spelunker.preferences.v1')`);
await send('Page.reload');
await sleep(2500);
await ev(PAGE_HELPERS);

// A search that produces skipped (access denied) errors, so the errors list exists.
await setField('[role=combobox]', 'C:\\Windows');
await setField('input[title^="Name"]', 'notepad.exe');
await ev(`document.querySelector('button.go').click()`);
for (let i = 0; i < 80; i++) {
  await sleep(1000);
  if (!(await ev(`!!document.querySelector('button.go.stop')`))) break;
}
const errorCount = await ev(`document.querySelector('.errors button')?.innerText ?? ''`);
console.log('errors button:', JSON.stringify(errorCount));

// Each thing to open, how to open it, how to find the box to measure, and how to close it.
const surfaces = [
  { name: 'the errors list', open: `document.querySelector('.errors button')?.click()`, box: `.errors .popover` },
  { name: 'Saved searches', open: `document.querySelector('button[aria-label="Saved searches"]').click()`, box: `[role=dialog][aria-label="Saved searches"]` },
  { name: 'Appearance', open: `document.querySelector('.theme > button').click()`, box: `[role=dialog][aria-label="Appearance"]` },
  { name: 'the shortcuts list', open: `document.querySelector('button[aria-label="Keyboard shortcuts"]').click()`, box: `[role=dialog][aria-label="Keyboard shortcuts"]` },
  { name: 'the export menu', open: `document.querySelector('button[aria-haspopup=menu][title*="Export"]').click()`, box: `[role=menu][aria-label="Export results"]` },
  { name: 'the column chooser', open: `document.querySelector('button[aria-label="Choose columns"]').click()`, box: `[role=menu][aria-label="Columns"]` },
  { name: 'Settings', open: `document.querySelector('button[aria-label="Settings"]').click()`, box: `[role=dialog][aria-label], [role=dialog][aria-labelledby="settings-title"]` },
];

for (const [width, height] of [[1280, 780], [1000, 650], [900, 520]]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  for (const surface of surfaces) {
    await ev(surface.open);
    await sleep(500);
    const box = await ev(`(() => { const e = document.querySelector(${JSON.stringify(surface.box)}); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight }; })()`);
    if (box === null) {
      check(`${surface.name} opens at ${width} wide`, false, 'not found');
    } else {
      const inside = box.left >= -0.5 && box.top >= -0.5 && box.right <= box.w + 0.5 && box.bottom <= box.h + 0.5;
      check(`${surface.name} stays inside a ${width} by ${height} window`, inside, box);
    }
    await key('Escape');
    await ev(`(() => { const open = document.querySelector('[role=dialog], [role=menu]'); return !!open; })()`);
  }
}
await send('Emulation.clearDeviceMetricsOverride');

summarize();
close();

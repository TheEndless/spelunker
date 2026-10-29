// Real-window checks for searching every drive: the This PC choice in the Look in list, a real all-drives search,
// and the launch with "This PC" that Explorer's This PC menu entry makes.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PAGE_HELPERS } from './cdp.mjs';
import { createChecker, openPage } from './page.mjs';

const { send, sleep, ev, key, mouse, setField, close } = await openPage();
const { check, summarize } = createChecker();
const lookIn = () => ev(`document.querySelector('[role=combobox]').value`);

await send('Page.reload');
await sleep(2500);
await ev(`localStorage.removeItem('spelunker.preferences.v1')`);
await send('Page.reload');
await sleep(2500);
await ev(PAGE_HELPERS);

// ---- there is no separate button: This PC is a choice in the folder dialog and in the Look in list
check('there is no separate all-drives button', await ev(`!document.querySelector('button[aria-label="Search all drives"]')`));
await setField('[role=combobox]', '');
await ev(`document.querySelector('[role=combobox]').focus()`);
await ev(`document.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
await sleep(300);
const offered = await ev(`[...document.querySelectorAll('[role=option]')].map((o) => o.innerText.trim())`);
check('the Look in list offers This PC with the drive letters first', /^This PC \([A-Z]:(, [A-Z]:)*\)$/.test(offered[0]), offered);

// ---- a real search over every drive, by file name, stopped once it has found things on two drives
await setField('[role=combobox]', offered[0]);
await setField('input[title^="Name"]', 'Cargo.toml; hosts');
await sleep(200);
await ev(`document.querySelector('button.go').click()`);
const drivesSeen = new Set();
const started = Date.now();
while (Date.now() - started < 120000) {
  await sleep(1500);
  const paths = await ev(`[...document.querySelectorAll('.body .row')].map((r) => r.querySelector('.cell:nth-child(2)')?.innerText ?? '')`);
  for (const text of paths) if (/^[A-Za-z]:/.test(text)) drivesSeen.add(text[0].toUpperCase());
  const stillRunning = await ev(`!!document.querySelector('button.go.stop')`);
  if (!stillRunning || drivesSeen.size >= 2) break;
}
// Only the rows on screen exist in the page, so a finished search is scrolled through to see them all.
if (!(await ev(`!!document.querySelector('button.go.stop')`))) {
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    await ev(`(() => { const grid = document.querySelector('[role=grid]'); grid.scrollTop = (grid.scrollHeight - grid.clientHeight) * ${fraction}; })()`);
    await sleep(300);
    const visible = await ev(`[...document.querySelectorAll('.body .row')].map((r) => r.querySelector('.cell:nth-child(2)')?.innerText ?? '')`);
    for (const text of visible) if (/^[A-Za-z]:/.test(text)) drivesSeen.add(text[0].toUpperCase());
  }
}
const scanned = await ev(`document.querySelector('.status')?.innerText.replace(/\\n/g, ' | ')`);
if (await ev(`!!document.querySelector('button.go.stop')`)) {
  await ev(`document.querySelector('button.go').click()`);
  await sleep(1500);
}
check('results come from more than one drive', drivesSeen.size >= 2, { drives: [...drivesSeen], scanned });

// ---- Explorer's This PC entry starts the app with the words "This PC"
await setField('[role=combobox]', 'D:\\Development');
const exe = 'D:\\Development\\ai\\spelunker\\target\\debug\\spelunker-app.exe';
// A second launch hands its words to the running window and exits. It is started without
// activation, and SPELUNKER_NO_FOCUS (set by launch.ps1 on the running window) keeps that window
// from coming forward, so this takes no focus.
const startQuiet = fileURLToPath(new URL('./start-quiet.ps1', import.meta.url));
execFileSync('pwsh', ['-NoProfile', '-File', startQuiet, exe, '-Arguments', '"This PC"', '-Wait'], { encoding: 'utf8' });
await sleep(3000);
check('launching with "This PC" sets Look in to all drives', (await lookIn()) === 'This PC (all drives)', await lookIn());

summarize();
close();

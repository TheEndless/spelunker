// Real-window checks for searching every drive: the toggle in the app, a real all-drives search,
// and the launch with "This PC" that Explorer's This PC menu entry makes.
import { execFileSync } from 'node:child_process';
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

// ---- the toggle
const toggle = `document.querySelector('button[aria-label="Search all drives"]')`;
check('a one-click "all drives" button sits next to Browse', await ev(`!!${toggle}`));
check('it starts off', (await ev(`${toggle}.getAttribute('aria-pressed')`)) === 'false');
await setField('[role=combobox]', 'D:\\Development\\ai\\spelunker\\docs');
await ev(`${toggle}.click()`);
await sleep(200);
check('pressing it fills Look in with "This PC (all drives)"', (await lookIn()) === 'This PC (all drives)', await lookIn());
check('and shows as pressed', (await ev(`${toggle}.getAttribute('aria-pressed')`)) === 'true');
await ev(`${toggle}.click()`);
await sleep(200);
check('pressing it again puts the previous folders back', (await lookIn()) === 'D:\\Development\\ai\\spelunker\\docs', await lookIn());

// ---- typing the words works too, and the list offers it
await setField('[role=combobox]', 'this pc');
await sleep(200);
check('typing "this pc" is recognised as all drives', (await ev(`${toggle}.getAttribute('aria-pressed')`)) === 'true');
await setField('[role=combobox]', '');
await ev(`document.querySelector('[role=combobox]').focus()`);
await ev(`document.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
await sleep(300);
const offered = await ev(`[...document.querySelectorAll('[role=option]')].map((o) => o.innerText.trim())`);
check('the Look in list offers it first', offered[0] === 'This PC (all drives)', offered);

// ---- a real search over every drive, by file name, stopped once it has found things on two drives
await ev(`${toggle}.getAttribute('aria-pressed') === 'true' || ${toggle}.click()`);
await setField('[role=combobox]', 'This PC (all drives)');
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
execFileSync('pwsh', ['-NoProfile', '-Command', `Start-Process '${exe}' -ArgumentList '"This PC"'; Start-Sleep 3`], { encoding: 'utf8' });
check('launching with "This PC" sets Look in to all drives', (await lookIn()) === 'This PC (all drives)', await lookIn());

summarize();
close();

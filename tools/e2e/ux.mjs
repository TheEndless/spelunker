// End-to-end check of the UX pass in the real window, using real key events over CDP.
import { writeFileSync, mkdirSync } from 'node:fs';
import { PAGE_HELPERS } from './cdp.mjs';
import { createChecker } from './page.mjs';

const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });

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
// The window never has the real focus (see openPage in page.mjs), so the page behaves as a focused one.
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
const ev = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (reply.result.exceptionDetails) {
    return { exception: reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text };
  }
  return reply.result.result.value;
};

const VK = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageDown: 34, PageUp: 33, Enter: 13, Escape: 27, Tab: 9, F1: 112, F3: 114, F6: 117, F10: 121, ContextMenu: 93, Delete: 46, f: 70, l: 76, n: 78, t: 84 };
async function key(name, { ctrl = false, shift = false } = {}) {
  const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
  const base = { key: name, code: name.length === 1 ? `Key${name.toUpperCase()}` : name, windowsVirtualKeyCode: VK[name], nativeVirtualKeyCode: VK[name], modifiers };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(140);
}

const { check, summarize } = createChecker();

// Start from a clean first-run window, whatever an earlier suite left behind.
await ev(`localStorage.removeItem('spelunker.preferences.v1')`);
await send('Page.reload');
// The first page build after the dev server starts can take a while, so wait until the app has drawn.
for (let attempt = 0; attempt < 60 && !(await ev(`!!document.querySelector('[role=search]')`)); attempt++) await sleep(500);
await sleep(500);
await ev(PAGE_HELPERS);
const active = `(() => { const a = document.activeElement; return a ? { tag: a.tagName, role: a.getAttribute('role'), label: a.getAttribute('aria-label'), text: (a.innerText || '').slice(0, 30), placeholder: a.getAttribute('placeholder'), pane: a.closest('[data-pane]')?.getAttribute('data-pane') ?? null } : null; })()`;
const waitDone = async (limit = 90000) => {
  const started = Date.now();
  await sleep(300);
  while (Date.now() - started < limit) {
    const text = await ev(`document.querySelector('.status').innerText`);
    if (typeof text === 'string' && !text.startsWith('Searching') && !text.startsWith('Stopping')) return text;
    await sleep(150);
  }
  return 'TIMEOUT';
};
const setField = (selector, value) =>
  ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

// ---------- first run: empty state, tooltips, wording
const idle = await ev(`({ title: document.querySelector('.empty strong')?.innerText, text: document.querySelector('.empty')?.innerText, headers: [...document.querySelectorAll('.head button')].map(b => b.innerText.trim()), searchTitle: [...document.querySelectorAll('button.go')].map(b => b.title), nameTitle: document.querySelector('input[placeholder*="log"]')?.title, textTitle: document.querySelector('input[placeholder="Text to find"]')?.title, lookTitle: document.querySelector('[role=combobox]')?.title, landmarks: { search: !!document.querySelector('[role=search]'), main: !!document.querySelector('main'), results: !!document.querySelector('section[aria-label=Results]'), preview: !!document.querySelector('aside[aria-label=Preview]') } })`);
check('empty state guides a first-time user', idle.title === 'Find files' && /Look in/.test(idle.text), idle);
check('column says Matches, not Hits', idle.headers.includes('Matches') && !idle.headers.includes('Hits'), idle.headers);
check('tooltips show shortcuts', /Ctrl\+N/.test(idle.nameTitle) && /Ctrl\+T/.test(idle.textTitle) && /Ctrl\+L/.test(idle.lookTitle) && idle.searchTitle.some((t) => /Enter/.test(t)), idle);
check('landmarks exist (search, main, results, preview)', Object.values(idle.landmarks).every(Boolean), idle.landmarks);

// ---------- Ctrl+F alias and typing a search with the keyboard only
await ev(`document.querySelector('[role=combobox]').focus()`);
await key('f', { ctrl: true });
const afterCtrlF = await ev(active);
check('Ctrl+F focuses Containing text', afterCtrlF?.placeholder === 'Text to find', afterCtrlF);

await ev(`document.querySelector('[role=combobox]').focus()`);
await key('l', { ctrl: true });
check('Ctrl+L focuses Look in (the combobox)', (await ev(active))?.role === 'combobox', await ev(active));

await setField('[role=combobox]', 'D:\\Development\\ai\\spelunker\\crates');
await setField('input[placeholder="Text to find"]', 'cancel');
await ev(`document.querySelector('input[placeholder="Text to find"]').focus()`);
await key('Enter');
const doneText = await waitDone();
check('Enter starts a search that finishes', /Done/.test(doneText), doneText);

// ---------- announcer and status bar
const announce = await ev(`({ announcer: document.querySelector('#search-announcement')?.innerText, footerLive: document.querySelector('footer.status')?.getAttribute('aria-live'), status: document.querySelector('.status').innerText.split(String.fromCharCode(10)).join(' / ') })`);
check('screen reader gets one calm announcement', /^Search finished\. \d+ files? matched\.$/.test(announce.announcer), announce);
check('status bar is not a live region', announce.footerLive === null, announce);
check('status bar says what was found', /\d+ matches? in \d+ files?|files? matched/.test(announce.status), announce.status);

// ---------- grid semantics
await ev(`document.querySelectorAll('.body .row')[2].click()`);
await sleep(300);
const grid = await ev(`(() => { const g = document.querySelector('[role=grid]'); const rows = [...document.querySelectorAll('.body .row')]; const selected = rows.filter(r => r.getAttribute('aria-selected') === 'true'); return { rowcount: g.getAttribute('aria-rowcount'), colcount: g.getAttribute('aria-colcount'), active: g.getAttribute('aria-activedescendant'), rowsRendered: rows.length, selectedCount: selected.length, selectedId: selected[0]?.id, selectedIndexAttr: selected[0]?.getAttribute('aria-rowindex'), headerIndex: document.querySelector('.header').getAttribute('aria-rowindex'), firstRowIndexAttr: rows[0].getAttribute('aria-rowindex'), cellIndex: rows[0].querySelector('.cell').getAttribute('aria-colindex') }; })()`);
check('grid exposes selection and position', grid.active === grid.selectedId && grid.selectedCount === 1 && grid.selectedIndexAttr === '4' && grid.headerIndex === '1' && grid.firstRowIndexAttr === '2' && grid.rowcount === String(grid.rowsRendered + 1) && grid.colcount === '6' && grid.cellIndex === '1', grid);

// ---------- grid keyboard
await ev(`document.querySelector('[role=grid]').focus()`);
const selectedName = () => ev(`document.querySelector('.row.selected .cell')?.innerText`);
await key('Home');
const first = await selectedName();
check('Home selects the first row', (await ev(`document.querySelector('[role=grid]').getAttribute('aria-activedescendant')`)) === 'result-row-0', first);
await key('ArrowDown');
check('ArrowDown moves one row', (await ev(`document.querySelector('[role=grid]').getAttribute('aria-activedescendant')`)) === 'result-row-1');
await key('End');
const rowTotal = await ev(`document.querySelectorAll('.body .row').length`);
check('End selects the last row', (await ev(`document.querySelector('[role=grid]').getAttribute('aria-activedescendant')`)) === `result-row-${rowTotal - 1}`, rowTotal);
await key('ArrowUp');
await key('PageUp');
check('PageUp from near the end moves up (clamped at the top for a short list)', (await ev(`document.querySelector('[role=grid]').getAttribute('aria-activedescendant')`)) === 'result-row-0');

// ---------- context menu from the keyboard
// Inside the app the menu is Windows' own, requested over IPC (stubbed in PAGE_HELPERS, never shown).
// The app's fallback menu only exists in a plain browser, so its keyboard model is checked there (mock.mjs).
const menuCalls = () => ev(`window.__sp.shellMenuCalls.map((c) => ({ paths: c.paths, extras: c.extraLabels.length }))`);
await ev(`window.__sp.shellMenuCalls.length = 0`);
const rowBefore = await selectedName();
await key('F10', { shift: true });
const afterShiftF10 = await menuCalls();
check('Shift+F10 asks for the context menu of the selected row', afterShiftF10.length === 1 && afterShiftF10[0].paths.length === 1 && afterShiftF10[0].paths[0].endsWith('\\' + rowBefore) && afterShiftF10[0].extras === 4, { afterShiftF10, rowBefore });
const focusAfterMenu = await ev(`document.activeElement.getAttribute('role')`);
check('focus is back on the grid once the menu is gone', focusAfterMenu === 'grid', focusAfterMenu);
await key('ContextMenu');
check('the Menu key also asks for it', (await menuCalls()).length === 2, await menuCalls());
await key('Escape');
check('Esc with no menu open leaves the grid focused', (await ev(`document.activeElement.getAttribute('role')`)) === 'grid');

// ---------- header keyboard: roving focus, resize, fit
const widths = () => ev(`getComputedStyle(document.querySelector('.header')).gridTemplateColumns.split(' ').map(parseFloat)`);
await ev(`document.querySelector('.head button').focus()`);
await key('ArrowRight');
check('Right moves between headings', (await ev(`document.activeElement.innerText.trim()`)) === 'Folder');
const before = await widths();
await key('ArrowRight', { ctrl: true });
const afterSmall = await widths();
check('Ctrl+Right widens the column by 8 px', afterSmall[1] - before[1] === 8, { before: before[1], after: afterSmall[1] });
await key('ArrowLeft', { ctrl: true, shift: true });
const afterBig = await widths();
check('Ctrl+Shift+Left narrows it by 32 px', afterSmall[1] - afterBig[1] === 32, { before: afterSmall[1], after: afterBig[1] });
await key('Enter', { ctrl: true });
const afterFit = await widths();
check('Ctrl+Enter fits the column to its content', afterFit[1] !== afterBig[1] && afterFit[1] >= 48 && afterFit[1] <= 600, { before: afterBig[1], after: afterFit[1] });
await key('End');
check('End goes to the last heading', (await ev(`document.activeElement.innerText.trim()`)) === 'Type');
const tabStops = await ev(`[...document.querySelectorAll('.head button')].map(b => b.tabIndex)`);
check('the header is a single tab stop', tabStops.filter((index) => index === 0).length === 1, tabStops);
await key('ArrowDown');
check('Down from a heading goes into the grid', (await ev(`document.activeElement.getAttribute('role')`)) === 'grid');

// ---------- preview region and match stepping
const preview = await ev(`(() => { const l = document.querySelector('.listing'); return { role: l.getAttribute('role'), tab: l.tabIndex, label: l.getAttribute('aria-label'), position: document.querySelector('.position')?.innerText, buttons: [...document.querySelectorAll('.steps button')].map(b => b.getAttribute('aria-label') + '|' + b.title) }; })()`);
check('preview is a focusable, named region', preview.role === 'region' && preview.tab === 0 && /Matching lines in/.test(preview.label), preview);
check('match buttons exist with shortcut tooltips', preview.buttons.length === 2 && /F3/.test(preview.buttons[1]) && /Shift\+F3/.test(preview.buttons[0]), preview.buttons);
check('position reads like Match 1 of N', /^Match 1 of \d+$/.test(preview.position), preview.position);
const total = Number(/of (\d+)/.exec(preview.position)?.[1] ?? 0);
await key('F3');
check('F3 moves to the next match', total < 2 || (await ev(`document.querySelector('.position').innerText`)) === `Match 2 of ${total}`, total);
await key('F3', { shift: true });
await key('F3', { shift: true });
check('Shift+F3 wraps to the last match', (await ev(`document.querySelector('.position').innerText`)) === `Match ${total} of ${total}`, total);

// ---------- F6 pane cycling
await ev(`document.querySelector('input[placeholder="Text to find"]').focus()`);
await key('F6');
check('F6 goes from search to results', (await ev(active))?.pane === 'results' && (await ev(active))?.role === 'grid', await ev(active));
await key('F6');
check('F6 goes on to the results map below the list', (await ev(active))?.pane === 'map', await ev(active));
await key('F6');
check('F6 goes on to the preview', (await ev(active))?.pane === 'preview', await ev(active));
await key('F6');
check('F6 wraps back to search', (await ev(active))?.pane === 'search', await ev(active));
await key('F6', { shift: true });
check('Shift+F6 goes backward to the preview', (await ev(active))?.pane === 'preview', await ev(active));

// ---------- shortcuts popover and focus return
await ev(`document.querySelector('input[placeholder="Text to find"]').focus()`);
await key('F1');
const shortcuts = await ev(`({ open: !!document.querySelector('[role=dialog][aria-label="Keyboard shortcuts"]'), focusInside: !!document.activeElement.closest('[aria-label="Keyboard shortcuts"]'), rows: document.querySelectorAll('[aria-label="Keyboard shortcuts"] kbd').length })`);
check('F1 opens the shortcuts list with focus inside', shortcuts.open && shortcuts.focusInside && shortcuts.rows > 10, shortcuts);
await key('Escape');
const afterShortcuts = await ev(`({ closed: !document.querySelector('[role=dialog][aria-label="Keyboard shortcuts"]'), focus: document.activeElement.getAttribute('placeholder') })`);
check('Esc closes it and focus returns to where it was', afterShortcuts.closed && afterShortcuts.focus === 'Text to find', afterShortcuts);

// ---------- saved searches and theme popovers: focus in, focus back
// The buttons are found by accessible name: "Saved searches" and "Appearance, <theme>".
for (const [label, dialogLabel] of [['Saved searches', 'Saved searches'], ['Appearance', 'Appearance']]) {
  const toggle = `[...document.querySelectorAll('button.tool')].find(b => (b.getAttribute('aria-label') || '').startsWith(${JSON.stringify(label)}))`;
  await ev(`${toggle}.focus()`);
  await ev(`${toggle}.click()`);
  await sleep(250);
  const open = await ev(`({ open: !!document.querySelector('[role=dialog][aria-label=${JSON.stringify(dialogLabel)}]'), inside: !!document.activeElement.closest('[role=dialog]') })`);
  check(`${dialogLabel} popover takes focus when opened`, open.open && open.inside, open);
  await key('Escape');
  const closed = await ev(`({ closed: !document.querySelector('[role=dialog][aria-label=${JSON.stringify(dialogLabel)}]'), onToggle: document.activeElement === ${toggle} })`);
  check(`${dialogLabel} popover returns focus to its button on Esc`, closed.closed && closed.onToggle, closed);
}

// ---------- recent folders combobox
await ev(`document.querySelector('[role=combobox]').focus()`);
await setField('[role=combobox]', '');
await key('ArrowDown');
const combo = await ev(`({ expanded: document.querySelector('[role=combobox]').getAttribute('aria-expanded'), options: document.querySelectorAll('[role=option]').length, active: document.querySelector('[role=combobox]').getAttribute('aria-activedescendant') })`);
check('ArrowDown opens the recent folders list and activates an option', combo.expanded === 'true' && combo.options >= 1 && combo.active, combo);
await key('Escape');
check('Esc closes the list and keeps focus in the field', (await ev(`document.querySelector('[role=combobox]').getAttribute('aria-expanded')`)) === 'false' && (await ev(active))?.role === 'combobox');
await key('ArrowDown');
await key('ArrowDown');
const chosenFrom = await ev(`document.querySelector('[role=option][aria-selected=true] .folder')?.innerText`);
const statusBefore = await ev(`document.querySelector('.status').innerText`);
await key('Enter');
const chosen = await ev(`({ value: document.querySelector('[role=combobox]').value, status: document.querySelector('.status').innerText })`);
check('Enter on an option fills the field and does not start a search', chosen.value === chosenFrom && chosen.status === statusBefore, { chosenFrom, chosen });

// ---------- filter chips
await ev(`[...document.querySelectorAll('button.tool')].find(b => b.innerText.includes('Filters')).click()`);
await sleep(250);
await ev(`(() => { const set = (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); }; set('select[aria-label="Size filter"]', 'larger'); return true; })()`);
await sleep(200);
await ev(`(() => { const e = document.querySelector('input[aria-label="Size"]'); e.value = '1'; e.dispatchEvent(new Event('input', {bubbles:true})); const u = document.querySelector('select[aria-label="Size unit"]'); u.value = 'KB'; u.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
await ev(`[...document.querySelectorAll('button.tool')].find(b => b.innerText.includes('Filters')).click()`);
await sleep(250);
const chips = await ev(`({ labels: [...document.querySelectorAll('ul[aria-label="Active filters"] li')].map(l => l.innerText.replace(/[^\\x20-\\x7E]/g, '').trim()), panelOpen: !!document.querySelector('.filters') })`);
check('closed Filters panel shows a chip per active filter', !chips.panelOpen && chips.labels.length === 1 && /Size over 1 KB/.test(chips.labels[0]), chips);
await ev(`document.querySelector('ul[aria-label="Active filters"] button[aria-label^="Remove filter"]').click()`);
await sleep(250);
const afterRemove = await ev(`({ chips: document.querySelectorAll('ul[aria-label="Active filters"] li').length, badge: document.querySelector('.badge')?.innerText ?? null })`);
check('removing a chip clears that filter', afterRemove.chips === 0 && afterRemove.badge === null, afterRemove);

// ---------- empty state after a search with no matches
await setField('input[placeholder="Text to find"]', 'zzzz_nothing_matches_qq');
await ev(`document.querySelector('input[placeholder="Text to find"]').focus()`);
await key('Enter');
await waitDone();
const none = await ev(`({ title: document.querySelector('.empty strong')?.innerText, lines: [...document.querySelectorAll('.empty p')].map(p => p.innerText), announcer: document.querySelector('#search-announcement').innerText })`);
check('zero results explain themselves', none.title === 'No files matched' && none.lines.length >= 1 && /No files matched/.test(none.announcer), none);

// ---------- errors list
await setField('[role=combobox]', 'C:\\Windows');
await setField('input[placeholder="Text to find"]', '');
await setField('input[placeholder*="log"]', '*.zzqqxx');
await ev(`document.querySelector('input[placeholder="Text to find"]').focus()`);
await key('Enter');
await waitDone(120000);
const errorsButton = await ev(`(() => { const b = [...document.querySelectorAll('footer button')].find(x => /errors? skipped/.test(x.innerText)); return b ? b.innerText : null; })()`);
check('errors skipped is a button when there are errors', Boolean(errorsButton), errorsButton);
if (errorsButton) {
  await ev(`[...document.querySelectorAll('footer button')].find(x => /errors? skipped/.test(x.innerText)).focus()`);
  await ev(`[...document.querySelectorAll('footer button')].find(x => /errors? skipped/.test(x.innerText)).click()`);
  await sleep(300);
  const errorsPanel = await ev(`({ open: !!document.querySelector('[role=dialog][aria-label="Files and folders that could not be read"]'), items: document.querySelectorAll('[role=dialog][aria-label="Files and folders that could not be read"] li').length, focusInside: !!document.activeElement.closest('[role=dialog]') })`);
  check('clicking it lists the unreadable paths', errorsPanel.open && errorsPanel.items > 0 && errorsPanel.focusInside, errorsPanel);
  await key('Escape');
  const errorsClosed = await ev(`({ closed: !document.querySelector('[role=dialog][aria-label="Files and folders that could not be read"]'), onButton: /errors? skipped/.test(document.activeElement.innerText) })`);
  check('Esc closes it and returns focus to the button', errorsClosed.closed && errorsClosed.onButton, errorsClosed);
}

// ---------- forced colors (Windows High Contrast)
await setField('[role=combobox]', 'D:\\Development\\ai\\spelunker\\crates');
await setField('input[placeholder*="log"]', '*.rs');
await setField('input[placeholder="Text to find"]', 'cancel');
await ev(`document.querySelector('input[placeholder="Text to find"]').focus()`);
await key('Enter');
await waitDone();
await ev(`document.querySelectorAll('.body .row')[1].click()`);
await sleep(300);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
await sleep(400);
const forced = await ev(`(() => { const row = document.querySelector('.row.selected'); const cs = getComputedStyle(row); const go = getComputedStyle(document.querySelector('button.go')); return { matches: matchMedia('(forced-colors: active)').matches, rowOutline: cs.outlineWidth + ' ' + cs.outlineStyle, goBorder: go.borderTopWidth + ' ' + go.borderTopStyle }; })()`);
check('forced colors: selected row gets an outline, buttons get a border', forced.matches && forced.rowOutline === '2px solid' && forced.goBorder === '1px solid', forced);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${outDir}/forced-colors.png`, Buffer.from(shot.result.data, 'base64'));
await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });

summarize();
socket.close();

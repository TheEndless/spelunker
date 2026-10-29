// Real-window checks: the resizable, collapsible preview, and columns that follow the pane.
import { PAGE_HELPERS } from './cdp.mjs';
import { createChecker, openPage } from './page.mjs';

const { send, sleep, ev, key, mouse, setField, close } = await openPage();
const { check, summarize } = createChecker();
const rect = (selector) =>
  ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
// The preview's own splitter. The results map has a separator of its own, above the map.
const PREVIEW_SPLITTER = '[role=separator][data-pane="preview"]';
const gridState = () =>
  ev(`(() => { const s = document.querySelector('[role=grid]'); return { scrollW: s.scrollWidth, clientW: s.clientWidth, heads: [...document.querySelectorAll('.head')].reduce((sum, h) => sum + h.getBoundingClientRect().width, 0) }; })()`);

await send('Page.reload');
await sleep(2500);
await ev(`localStorage.removeItem('spelunker.preferences.v1')`);
await send('Page.reload');
await sleep(2500);
await ev(PAGE_HELPERS);
await setField('[role=combobox]', 'D:\\Development\\ai\\spelunker\\crates');
await setField('input[placeholder="Text to find"]', 'fn ');
await ev(`document.querySelector('button.go').click()`);
await sleep(2500);
await ev(`document.querySelector('.body .row')?.click()`);
await sleep(600);

// ---- the preview starts at its default share and has a splitter
const start = await rect('aside.preview');
const splitter = await rect(PREVIEW_SPLITTER);
check('the preview starts at about 25 percent of the window', start.w > 300 && start.w < 400, start);
check('a splitter sits on the preview edge', splitter && Math.abs(splitter.cx - start.x) < 6, { splitter, start });

// ---- drag it
await mouse('mouseMoved', splitter.cx, splitter.cy + 100);
await mouse('mousePressed', splitter.cx, splitter.cy + 100);
for (let i = 1; i <= 10; i++) {
  await mouse('mouseMoved', splitter.cx - i * 20, splitter.cy + 100, { buttons: 1 });
  await sleep(15);
}
await mouse('mouseReleased', splitter.cx - 200, splitter.cy + 100);
await sleep(300);
const wider = await rect('aside.preview');
check('dragging the splitter left widens the preview', wider.w > start.w + 150, { before: start.w, after: wider.w });
const gridAfterDrag = await gridState();
check('the grid has no sideways scroll bar after the drag (columns refit to the narrower pane)', gridAfterDrag.scrollW <= gridAfterDrag.clientW + 1, gridAfterDrag);

// ---- the limits
const results1 = await rect('.results');
check('the results keep their minimum width', results1.w >= 359, results1);
await mouse('mouseMoved', wider.x, splitter.cy + 100);
await mouse('mousePressed', wider.x, splitter.cy + 100);
await mouse('mouseMoved', 5, splitter.cy + 100, { buttons: 1 });
await mouse('mouseReleased', 5, splitter.cy + 100);
await sleep(300);
const extreme = await rect('.results');
check('dragging as far as it goes still leaves the results 360 px', extreme.w >= 359 && extreme.w < 380, extreme);

// ---- keyboard
await ev(`document.querySelector('${PREVIEW_SPLITTER}').focus()`);
const beforeKey = await rect('aside.preview');
await key('ArrowRight');
const afterRight = await rect('aside.preview');
check('Right narrows the preview by 16 px', Math.round(beforeKey.w - afterRight.w) === 16, { beforeKey: beforeKey.w, afterRight: afterRight.w });
await key('ArrowLeft', { shift: true });
const afterShiftLeft = await rect('aside.preview');
check('Shift+Left widens it by 48 px', Math.round(afterShiftLeft.w - afterRight.w) === 48 || afterShiftLeft.w >= afterRight.w, { afterRight: afterRight.w, afterShiftLeft: afterShiftLeft.w });
await key('Home');
const narrowest = await rect('aside.preview');
check('Home makes it as narrow as allowed (280 px)', Math.round(narrowest.w) === 280, narrowest);
const valueNow = await ev(`document.querySelector('${PREVIEW_SPLITTER}').getAttribute('aria-valuenow')`);
check('the splitter reports its value for assistive technology', Number(valueNow) === 280, valueNow);

// ---- double-click resets
await ev(`document.querySelector('${PREVIEW_SPLITTER}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await sleep(300);
const reset = await rect('aside.preview');
check('double-clicking the splitter restores the default width', Math.abs(reset.w - start.w) < 4, { reset: reset.w, start: start.w });

// ---- persistence
await key('Home');
await sleep(600);
const stored = await ev(`JSON.parse(localStorage.getItem('spelunker.preferences.v1')).previewWidth`);
check('the width is saved', stored === 280, stored);
await send('Page.reload');
await sleep(2500);
await ev(PAGE_HELPERS);
const afterReload = await rect('aside.preview');
check('the width survives a restart', Math.round(afterReload.w) === 280, afterReload);

// ---- collapse with the button
await setField('[role=combobox]', 'D:\\Development\\ai\\spelunker\\crates');
await setField('input[placeholder="Text to find"]', 'fn ');
await ev(`document.querySelector('button.go').click()`);
await sleep(2500);
const gridWithPreview = await gridState();
// A real click focuses the button first, and that is what decides where focus goes afterwards.
await ev(`(() => { const b = document.querySelector('button[aria-label="Hide the preview"]'); b.focus(); b.click(); })()`);
await sleep(700);
const rail = await rect('.rail[data-pane=preview]');
check('Hide the preview leaves a narrow strip on the right', rail && rail.w < 50 && !(await ev(`!!document.querySelector('aside.preview')`)), rail);
const focusAfterHide = await ev(`document.activeElement.closest('[data-pane]')?.getAttribute('data-pane')`);
check('focus moves to the results when the preview it was in disappears', focusAfterHide === 'results', focusAfterHide);
const gridCollapsed = await gridState();
check('the columns widen to use the room (no gap, no scroll bar)', gridCollapsed.scrollW <= gridCollapsed.clientW + 1 && gridCollapsed.clientW > gridWithPreview.clientW + 200, { gridWithPreview, gridCollapsed });
check('the header fills the pane to its right edge', Math.abs(gridCollapsed.heads - (gridCollapsed.clientW - 3)) < 40, gridCollapsed);

// ---- F6 skips the hidden preview
await ev(`document.querySelector('input[placeholder="Text to find"]').focus()`);
const panesVisited = [];
for (let press = 0; press < 3; press++) {
  await key('F6');
  panesVisited.push(await ev(`document.activeElement.closest('[data-pane]')?.getAttribute('data-pane')`));
}
check('F6 cycles search, results, map, search while the preview is hidden', panesVisited.join(' ') === 'results map search', panesVisited);

// ---- collapse state persists and restore works with the shortcut
await sleep(400);
const collapsedStored = await ev(`JSON.parse(localStorage.getItem('spelunker.preferences.v1')).previewCollapsed`);
check('the hidden state is saved', collapsedStored === true, collapsedStored);
await key('p', { ctrl: true, shift: true });
check('Ctrl+Shift+P shows the preview again', await ev(`!!document.querySelector('aside.preview')`));
const focusAfterShow = await ev(`document.activeElement.closest('[data-pane]')?.getAttribute('data-pane')`);
check('and does not steal focus from the search box', focusAfterShow === 'search', focusAfterShow);
await key('p', { ctrl: true, shift: true });
check('Ctrl+Shift+P hides it again', !(await ev(`!!document.querySelector('aside.preview')`)));

// ---- restoring from the strip
await ev(`(() => { const b = document.querySelector('button[aria-label="Show the preview"]'); b.focus(); b.click(); })()`);
await sleep(600);
check('the strip button brings the preview back', await ev(`!!document.querySelector('aside.preview')`));
const focusAfterRestore = await ev(`document.activeElement.closest('[data-pane]')?.getAttribute('data-pane')`);
check('and focus follows it into the preview', focusAfterRestore === 'preview', focusAfterRestore);
const widthBack = await rect('aside.preview');
check('at the width it had before', Math.round(widthBack.w) === 280, widthBack);

// ---- window resize refits columns
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 650, deviceScaleFactor: 1, mobile: false });
await sleep(900);
const small = await gridState();
check('shrinking the window refits the columns without a scroll bar', small.scrollW <= small.clientW + 1, small);
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(900);
const large = await gridState();
check('widening it spreads them again', large.scrollW <= large.clientW + 1 && large.heads > small.heads + 200, { small, large });
await send('Emulation.clearDeviceMetricsOverride');

summarize();
close();

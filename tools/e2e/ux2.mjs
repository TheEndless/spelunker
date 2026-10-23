// Regression checks for the audit fixes, in the real window with real key and mouse events over CDP.
import { PAGE_HELPERS } from './cdp.mjs';
import { createChecker, openPage } from './page.mjs';

const { send, sleep, ev, key, mouse, setField, close } = await openPage();
const { check, summarize } = createChecker();
async function mouseClickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(200);
}

const active = `(() => { const a = document.activeElement; return a ? { tag: a.tagName, role: a.getAttribute('role'), label: a.getAttribute('aria-label'), text: (a.innerText || '').slice(0, 30), cls: a.className, pane: a.closest('[data-pane]')?.getAttribute('data-pane') ?? null, id: a.id } : null; })()`;
const statusText = () => ev(`document.querySelector('.status').innerText`);
const waitDone = async (limit = 90000) => {
  const started = Date.now();
  await sleep(300);
  while (Date.now() - started < limit) {
    const text = await statusText();
    if (typeof text === 'string' && !text.startsWith('Searching') && !text.startsWith('Stopping')) return text;
    await sleep(150);
  }
  return 'TIMEOUT';
};
const runSearch = async (folder, text) => {
  await setField('[role=combobox]', folder);
  await setField('input[placeholder="Text to find"]', text);
  await sleep(200);
  await ev(`document.querySelector('input[placeholder="Text to find"]').focus()`);
  await key('Enter');
  return waitDone();
};

// Start from a clean first-run window: no saved preferences from another suite, and nothing running.
await ev(`localStorage.removeItem('spelunker.preferences.v1')`);
await send('Page.reload');
for (let attempt = 0; attempt < 60 && !(await ev(`!!document.querySelector('[role=search]')`)); attempt++) await sleep(500);
await sleep(500);
await ev(PAGE_HELPERS);

// Small, fast folder with many text hits.
const finished = await runSearch('D:\\Development\\ai\\spelunker\\docs', 'the');
check('baseline search finishes', /matches in \d+ files?|files? matched/.test(finished), finished);

// ---------- header focus must not swallow the global shortcuts
await ev(`document.querySelector('.head button').focus()`);
await key('F6');
const afterHeaderF6 = await ev(active);
// The heading is part of the results pane, so F6 moves on to the next pane, the map below the list.
check('F6 from a column heading moves on to the next pane (the results map)', afterHeaderF6?.pane === 'map', afterHeaderF6);
await ev(`document.querySelector('.head button').focus()`);
await key('F1');
const popoverOpen = await ev(`!!document.querySelector('[role=dialog][aria-label="Keyboard shortcuts"]')`);
check('F1 from a column heading opens the shortcuts list', popoverOpen);

// ---------- F1 then clicking "?" toggles once, it does not close and reopen
const questionRect = await ev(`(() => { const r = document.querySelector('button[aria-label="Keyboard shortcuts"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
await mouseClickAt(questionRect.x, questionRect.y);
const afterClick = await ev(`!!document.querySelector('[role=dialog][aria-label="Keyboard shortcuts"]')`);
check('clicking "?" while the list is open closes it for good', afterClick === false);

// ---------- appearance menu is a radio group with arrow keys
await ev(`document.querySelector('.theme > button').click()`);
await sleep(300);
const radios = () => ev(`[...document.querySelectorAll('[role=radiogroup][aria-label="Color theme"] [role=radio]')].map((r) => ({ id: r.dataset.id, checked: r.getAttribute('aria-checked'), tab: r.tabIndex }))`);
const radiosBefore = await radios();
check('exactly one theme is a tab stop and it is the checked one', Array.isArray(radiosBefore) && radiosBefore.filter((r) => r.tab === 0).length === 1 && radiosBefore.find((r) => r.tab === 0)?.checked === 'true', radiosBefore);
await ev(`document.querySelector('[role=radiogroup][aria-label="Color theme"] [role=radio][tabindex="0"]').focus()`);
const firstChecked = radiosBefore.find((r) => r.checked === 'true')?.id;
await key('ArrowDown');
const radiosAfter = await radios();
const focusedRadio = await ev(`document.activeElement?.dataset?.id`);
const nowChecked = radiosAfter.find((r) => r.checked === 'true')?.id;
check('Down arrow checks the next theme and moves focus to it', nowChecked && nowChecked !== firstChecked && focusedRadio === nowChecked, { firstChecked, nowChecked, focusedRadio });
await key('ArrowUp');
const backChecked = (await radios()).find((r) => r.checked === 'true')?.id;
check('Up arrow returns to the previous theme', backChecked === firstChecked, { backChecked, firstChecked });
await key('Escape');

// ---------- recent-folder option: a real mouse click selects it
await ev(`document.querySelector('[role=combobox]').focus()`);
await setField('[role=combobox]', '');
await key('ArrowDown');
const option = await ev(`(() => { const o = document.querySelector('[role=listbox] [role=option]'); if (!o) return null; const r = o.getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2, text: o.innerText.trim().split('\\n')[0] }; })()`);
if (option) {
  await mouseClickAt(option.x, option.y);
  const chosen = await ev(`({ value: document.querySelector('[role=combobox]').value, open: !!document.querySelector('[role=listbox]') })`);
  check('mouse click on a recent folder fills the field and closes the list', chosen.value.length > 0 && chosen.open === false && option.text.includes(chosen.value.slice(0, 10)), { option, chosen });
} else {
  check('recent folder option exists to click', false, 'no option rendered');
}
const describedBy = await ev(`(() => { const id = document.querySelector('[role=combobox]').getAttribute('aria-describedby'); return document.getElementById(id)?.innerText ?? null; })()`);
check('combobox is described for screen readers', /Delete/.test(describedBy ?? ''), describedBy);
const labelFor = await ev(`document.querySelector('label[for=lookin-input]') !== null && document.getElementById('lookin-input') === document.querySelector('[role=combobox]')`);
check('"Look in" label is tied to the field', labelFor);

// ---------- Stop keeps focus on the same button
await setField('[role=combobox]', 'D:\\');
await setField('input[placeholder="Text to find"]', 'e');
await sleep(200);
await ev(`document.querySelector('button.go').focus()`);
await key('Enter');
await sleep(1500);
const runningFocus = await ev(`document.activeElement === document.querySelector('button.go') && /Stop/.test(document.activeElement.innerText)`);
check('starting a search from the button leaves focus on it, now labeled Stop', runningFocus);

// ---------- Escape in the context menu must not stop the running search
await ev(`document.querySelector('.body .row')?.click()`);
await sleep(200);
await ev(`document.querySelector('[role=grid]').focus()`);
// The native shell menu is stubbed (see PAGE_HELPERS), so the request is recorded instead of shown.
await ev(`window.__sp.shellMenuCalls.length = 0`);
await key('F10', { shift: true });
const menuOpen = await ev(`window.__sp.shellMenuCalls.length === 1`);
const statusAfterMenu = await statusText();
check('context menu requested while searching', menuOpen);
// Still searching, or finished by itself on a fast machine. Only "Stopping" or "Stopped" would mean the key stopped it.
check('asking for the menu does not stop the search', /^(Searching|Done)/.test(statusAfterMenu ?? ''), statusAfterMenu);

// ---------- Stop returns focus to the button, which is now Search
await ev(`document.querySelector('button.go').focus()`);
await key('Enter');
await waitDone();
const afterStop = await ev(`document.activeElement === document.querySelector('button.go') && /Search/.test(document.activeElement.innerText)`);
check('Stop leaves focus on the same button, now labeled Search', afterStop);

// ---------- sort keeps the selected row in view
await runSearch('D:\\Development\\ai\\spelunker\\crates', 'fn');
await ev(`document.querySelector('[role=grid]').focus()`);
await key('End');
const selectedName = await ev(`document.querySelector('.row.selected')?.innerText.split('\\n')[0]`);
await ev(`[...document.querySelectorAll('.head button')].find((b) => b.innerText.trim().startsWith('Name')).click()`);
await sleep(400);
const visible = await ev(`(() => { const row = document.querySelector('.row.selected'); if (!row) return { found: false }; const scroller = document.querySelector('[role=grid]').getBoundingClientRect(); const r = row.getBoundingClientRect(); return { found: true, inView: r.bottom > scroller.top && r.top < scroller.bottom }; })()`);
check('after sorting, the selected row is still on screen', visible.found && visible.inView, { selectedName, visible });

// ---------- empty result has a valid grid row structure
await runSearch('D:\\Development\\ai\\spelunker\\docs', 'zzzzqqqqnotpresent12345');
const emptyShape = await ev(`(() => { const empty = document.querySelector('.empty'); return { role: empty?.getAttribute('role'), childRole: empty?.firstElementChild?.getAttribute('role'), inGrid: !!empty?.closest('[role=grid]') }; })()`);
check('empty results are a row holding a gridcell inside the grid', emptyShape.role === 'row' && emptyShape.childRole === 'gridcell' && emptyShape.inGrid, emptyShape);

// ---------- chip removal keeps focus on something sensible
await ev(`(() => { const t = document.querySelector('button[aria-controls=filters-panel]'); if (t.getAttribute('aria-expanded') !== 'true') t.click(); })()`);
await sleep(300);
await ev(`(() => { const mode = document.querySelector('select[aria-label="Size filter"]'); mode.value = 'larger'; mode.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await sleep(200);
await ev(`(() => { const el = document.querySelector('input[aria-label="Size"]'); el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await ev(`(() => { const t = document.querySelector('button[aria-controls=filters-panel]'); if (t.getAttribute('aria-expanded') === 'true') t.click(); })()`);
await sleep(300);
const chipCount = await ev(`document.querySelectorAll('.chips button[aria-label^="Remove filter"]').length`);
if (chipCount > 0) {
  await ev(`document.querySelector('.chips button[aria-label^="Remove filter"]').focus()`);
  await key('Enter');
  await sleep(300);
  const focusAfterRemove = await ev(active);
  check('removing the only chip keeps focus out of the void', focusAfterRemove && focusAfterRemove.tag !== 'BODY', focusAfterRemove);
} else {
  check('a size filter produced a chip to remove', false, { chipCount });
}

summarize();
close();

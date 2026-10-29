// Real-window checks for the new features: columns, previews, settings, export, header layout.
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('final', { recursive: true });
import { PAGE_HELPERS } from './cdp.mjs';
import { createChecker, openPage } from './page.mjs';

const { send, sleep, ev, key, mouse, setField, close } = await openPage();
const { check, summarize } = createChecker();
async function click(x, y) {
  await mouse('mouseMoved', x, y);
  await mouse('mousePressed', x, y);
  await mouse('mouseReleased', x, y);
  await sleep(250);
}
async function drag(fromX, toX, y) {
  await mouse('mouseMoved', fromX, y);
  await mouse('mousePressed', fromX, y);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', fromX + ((toX - fromX) * i) / steps, y, { buttons: 1 });
    await sleep(15);
  }
  await mouse('mouseReleased', toX, y);
  await sleep(300);
}
const headings = () => ev(`[...document.querySelectorAll('.head button')].map((b) => b.innerText.replace(/[▲▼]/g, '').trim())`);
const rect = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
const shot = async (name, clip) => {
  const reply = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  writeFileSync(`final/${name}.png`, Buffer.from(reply.result.data, 'base64'));
};

await send('Page.reload');
await sleep(2500);
await ev(`localStorage.removeItem('spelunker.preferences.v1')`);
await send('Page.reload');
await sleep(2500);
await ev(PAGE_HELPERS);
await setField('[role=combobox]', 'D:\\Development\\ai\\spelunker\\docs');
await setField('input[placeholder="Text to find"]', 'the');
await ev(`document.querySelector('button.go').click()`);
await sleep(1500);

// ---- column chooser
check('default headings in the classic order, without Matches', JSON.stringify(await headings()) === JSON.stringify(['Name', 'Folder', 'Size', 'Modified', 'Type']), await headings());
const corner = await rect('.corner');
await click(corner.cx, corner.cy);
const menuItems = await ev(`[...document.querySelectorAll('[role=menu][aria-label=Columns] [role^=menuitem]')].map((b) => [b.innerText.trim(), b.getAttribute('aria-checked')])`);
check('chooser lists every column, all checked but Matches, then the sizing commands', menuItems.length === 9 && menuItems.slice(0, 6).every(([label, checked]) => checked === (label === 'Matches' ? 'false' : 'true')), menuItems);
await shot('columns-menu', { x: 400, y: 100, width: 500, height: 420 });

const matchesItem = await ev(`(() => { const b = [...document.querySelectorAll('[role=menu][aria-label=Columns] button')].find((x) => x.innerText.trim() === 'Matches'); const r = b.getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`);
await click(matchesItem.x, matchesItem.y);
check('choosing Matches shows the column in its place', JSON.stringify(await headings()) === JSON.stringify(['Name', 'Folder', 'Matches', 'Size', 'Modified', 'Type']), await headings());

const typeItem = await ev(`(() => { const b = [...document.querySelectorAll('[role=menu][aria-label=Columns] button')].find((x) => x.innerText.trim() === 'Type'); const r = b.getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`);
await click(typeItem.x, typeItem.y);
check('hiding Type removes the column', !(await headings()).includes('Type'), await headings());
check('the menu stays open so several columns can be changed', await ev(`!!document.querySelector('[role=menu][aria-label=Columns]')`));
await key('Escape');
check('Esc closes the chooser', !(await ev(`!!document.querySelector('[role=menu][aria-label=Columns]')`)));

// ---- drag to reorder
const sizeHead = await rect('.head:nth-child(4)');
const nameHead = await rect('.head:nth-child(1)');
await drag(sizeHead.cx, nameHead.x + 8, sizeHead.cy);
let order = await headings();
check('dragging Size before Name reorders the columns', order[0] === 'Size' && order[1] === 'Name', order);
const afterDragSort = await ev(`document.querySelector('.head[aria-sort=ascending], .head[aria-sort=descending]') === null`);
check('a drag does not also sort the column', afterDragSort);

// ---- keyboard reorder
await ev(`document.querySelectorAll('.head button')[0].focus()`);
await key('ArrowRight', { alt: true, shift: true });
order = await headings();
check('Alt+Shift+Right moves the focused column one place', order[0] === 'Name' && order[1] === 'Size', order);
const stillFocused = await ev(`document.activeElement.innerText.trim()`);
check('and focus stays on that column', stillFocused.startsWith('Name') || stillFocused.startsWith('Size'), stillFocused);

// ---- fit / resize
const sizedIndex = (await headings()).indexOf('Matches') + 1;
const folderHead = await rect(`.head:nth-child(${sizedIndex}) .resizer`);
const before = (await rect(`.head:nth-child(${sizedIndex})`)).w;
await mouse('mouseMoved', folderHead.cx, folderHead.cy);
await mouse('mousePressed', folderHead.cx, folderHead.cy, { clickCount: 1 });
await mouse('mouseMoved', folderHead.cx + 60, folderHead.cy, { buttons: 1 });
await mouse('mouseReleased', folderHead.cx + 60, folderHead.cy);
await sleep(250);
const widened = (await rect(`.head:nth-child(${sizedIndex})`)).w;
check('dragging the edge widens a column', widened > before + 40, { before, widened });
await ev(`(() => { const r = document.querySelector('.head:nth-child(${sizedIndex}) .resizer'); r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`);
await sleep(250);
const fitted = (await rect(`.head:nth-child(${sizedIndex})`)).w;
check('double-clicking the edge fits it to its content', fitted < widened - 20, { widened, fitted });

// ---- persistence
// Saves for resizing are debounced by a third of a second.
await sleep(600);
const stored = await ev(`JSON.parse(localStorage.getItem('spelunker.preferences.v1')).columns`);
check('layout is saved with order, hidden columns, and automatic sizing off after a manual resize', stored.hidden.includes('type') && stored.order[0] === 'name' && stored.autoSize === false, stored);
await send('Page.reload');
await sleep(2500);
await ev(PAGE_HELPERS);
order = await headings();
check('layout survives a restart', order[0] === 'Name' && !order.includes('Type') && order.length === 5, order);

// ---- reset
const corner2 = await rect('.corner');
await click(corner2.cx, corner2.cy);
const reset = await ev(`(() => { const b = [...document.querySelectorAll('[role=menu][aria-label=Columns] button')].find((x) => x.innerText.trim() === 'Reset columns'); const r = b.getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`);
await click(reset.x, reset.y);
order = await headings();
check('Reset columns restores the default set and order', JSON.stringify(order) === JSON.stringify(['Name', 'Folder', 'Size', 'Modified', 'Type']), order);

// ---- right-click on a heading opens the same chooser, and the Menu key does too
const folderHeading = await rect('.head:nth-child(2)');
await mouse('mouseMoved', folderHeading.cx, folderHeading.cy);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: folderHeading.cx, y: folderHeading.cy, button: 'right', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: folderHeading.cx, y: folderHeading.cy, button: 'right', clickCount: 1 });
await sleep(300);
check('right-clicking a heading opens the column chooser', await ev(`!!document.querySelector('[role=menu][aria-label=Columns]')`));
await key('Escape');
await ev(`document.querySelectorAll('.head button')[1].focus()`);
await key('ContextMenu');
check('the Menu key on a heading opens it too', await ev(`!!document.querySelector('[role=menu][aria-label=Columns]')`));
await key('Escape');

summarize();
close();

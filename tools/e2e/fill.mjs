// Checks that the results columns always fill their pane as the window changes size, in automatic
// and in hand-sized mode. It runs the page in headless Edge against the dev server (mock backend),
// because that reports resizes the way a real window does, and needs no Spelunker window.
// Usage: start the dev server (npm run dev), then: node fill.mjs
import { launchHeadlessEdge, resizeTo as resizeHeadless, settleFrames } from './headless.mjs';
import { createChecker, openPage } from './page.mjs';

const edge = await launchHeadlessEdge({ port: 9341, width: 1280, height: 780, name: 'fill' });
const { send, sleep, ev, close } = await openPage({ webSocketDebuggerUrl: edge.webSocketDebuggerUrl });
const { check, summarize } = createChecker();
const resizeTo = (width, height) => resizeHeadless(send, width, height);
/** How well the columns fill the grid: header total against the grid, and whether it scrolls sideways. */
const fill = () =>
  ev(`(() => { const g = document.querySelector('[role=grid]'); const heads = [...document.querySelectorAll('.head')].map((h) => h.getBoundingClientRect().width); const total = heads.reduce((a, b) => a + b, 0); return { pane: g.clientWidth, total: Math.round(total), gap: Math.round(g.clientWidth - total), scrolls: g.scrollWidth > g.clientWidth + 1 }; })()`);
const fills = (state) => !state.scrolls && state.gap >= 0 && state.gap <= 40;

await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(2500);
await ev(`localStorage.removeItem('spelunker.preferences.v1')`);
await resizeTo(1280, 780);
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(2500);
await ev(`(async () => {
  const set = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('[role=combobox]', 'C:/Windows');
  set('input[placeholder="Text to find"]', 'a');
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('button.go').click();
  await new Promise((r) => setTimeout(r, 2500));
})()`);

// ---- automatic mode
const startState = await fill();
check('automatic: the columns fill the pane at 1280', fills(startState), startState);
await resizeTo(1900, 900);
const wide = await fill();
check('automatic: they follow the window when it widens', fills(wide) && wide.total > startState.total + 300, { startState, wide });
await resizeTo(1000, 650);
const narrow = await fill();
check('automatic: and when it narrows', fills(narrow) && narrow.total < startState.total, { startState, narrow });

// ---- hand-sized mode: a drag on a column edge, which switches automatic fitting off
await resizeTo(1280, 780);
const dragged = await ev(`(async () => {
  const handle = document.querySelectorAll('.resizer')[0];
  const x = handle.getBoundingClientRect().left + 3;
  handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, button: 0, bubbles: true, cancelable: true, pointerId: 1 }));
  for (let i = 1; i <= 6; i++) { window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + i * 15, bubbles: true, pointerId: 1 })); await new Promise((r) => setTimeout(r, 20)); }
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + 90, bubbles: true, pointerId: 1 }));
  await new Promise((r) => setTimeout(r, 500));
  return JSON.parse(localStorage.getItem('spelunker.preferences.v1')).columns.autoSize;
})()`);
check('a drag turns automatic fitting off', dragged === false, dragged);
const afterDrag = await fill();
check('hand-sized: the pane is still filled right after the drag (neighbours gave up the room)', fills(afterDrag), afterDrag);
await resizeTo(1900, 900);
const handWide = await fill();
check('hand-sized: the columns still widen with the window', fills(handWide) && handWide.total > afterDrag.total + 300, { afterDrag, handWide });
await resizeTo(1000, 650);
const handNarrow = await fill();
check('hand-sized: and narrow with it', fills(handNarrow) && handNarrow.total < afterDrag.total, { afterDrag, handNarrow });

// ---- hiding the preview gives the grid the whole width
await resizeTo(1280, 780);
const beforeHide = await fill();
await ev(`document.querySelector('button[aria-label="Hide the preview"]').click()`);
await settleFrames(send, 900);
const afterHide = await fill();
check('hiding the preview widens the columns to the full width', fills(afterHide) && afterHide.total > beforeHide.total + 250, { beforeHide, afterHide });

summarize();
close();
await edge.stop();

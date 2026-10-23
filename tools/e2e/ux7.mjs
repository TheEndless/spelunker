// Checks the results map: drawing, toggles, selection, zoom, keys, F6, collapse, the splitter, a
// short window, forced colors, themes, and the performance budget with measured numbers.
//
// node ux7.mjs [--shots <folder>]
//   Checks 1 to 16 in headless Edge against the dev server (start it first: npm run dev). Needs no
//   Spelunker window, takes no focus, and sends nothing to the desktop. With --shots, light and
//   dark screenshots of the map on the deep fixture are saved into that folder.
// node ux7.mjs --real
//   Check 17 only: a real folder search through the actual backend. Start the debug exe first
//   (launch.ps1), since it attaches to the running window on port 9222.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_HELPERS } from './cdp.mjs';
import { launchHeadlessEdge } from './headless.mjs';
import { createChecker, openPage } from './page.mjs';

const real = process.argv.includes('--real');
const shotsIndex = process.argv.indexOf('--shots');
const shotsFolder = shotsIndex > 0 ? process.argv[shotsIndex + 1] : null;
const APP_URL = 'http://localhost:5173/';
const HEADLESS_PORT = 9371;

// The performance budget from the design (docs/superpowers/specs/2026-10-22-results-map-design.md).
const BUDGET = { layoutMs: 250, paintMs: 80, hoverMs: 1, indexMs: 5, longTaskMs: 100, extraLongTaskTotalMs: 50 };
const AGE_LABELS = ['Today', 'This week', 'This month', 'This year', 'Older', 'Unknown'];

const { check, summarize } = createChecker();
const skip = (name, reason) => console.log(`SKIP  ${name}  (${reason})`);
const measured = (name, numbers) => console.log(`      ${name}: ${JSON.stringify(numbers)}`);
const problems = [];
const onEvent = (event) => {
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params.exceptionDetails;
    problems.push(`exception: ${details.exception?.description ?? details.text}`);
  } else if (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(event.params.type)) {
    problems.push(`${event.params.type}: ${event.params.args.map((arg) => arg.value ?? arg.description).join(' ')}`);
  }
};

const edge = real ? null : await launchHeadlessEdge({ port: HEADLESS_PORT, name: 'ux7' });
const page = await openPage(real ? { onEvent } : { webSocketDebuggerUrl: edge.webSocketDebuggerUrl, onEvent });
const { send, sleep, ev, key, mouse, setField } = page;

/**
 * Headless Edge runs the rendering steps (where size observers fire and the worker's canvas reaches
 * the page) only when a frame is drawn, so one is asked for, as a real window draws them on its own.
 */
const frame = async () => {
  await send('Page.captureScreenshot', { format: 'jpeg', quality: 10 });
  await sleep(120);
};
const settle = async (milliseconds) => {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    await frame();
    await sleep(200);
  }
};
const shot = async (name) => {
  if (!shotsFolder) return;
  await frame();
  const reply = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shotsFolder, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  console.log(`      saved ${name}.png`);
};
const resizeTo = async (width, height) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await settle(900);
};
const click = async (x, y, modifiers = 0) => {
  await mouse('mouseMoved', x, y, { modifiers });
  await mouse('mousePressed', x, y, { modifiers });
  await mouse('mouseReleased', x, y, { modifiers });
  await sleep(250);
};

/** Measuring helpers that run in the page. Points are seeded, so two samples compare the same pixels. */
const MAP_HELPERS = `
  window.__ux7 = {
    points(count, width, height) {
      let seed = 12345;
      const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      return Array.from({ length: count }, () => [Math.floor(next() * width), Math.floor(next() * height)]);
    },
    /** Reads pixels of a canvas through a 2D copy, which also works for the worker's transferred canvas. */
    sample(selector, count = 200) {
      const source = document.querySelector(selector);
      if (!source || source.width === 0 || source.height === 0) return null;
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      const context = copy.getContext('2d');
      context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      const colors = window.__ux7.points(count, copy.width, copy.height).map(([x, y]) => {
        const at = (y * copy.width + x) * 4;
        return [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]];
      });
      const corner = [pixels[0], pixels[1], pixels[2]];
      const opaque = colors.filter((color) => color[3] > 0);
      return {
        sampled: count,
        opaque: opaque.length,
        signature: colors.map((color) => color.join('.')).join(','),
        distinct: new Set(colors.map((color) => color.join('.'))).size,
        // Clearly colored pixels: an outline or its smoothing is a gray between the two system colors.
        chromatic: opaque.filter(([red, green, blue]) => Math.max(red, green, blue) - Math.min(red, green, blue) > 24).length,
        allPixelsOpaque: (() => { for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 0) return false; return true; })(),
        anyOpaque: (() => { for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) return true; return false; })(),
        corner,
      };
    },
    state() {
      const map = document.querySelector('section[data-pane="map"]');
      const panel = document.querySelector('.map-panel');
      const grid = document.querySelector('[data-pane="results"]');
      const toggle = document.querySelector('.map-toggle');
      const selected = document.querySelector('.body .row[aria-selected="true"]');
      return {
        shown: !!map,
        panelHeight: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
        gridHeight: grid ? Math.round(grid.getBoundingClientRect().height) : 0,
        columnHeight: Math.round(document.querySelector('.left')?.clientHeight ?? 0),
        summary: map?.querySelector('.summary')?.textContent ?? null,
        legend: [...(map?.querySelectorAll('.legend .entry') ?? [])].map((entry) => entry.childNodes[1]?.textContent.trim() ?? ''),
        crumbs: [...(map?.querySelectorAll('.crumb') ?? [])].map((crumb) => crumb.textContent),
        tooltip: map?.querySelector('.tooltip strong')?.textContent ?? null,
        toggle: toggle ? { pressed: toggle.getAttribute('aria-pressed'), disabled: toggle.disabled, title: toggle.title } : null,
        pane: document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? null,
        onStage: document.activeElement?.hasAttribute('data-map-stage') ?? false,
        selectedName: selected?.querySelector('.cell .text')?.textContent ?? null,
        previewName: document.querySelector('aside.preview .title .name')?.textContent ?? null,
        busy: !!document.querySelector('.status .state.busy'),
      };
    },
    /** A point on the stage with a rectangle of the wanted kind under it, scanning from the middle out. */
    pointOn(kinds) {
      const box = document.querySelector('[data-map-stage]').getBoundingClientRect();
      for (let step = 0; step < 400; step++) {
        const x = box.left + 2 + ((step * 37) % 100) / 100 * (box.width - 4);
        const y = box.top + 2 + ((step * 61) % 100) / 100 * (box.height - 4);
        const hit = window.__spMapProbe.indexAt(x, y);
        if (hit.index >= 0 && kinds.includes(hit.kind)) return { x, y, kind: hit.kind };
      }
      return null;
    },
    /** The middle of the largest file rectangles, which are big enough to aim at. */
    largestFiles(count) {
      return window.__spMapProbe.rects(100000)
        .sort((left, right) => right.width * right.height - left.width * left.height)
        .slice(0, count)
        .map((rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height }));
    },
  };
  true`;

const state = () => ev('window.__ux7.state()');
const sampleBase = () => ev(`window.__ux7.sample('[data-map-stage] canvas.base')`);
const sampleOverlay = () => ev(`window.__ux7.sample('[data-map-stage] canvas.overlay', 2000)`);

/** Starts a search with the given text and waits until it has finished and the map has settled. */
async function search(text, folder = 'C:\\data') {
  await setField('[role=combobox]', folder);
  await setField('input[placeholder="Text to find"]', text);
  await sleep(300);
  await ev(`document.querySelector('button.go').click()`);
  await sleep(300);
  for (let attempt = 0; attempt < 240 && (await state()).busy; attempt++) {
    await frame();
    await sleep(250);
  }
  await waitForSettledMap();
}

/** Waits until the map summary stops changing (a layout lands at most 1200 ms after the last rows). */
async function waitForSettledMap() {
  let last = null;
  let sameFor = 0;
  for (let attempt = 0; attempt < 60 && sameFor < 6; attempt++) {
    await frame();
    await sleep(250);
    const current = JSON.stringify([(await state()).summary, await ev('window.__spMapProbe?.timings() ?? null')]);
    sameFor = current === last ? sameFor + 1 : 0;
    last = current;
  }
}

async function loadFresh(theme) {
  // A page of the same origin that is not the app, so no pending save of the app overwrites this.
  await send('Page.navigate', { url: `${APP_URL}package.json` });
  await sleep(800);
  await ev(`localStorage.setItem('spelunker.preferences.v1', JSON.stringify({ theme: ${JSON.stringify(theme)} }))`);
  await send('Page.navigate', { url: APP_URL });
  await sleep(2500);
  await ev(PAGE_HELPERS);
  await ev(MAP_HELPERS);
  await frame();
}

async function chooseTheme(label) {
  await ev(`document.querySelector('button[aria-label^="Appearance"]').click()`);
  await sleep(300);
  await ev(`[...document.querySelectorAll('.theme .modes button')].find((button) => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
  await sleep(200);
  await key('Escape');
  await waitForSettledMap();
}

async function radio(group, label) {
  await ev(`[...document.querySelectorAll('.map [role=radiogroup][aria-label=${group}] button')].find((button) => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
  await waitForSettledMap();
}

const radioState = (group, label) =>
  ev(`(() => { const button = [...document.querySelectorAll('.map [role=radiogroup][aria-label=${group}] button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); return { checked: button.getAttribute('aria-checked') === 'true', disabled: button.disabled }; })()`);

async function browserChecks() {
  await send('Runtime.enable');
  await send('Page.enable');
  // Headless pages never have focus on their own, so focus events and :focus-visible would not happen.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await resizeTo(1280, 800);
  await loadFresh('light');

  // ---- 1. the map draws
  await search('many');
  const first = await state();
  const firstSample = await sampleBase();
  check('1. after searching "many" the map section exists', first.shown, first);
  check('1. the base canvas has drawn pixels (200 sampled points)', firstSample && firstSample.opaque === 200 && firstSample.distinct > 1, firstSample && { opaque: firstSample.opaque, distinct: firstSample.distinct });
  check('1. the summary mentions 100,000 files', (first.summary ?? '').startsWith('100,000 files'), first.summary);

  // ---- 2. Matches needs Containing text (the empty-text half runs at the end, after the other checks)
  check('2. Matches is enabled with Containing text', !(await radioState('Area', 'Matches')).disabled);

  // ---- 3. Size to Matches changes the layout
  await radio('Area', 'Matches');
  const byMatches = await state();
  const matchesSample = await sampleBase();
  check('3. switching to Matches changes the summary', byMatches.summary !== first.summary && /match/.test(byMatches.summary ?? ''), { before: first.summary, after: byMatches.summary });
  check('3. and the picture', matchesSample.signature !== firstSample.signature);
  await radio('Area', 'Size');

  // ---- 4. File type to Age changes the colors and the legend
  const typeSample = await sampleBase();
  const typeLegend = (await state()).legend;
  await radio('Color', 'Age');
  const ageSample = await sampleBase();
  const ageLegend = (await state()).legend;
  check('4. switching to Age changes the picture', ageSample.signature !== typeSample.signature);
  check('4. the legend lists age buckets after the switch', ageLegend.length >= 2 && ageLegend.every((label) => AGE_LABELS.includes(label)), { typeLegend, ageLegend });
  await radio('Color', 'File type');

  // ---- 8. Ctrl+click zooms, Backspace zooms out (first, so later checks have file rectangles to aim at)
  const crumbsAtTop = (await state()).crumbs;
  const block = await ev(`window.__ux7.pointOn(['folder-block', 'small-files', 'file'])`);
  await click(block.x, block.y, 2);
  await waitForSettledMap();
  const crumbsZoomed = (await state()).crumbs;
  check('8. Ctrl+click zooms: the breadcrumb gains a segment', crumbsZoomed.length === crumbsAtTop.length + 1, { crumbsAtTop, crumbsZoomed });
  await ev(`document.querySelector('[data-map-stage]').focus()`);
  await key('Backspace');
  await waitForSettledMap();
  const crumbsBack = (await state()).crumbs;
  check('8. Backspace removes it', crumbsBack.length === crumbsAtTop.length, { crumbsAtTop, crumbsBack });
  await click(block.x, block.y, 2);
  await waitForSettledMap();

  // ---- 7 and 5. hover names a file, and clicking it selects that file's row and previews it
  const [target] = await ev('window.__ux7.largestFiles(1)');
  await mouse('mouseMoved', target.x, target.y);
  await sleep(200);
  await frame();
  const hovered = await state();
  check('7. hover shows the tooltip with the file name', /^file_\d+\.\w+$/.test(hovered.tooltip ?? ''), hovered.tooltip);
  await click(target.x, target.y);
  await settle(600);
  const clicked = await state();
  check('5. clicking a rectangle selects that file\'s row in the list', clicked.selectedName !== null && clicked.selectedName === hovered.tooltip, { tooltip: hovered.tooltip, row: clicked.selectedName });
  check('5. and the preview header shows the file name', clicked.previewName === hovered.tooltip, clicked.previewName);
  const toolbar = await ev(`(() => { const box = document.querySelector('.map .toolbar').getBoundingClientRect(); return { x: box.right - 4, y: box.bottom - 3 }; })()`);
  await mouse('mouseMoved', toolbar.x, toolbar.y);
  await sleep(200);
  check('7. the tooltip hides when the pointer leaves', (await state()).tooltip === null);

  // ---- 6. selecting a row in the list outlines its rectangle
  const overlayBefore = await sampleOverlay();
  const nextRow = await ev(`(() => { const rows = [...document.querySelectorAll('.body .row')]; const at = rows.findIndex((row) => row.getAttribute('aria-selected') === 'true'); const row = rows[at > 0 ? at - 1 : at + 1]; const box = row.getBoundingClientRect(); return { x: box.left + 40, y: box.top + box.height / 2, name: row.querySelector('.cell .text').textContent }; })()`);
  await click(nextRow.x, nextRow.y);
  await waitForSettledMap();
  const overlayAfter = await sampleOverlay();
  const afterRow = await state();
  check('6. selecting another row in the list outlines it on the overlay', afterRow.selectedName === nextRow.name && overlayAfter?.anyOpaque && overlayAfter.signature !== overlayBefore?.signature, { selected: afterRow.selectedName, wanted: nextRow.name, opaqueBefore: overlayBefore?.opaque, opaqueAfter: overlayAfter?.opaque });

  // ---- 9. arrow keys on the focused stage
  // Selecting a row in another folder can zoom the map out to where files are folded into blocks,
  // and the keys only select files, so zoom back in and start from a file.
  let [startFile] = await ev('window.__ux7.largestFiles(1)');
  if (!startFile) {
    const folded = await ev(`window.__ux7.pointOn(['folder-block', 'small-files'])`);
    await click(folded.x, folded.y, 2);
    await waitForSettledMap();
    [startFile] = await ev('window.__ux7.largestFiles(1)');
  }
  await click(startFile.x, startFile.y);
  await ev(`document.querySelector('[data-map-stage]').focus()`);
  const beforeArrow = (await state()).selectedName;
  let afterArrow = beforeArrow;
  for (const arrow of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await key(arrow);
    await sleep(150);
    afterArrow = (await state()).selectedName;
    if (afterArrow !== beforeArrow) break;
  }
  check('9. an arrow key on the focused map changes the selected row', afterArrow !== null && afterArrow !== beforeArrow, { beforeArrow, afterArrow, crumbs: (await state()).crumbs });
  skip('9. Enter opens the selected file', 'the suite records no open_path requests, and outside Tauri opening a file does nothing to observe');

  // ---- 10. F6
  await ev(`document.querySelector('[data-pane="results"] [role=grid]').focus()`);
  await key('F6');
  const afterF6 = await state();
  await key('F6');
  const afterSecondF6 = await state();
  check('10. F6 from the results reaches the map', afterF6.onStage, afterF6.pane);
  check('10. and goes on to the preview', afterSecondF6.pane === 'preview', afterSecondF6.pane);

  // ---- 11. Ctrl+Shift+M and the status bar button
  await ev(`document.querySelector('[data-map-stage]').focus()`);
  await key('m', { ctrl: true, shift: true });
  await settle(400);
  const hidden = await state();
  check('11. Ctrl+Shift+M hides the map', !hidden.shown && hidden.toggle?.pressed === 'false', hidden.toggle);
  check('11. focus returns to the results when the map had it', hidden.pane === 'results', hidden.pane);
  await ev(`document.querySelector('.map-toggle').click()`);
  await waitForSettledMap();
  const shownAgain = await state();
  check('11. the status bar button shows it again', shownAgain.shown && shownAgain.toggle?.pressed === 'true', shownAgain.toggle);

  // ---- 12. the splitter
  const splitter = '.map-panel [role=separator]';
  const beforeDrag = await state();
  const grip = await ev(`(() => { const box = document.querySelector('${splitter}').getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
  await mouse('mouseMoved', grip.x, grip.y);
  await mouse('mousePressed', grip.x, grip.y);
  for (let i = 1; i <= 6; i++) {
    await mouse('mouseMoved', grip.x, grip.y - i * 10, { buttons: 1 });
    await sleep(30);
  }
  await mouse('mouseReleased', grip.x, grip.y - 60);
  await settle(500);
  const afterDrag = await state();
  check('12. dragging the splitter up 60 px makes the map 60 px taller', Math.abs(afterDrag.panelHeight - beforeDrag.panelHeight - 60) <= 1, { before: beforeDrag.panelHeight, after: afterDrag.panelHeight });
  await ev(`document.querySelector('${splitter}').focus()`);
  await key('Home');
  const atHome = await state();
  await key('End');
  const atEnd = await state();
  check('12. Home makes the map as short as allowed (140 px)', atHome.panelHeight === 140, atHome.panelHeight);
  check('12. End makes it as tall as allowed (the grid keeps 200 px)', atEnd.panelHeight === atEnd.columnHeight - 200 && atEnd.gridHeight >= 200, { panel: atEnd.panelHeight, column: atEnd.columnHeight, grid: atEnd.gridHeight });
  await ev(`document.querySelector('${splitter}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await settle(500);
  const reset = await state();
  check('12. double-click resets to the default height (about a third of the column)', Math.abs(reset.panelHeight - Math.round(reset.columnHeight * 0.34)) <= 1, { panel: reset.panelHeight, column: reset.columnHeight });
  await ev(`document.querySelector('${splitter}').focus()`);
  await key('ArrowUp');
  await key('ArrowUp');
  await sleep(700);
  const chosen = await state();
  const storedHeight = await ev(`JSON.parse(localStorage.getItem('spelunker.preferences.v1')).mapHeight`);
  await ev('location.reload()');
  await sleep(2500);
  await ev(PAGE_HELPERS);
  await ev(MAP_HELPERS);
  await search('many');
  const reloaded = await state();
  check('12. the height persists across a reload', storedHeight === chosen.panelHeight && reloaded.panelHeight === chosen.panelHeight, { chosen: chosen.panelHeight, storedHeight, reloaded: reloaded.panelHeight });

  // ---- 13. the shortest window
  await resizeTo(1000, 520);
  const short = await state();
  check('13. at 1000 by 520 the map collapses on its own', !short.shown, short);
  check('13. the status bar button is disabled and says why', short.toggle?.disabled === true && short.toggle.title === 'The window is too short for the map', short.toggle);
  check('13. the grid keeps at least 200 px', short.gridHeight >= 200, short.gridHeight);
  await resizeTo(1280, 800);
  await waitForSettledMap();
  const restored = await state();
  check('13. restoring the size brings the map back', restored.shown && restored.toggle?.disabled === false, restored.toggle);

  // ---- 14. forced colors
  const normalSample = await sampleBase();
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
  await waitForSettledMap();
  const forcedSample = await sampleBase();
  await shot('forced-colors');
  measured('14. chromatic (filled) pixels of 200', { normal: normalSample.chromatic, forced: forcedSample.chromatic, forcedDistinctColors: forcedSample.distinct });
  check('14. under forced colors the map draws outlines only (under 5 percent filled)', forcedSample.chromatic < 10 && forcedSample.distinct >= 2 && forcedSample.signature !== normalSample.signature, { chromatic: forcedSample.chromatic, distinct: forcedSample.distinct });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
  await waitForSettledMap();

  // ---- 15. light and dark
  const lightSample = await sampleBase();
  await chooseTheme('Dark');
  const darkSample = await sampleBase();
  const brightness = (color) => (color[0] + color[1] + color[2]) / 3;
  measured('15. map background (top left pixel)', { light: lightSample.corner, dark: darkSample.corner });
  check('15. the dark theme repaints the map', (await ev('document.documentElement.dataset.theme')) === 'dark' && darkSample.opaque === 200 && darkSample.signature !== lightSample.signature && brightness(darkSample.corner) < brightness(lightSample.corner));
  await chooseTheme('Light');
  const lightAgain = await sampleBase();
  check('15. and the light theme paints it again', lightAgain.opaque === 200 && brightness(lightAgain.corner) > brightness(darkSample.corner), { corner: lightAgain.corner });

  // ---- 2. the empty-text half
  await radio('Area', 'Matches');
  await search('');
  const nameOnly = await radioState('Area', 'Matches');
  check('2. Matches is disabled for a name-only search (no Containing text)', nameOnly.disabled && (await radioState('Area', 'Size')).checked, nameOnly);
  await radio('Area', 'Size');

  // ---- 16. performance on the deep fixture
  await performanceChecks();
}

/** Runs the deep search while recording main-thread long tasks. Returns the tasks and the map's timings. */
async function deepSearchWithLongTasks() {
  await ev(`(() => {
    window.__longTasks = [];
    window.__longTaskObserver?.disconnect();
    window.__longTaskObserver = new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration)); });
    window.__longTaskObserver.observe({ type: 'longtask' });
  })()`);
  const started = Date.now();
  await search('deep');
  // The same quiet time after every run, so both runs record over the same span.
  await settle(Math.max(0, 9000 - (Date.now() - started)));
  return ev(`(() => { window.__longTaskObserver.disconnect(); const tasks = window.__longTasks; return { count: tasks.length, total: tasks.reduce((sum, task) => sum + task, 0), longest: Math.max(0, ...tasks), tasks }; })()`);
}

/** The time one pointer move over the map takes, including the redraw it causes. */
const hoverCost = () =>
  ev(`(async () => {
    const stage = document.querySelector('[data-map-stage]');
    const box = stage.getBoundingClientRect();
    const points = window.__ux7.points(500, Math.floor(box.width), Math.floor(box.height));
    const costs = [];
    for (const [x, y] of points) {
      const started = performance.now();
      stage.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + x, clientY: box.top + y, bubbles: true }));
      // Svelte flushes the tooltip and overlay effects in a microtask queued during the event.
      await new Promise((resolve) => queueMicrotask(resolve));
      costs.push(performance.now() - started);
    }
    stage.dispatchEvent(new PointerEvent('pointerleave'));
    costs.sort((left, right) => left - right);
    const mean = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
    return { moves: costs.length, mean: Number(mean.toFixed(3)), median: Number(costs[costs.length >> 1].toFixed(3)), p95: Number(costs[Math.floor(costs.length * 0.95)].toFixed(3)), max: Number(costs.at(-1).toFixed(3)) };
  })()`);

async function performanceChecks() {
  const withMap = await deepSearchWithLongTasks();
  const settled = await ev('window.__spMapProbe.timings()');
  // More layouts of the same settled rows, to see the spread.
  const relayouts = [];
  for (const [group, label] of [['Area', 'Matches'], ['Area', 'Size'], ['Color', 'Age'], ['Color', 'File type']]) {
    await radio(group, label);
    relayouts.push({ view: `${group} ${label}`, ...(await ev('window.__spMapProbe.timings()')) });
  }
  const hover = await hoverCost();
  const summary = (await state()).summary;
  await shot('deep-light-type');
  await radio('Color', 'Age');
  await shot('deep-light-age');
  await radio('Color', 'File type');

  await ev(`document.querySelector('.map-toggle').click()`);
  await settle(400);
  const withoutMap = await deepSearchWithLongTasks();
  await ev(`document.querySelector('.map-toggle').click()`);
  await waitForSettledMap();

  const round = (value) => Number(value.toFixed(1));
  measured('16. deep fixture summary', summary);
  measured('16. settled layout (ms)', { layout: round(settled.layout), paint: round(settled.paint), index: round(settled.index) });
  measured('16. relayouts of the settled rows (ms)', relayouts.map((entry) => ({ view: entry.view, layout: round(entry.layout), paint: round(entry.paint), index: round(entry.index) })));
  measured('16. hover per move (ms)', hover);
  measured('16. long tasks with the map', withMap);
  measured('16. long tasks with the map collapsed', withoutMap);
  const extraTotal = withMap.total - withoutMap.total;
  const mapOnlyLongest = withMap.tasks.filter((task) => task > BUDGET.longTaskMs).length - withoutMap.tasks.filter((task) => task > BUDGET.longTaskMs).length;
  measured('16. long-task time the map adds (ms)', { extraTotal, extraTasksOver100: mapOnlyLongest });

  check(`16. worker layout of 100,000 files under ${BUDGET.layoutMs} ms`, settled.layout < BUDGET.layoutMs, round(settled.layout));
  check(`16. worker paint under ${BUDGET.paintMs} ms`, settled.paint < BUDGET.paintMs, round(settled.paint));
  check(`16. hit index build under ${BUDGET.indexMs} ms`, settled.index < BUDGET.indexMs, round(settled.index));
  check(`16. hover under ${BUDGET.hoverMs} ms per move`, hover.mean < BUDGET.hoverMs, hover);
  check(`16. the map adds no long task over ${BUDGET.longTaskMs} ms`, mapOnlyLongest <= 0, { withMap: withMap.tasks, withoutMap: withoutMap.tasks });
  check(`16. the map adds under ${BUDGET.extraLongTaskTotalMs} ms of long-task time`, extraTotal < BUDGET.extraLongTaskTotalMs, { withMap: withMap.total, withoutMap: withoutMap.total });

  if (shotsFolder) {
    await chooseTheme('Dark');
    await shot('deep-dark-type');
    await radio('Color', 'Age');
    await shot('deep-dark-age');
    const zoomPoint = await ev(`window.__ux7.pointOn(['folder-block', 'small-files', 'file'])`);
    await click(zoomPoint.x, zoomPoint.y, 2);
    await waitForSettledMap();
    await mouse('mouseMoved', 5, 5);
    await shot('deep-dark-age-zoomed');
    await radio('Color', 'File type');
    await shot('deep-dark-type-zoomed');
    await chooseTheme('Light');
    await shot('deep-light-type-zoomed');
  }
}

/** Check 17: the real backend, in the running debug exe. */
async function realChecks() {
  await send('Runtime.enable');
  await ev(PAGE_HELPERS);
  await ev(MAP_HELPERS);
  const folder = 'D:\\Development\\ai\\spelunker\\src';
  await search('export', folder);
  const mapped = await state();
  check('17. a real folder search draws the map', mapped.shown && (await sampleBase())?.opaque === 200, mapped.summary);
  const [target] = await ev('window.__ux7.largestFiles(1)');
  await mouse('mouseMoved', target.x, target.y);
  await sleep(300);
  const tooltip = await ev(`(() => { const tip = document.querySelector('.map .tooltip'); return tip ? { title: tip.querySelector('strong').textContent, folder: tip.querySelector('span')?.textContent ?? '' } : null; })()`);
  check('17. the tooltip names a real file in that folder', tooltip !== null && /\.\w+$/.test(tooltip.title) && tooltip.folder.toLowerCase().startsWith(folder.toLowerCase()), tooltip);
  await click(target.x, target.y);
  await sleep(400);
  check('17. clicking it selects the same file in the list', (await state()).selectedName === tooltip?.title, { tooltip: tooltip?.title, selected: (await state()).selectedName });
}

try {
  if (real) {
    for (let number = 1; number <= 16; number++) skip(`${number}.`, 'runs in headless Edge: node ux7.mjs');
    await realChecks();
  } else {
    await browserChecks();
    skip('17. a real folder search through the actual backend', 'needs the debug exe: start it with launch.ps1, then node ux7.mjs --real');
  }
} finally {
  console.log(problems.length === 0 ? '\nno console errors, warnings, or exceptions' : `\nconsole problems:\n${problems.join('\n')}`);
  summarize();
  page.close();
  await edge?.stop();
}

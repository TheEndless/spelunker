// Checks the results map: drawing, toggles, selection, zoom, keys, F6, collapse, the splitter, a
// short window, forced colors, themes, cushion and flat shading, and the performance budget with
// measured numbers.
//
// node ux7.mjs [--shots <folder>]
//   Checks 1 to 16, 18 and 19 in headless Edge against the dev server (start it first: npm run dev). Needs no
//   Spelunker window, takes no focus, and sends nothing to the desktop. With --shots, light and
//   dark screenshots of the map on the deep fixture are saved into that folder.
// node ux7.mjs --real
//   Check 17 only: a real folder search through the actual backend. Start the debug exe first
//   (launch.ps1), since it attaches to the running window on port 9222.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_HELPERS } from './cdp.mjs';
import { drawFrame, launchHeadlessEdge, resizeTo as resizeHeadless, settleFrames } from './headless.mjs';
import { createChecker, openPage, sleep } from './page.mjs';

const real = process.argv.includes('--real');
const shotsIndex = process.argv.indexOf('--shots');
const shotsFolder = shotsIndex > 0 ? process.argv[shotsIndex + 1] : null;
const APP_URL = 'http://localhost:5173/';
const HEADLESS_PORT = 9371;

// The map's performance budget. postMs is the page's cost to hand one batch of rows to the worker.
const BUDGET = { layoutMs: 250, paintMs: 80, hoverMs: 1, indexMs: 5, postMs: 2, longTaskMs: 100, extraLongTaskTotalMs: 50 };
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

// The page's protocol calls, filled in once the page is open (inside the try at the end).
let send, ev, key, mouse, setField;

const frame = () => drawFrame(send);
const settle = (milliseconds) => settleFrames(send, milliseconds);
const shot = async (name) => {
  if (!shotsFolder) return;
  await frame();
  const reply = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shotsFolder, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  console.log(`      saved ${name}.png`);
};
const resizeTo = (width, height, pixelRatio) => resizeHeadless(send, width, height, pixelRatio);
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
        toggle: toggle ? {
          pressed: toggle.getAttribute('aria-pressed'),
          disabled: toggle.disabled,
          ariaDisabled: toggle.getAttribute('aria-disabled'),
          title: toggle.title,
          description: (toggle.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent.trim() ?? '').join(' '),
        } : null,
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
    /**
     * The mean of red plus green plus blue over a 5 by 5 device-pixel patch near the top left and near
     * the bottom right of the largest file rectangle, read from the base canvas. The top patch sits
     * below the label line.
     */
    tileLight() {
      const stage = document.querySelector('[data-map-stage]').getBoundingClientRect();
      const [rect] = window.__spMapProbe.rects(100000).sort((left, right) => right.width * right.height - left.width * left.height);
      const source = document.querySelector('[data-map-stage] canvas.base');
      if (!rect || !source || source.width === 0) return null;
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      const context = copy.getContext('2d');
      context.drawImage(source, 0, 0);
      const ratio = source.width / stage.width;
      const patch = (x, y) => {
        const pixels = context.getImageData(Math.round((x - stage.left) * ratio) - 2, Math.round((y - stage.top) * ratio) - 2, 5, 5).data;
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
        return sum / 25;
      };
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        topLeft: patch(rect.x + rect.width * 0.25, rect.y + Math.max(rect.height * 0.3, 22)),
        bottomRight: patch(rect.x + rect.width * 0.75, rect.y + rect.height * 0.75),
      };
    },
    /** The middle of the largest file rectangles, which are big enough to aim at. */
    largestFiles(count) {
      return window.__spMapProbe.rects(100000)
        .sort((left, right) => right.width * right.height - left.width * left.height)
        .slice(0, count)
        .map((rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height }));
    },
    /** The app's own context menu, when open: its name, where it sits, and how many items it has. */
    menu() {
      const menu = document.querySelector('.menu[role=menu]');
      if (!menu) return null;
      const box = menu.getBoundingClientRect();
      return { label: menu.getAttribute('aria-label'), left: box.left, top: box.top, items: menu.querySelectorAll('[role^=menuitem]').length, viewport: { width: innerWidth, height: innerHeight } };
    },
    /**
     * Starts timing every message the page posts to a worker. postMessage copies the message before
     * it returns, so its duration is the page's cost of handing the rows over. The wrapper goes on
     * the prototype once per page, and each call starts a fresh record.
     */
    recordPosts() {
      window.__ux7Posts = [];
      if (Worker.prototype.postMessage.timedByUx7) return true;
      const original = Worker.prototype.postMessage;
      const timed = function (message, transfer) {
        const started = performance.now();
        try {
          return original.call(this, message, transfer);
        } finally {
          window.__ux7Posts?.push({ type: message?.type, milliseconds: performance.now() - started, records: message?.records?.length ?? 0 });
        }
      };
      timed.timedByUx7 = true;
      Worker.prototype.postMessage = timed;
      return true;
    },
    /** The recorded add posts: how many, the rows they carried, and their 95th percentile and slowest times. */
    postStats() {
      const adds = (window.__ux7Posts ?? []).filter((post) => post.type === 'add');
      const times = adds.map((post) => post.milliseconds).sort((left, right) => left - right);
      const round = (value) => Number(value.toFixed(3));
      return {
        adds: adds.length,
        records: adds.reduce((sum, post) => sum + post.records, 0),
        largestBatch: Math.max(0, ...adds.map((post) => post.records)),
        p95: times.length ? round(times[Math.floor(times.length * 0.95)]) : 0,
        max: times.length ? round(times.at(-1)) : 0,
        layoutRequests: (window.__ux7Posts ?? []).filter((post) => post.type === 'layout').length,
      };
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
  ev(`(() => { const button = [...document.querySelectorAll('.map [role=radiogroup][aria-label=${group}] button')].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)}); return { checked: button.getAttribute('aria-checked') === 'true', disabled: button.disabled }; })()`);

/** Runs `inDialog` with the Settings dialog open, then closes it with Escape. */
async function withSettings(inDialog) {
  await ev(`document.querySelector('button[aria-label="Settings"]').click()`);
  await sleep(300);
  const result = await inDialog();
  await key('Escape');
  await sleep(200);
  return result;
}

/** The checked choice of the Settings dialog's Map shading group, and what the group is called. */
const shadingInSettings = () =>
  withSettings(() =>
    ev(`(() => {
      const group = document.querySelector('.dialog [role=radiogroup][aria-labelledby="shading-heading"]');
      const checked = [...(group?.querySelectorAll('label') ?? [])].find((label) => label.querySelector('input').checked);
      return { group: document.getElementById(group?.getAttribute('aria-labelledby'))?.textContent ?? null, checked: checked?.textContent.trim() ?? null };
    })()`),
  );

async function chooseShading(label) {
  await withSettings(() =>
    ev(`[...document.querySelectorAll('.dialog [aria-labelledby="shading-heading"] label')].find((item) => item.textContent.trim() === ${JSON.stringify(label)}).querySelector('input').click()`),
  );
  await waitForSettledMap();
}

async function browserChecks() {
  await send('Runtime.enable');
  await send('Page.enable');
  await resizeTo(1280, 800);
  await loadFresh('light');

  // ---- 19. the map shading setting (the rest runs after check 15)
  const firstShading = await shadingInSettings();
  check('19. Settings has a Map shading choice, and Cushion is the default', firstShading.group === 'Map shading' && firstShading.checked === 'Cushion', firstShading);

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
  check('3. and the picture (both samples drawn)', firstSample?.opaque === 200 && matchesSample?.opaque === 200 && matchesSample.signature !== firstSample.signature, { before: firstSample?.opaque, after: matchesSample?.opaque });
  await radio('Area', 'Size');

  // ---- 4. File type to Age changes the colors and the legend
  const typeSample = await sampleBase();
  const typeLegend = (await state()).legend;
  await radio('Color', 'Age');
  const ageSample = await sampleBase();
  const ageLegend = (await state()).legend;
  check('4. switching to Age changes the picture (both samples drawn)', typeSample?.opaque === 200 && ageSample?.opaque === 200 && ageSample.signature !== typeSample.signature, { before: typeSample?.opaque, after: ageSample?.opaque });
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

  // ---- 18. the context menu. Outside Tauri there is no Windows menu, so the app's own menu opens.
  await contextMenuChecks();

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
  const tooShortReason = 'The window is too short for the map';
  check('13. the status bar button is marked unavailable, not pressed, and says why', short.toggle?.ariaDisabled === 'true' && short.toggle.pressed === 'false' && short.toggle.title === tooShortReason && short.toggle.description === tooShortReason, short.toggle);
  await ev(`document.querySelector('.map-toggle').focus()`);
  check('13. it stays focusable, so the reason can be reached from the keyboard', short.toggle?.disabled === false && (await ev(`document.activeElement === document.querySelector('.map-toggle')`)), short.toggle);
  const storedBefore = await ev(`localStorage.getItem('spelunker.preferences.v1')`);
  await ev(`document.querySelector('.map-toggle').click()`);
  await settle(400);
  const afterClick = await state();
  check('13. clicking it while the window is too short changes nothing', !afterClick.shown && afterClick.toggle?.pressed === 'false' && (await ev(`localStorage.getItem('spelunker.preferences.v1')`)) === storedBefore, afterClick.toggle);
  check('13. the grid keeps at least 200 px', short.gridHeight >= 200, short.gridHeight);
  await resizeTo(1280, 800);
  await waitForSettledMap();
  const restored = await state();
  check('13. restoring the size brings the map back', restored.shown && restored.toggle?.ariaDisabled === null && restored.toggle?.pressed === 'true' && restored.toggle?.description === '', restored.toggle);

  // ---- 14. forced colors, with each map shading
  const forcedSamples = {};
  for (const shading of ['Cushion', 'Flat']) {
    if (shading !== 'Cushion') await chooseShading(shading);
    const normalSample = await sampleBase();
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await waitForSettledMap();
    const forcedSample = await sampleBase();
    forcedSamples[shading] = forcedSample;
    await shot(`forced-colors-${shading.toLowerCase()}`);
    measured(`14. ${shading}: chromatic (filled) pixels of 200`, { normal: normalSample.chromatic, forced: forcedSample.chromatic, forcedDistinctColors: forcedSample.distinct });
    check(`14. ${shading}: under forced colors the map draws outlines only (under 5 percent filled)`, forcedSample.chromatic < 10 && forcedSample.distinct >= 2 && forcedSample.signature !== normalSample.signature, { chromatic: forcedSample.chromatic, distinct: forcedSample.distinct });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
    await waitForSettledMap();
  }
  // Forced colors ignores the shading setting, layout included, so the folder gaps that show the
  // grouping are there with either choice and the two pictures are the same.
  check('14. forced colors paints the same picture with Cushion chosen as with Flat', forcedSamples.Cushion?.opaque === 200 && forcedSamples.Cushion.signature === forcedSamples.Flat?.signature, { cushionDistinct: forcedSamples.Cushion?.distinct, flatDistinct: forcedSamples.Flat?.distinct });
  await chooseShading('Cushion');

  // ---- 15. light and dark
  // Cushion tiles touch, so the canvas need not show the map background anywhere. The light picture
  // is compared with itself instead: the same layout in the same colors paints the same pixels.
  const lightSample = await sampleBase();
  await chooseTheme('Dark');
  const darkSample = await sampleBase();
  measured('15. top left pixel', { light: lightSample.corner, dark: darkSample.corner });
  check('15. the dark theme repaints the map', (await ev('document.documentElement.dataset.theme')) === 'dark' && darkSample.opaque === 200 && darkSample.signature !== lightSample.signature, { opaque: darkSample.opaque });
  await chooseTheme('Light');
  const lightAgain = await sampleBase();
  check('15. and the light theme paints the same picture again', lightAgain.opaque === 200 && lightAgain.signature === lightSample.signature, { opaque: lightAgain.opaque, distinct: lightAgain.distinct });

  // ---- 2. the empty-text half
  await radio('Area', 'Matches');
  await search('');
  const nameOnly = await radioState('Area', 'Matches');
  check('2. Matches is disabled for a name-only search (no Containing text)', nameOnly.disabled && (await radioState('Area', 'Size')).checked, nameOnly);
  await radio('Area', 'Size');

  // ---- 16. performance on the deep fixture
  await performanceChecks();

  // ---- 19. cushion and flat shading, on the deep fixture, whose large files make large tiles
  await shadingChecks();

  // ---- 16. the paint budget at ratio 2, last, since it resizes the window and resets the map height
  await ratioTwoPaintChecks();
}

/**
 * Resizes the window at `pixelRatio` until the map stage is about `cssWidth` by `cssHeight`, resetting
 * the map to its default height (a share of the column) each time, and returns the stage's sizes.
 * The stage grows by about 0.62 of a window width change and 0.34 of a height change.
 */
async function sizeStageTo(cssWidth, cssHeight, pixelRatio) {
  let windowWidth = Math.round(1280 + (cssWidth - 794) / 0.62);
  let windowHeight = Math.round(800 + (cssHeight - 126) / 0.34);
  let stage = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await resizeTo(windowWidth, windowHeight, pixelRatio);
    await ev(`document.querySelector('.map-panel [role=separator]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await waitForSettledMap();
    stage = await ev(`(() => { const box = document.querySelector('[data-map-stage]').getBoundingClientRect(); const canvas = document.querySelector('[data-map-stage] canvas.base'); return { window: [innerWidth, innerHeight], css: [Math.round(box.width), Math.round(box.height)], device: [canvas.width, canvas.height], ratio: devicePixelRatio }; })()`);
    const [width, height] = stage.css;
    if (Math.abs(width - cssWidth) <= cssWidth * 0.02 && Math.abs(height - cssHeight) <= cssHeight * 0.02) break;
    windowWidth = Math.round(windowWidth + (cssWidth - width) / 0.62);
    windowHeight = Math.round(windowHeight + (cssHeight - height) / 0.34);
  }
  return stage;
}

/** Worker cushion paint times of three repaints of the whole deep fixture (Age, File type, Age again). */
async function paintSamples() {
  const samples = [];
  for (const label of ['Age', 'File type', 'Age']) {
    await radio('Color', label);
    samples.push(Number((await ev('window.__spMapProbe.timings()')).paint.toFixed(1)));
  }
  await radio('Color', 'File type');
  return samples;
}

/**
 * Check 16 at ratio 2: the paint budget is defined at 2400 by 520 device pixels, which a map of about
 * 1200 by 260 CSS pixels has at ratio 2. The median of three repaints is asserted. One larger map is
 * measured and printed only, to show how the time grows with the pixel count.
 */
async function ratioTwoPaintChecks() {
  await search('deep');
  const budgetStage = await sizeStageTo(1200, 260, 2);
  const crumbs = (await state()).crumbs;
  const budgetSamples = await paintSamples();
  const median = [...budgetSamples].sort((left, right) => left - right)[1];
  measured('16. ratio 2 at the budget size: stage and cushion paint times (ms)', { ...budgetStage, crumbs: crumbs.length, paint: budgetSamples });
  check(`16. worker cushion paint under ${BUDGET.paintMs} ms at ratio 2 and about 2400 by 520 device pixels (median of three)`, budgetStage.ratio === 2 && Math.abs(budgetStage.device[0] * budgetStage.device[1] - 2400 * 520) <= 2400 * 520 * 0.05 && median < BUDGET.paintMs, { device: budgetStage.device, median });
  if (shotsFolder) await shot('deep-light-type-ratio2');

  const largeStage = await sizeStageTo(1920, 600, 2);
  measured('16. ratio 2 at a large size, not asserted: stage and cushion paint times (ms)', { ...largeStage, paint: await paintSamples() });
  await resizeTo(1280, 800, 1);
  await waitForSettledMap();
}

/**
 * Check 19: cushion tiles are lit from the top left and flat ones are even, switching keeps the zoom
 * and the selection, and the choice survives a reload.
 */
async function shadingChecks() {
  // Zoom in until a file is drawn large enough to sample away from its label, then select it, so
  // there is a zoom and a selection to keep.
  await zoomToLargeFile();
  const [target] = await ev('window.__ux7.largestFiles(1)');
  await click(target.x, target.y);
  await waitForSettledMap();
  await mouse('mouseMoved', 5, 5);
  await settle(300);
  const cushioned = await state();
  const cushionLight = await ev('window.__ux7.tileLight()');
  const cushionSample = await sampleBase();
  measured('19. cushion: the largest tile, red plus green plus blue near its top left and bottom right', cushionLight);
  check('19. cushion: the largest tile is brighter at its top left than at its bottom right', cushionLight && cushionLight.height >= LARGE_TILE && cushionLight.topLeft > cushionLight.bottomRight * 1.1, cushionLight);

  await chooseShading('Flat');
  const flattened = await state();
  const flatLight = await ev('window.__ux7.tileLight()');
  const flatSample = await sampleBase();
  const flatOverlay = await sampleOverlay();
  measured('19. flat: the same patches', flatLight);
  // Both patches above 0, since an unpainted canvas would read 0 at both and match too.
  check('19. flat: the largest tile is the same color at its top left and bottom right', flatLight && flatLight.height >= LARGE_TILE && flatLight.topLeft > 0 && flatLight.topLeft === flatLight.bottomRight, flatLight);
  check('19. switching to Flat repaints the map', flatSample?.opaque === 200 && cushionSample?.opaque === 200 && flatSample.signature !== cushionSample.signature, { cushion: cushionSample?.opaque, flat: flatSample?.opaque });
  check('19. and keeps the zoom and the selected file, still outlined', cushioned.crumbs.length > 1 && JSON.stringify(flattened.crumbs) === JSON.stringify(cushioned.crumbs) && cushioned.selectedName !== null && flattened.selectedName === cushioned.selectedName && flatOverlay?.anyOpaque, { before: { crumbs: cushioned.crumbs, selected: cushioned.selectedName }, after: { crumbs: flattened.crumbs, selected: flattened.selectedName }, outlined: flatOverlay?.anyOpaque });

  await sleep(700);
  const storedShading = await ev(`JSON.parse(localStorage.getItem('spelunker.preferences.v1')).mapShading`);
  await ev('location.reload()');
  await sleep(2500);
  await ev(PAGE_HELPERS);
  await ev(MAP_HELPERS);
  const reloadedChoice = await shadingInSettings();
  await search('deep');
  await zoomToLargeFile();
  const reloadedLight = await ev('window.__ux7.tileLight()');
  check('19. Flat persists across a reload, in Settings and on the map', storedShading === 'flat' && reloadedChoice.checked === 'Flat' && reloadedLight?.height >= LARGE_TILE && reloadedLight.topLeft > 0 && reloadedLight.topLeft === reloadedLight.bottomRight, { storedShading, reloadedChoice, reloadedLight });

  await chooseShading('Cushion');
  const backLight = await ev('window.__ux7.tileLight()');
  check('19. choosing Cushion again lights the tiles again', backLight?.height >= LARGE_TILE && backLight.topLeft > backLight.bottomRight * 1.1, backLight);
}

/** The height in CSS pixels a file tile needs for its two patches to sit well apart and clear of its label. */
const LARGE_TILE = 60;

/** Ctrl+clicks into a folder until the largest file tile is at least LARGE_TILE tall, a few times at most. */
async function zoomToLargeFile() {
  for (let attempt = 0; attempt < 4; attempt++) {
    const [largest] = await ev('window.__ux7.largestFiles(1)');
    if (largest && largest.height >= LARGE_TILE) return;
    const point = await ev(`window.__ux7.pointOn(['folder-block', 'file'])`);
    if (!point) return;
    await click(point.x, point.y, 2);
    await waitForSettledMap();
  }
}

/**
 * Where the app's menu should sit when asked for at a point: the point itself, kept on screen the
 * way the menu keeps itself on screen. Within a pixel, since the menu's box is read back.
 */
const menuIsAt = (menu, x, y) =>
  Math.abs(menu.left - Math.max(4, Math.min(x, menu.viewport.width - 240))) <= 1 &&
  Math.abs(menu.top - Math.max(4, Math.min(y, menu.viewport.height - menu.items * 30 - 16))) <= 1;

/** Check 18: a right-click, the Menu key, and Shift+F10 on the map each open the app's menu for the right file. */
async function contextMenuChecks() {
  const shellMenuCalls = () => ev('window.__sp.shellMenuCalls.length');
  const callsBefore = await shellMenuCalls();
  const [target] = await ev('window.__ux7.largestFiles(1)');
  await mouse('mouseMoved', target.x, target.y);
  await sleep(200);
  const targetName = (await state()).tooltip;
  await mouse('mousePressed', target.x, target.y, { button: 'right' });
  await mouse('mouseReleased', target.x, target.y, { button: 'right' });
  await sleep(300);
  const byPointer = await ev('window.__ux7.menu()');
  const selectedByPointer = (await state()).selectedName;
  check('18. a right-click on a file rectangle opens the app\'s file menu at the pointer', byPointer?.label === 'File actions' && byPointer.items > 0 && menuIsAt(byPointer, target.x, target.y), { menu: byPointer, at: target });
  check('18. and selects that file', targetName !== null && selectedByPointer === targetName, { tooltip: targetName, selected: selectedByPointer });
  await key('Escape');
  check('18. Escape closes it', (await ev('window.__ux7.menu()')) === null);

  // The file under the pointer is now selected, so the keys open the menu at its rectangle's middle.
  for (const [name, press] of [['the Menu key', () => key('ContextMenu')], ['Shift+F10', () => key('F10', { shift: true })]]) {
    await mouse('mouseMoved', 5, 5);
    await ev(`document.querySelector('[data-map-stage]').focus()`);
    await press();
    await sleep(300);
    const byKey = await ev('window.__ux7.menu()');
    check(`18. ${name} on the focused map opens the menu at the selected rectangle`, byKey?.label === 'File actions' && menuIsAt(byKey, target.x, target.y) && (await state()).selectedName === targetName, { menu: byKey, at: target });
    await key('Escape');
    await sleep(100);
  }
  check('18. no Windows menu was asked for (there is none in a plain browser)', (await shellMenuCalls()) === callsBefore, await shellMenuCalls());
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
  await ev('window.__ux7.recordPosts()');
  const withMap = await deepSearchWithLongTasks();
  const posts = await ev('window.__ux7.postStats()');
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
  measured('16. settled layout with cushion shading (ms)', { layout: round(settled.layout), paint: round(settled.paint), index: round(settled.index) });
  measured('16. relayouts of the settled rows (ms)', relayouts.map((entry) => ({ view: entry.view, layout: round(entry.layout), paint: round(entry.paint), index: round(entry.index) })));
  measured('16. hover per move (ms)', hover);
  measured(`16. posting rows to the worker during the search (ms per batch, budget ${BUDGET.postMs})`, posts);
  measured('16. long tasks with the map', withMap);
  measured('16. long tasks with the map collapsed', withoutMap);
  const extraTotal = withMap.total - withoutMap.total;
  const mapOnlyLongest = withMap.tasks.filter((task) => task > BUDGET.longTaskMs).length - withoutMap.tasks.filter((task) => task > BUDGET.longTaskMs).length;
  measured('16. long-task time the map adds (ms)', { extraTotal, extraTasksOver100: mapOnlyLongest });

  check(`16. worker layout of 100,000 files under ${BUDGET.layoutMs} ms`, settled.layout < BUDGET.layoutMs, round(settled.layout));
  check(`16. worker cushion paint under ${BUDGET.paintMs} ms`, settled.paint < BUDGET.paintMs, round(settled.paint));
  check(`16. hit index build under ${BUDGET.indexMs} ms`, settled.index < BUDGET.indexMs, round(settled.index));
  check(`16. hover under ${BUDGET.hoverMs} ms per move (95th percentile)`, hover.p95 < BUDGET.hoverMs, hover);
  check(`16. every batch of rows reaches the worker in under ${BUDGET.postMs} ms (all ${posts.records.toLocaleString('en-US')} rows went)`, posts.adds > 0 && posts.records === 100_000 && posts.max < BUDGET.postMs, posts);
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
  // Start from a first-run window: an earlier suite can leave a Name pattern or a filter behind in
  // the same page, which would make this search find nothing. Clearing the preferences and then
  // reloading is not enough, since the page saves a pending change as it unloads.
  await loadFresh('light');
  const folder = 'D:\\Development\\ai\\spelunker\\src';
  await search('export', folder);
  const mapped = await state();
  const mappedSample = await sampleBase();
  check('17. a real folder search draws the map of its files', mapped.shown && /^\d[\d,]* files?\b/.test(mapped.summary ?? '') && mappedSample?.opaque === 200, { summary: mapped.summary, opaque: mappedSample?.opaque });
  const [target] = await ev('window.__ux7.largestFiles(1)');
  await mouse('mouseMoved', target.x, target.y);
  await sleep(300);
  const tooltip = await ev(`(() => { const tip = document.querySelector('.map .tooltip'); return tip ? { title: tip.querySelector('strong').textContent, folder: tip.querySelector('span')?.textContent ?? '' } : null; })()`);
  check('17. the tooltip names a real file in that folder', tooltip !== null && /\.\w+$/.test(tooltip.title) && tooltip.folder.toLowerCase().startsWith(folder.toLowerCase()), tooltip);
  await click(target.x, target.y);
  await sleep(400);
  check('17. clicking it selects the same file in the list', (await state()).selectedName === tooltip?.title, { tooltip: tooltip?.title, selected: (await state()).selectedName });
}

let edge = null;
let page = null;
try {
  // Both inside the try, so a browser that starts but cannot be reached is still stopped.
  edge = real ? null : await launchHeadlessEdge({ port: HEADLESS_PORT, name: 'ux7' });
  page = await openPage(real ? { onEvent } : { webSocketDebuggerUrl: edge.webSocketDebuggerUrl, onEvent });
  ({ send, ev, key, mouse, setField } = page);
  if (real) {
    for (const number of [...Array.from({ length: 16 }, (_, index) => index + 1), 18, 19]) skip(`${number}.`, 'runs in headless Edge: node ux7.mjs');
    await realChecks();
  } else {
    await browserChecks();
    skip('17. a real folder search through the actual backend', 'needs the debug exe: start it with launch.ps1, then node ux7.mjs --real');
  }
} finally {
  check('no console errors, warnings, or exceptions', problems.length === 0, problems);
  summarize();
  page?.close();
  await edge?.stop();
}

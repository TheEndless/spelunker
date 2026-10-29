// Checks the Settings dialog: its tabs (roles, the arrow keys, Home and End, which settings are on
// which tab), the About tab, Escape and where focus goes back to, and the reset in the footer. It
// runs the page in headless Edge against the dev server (mock backend), so it needs no Spelunker
// window and takes no focus. Usage: start the dev server (npm run dev), then: node settings.mjs
import { launchHeadlessEdge, resizeTo } from './headless.mjs';
import { createChecker, openPage } from './page.mjs';

const edge = await launchHeadlessEdge({ port: 9391, width: 1100, height: 800, name: 'settings' });
const { check, summarize } = createChecker();
try {
  const { send, sleep, ev, key, close } = await openPage({ webSocketDebuggerUrl: edge.webSocketDebuggerUrl });
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(2500);
  await ev(`localStorage.removeItem('spelunker.preferences.v1')`);
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(2500);

  const tabs = () => ev(`[...document.querySelectorAll('[role=tab]')].map((tab) => ({ name: tab.textContent.trim(), selected: tab.getAttribute('aria-selected') === 'true', tabIndex: tab.tabIndex }))`);
  const selected = async () => (await tabs()).find((tab) => tab.selected)?.name;
  const focusedTab = () => ev(`document.activeElement?.getAttribute('role') === 'tab' ? document.activeElement.textContent.trim() : null`);
  const panelText = () => ev(`document.querySelector('[role=tabpanel]')?.innerText ?? ''`);
  const dialogOpen = () => ev(`!!document.querySelector('[role=dialog][aria-labelledby="settings-title"]')`);

  // ---- opening
  await ev(`document.querySelector('button[aria-label="Settings"]').focus()`);
  await ev(`document.querySelector('button[aria-label="Settings"]').click()`);
  await sleep(300);
  const tabList = await tabs();
  check('the dialog has the tabs Files, Appearance and About', JSON.stringify(tabList.map((tab) => tab.name)) === JSON.stringify(['Files', 'Appearance', 'About']), tabList);
  check('Files is the tab shown first, and only it is a tab stop', (await selected()) === 'Files' && tabList.filter((tab) => tab.tabIndex === 0).length === 1, tabList);
  check('focus starts on the selected tab', (await focusedTab()) === 'Files', await focusedTab());
  check('the tab list is named, and each tab names its panel', await ev(`(() => {
    const list = document.querySelector('[role=tablist]');
    const tab = document.querySelector('[role=tab][aria-selected=true]');
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    return !!list.getAttribute('aria-label') && !!panel && panel.getAttribute('role') === 'tabpanel' && panel.getAttribute('aria-labelledby') === tab.id;
  })()`));
  const files = await panelText();
  check('Files holds the editor, preview and Explorer settings', /Open in editor/.test(files) && /Lines of context/.test(files) && /Windows Explorer/.test(files), files);
  check('the map shading is not on the Files tab', !/Map shading/.test(files));

  // ---- the keyboard
  await key('ArrowRight');
  check('Right moves to the next tab, shows it and focuses it', (await selected()) === 'Appearance' && (await focusedTab()) === 'Appearance', await selected());
  const display = await panelText();
  check('Appearance holds the theme and the map shading', /Theme/.test(display) && /Mode/.test(display) && /Map shading/.test(display) && !/Match highlight|Found text/.test(display) && !/Open in editor/.test(display), display);
  // ---- the theme, on the Appearance tab
  const themes = await ev(`(() => {
    const items = [...document.querySelectorAll('.dialog [role=radiogroup][aria-label="Color theme"] [role=radio]')];
    return { count: items.length, checked: items.filter((item) => item.getAttribute('aria-checked') === 'true').map((item) => item.textContent.trim()), tabStops: items.filter((item) => item.tabIndex === 0).length };
  })()`);
  check('the tab lists every color theme, one checked, and only that one a tab stop', themes.count >= 10 && themes.checked.length === 1 && themes.tabStops === 1, themes);
  check('the tab has the Auto, Light and Dark choice', JSON.stringify(await ev(`[...document.querySelectorAll('.dialog [aria-labelledby="mode-heading"] button')].map((button) => button.textContent.trim())`)) === JSON.stringify(['Auto', 'Light', 'Dark']));
  const firstChecked = themes.checked[0];
  await ev(`document.querySelector('.dialog [role=radio][aria-checked=true]').focus()`);
  await key('ArrowDown');
  const afterArrow = await ev(`({ checked: document.querySelector('.dialog [role=radio][aria-checked=true]').textContent.trim(), focused: document.activeElement.textContent.trim(), stored: JSON.parse(localStorage.getItem('spelunker.preferences.v1')).palette })`);
  check('Down checks the next theme, moves focus to it and saves it', afterArrow.checked !== firstChecked && afterArrow.focused === afterArrow.checked && typeof afterArrow.stored === 'string', afterArrow);
  await ev(`[...document.querySelectorAll('.dialog [aria-labelledby="mode-heading"] button')].find((button) => button.textContent.trim() === 'Dark').click()`);
  await sleep(200);
  check('choosing Dark is kept', (await ev(`JSON.parse(localStorage.getItem('spelunker.preferences.v1')).theme`)) === 'dark');
  await ev(`[...document.querySelectorAll('.dialog [aria-labelledby="mode-heading"] button')].find((button) => button.textContent.trim() === 'Auto').click()`);
  // Back on the tab, which is where the keys of the next checks are pressed.
  await ev(`document.getElementById('settings-tab-appearance').focus()`);

  await key('ArrowRight');
  await key('ArrowRight');
  check('Right wraps from the last tab to the first', (await selected()) === 'Files', await selected());
  await key('ArrowLeft');
  check('Left wraps from the first tab to the last', (await selected()) === 'About', await selected());
  await key('Home');
  check('Home goes to the first tab', (await selected()) === 'Files');
  await key('End');
  check('End goes to the last tab', (await selected()) === 'About');
  await key('Tab');
  const afterTab = await ev(`document.activeElement.closest('[role=tabpanel]') !== null || document.activeElement.closest('footer') !== null`);
  check('Tab leaves the tab list for the panel or the footer, not the next tab', afterTab && (await focusedTab()) === null, await ev(`document.activeElement.outerHTML.slice(0, 80)`));

  // ---- the toolbar's Appearance menu offers the same choices
  await key('Escape');
  await sleep(250);
  await ev(`document.querySelector('button[aria-label^="Appearance"]').click()`);
  await sleep(300);
  const menu = await ev(`(() => {
    const items = [...document.querySelectorAll('[role=dialog][aria-label="Appearance"] [role=radio]')];
    return { count: items.length, checked: items.filter((item) => item.getAttribute('aria-checked') === 'true').map((item) => item.textContent.trim()) };
  })()`);
  check('the Appearance menu lists the same themes with the same one checked', menu.count === themes.count && menu.checked[0] === afterArrow.checked, { menu, themes, afterArrow });
  await key('ArrowDown');
  check('and its arrow keys still move the choice', (await ev(`document.querySelector('[role=dialog][aria-label="Appearance"] [role=radio][aria-checked=true]').textContent.trim()`)) !== afterArrow.checked);
  await key('Escape');
  await sleep(250);
  await ev(`document.querySelector('button[aria-label="Settings"]').click()`);
  await sleep(300);
  await ev(`document.getElementById('settings-tab-about').click()`);
  await sleep(150);

  // ---- About
  await ev(`document.getElementById('settings-tab-about').click()`);
  await sleep(200);
  const about = await panelText();
  check('About names the app and its version', /Spelunker/.test(about) && /Version\s*\n?\s*\S+/.test(about), about);
  check('About gives the license and the window engine', /MIT/.test(about) && /WebView2/.test(about), about);
  const aboutBox = await ev(`(() => { const dialog = document.querySelector('.dialog').getBoundingClientRect(); return { top: dialog.top, bottom: dialog.bottom, viewport: innerHeight }; })()`);
  check('the dialog stays inside the window on the tallest and the shortest tab', aboutBox.top >= 0 && aboutBox.bottom <= aboutBox.viewport, aboutBox);

  // The dialog does not change size when the tab does.
  const heights = [];
  for (const name of ['files', 'display', 'about']) {
    await ev(`document.getElementById('settings-tab-${name}').click()`);
    await sleep(150);
    heights.push(await ev(`Math.round(document.querySelector('.dialog').getBoundingClientRect().height)`));
  }
  check('the dialog keeps one height whichever tab is shown', Math.max(...heights) - Math.min(...heights) <= 2, heights);

  // ---- a window shorter than the dialog: only the panel scrolls
  await ev(`document.getElementById('settings-tab-files').click()`);
  await resizeTo(send, 1100, 380);
  await sleep(300);
  const squeezed = await ev(`(() => {
    const part = (selector) => { const box = document.querySelector('.dialog ' + selector).getBoundingClientRect(); return { top: Math.round(box.top), bottom: Math.round(box.bottom) }; };
    const panel = document.querySelector('.panels');
    const before = { header: part('header'), tabs: part('.tabs'), footer: part('footer') };
    panel.scrollTop = panel.scrollHeight;
    const after = { header: part('header'), tabs: part('.tabs'), footer: part('footer') };
    return { viewport: innerHeight, before, after, scrolls: panel.scrollHeight > panel.clientHeight, dialog: part('') };
  })()`);
  check('in a short window the panel scrolls', squeezed.scrolls, squeezed);
  check('and the title, the tabs and the buttons stay where they were while it does', JSON.stringify(squeezed.before) === JSON.stringify(squeezed.after) && squeezed.after.footer.bottom <= squeezed.viewport, squeezed);
  await resizeTo(send, 1100, 800);
  await sleep(300);

  // ---- choosing the custom command shows its box
  await ev(`[...document.querySelectorAll('.dialog input[name=editor]')].find((radio) => radio.parentElement.textContent.includes('Custom')).click()`);
  await sleep(300);
  check('choosing Custom command shows its box inside the panel', await ev(`(() => { const field = document.querySelector('.dialog .field').getBoundingClientRect(); const panel = document.querySelector('.panels').getBoundingClientRect(); return field.top >= panel.top - 1 && field.bottom <= panel.bottom + 1; })()`));
  await ev(`[...document.querySelectorAll('.dialog input[name=editor]')].find((radio) => radio.parentElement.textContent.includes('System')).click()`);

  // ---- the reset, in the footer
  await ev(`document.getElementById('settings-tab-appearance').click()`);
  await sleep(150);
  await ev(`[...document.querySelectorAll('.dialog input[name="map-shading"]')].find((box) => box.parentElement.textContent.trim() === 'Flat').click()`);
  await sleep(200);
  check('a setting changed on a tab is kept', (await ev(`JSON.parse(localStorage.getItem('spelunker.preferences.v1')).mapShading`)) === 'flat');
  check('the reset button is in the footer, whichever tab is shown', await ev(`!!document.querySelector('.dialog footer')?.innerText.includes('Reset everything to defaults')`));
  await ev(`[...document.querySelectorAll('.dialog footer button')].find((button) => /Reset everything to defaults/.test(button.textContent)).click()`);
  await sleep(150);
  const doneBefore = await ev(`(() => { const box = [...document.querySelectorAll('.dialog footer button')].find((button) => button.textContent.trim() === 'Done').getBoundingClientRect(); return { left: Math.round(box.left), top: Math.round(box.top) }; })()`);
  const footerBefore = await ev(`Math.round(document.querySelector('.dialog footer').getBoundingClientRect().height)`);
  const confirming = await ev(`document.querySelector('.dialog footer').innerText`);
  check('the reset asks before it does anything', /Reset everything now/.test(confirming) && /Cancel/.test(confirming), confirming);
  const doneDuring = await ev(`(() => { const box = [...document.querySelectorAll('.dialog footer button')].find((button) => button.textContent.trim() === 'Done').getBoundingClientRect(); return { left: Math.round(box.left), top: Math.round(box.top) }; })()`);
  check('asking does not move Done or change the height of the footer', JSON.stringify(doneBefore) === JSON.stringify(doneDuring) && footerBefore === (await ev(`Math.round(document.querySelector('.dialog footer').getBoundingClientRect().height)`)), { doneBefore, doneDuring });
  await ev(`[...document.querySelectorAll('.dialog footer button')].find((button) => /Cancel/.test(button.textContent)).click()`);
  await sleep(150);
  check('Cancel puts the footer back and keeps the setting', (await ev(`JSON.parse(localStorage.getItem('spelunker.preferences.v1')).mapShading`)) === 'flat' && /Reset everything to defaults/.test(await ev(`document.querySelector('.dialog footer').innerText`)));
  await ev(`[...document.querySelectorAll('.dialog footer button')].find((button) => /Reset everything to defaults/.test(button.textContent)).click()`);
  await sleep(150);
  await ev(`[...document.querySelectorAll('.dialog footer button')].find((button) => /Reset everything now/.test(button.textContent)).click()`);
  await sleep(300);
  check('resetting puts the settings back to the defaults', (await ev(`JSON.parse(localStorage.getItem('spelunker.preferences.v1')).mapShading`)) === 'facet');
  check('the dialog stays open after a reset', await dialogOpen());

  // ---- closing
  await key('Escape');
  await sleep(250);
  check('Escape closes the dialog', !(await dialogOpen()));
  check('focus goes back to the Settings button', await ev(`document.activeElement === document.querySelector('button[aria-label="Settings"]')`));

  summarize();
  close();
} finally {
  await edge.stop();
}

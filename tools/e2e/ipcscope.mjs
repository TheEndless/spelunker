// Calls the backend commands directly, the way a page that had been taken over would, and checks
// they refuse what they should: paths outside the folders of the current search, a file path chosen
// by the page, an editor that is not one Spelunker knows, and the command that used to write any
// file. The allowed calls are checked too, so a refusal cannot hide a broken command. It never
// starts a program, opens a menu or shows a dialog: every call that is refused is refused before
// any of that, and the allowed ones only read. Attaches to the running debug app (see launch.ps1).
// Run fixtures.mjs once first. Sends no input to the desktop.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_HELPERS } from './cdp.mjs';
import { createChecker, openPage } from './page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const folder = resolve(here, 'testfiles');
const inside = resolve(folder, 'code.rs');
const outside = 'C:\\Windows\\win.ini';
const climbing = `${folder}\\..\\..\\..\\..\\..\\Windows\\win.ini`;
const { check, summarize } = createChecker();
const { ev, close } = await openPage();

await ev(PAGE_HELPERS);
await ev(`(async () => {
  const sp = window.__sp;
  sp.setInput('[role=combobox]', ${JSON.stringify(folder)});
  sp.setInput('input[placeholder="Text to find"]', '');
  await sp.wait(200);
  document.querySelector('button.go').click();
  await sp.wait(2500);
})()`);

/** What a call to a command gives: ok with its value, or the error it rejected with. */
const call = (command, args) =>
  ev(`(async () => {
    try { return { ok: true, value: await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)}) }; }
    catch (error) { return { ok: false, error: String(error) }; }
  })()`);
const refused = (result) => result.ok === false && /not in the folders of the current search/.test(result.error);

const query = { text: '', regex: false, matchCase: false, wholeWord: false, multiLine: false };
const read = await call('read_file_text', { path: inside, query: null });
check('reading a file in the searched folder works', read.ok, read);
check('reading a file outside it is refused', refused(await call('read_file_text', { path: outside, query: null })));
check('a path that climbs out of the folder with .. is refused', refused(await call('read_file_text', { path: climbing, query: null })));
check('a preview outside the folder is refused', refused(await call('preview', { path: outside, query, contextLines: 1, includeBinary: false })));
check('allowing a file outside the folder for the asset protocol is refused', refused(await call('allow_preview', { path: outside })));
check('opening a file outside the folder is refused', refused(await call('open_path', { path: outside })));
check('revealing a file outside the folder is refused', refused(await call('reveal_path', { path: outside })));
check('the system menu for a file outside the folder is refused', refused(await call('show_shell_menu', { paths: [outside], x: 10, y: 10, extraLabels: [] })));
check('dragging a file outside the folder is refused', refused(await call('start_file_drag', { paths: [outside] })));
check('one path outside among allowed ones refuses the whole drag', refused(await call('start_file_drag', { paths: [inside, outside] })));
check('opening in an editor a file outside the folder is refused', refused(await call('open_in_editor', { editor: 'vscode', customTemplate: '', path: outside, line: 1 })));

const unknownEditor = await call('open_in_editor', { editor: 'calc.exe', customTemplate: '', path: inside, line: 1 });
check('an editor that is not built in or custom is refused', unknownEditor.ok === false && /not one Spelunker knows/.test(unknownEditor.error), unknownEditor);
const emptyCustom = await call('open_in_editor', { editor: 'custom', customTemplate: '   ', path: inside, line: 1 });
check('a custom editor with no command is refused before any dialog', emptyCustom.ok === false && /No editor command is set/.test(emptyCustom.error), emptyCustom);

const badExtension = await call('save_text_file', { suggestedName: 'a', extension: 'exe;bat', content: 'x' });
check('saving with an odd file type is refused before any dialog', badExtension.ok === false && /not a file type/.test(badExtension.error), badExtension);
const oldWrite = await call('write_text_file', { path: 'C:\\x.txt', content: 'x' });
check('the old command that wrote any path is gone', oldWrite.ok === false && /not found|not allowed|unknown/i.test(oldWrite.error), oldWrite);

const quote = await call('reveal_path', { path: `${folder}\\a" C:\\Windows\\win.ini` });
check('a path with a quote cannot reach Explorer', quote.ok === false, quote);

summarize();
close();

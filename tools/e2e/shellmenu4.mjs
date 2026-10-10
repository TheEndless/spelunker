// Opens the REAL Windows menu on a result and clicks entries by name through UI Automation.
// No screenshots of the desktop are taken. Prints PASS or FAIL lines.
import { execFileSync } from 'node:child_process';
import { connect, PAGE_HELPERS } from './cdp.mjs';

const scratch = process.cwd();
const { evaluate, close } = await connect();
await evaluate(PAGE_HELPERS);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pwsh = (...args) => execFileSync('pwsh', ['-NoProfile', ...args], { encoding: 'utf8' }).trim();
const clickItem = (name) => pwsh('-File', `${scratch}\\clickmenu.ps1`, name);
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`);

await evaluate(`(async () => {
  const sp = window.__sp;
  sp.setInput('[role=combobox]', ${JSON.stringify(scratch + '\\testfiles')});
  sp.setInput('input[placeholder="Text to find"]', '');
  sp.setInput('input[title^="Name"]', '');
  await sp.wait(200);
  document.querySelector('button.go').click();
  await sp.wait(1500);
})()`);
await evaluate(`delete window.__spShellMenuHook`);

const openMenu = () =>
  evaluate(`(() => {
    const row = [...document.querySelectorAll('.body .row')].find((r) => r.innerText.includes('picture.png'));
    row.click();
    const box = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 80, clientY: box.top + 12 }));
  })()`);

async function choose(name) {
  await openMenu();
  await sleep(1500);
  try {
    return clickItem(name);
  } catch (error) {
    console.log(`FAIL  could not click "${name}": ${String(error.message).split('\n')[0]}`);
    console.log('A native menu may still be open. Restart the debug app.');
    close();
    process.exit(2);
  }
}

// One of our own entries.
pwsh('-Command', 'Set-Clipboard -Value "before"');
await choose('Copy path');
await sleep(1200);
const copiedPath = pwsh('-Command', 'Get-Clipboard');
check('our "Copy path" entry puts the full path on the clipboard', copiedPath.endsWith('testfiles\\picture.png'), copiedPath);

// One of the shell's own entries: Copy puts the file itself on the clipboard.
pwsh('-Command', 'Set-Clipboard -Value "before"');
await choose('Copy');
await sleep(1200);
const files = pwsh('-Command', "Add-Type -AssemblyName System.Windows.Forms; ([System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { $_ }) -join '|'");
check("the shell's own \"Copy\" command ran on the file", files.endsWith('testfiles\\picture.png'), files);

check('the window is still responsive afterwards', (await evaluate(`document.title`)) === 'Spelunker');
close();

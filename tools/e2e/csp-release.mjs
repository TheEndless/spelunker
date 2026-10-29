// Checks the production Content Security Policy on the real release exe, which is the only place
// the real asset protocol and IPC run under it (csp.mjs covers the built frontend alone, and a dev
// window does not enforce the policy at all). It proves the policy is enforced by making the page do
// three things it forbids, then searches the sample files, previews each kind of file, and expects
// no violation anywhere. Attaches to a release exe started with the debug port open: see
// csp-release.ps1, which starts and stops it. Run fixtures.mjs once first.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_HELPERS } from './cdp.mjs';
import { createChecker, openPage } from './page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const folder = resolve(here, 'testfiles');
const { check, summarize } = createChecker();

const logged = [];
const { send, sleep, ev, close } = await openPage({
  onEvent: (event) => {
    if (event.method === 'Log.entryAdded') logged.push(event.params.entry.text);
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
      logged.push(event.params.args.map((arg) => arg.value ?? arg.description).join(' '));
    }
  },
});

// A listener has to exist before the page's scripts run, so it goes into every new document and the
// page is loaded again.
await send('Page.enable');
await send('Log.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__violations = [];
    document.addEventListener('securitypolicyviolation', (event) => window.__violations.push(event.violatedDirective + ' ' + event.blockedURI));`,
});
await send('Page.reload');
await sleep(4000);
await ev(PAGE_HELPERS);

check('the page is the bundled app, not a dev server', (await ev('location.origin')) === 'http://tauri.localhost', await ev('location.href'));

// Proof the policy is enforced here: a request, an inline script and a frame it forbids.
await ev(`(async () => {
  try { await fetch('http://example.com/x'); } catch {}
  const script = document.createElement('script');
  script.textContent = 'window.__ran = true';
  document.head.appendChild(script);
  const frame = document.createElement('iframe');
  frame.src = 'http://example.com/';
  document.body.appendChild(frame);
  await new Promise((resolve) => setTimeout(resolve, 600));
})()`);
const forbidden = await ev('window.__violations');
check('the policy is enforced: a request, an inline script and a frame it forbids are all reported', forbidden.length >= 3 && (await ev('window.__ran')) !== true, forbidden);

// Start again clean, then use the app. The messages the deliberate violations above wrote to the
// console are dropped, so only what using the app writes is counted.
await send('Page.reload');
await sleep(4000);
logged.length = 0;
await ev(PAGE_HELPERS);
await ev(`(async () => {
  const sp = window.__sp;
  sp.setInput('[role=combobox]', ${JSON.stringify(folder)});
  sp.setInput('input[placeholder="Text to find"]', '');
  await sp.wait(200);
  document.querySelector('button.go').click();
  await sp.wait(2500);
})()`);

const names = await ev(`[...document.querySelectorAll('.body .row .cell:first-child')].map((cell) => cell.innerText.trim())`);
check('a search through the real backend finds the sample files', names.length >= 5, names);

/** Selects the row of `name`, waits for its preview, and says what the preview shows. */
async function previewOf(name) {
  await ev(`(async () => {
    const cell = [...document.querySelectorAll('.body .row .cell:first-child')].find((c) => c.innerText.trim() === ${JSON.stringify(name)});
    cell.closest('.row').click();
    await new Promise((r) => setTimeout(r, 1800));
  })()`);
  return ev(`(() => {
    const preview = document.querySelector('.preview');
    const image = preview.querySelector('img');
    return {
      image: image ? { width: image.naturalWidth, complete: image.complete } : null,
      frame: preview.querySelector('iframe')?.getAttribute('src') ?? null,
      lines: preview.querySelectorAll('.line').length,
      card: !!preview.querySelector('.card'),
    };
  })()`);
}

const picture = await previewOf('picture.png');
check('a picture loads through the asset protocol', picture.image && picture.image.complete && picture.image.width > 0, picture);
const pdf = await previewOf('doc.pdf');
check('a real PDF is put in the frame', typeof pdf.frame === 'string' && pdf.frame.includes('asset.localhost'), pdf);
const disguised = await previewOf('evil.pdf');
check('a page named like a PDF is refused, not shown', disguised.frame === null, disguised);
const code = await previewOf('code.rs');
check('a text file is shown line by line', code.lines > 0, code);
const archive = await previewOf('archive.zip');
check('a file with nothing to show gets a card', archive.card, archive);

const canvas = await ev(`(() => { const stage = document.querySelector('.map canvas'); return stage ? { width: stage.width, height: stage.height } : null; })()`);
check('the map is drawn by its worker', canvas !== null && canvas.width > 0, canvas);
const icons = await ev(`[...document.querySelectorAll('.body .row img.system')].filter((image) => image.complete && image.naturalWidth > 0).length`);
check('system file icons load from blob URLs', icons > 0, icons);

const violations = await ev('window.__violations');
check('using the app reported no policy violation', violations.length === 0, violations);
const policyMessages = logged.filter((text) => /Content Security Policy|violates the following/i.test(text));
check('the console has no policy message from using the app', policyMessages.length === 0, policyMessages);

summarize();
close();

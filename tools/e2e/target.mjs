// Which page on the debug port is Spelunker. The port is open to any local program and answers with
// every page of every WebView2 or Chrome that holds it, so a script must not drive "the first page":
// it could be another browser, and the script would run its code there.

/** The addresses Spelunker's own page has: the dev server, or the bundled app in a release build. */
const SPELUNKER_PAGE = /^https?:\/\/(localhost:5173|tauri\.localhost)(\/|$)/;

/** The debug target of Spelunker's page on `port`. Throws, naming what it found, when there is none. */
export async function findSpelunkerPage(port = 9222) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((target) => target.type === 'page' && SPELUNKER_PAGE.test(target.url));
  if (!page) {
    const found = targets.map((target) => `${target.type} ${target.url}`).join(', ') || 'nothing';
    throw new Error(`port ${port} has no Spelunker page (it has: ${found})`);
  }
  return page;
}

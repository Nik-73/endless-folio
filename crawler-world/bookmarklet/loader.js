// Bookmarklet loader (proof of concept). Injected as a module into any page:
//   <script type="module" src=".../bookmarklet/loader.js?seed=123">
// It wraps the words of readable blocks near the viewport, builds the same
// world object as the host page, and drops the owner's creature on top.
// Running it a second time, or pressing Escape, removes everything and
// restores the page text. The page plumbing lives in ../src/host-page.js,
// shared with the Chrome extension.

import { parseSeed } from '../src/prng.js?v=20261028215825';
import { attachToPage, TOP_Z } from '../src/host-page.js?v=20261028215825';
import { addSheet } from '../src/sheet.js?v=20261028215825';
import { createCrawler as createStubCrawler } from '../src/stub-crawler.js?v=20261028215825';

const KEY = '__folioBookmarklet';
const ENGINE_CANDIDATES = ['../../crawler-engine/src/index.js?v=20261028215825', '../../crawler-engine/index.js?v=20261028215825'];

if (window[KEY]) {
  window[KEY].destroy();
} else {
  window[KEY] = { destroy() {} }; // Guard against a double click while loading.
  boot().catch((err) => {
    console.error('[folio bookmarklet]', err);
    delete window[KEY];
  });
}

async function boot() {
  const here = new URL(import.meta.url);
  let seed = parseSeed(here.searchParams.get('seed'));
  if (seed == null) seed = (Math.random() * 2 ** 32) >>> 0;

  const createCrawler = await loadEngine(here);
  const raw = here.searchParams.get('seed') || '';
  const name = !raw || /^\d+$/.test(raw) ? `Specimen ${seed}` : raw.charAt(0).toUpperCase() + raw.slice(1);
  const host = await attachToPage({ seed, createCrawler, canvasClass: 'cw-bm-canvas', rngLabel: 'bookmarklet:' + location.host, name, seedLabel: raw || seed });

  const removeSheet = addSheet(document, `.cw-bm-close { position: fixed; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); z-index: ${TOP_Z + 1};
      font: 12px/1 ui-monospace, Menlo, monospace; letter-spacing: .06em; padding: 10px 14px; border-radius: 999px;
      border: 1px solid #b9ab8f; background: #f6f0e3; color: #2b241c; cursor: pointer; }`, 'cw-bm-ui');
  const close = document.createElement('button');
  close.dataset.cwIgnore = '';
  close.type = 'button';
  close.className = 'cw-bm-close cw-bm-ui';
  close.textContent = 'Remove crawler';
  document.body.append(close);

  function destroy() {
    host.destroy();
    removeSheet();
    removeEventListener('keydown', onKey, true);
    delete window[KEY];
  }
  function onKey(e) { if (e.key === 'Escape') destroy(); }
  addEventListener('keydown', onKey, true);
  close.addEventListener('click', destroy);

  window[KEY] = { destroy, world: host.world, crawler: host.crawler, worker: host.worker, seed, engine: engineSource };
}

let engineSource = 'stub';
async function loadEngine(here) {
  const choice = here.searchParams.get('engine');
  if (choice === 'stub') return createStubCrawler;
  for (const rel of choice ? [choice] : ENGINE_CANDIDATES) {
    try {
      const mod = await import(new URL(rel, here).href);
      const fn = mod.createCrawler || mod.default?.createCrawler || mod.default;
      if (typeof fn === 'function') { engineSource = rel; return fn; }
    } catch { /* engine not published yet */ }
  }
  return createStubCrawler;
}

// Bookmarklet loader (proof of concept). Injected as a module into any page:
//   <script type="module" src=".../bookmarklet/loader.js?seed=123">
// It wraps the words of readable blocks near the viewport in <span class="w">,
// builds the same world object as the host page, and drops the owner's
// creature on top. Running it a second time, or pressing Escape, removes
// everything and restores the page text.

import { parseSeed, makeRng } from '../src/prng.js';
import { CORPUS } from '../src/corpus.js';
import { createPredictor } from '../src/predictor.js';
import { createEnv } from '../src/env.js';
import { createWorld } from '../src/world.js';
import { createCrawler as createStubCrawler } from '../src/stub-crawler.js';

const KEY = '__folioBookmarklet';
const TOP_Z = 2147483000;
const BLOCK_SEL = 'p, li, dd, dt, blockquote, figcaption, td, th, h1, h2, h3, h4, h5, h6';
const SKIP_SEL = 'script, style, noscript, textarea, input, select, button, code, pre, svg, canvas, [contenteditable], [contenteditable] *, .cw-bm-ui';
const MAX_BLOCKS = 600; // Cap DOM changes on very long pages.
const ENGINE_CANDIDATES = ['../../crawler-engine/src/index.js', '../../crawler-engine/index.js'];

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
  const rng = makeRng(seed).fork('bookmarklet:' + location.host);

  const style = document.createElement('style');
  style.className = 'cw-bm-ui';
  style.textContent = `
    .w { display: inline-block; transform-origin: 50% 60%; }
    .cw-threads { color: #b5532d; }
    .cw-thread { opacity: 0.75; }
    .fx-hl { animation: cw-fx-hl 1.8s ease-out both; border-radius: 3px; }
    @keyframes cw-fx-hl { 0% { background-color: color-mix(in srgb, var(--fx-color, #d68a4a) 45%, transparent); } 100% { background-color: transparent; } }
    .fx-linked { text-decoration: underline; text-decoration-color: #d68a4a; text-underline-offset: 0.2em; }
    .fx-pulse { animation: cw-fx-pulse 0.9s ease-out; }
    @keyframes cw-fx-pulse { 30% { transform: scale(1.025) rotate(-0.6deg); } }
    .cw-bm-canvas { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; height: 100lvh; pointer-events: none; z-index: ${TOP_Z}; }
    .cw-bm-close { position: fixed; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); z-index: ${TOP_Z + 1};
      font: 12px/1 ui-monospace, Menlo, monospace; letter-spacing: .06em; padding: 10px 14px; border-radius: 999px;
      border: 1px solid #b9ab8f; background: #f6f0e3; color: #2b241c; cursor: pointer; }
    @media (prefers-reduced-motion: reduce) { .fx-hl, .fx-pulse { animation: none; } }
  `;
  document.head.append(style);

  const canvas = document.createElement('canvas');
  canvas.className = 'cw-bm-canvas cw-bm-ui';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);

  const close = document.createElement('button');
  close.dataset.cwIgnore = '';
  close.type = 'button';
  close.className = 'cw-bm-close cw-bm-ui';
  close.textContent = 'Remove crawler';
  document.body.append(close);

  // ---- prepare the host page ---------------------------------------------
  const wrapped = []; // spans we created, for teardown
  const marked = []; // [el, classes added]
  const candidates = pickBlocks();

  function mark(el, ...classes) {
    const add = classes.filter((c) => !el.classList.contains(c));
    const hadClass = el.hasAttribute('class');
    el.classList.add(...add);
    marked.push([el, add, hadClass]);
  }

  function wrapBlock(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (!n.nodeValue.trim() || n.parentElement.closest(SKIP_SEL) || n.parentElement.closest('.w')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of node.nodeValue.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.append(part); continue; }
        const s = document.createElement('span');
        s.className = 'w';
        s.textContent = part;
        wrapped.push(s);
        frag.append(s);
      }
      node.replaceWith(frag);
    }
    for (const a of el.querySelectorAll('a[href]')) mark(a, 'xref');
    el.dataset.block = '';
  }

  // Wrap lazily as blocks approach the viewport, so long pages stay fast.
  const pending = new Set(candidates);
  let world = null;
  const lazy = new IntersectionObserver((entries) => {
    const ready = [];
    for (const e of entries) {
      if (!e.isIntersecting || !pending.has(e.target)) continue;
      pending.delete(e.target);
      lazy.unobserve(e.target);
      if (e.target.tagName === 'IMG') { mark(e.target, 'plate'); e.target.dataset.block = ''; }
      else wrapBlock(e.target);
      ready.push(e.target);
    }
    if (ready.length && world) world.addBlocks(ready);
  }, { rootMargin: '100% 0px 100% 0px' });
  candidates.forEach((el) => lazy.observe(el));

  // ---- world + creature ----------------------------------------------------
  const env = createEnv({ canvas, startMuted: true });
  const predictor = createPredictor(CORPUS, { rng: rng.fork('predictor') });
  world = createWorld({ root: document.body, env, predictor, rng: rng.fork('world'), threadZ: TOP_Z - 1 });

  const createCrawler = await loadEngine(here);
  const crawler = await createCrawler({ seed, canvas, world, startAwake: true }); // alive on arrival; sleep comes later, by temperament
  crawler?.start?.();

  function destroy() {
    crawler?.destroy?.();
    world.destroy();
    env.destroy();
    lazy.disconnect();
    for (const s of wrapped) if (s.isConnected) {
      s.style.transform = '';
      s.replaceWith(s.textContent);
    }
    for (const [el, classes, hadClass] of marked) {
      el.classList.remove(...classes);
      if (!hadClass && !el.classList.length) el.removeAttribute('class');
    }
    document.querySelectorAll('[data-block]').forEach((el) => {
      delete el.dataset.block;
      delete el.dataset.cwBlock;
      el.normalize();
    });
    document.querySelectorAll('[data-cw-id]').forEach((el) => delete el.dataset.cwId);
    document.querySelectorAll('.cw-bm-ui').forEach((el) => el.remove());
    removeEventListener('keydown', onKey, true);
    delete window[KEY];
  }
  function onKey(e) { if (e.key === 'Escape') destroy(); }
  addEventListener('keydown', onKey, true);
  close.addEventListener('click', destroy);

  window[KEY] = { destroy, world, crawler, seed, engine: engineSource };
}

// Readable blocks only: visible, a reasonable amount of text, and not nested
// inside another chosen block. Large images become "plates".
function pickBlocks() {
  const out = [];
  const chosen = new Set();
  for (const el of document.body.querySelectorAll(BLOCK_SEL)) {
    if (out.length >= MAX_BLOCKS) break;
    if (el.closest(SKIP_SEL) || el.closest('[aria-hidden="true"], nav, header, footer')) continue;
    const len = el.textContent.trim().length;
    if (len < 2 || len > 4000) continue;
    let p = el.parentElement, nested = false;
    while (p && p !== document.body) { if (chosen.has(p)) { nested = true; break; } p = p.parentElement; }
    if (nested) continue;
    // Prefer the innermost block (e.g. <p> inside <li>): drop a chosen parent.
    if (el.querySelector(BLOCK_SEL)) continue;
    chosen.add(el);
    out.push(el);
  }
  for (const img of document.body.querySelectorAll('img')) {
    if (out.length >= MAX_BLOCKS) break;
    if (img.width >= 60 && img.height >= 60 && !img.closest(SKIP_SEL)) out.push(img);
  }
  return out;
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

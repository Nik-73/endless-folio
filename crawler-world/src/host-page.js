// Puts a creature onto someone else's page: wraps the words of readable blocks
// near the viewport in <span class="w">, builds the same env + world as the
// Folio, drops the creature on a fixed full-screen canvas, and can undo all of
// it exactly. Shared by the bookmarklet (bookmarklet/loader.js) and the
// Chrome extension's content script (crawler-extension/).

import { makeRng } from './prng.js';
import { CORPUS } from './corpus.js';
import { createPredictor } from './predictor.js';
import { createEnv } from './env.js';
import { createWorld, resolvePaperColor } from './world.js';

export const TOP_Z = 2147483000;
const BLOCK_SEL = 'p, li, dd, dt, blockquote, figcaption, td, th, h1, h2, h3, h4, h5, h6';
// Anything marked [data-cw-ui] is ours (canvas, buttons, shadow hosts) and never wrapped.
const SKIP_SEL = 'script, style, noscript, textarea, input, select, button, code, pre, svg, canvas, [contenteditable], [contenteditable] *, .cw-bm-ui, [data-cw-ui]';
const MAX_BLOCKS = 600; // Cap DOM changes on very long pages.

const PAGE_CSS = `
  .w { display: inline-block; transform-origin: 50% 60%; }
  .cw-threads { color: #b5532d; }
  .cw-thread { opacity: 0.75; }
  .fx-hl { animation: cw-fx-hl 1.8s ease-out both; border-radius: 3px; }
  @keyframes cw-fx-hl { 0% { background-color: color-mix(in srgb, var(--fx-color, #d68a4a) 45%, transparent); } 100% { background-color: transparent; } }
  .fx-linked { text-decoration: underline; text-decoration-color: #d68a4a; text-underline-offset: 0.2em; }
  .fx-pulse { animation: cw-fx-pulse 0.9s ease-out; }
  @keyframes cw-fx-pulse { 30% { transform: scale(1.025) rotate(-0.6deg); } }
  .cw-canvas { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; height: 100lvh; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { .fx-hl, .fx-pulse { animation: none; } }
`;

/**
 * @param {object} o
 * @param {number|string} o.seed
 * @param {Function} o.createCrawler  engine factory: ({ seed, canvas, world, ...crawlerOptions }) -> handle
 * @param {string} [o.uiClass]        class put on every element we add (for teardown and skipping)
 * @param {string} [o.canvasClass]    extra class on the canvas
 * @param {string} [o.rngLabel]
 * @param {object} [o.crawlerOptions] passed through to createCrawler
 */
export async function attachToPage({ seed, createCrawler, uiClass = 'cw-bm-ui', canvasClass = '', rngLabel = 'host:' + location.host, crawlerOptions = {}, attrPrefix = 'cw' }) {
  const attr = (k) => 'data-' + attrPrefix + '-' + k; // e.g. data-cw-id
  const BLOCK_KEY = attrPrefix + 'Block', ID_KEY = attrPrefix + 'Id';
  const rng = makeRng(seed).fork(rngLabel);
  const added = [];

  const style = document.createElement('style');
  style.className = uiClass;
  style.dataset.cwUi = '';
  style.textContent = PAGE_CSS;
  document.head.append(style);
  added.push(style);

  const canvas = document.createElement('canvas');
  canvas.className = `cw-canvas ${canvasClass} ${uiClass}`.trim();
  canvas.dataset.cwUi = '';
  canvas.style.zIndex = String(TOP_Z);
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  added.push(canvas);

  // ---- prepare the host page ---------------------------------------------
  const wrapped = []; // spans we created
  const marked = []; // [el, classes added, had a class attribute before]
  const blocked = []; // elements we gave data-block (the host may already use it, e.g. the Folio)
  function markBlock(el) { if (!('block' in el.dataset)) { el.dataset.block = ''; blocked.push(el); } }

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
    markBlock(el);
  }

  // Wrap lazily as blocks approach the viewport, so long pages stay fast.
  const pending = new Set(pickBlocks());
  let world = null;
  const lazy = new IntersectionObserver((entries) => {
    const ready = [];
    for (const e of entries) {
      if (!e.isIntersecting || !pending.has(e.target)) continue;
      pending.delete(e.target);
      lazy.unobserve(e.target);
      if (e.target.tagName === 'IMG') { mark(e.target, 'plate'); markBlock(e.target); }
      else wrapBlock(e.target);
      ready.push(e.target);
    }
    if (ready.length && world) world.addBlocks(ready);
  }, { rootMargin: '100% 0px 100% 0px' });
  pending.forEach((el) => lazy.observe(el));

  // ---- world + creature ----------------------------------------------------
  const env = createEnv({ canvas, startMuted: true });
  const predictor = createPredictor(CORPUS, { rng: rng.fork('predictor') });
  world = createWorld({ root: document.body, env, predictor, rng: rng.fork('world'), threadZ: TOP_Z - 1, paperColor: resolvePaperColor(document.body), attrPrefix });

  const crawler = await createCrawler({ seed, canvas, world, startAwake: true, ...crawlerOptions }); // alive on arrival
  crawler?.start?.();

  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
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
    for (const el of blocked) { delete el.dataset.block; el.normalize(); }
    document.querySelectorAll(`[${attr('block')}]`).forEach((el) => delete el.dataset[BLOCK_KEY]);
    document.querySelectorAll(`[${attr('id')}]`).forEach((el) => delete el.dataset[ID_KEY]);
    added.forEach((el) => el.remove());
    document.querySelectorAll('.' + uiClass).forEach((el) => el.remove());
  }

  return { env, world, crawler, canvas, destroy, track: (el) => added.push(el), get destroyed() { return destroyed; } };
}

// Readable blocks only: visible, a reasonable amount of text, and not nested
// inside another chosen block. Large images become "plates".
export function pickBlocks(root = document.body) {
  const out = [];
  const chosen = new Set();
  for (const el of root.querySelectorAll(BLOCK_SEL)) {
    if (out.length >= MAX_BLOCKS) break;
    if (el.closest(SKIP_SEL) || el.closest('[aria-hidden="true"], nav, header, footer')) continue;
    const len = el.textContent.trim().length;
    if (len < 2 || len > 4000) continue;
    let p = el.parentElement, nested = false;
    while (p && p !== root) { if (chosen.has(p)) { nested = true; break; } p = p.parentElement; }
    if (nested) continue;
    // Prefer the innermost block (e.g. <p> inside <li>): drop a chosen parent.
    if (el.querySelector(BLOCK_SEL)) continue;
    chosen.add(el);
    out.push(el);
  }
  for (const img of root.querySelectorAll('img')) {
    if (out.length >= MAX_BLOCKS) break;
    if (img.width >= 60 && img.height >= 60 && !img.closest(SKIP_SEL)) out.push(img);
  }
  return out;
}

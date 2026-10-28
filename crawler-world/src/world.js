// The world object handed to createCrawler({ seed, canvas, world }).
//
// Coordinates: every x/y the world accepts or returns is in *viewport CSS
// pixels* — the same space as the fixed full-screen creature canvas (before
// devicePixelRatio scaling). Internally items are indexed in document space so
// scrolling never invalidates the index; only reflow does.
//
// See ../WORLD_API.md for the contract.

import { createThreadLayer } from './fx-layer.js?v=20261028215825';

const KINDS = ['word', 'link', 'image', 'block'];

// First non-transparent background colour from el up to <html>, else white.
export function resolvePaperColor(el) {
  const win = el.ownerDocument.defaultView;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const c = win.getComputedStyle(n).backgroundColor;
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) continue;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (parts.length < 4 || parts[3] > 0) return c;
  }
  return '#ffffff';
}

// attrPrefix namespaces the data-* attributes this world writes (data-cw-block,
// data-cw-id by default), so two worlds can share one page without clobbering
// each other (e.g. the extension's creature visiting the Folio).
export function createWorld({ root, env, predictor, rng, threadMount, threadZ = 40, paperColor, attrPrefix = 'cw' }) {
  const BLOCK_KEY = attrPrefix + 'Block', ID_KEY = attrPrefix + 'Id';
  const win = root.ownerDocument.defaultView;
  const blocks = new Map(); // el -> block
  const blockById = new Map();
  const items = new Map(); // id -> item
  const active = new Set(); // blocks near the viewport
  const threads = createThreadLayer({ doc: root.ownerDocument, mount: threadMount || root.ownerDocument.body, className: 'cw-threads', zIndex: threadZ });
  const touched = [];
  let seq = 0;
  let reflowTimer = 0;

  // ---- indexing ------------------------------------------------------------
  const io = new win.IntersectionObserver((entries) => {
    for (const e of entries) {
      const b = blocks.get(e.target);
      if (!b) continue;
      if (e.isIntersecting) {
        active.add(b);
        if (b.dirty) idle(() => b.dirty && indexBlock(b));
      } else active.delete(b);
    }
  }, { rootMargin: '50% 0px 50% 0px' });

  function idle(fn) {
    (win.requestIdleCallback || ((f) => setTimeout(f, 16)))(fn, { timeout: 200 });
  }

  function register(el) {
    if (blocks.has(el)) return blocks.get(el);
    const b = { id: 'b' + ++seq, el, items: [], dirty: true, box: null, heading: /^H[1-6]$/.test(el.tagName), scattered: false };
    el.dataset[BLOCK_KEY] = b.id;
    blocks.set(el, b);
    blockById.set(b.id, b);
    io.observe(el);
    return b;
  }

  function docRect(r) {
    return { x: r.left + win.scrollX, y: r.top + win.scrollY, w: r.width, h: r.height };
  }

  function union(rs) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function upsert(el, kind, b, extra) {
    let id = el.dataset[ID_KEY];
    let it = id && items.get(id);
    if (!it) {
      id = kind[0] + ++seq;
      el.dataset[ID_KEY] = id;
      it = { id, kind, el, block: b, text: '', rects: [], box: null, ...extra };
      items.set(id, it);
    }
    return it;
  }

  function indexBlock(b) {
    const list = [];
    for (const w of b.el.querySelectorAll('.w')) {
      const link = w.closest('a.xref');
      const it = upsert(w, 'word', b, {});
      it.text = w.textContent;
      it.heading = b.heading;
      it.linkId = link ? upsert(link, 'link', b, {}).id : null;
      it.rects = [docRect(w.getBoundingClientRect())];
      it.box = it.rects[0];
      list.push(it);
    }
    for (const a of b.el.querySelectorAll('a.xref')) {
      const it = upsert(a, 'link', b, {});
      it.text = a.textContent.trim();
      it.href = a.getAttribute('href');
      it.heading = b.heading;
      it.rects = [...a.getClientRects()].map(docRect);
      it.box = union(it.rects);
      list.push(it);
    }
    const imgs = b.el.matches('.plate') ? [b.el] : b.el.querySelectorAll('.plate');
    for (const p of imgs) {
      const it = upsert(p, 'image', b, {});
      it.text = p.getAttribute('aria-label') || p.dataset.caption || 'plate';
      it.rects = [docRect(p.getBoundingClientRect())];
      it.box = it.rects[0];
      list.push(it);
    }
    b.items = list;
    const own = docRect(b.el.getBoundingClientRect());
    b.box = list.length ? union([own, ...list.map((i) => i.box)]) : own;
    b.dirty = false;
  }

  let gone = false;
  function invalidateAll() {
    if (gone) return; // late timers after destroy() must not re-mark the page
    for (const b of blocks.values()) b.dirty = true;
    for (const b of active) indexBlock(b);
    threads.redraw();
    env.emit('reindex', { blocks: blocks.size });
  }
  function scheduleReflow(ms = 120) {
    clearTimeout(reflowTimer);
    reflowTimer = setTimeout(invalidateAll, ms);
  }

  // Reflow sources: width changes and late font loads. Scroll never reflows.
  let lastWidth = root.clientWidth;
  const ro = new win.ResizeObserver(() => {
    if (root.clientWidth !== lastWidth) { lastWidth = root.clientWidth; scheduleReflow(); }
  });
  ro.observe(root);
  root.ownerDocument.fonts?.ready.then(() => scheduleReflow(0));

  // ---- queries ---------------------------------------------------------------
  function distToRect(px, py, r) {
    const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    return Math.hypot(dx, dy);
  }

  function toPublic(it, distance) {
    const sx = win.scrollX, sy = win.scrollY;
    const box = it.box;
    return {
      id: it.id,
      kind: it.kind,
      // Engine vocabulary: words are 'text'; links and images keep their kind.
      type: it.kind === 'word' ? 'text' : it.kind,
      text: it.text,
      x: box.x - sx, y: box.y - sy, w: box.w, h: box.h,
      cx: box.x - sx + box.w / 2, cy: box.y - sy + box.h / 2,
      distance,
      blockId: it.kind === 'block' ? it.id : it.block.id,
      heading: !!it.heading,
      linkId: it.linkId || null,
      href: it.href || null,
      rects: it.rects.map((r) => ({ x: r.x - sx, y: r.y - sy, w: r.w, h: r.h })),
      el: it.el,
    };
  }

  function blockAsItem(b) {
    return { id: b.id, kind: 'block', el: b.el, block: b, text: b.el.textContent.slice(0, 80), rects: [b.box], box: b.box, heading: b.heading };
  }

  function queryNear(x, y, radius = 40, { kinds = ['word', 'link', 'image'], limit = 32 } = {}) {
    const px = x + win.scrollX, py = y + win.scrollY;
    const want = new Set(kinds);
    const out = [];
    for (const b of active) {
      if (b.dirty) indexBlock(b);
      if (distToRect(px, py, b.box) > radius) continue;
      if (want.has('block')) out.push([blockAsItem(b), distToRect(px, py, b.box)]);
      for (const it of b.items) {
        if (!want.has(it.kind)) continue;
        let d = Infinity;
        for (const r of it.rects) d = Math.min(d, distToRect(px, py, r));
        if (d <= radius) out.push([it, d]);
      }
    }
    out.sort((a, b) => a[1] - b[1]);
    return out.slice(0, limit).map(([it, d]) => toPublic(it, d));
  }

  function resolve(target) {
    if (!target) return null;
    if (typeof target === 'string') return items.get(target) || (blockById.get(target) && blockAsItem(blockById.get(target)));
    if (target.id) return items.get(target.id) || (blockById.get(target.id) && blockAsItem(blockById.get(target.id)));
    return null;
  }

  // ---- effects ---------------------------------------------------------------
  const timers = new WeakMap();

  function touch(target, strength = 1) {
    const it = resolve(target);
    if (!it) return false;
    let learned = false;
    for (const w of it.text.split(/\s+/)) learned = predictor.touch(w, strength) || learned;
    touched.push({ id: it.id, text: it.text, t: performance.now() });
    if (touched.length > 64) touched.shift();
    env.emit('touch', { id: it.id, kind: it.kind, text: it.text, learned });
    return learned;
  }

  function highlight(it, { duration = 1800, color, persist = false } = {}) {
    const el = it.el;
    if (color) el.style.setProperty('--fx-color', color);
    el.classList.remove('fx-hl');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('fx-hl');
    clearTimeout(timers.get(el));
    if (!persist) timers.set(el, setTimeout(() => el.classList.remove('fx-hl'), duration));
    return () => el.classList.remove('fx-hl');
  }

  function connect(a, b, opts = {}) {
    if (!a || !b || a === b) return null;
    a.el.classList.add('fx-linked');
    b.el.classList.add('fx-linked');
    const bend = (rng.next() - 0.5) * 2 || 1;
    const t = threads.add(a.el, b.el, { color: opts.color, width: opts.width, bend });
    return () => { t.remove(); a.el.classList.remove('fx-linked'); b.el.classList.remove('fx-linked'); };
  }

  function scatter(it, { strength = 1, restoreAfter = 0 } = {}) {
    const b = it.block;
    const reduced = env.state.reducedMotion;
    const s = reduced ? 0.25 : strength;
    const parts = b.el.querySelectorAll('.w, .plate');
    const cw = root.clientWidth;
    for (const w of parts) {
      // Keep words on-screen horizontally: the push is relative to column width.
      const dx = (rng.next() - 0.5) * Math.min(260, cw * 0.45) * s;
      const dy = (rng.next() - 0.35) * 120 * s;
      const rot = reduced ? 0 : (rng.next() - 0.5) * 70 * s;
      w.style.transition = `transform ${900 + rng.next() * 900}ms cubic-bezier(.2,.7,.2,1), opacity 1.2s`;
      w.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`;
      w.style.opacity = String(0.55 + rng.next() * 0.45);
    }
    b.el.classList.add('fx-scattered');
    b.scattered = true;
    setTimeout(() => { if (gone) return; b.dirty = true; if (active.has(b)) indexBlock(b); threads.redraw(); }, 1900);
    if (restoreAfter) setTimeout(() => gather(it), restoreAfter);
    return () => gather(it);
  }

  function gather(it) {
    const b = it.block;
    for (const w of b.el.querySelectorAll('.w, .plate')) {
      w.style.transition = 'transform 1.4s cubic-bezier(.4,0,.2,1), opacity 1s';
      w.style.transform = '';
      w.style.opacity = '';
    }
    b.el.classList.remove('fx-scattered');
    b.scattered = false;
    setTimeout(() => { if (gone) return; b.dirty = true; if (active.has(b)) indexBlock(b); threads.redraw(); }, 1500);
  }

  function fade(it, { amount = 0.22 } = {}) {
    const el = it.el;
    el.style.transition = 'opacity 2.5s';
    el.style.opacity = String(amount);
    el.classList.add('fx-ghost');
    return () => { el.style.opacity = ''; el.classList.remove('fx-ghost'); };
  }

  function pulse(it) {
    const el = it.el;
    el.classList.remove('fx-pulse');
    void el.offsetWidth;
    el.classList.add('fx-pulse');
    setTimeout(() => el.classList.remove('fx-pulse'), 900);
    return () => el.classList.remove('fx-pulse');
  }

  // A foot's weight: the word under it dips while the foot is planted. Uses the
  // `translate` property, so it never fights a word's own transform (knocked or
  // scattered words). One word at a time and no keyframes: an animated word
  // repaints the whole page layer every frame, which on a long page is most of
  // a phone's frame budget. A snap costs two small repaints per step.
  let pressed = null, pressT = 0, pressAt = 0;
  function release() { clearTimeout(pressT); pressed?.classList.remove('fx-press'); pressed = null; }
  function press(it) {
    const el = it.el, now = performance.now();
    if (el !== pressed && now - pressAt < 110) return () => {}; // feet land faster than the eye reads
    pressAt = now;
    if (pressed !== el) { pressed?.classList.remove('fx-press'); pressed = el; el.classList.add('fx-press'); }
    clearTimeout(pressT);
    pressT = setTimeout(release, 200);
    return () => { if (pressed === el) release(); };
  }

  function applyEffect(type, target, opts = {}) {
    if (type === 'clear') {
      threads.clear();
      root.querySelectorAll('.fx-hl,.fx-linked').forEach((e) => e.classList.remove('fx-hl', 'fx-linked'));
      return { type, ids: [], undo() {} };
    }
    let a, b;
    if (type === 'connect') {
      const pair = Array.isArray(target) ? target : [target, opts.to];
      a = resolve(pair[0]); b = resolve(pair[1]);
      if (!a || !b) return null;
    } else {
      a = resolve(target);
      if (!a) return null;
    }
    let undo;
    switch (type) {
      case 'highlight': undo = highlight(a, opts); touch(a, 0.5); break;
      case 'connect': undo = connect(a, b, opts); if (!undo) return null; touch(a, 1); touch(b, 1); break;
      case 'scatter': undo = scatter(a, opts); touch(a, 0.5); break;
      case 'gather': gather(a); undo = () => {}; break;
      case 'fade': undo = fade(a, opts); touch(a, 1.5); break;
      case 'pulse': undo = pulse(a); break;
      case 'press': undo = press(a); return { type, ids: [a.id], undo };
      default: console.warn('[world] unknown effect', type); return null;
    }
    const ids = b ? [a.id, b.id] : [a.id];
    env.emit('effect', { type, ids });
    return { type, ids, undo };
  }

  // ---- public ------------------------------------------------------------------
  root.querySelectorAll('[data-block]').forEach(register);
  let boundsNow = null;

  return {
    version: 1,
    /** Colour of the paper under the text, for halos/shadows that lift the creature off the page. */
    get paperColor() { return typeof paperColor === 'function' ? paperColor() : paperColor || (paperColor = resolvePaperColor(root)); },
    /** Extra tap radius around a creature, by pointer type (mouse/pen/touch). Also on each tap event as `pad`. */
    tapPad: env.tapPad,
    effects: ['highlight', 'connect', 'scatter', 'gather', 'fade', 'pulse', 'press', 'clear'],
    kinds: KINDS,
    viewport: env.viewport,
    pointer: env.pointer,
    audio: env.audio,
    state: env.state,
    on: env.on,
    off: env.off,
    queryNear,
    hitTest: (x, y) => queryNear(x, y, 0, { limit: 1 })[0] || null,
    applyEffect,
    touch,
    getItem: (id) => { const it = resolve(id); return it ? toPublic(it, 0) : null; },
    touchedWords: () => predictor.touchedWords(),
    recentTouches: () => touched.slice(),
    /** Visible part of the article column, in viewport coords: the creature's roaming area. */
    bounds() {
      // Every creature asks several times a frame, between DOM writes (pressed
      // words, carried tags), so each fresh read would force a style and layout
      // pass. Measure once per task instead.
      if (boundsNow) return boundsNow;
      const r = root.getBoundingClientRect();
      const vh = env.viewport.height || win.innerHeight;
      const y0 = Math.max(0, r.top), y1 = Math.min(vh, r.bottom);
      boundsNow = { x: r.left, y: y0, w: r.width, h: Math.max(0, y1 - y0) };
      queueMicrotask(() => { boundsNow = null; });
      return boundsNow;
    },
    /** The whole article column, in viewport coords (may extend far off-screen). */
    columnBounds() {
      const r = root.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    documentSize: () => ({ width: root.ownerDocument.documentElement.scrollWidth, height: root.ownerDocument.documentElement.scrollHeight }),
    /** Host-only: register newly appended blocks. */
    addBlocks(els) { els.forEach(register); env.emit('append', { count: els.length }); },
    stats: () => ({ blocks: blocks.size, active: active.size, items: items.size, threads: threads.count() }),
    reflow: invalidateAll,
    /** Host-only: stop observing and remove threads (used by the bookmarklet's teardown). */
    destroy() { gone = true; io.disconnect(); ro.disconnect(); clearTimeout(reflowTimer); release(); threads.destroy(); },
  };
}

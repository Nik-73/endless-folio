// What the creature did to a page, kept. Every tear, bite and knock is saved as
// an operation anchored to the page's own text (block signature + word index,
// or link text + href), and replayed when the page is opened again, so the
// page you come back to is the one it left. "Original" peeks underneath;
// "Mend" forgets this page's operations.
//
// Storage is pluggable: { get(key) -> Promise<any>, set(key, value) -> Promise }.
// The Folio and the bookmarklet use localStorage; the extension passes
// chrome.storage.local, which also works across sites.

export function localStore(prefix = 'crawler-world:') {
  return {
    async get(k) { try { return JSON.parse(localStorage.getItem(prefix + k) || 'null'); } catch { return null; } },
    async set(k, v) { try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch { /* full or blocked */ } },
  };
}

export function pageKey(loc = location) {
  return 'page:' + loc.origin + loc.pathname + loc.search;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
export function blockSig(el) { return hash(norm(el.textContent).slice(0, 160)); }

const MAX_OPS = 500;

/**
 * @param {object} o
 * @param {object} o.store
 * @param {object} o.world     world API (for the 'append' event when new blocks are wrapped)
 * @param {Function} o.onApply (el, op) called for every op put back on the page
 */
export function createPageLayer({ store, world, doc = document, onApply = () => {} }) {
  const key = pageKey(doc.defaultView.location);
  let ops = [];
  const pending = new Set();
  let ready = false, saveT = 0;

  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => store.set(key, { ops, at: Date.now(), title: doc.title }), 300); };

  function wordAt(block, i) { return block.querySelectorAll('.w')[i] || null; }
  function blocksBySig() {
    const m = new Map();
    for (const b of doc.querySelectorAll('[data-block]')) if (b.querySelector('.w')) m.set(blockSig(b), b);
    return m;
  }

  function applyOne(op, blocks) {
    if (op.k === 'tear') {
      for (const a of doc.querySelectorAll('a[href]')) {
        if (a.closest('[data-cw-ui]')) continue;
        if (a.href === op.href && norm(a.textContent) === op.text) { onApply(a, op); return true; }
      }
      return false;
    }
    const b = blocks.get(op.sig);
    if (!b) return false;
    const w = wordAt(b, op.i);
    if (!w) return false;
    onApply(w, op);
    return true;
  }

  function replay() {
    if (!pending.size) return;
    const blocks = blocksBySig();
    for (const op of [...pending]) if (applyOne(op, blocks)) pending.delete(op);
  }

  const off = world.on?.('append', () => setTimeout(replay, 30));
  const ready$ = store.get(key).then((saved) => {
    ops = (saved?.ops || []).slice(-MAX_OPS);
    ops.forEach((op) => pending.add(op));
    ready = true;
    replay();
    // lazy-wrapped pages fill in as you scroll; keep trying for a while
    let n = 0;
    const iv = setInterval(() => { replay(); if (!pending.size || ++n > 30) clearInterval(iv); }, 1000);
    return ops.length;
  });

  // Anchor a word element: its block signature and index among the block's words.
  function anchorWord(el) {
    const b = el.closest('[data-block]');
    if (!b) return null;
    const i = [...b.querySelectorAll('.w')].indexOf(el);
    return i < 0 ? null : { sig: blockSig(b), i };
  }

  return {
    ready: ready$,
    get count() { return ops.length; },
    record(op) {
      if (!ready) return;
      ops.push({ ...op, at: Date.now() });
      if (ops.length > MAX_OPS) ops = ops.slice(-MAX_OPS);
      save();
    },
    recordTear(a) { this.record({ k: 'tear', href: a.href, text: norm(a.textContent) }); },
    recordBite(el) { const an = anchorWord(el); if (an) this.record({ k: 'bite', ...an }); },
    recordKnock(el, t, o) { const an = anchorWord(el); if (an) this.record({ k: 'knock', ...an, t, o }); },
    clear() { ops = []; pending.clear(); store.set(key, null); },
    replay,
    destroy() { off?.(); clearTimeout(saveT); },
  };
}

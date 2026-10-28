// Minimal world for standalone use and the demo. Indexes text, links and
// images inside `root` and reports them in the coordinate space of `canvas`
// (the canvas is expected to overlay root). Effects are CSS classes:
// .cw-fx-<effect> is added for a moment, nibble dims a word for a while.

export function createStubWorld({ root, canvas, selectors = {} } = {}) {
  const sel = { text: '.w', link: 'a', image: '.img, img', ...selectors };
  let items = [], dirty = true, seq = 0;

  function reindex() {
    const base = (canvas || root).getBoundingClientRect();
    items = [];
    const add = (el, type) => {
      if (!el.dataset.cwId) el.dataset.cwId = type[0] + ++seq;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      items.push({ id: el.dataset.cwId, type, el, text: (el.textContent || el.getAttribute('alt') || '').trim(),
        x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    };
    root.querySelectorAll(sel.text).forEach((el) => { if (!el.closest(sel.link)) add(el, 'text'); });
    root.querySelectorAll(sel.link).forEach((el) => add(el, 'link'));
    root.querySelectorAll(sel.image).forEach((el) => add(el, 'image'));
    dirty = false;
  }

  // Rects are cached; anything that can move them marks the index dirty.
  const markDirty = () => { dirty = true; };
  const ro = 'ResizeObserver' in window ? new ResizeObserver(markDirty) : null;
  ro?.observe(root);
  window.addEventListener('scroll', markDirty, { passive: true });
  window.addEventListener('resize', markDirty, { passive: true });
  document.fonts?.ready.then(markDirty);

  function distToRect(px, py, r) {
    const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    return Math.hypot(dx, dy);
  }

  const timers = new WeakMap();
  function flash(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart CSS animation
    el.classList.add(cls);
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(() => el.classList.remove(cls), ms));
  }

  return {
    kinds: ['text', 'link', 'image'],
    /** Items whose box is within `radius` px of (x, y), nearest first. */
    queryNear(x, y, radius) {
      if (dirty) reindex();
      const out = [];
      for (const it of items) {
        const d = distToRect(x, y, it);
        if (d <= radius) { it.distance = d; out.push(it); }
      }
      return out.sort((a, b) => a.distance - b.distance);
    },
    applyEffect(effect, item, info) {
      const el = item?.el;
      if (!el) return;
      if (info?.crawler) el.style.setProperty('--cw-color', info.crawler.traits.palette.accent);
      if (effect === 'nibble') {
        el.classList.add('cw-eaten');
        setTimeout(() => el.classList.remove('cw-eaten'), 20000);
      }
      flash(el, 'cw-fx-' + effect, effect === 'hide' || effect === 'perch' ? 5000 : 1400);
    },
    reindex: markDirty,
    destroy() {
      ro?.disconnect();
      window.removeEventListener('scroll', markDirty);
      window.removeEventListener('resize', markDirty);
    },
  };
}

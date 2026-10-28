// Translates between the engine's world vocabulary and a host world.
//
// The engine asks for nearby things with world.queryNear(x, y, radius) and
// expects items { id, type: 'text'|'link'|'image', x, y, w, h } in canvas CSS
// px. It reports what it does with world.applyEffect(effect, item, info) using
// its own behaviour verbs (read, nibble, tug, inspect, hide, perch, jostle).
//
// A world that already speaks that vocabulary (e.g. ./stub-world.js) is used
// as is. The Folio world (crawler-world/src/world.js: kinds word/link/image,
// effects highlight/fade/pulse/scatter/connect) is wrapped so each behaviour
// becomes a visible change to the page.

const KIND_TO_TYPE = { word: 'text', link: 'link', image: 'image' };

export function isFolioWorld(w) {
  return !!w && Array.isArray(w.kinds) && w.kinds.includes('word') && typeof w.queryNear === 'function';
}

export function adaptWorld(world, opts = {}) {
  if (!world) return null;
  if (!isFolioWorld(world)) return world;
  return new FolioAdapter(world, opts);
}

class FolioAdapter {
  constructor(world, { restoreEaten = 45000 } = {}) {
    this.host = world;
    this.restoreEaten = restoreEaten;
    this.lastScatter = -1e9;
    this.lastFootWord = null;
    this.footT = 0;
  }

  get paperColor() { return this.host.paperColor || null; }

  queryNear(x, y, radius, limit = 24) {
    const items = this.host.queryNear(x, y, radius, { kinds: ['word', 'link', 'image'], limit });
    for (const it of items) it.type = KIND_TO_TYPE[it.kind] || it.kind;
    return items;
  }

  /**
   * Creatures roam the visible part of the article column (world.bounds()),
   * widened a little and clipped to what is actually visible: on phones the
   * canvas is sized to the large viewport, so the URL bar can cover its bottom.
   */
  bounds() {
    const v = this.host.viewport, b = this.host.bounds();
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const visH = vv ? Math.min(v.height, vv.height + vv.offsetTop) : v.height;
    const pad = 6;
    let x0 = Math.max(0, b.x - 24), x1 = Math.min(v.width, b.x + b.w + 24);
    if (x1 - x0 < 160) { x0 = 0; x1 = v.width; }
    const y0 = Math.max(pad, b.y), y1 = Math.min(visH - pad, b.y + b.h);
    if (y1 - y0 < 160) return { x: x0, y: pad, w: x1 - x0, h: visH - pad * 2 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  applyEffect(effect, item, info) {
    const H = this.host, c = info?.crawler, color = c?.traits.palette.accent;
    switch (effect) {
      case 'read': // one word of a reading chain; the chain leaves a trail
        H.applyEffect('highlight', item, { color, duration: 4200 });
        break;
      case 'thread': // first word of a reading chain to its last
        if (info?.to) H.applyEffect('connect', [item, info.to], { color });
        break;
      case 'nibble': {
        const r = H.applyEffect('fade', item, { amount: 0.2 });
        if (r && this.restoreEaten) setTimeout(() => r.undo(), this.restoreEaten);
        break;
      }
      case 'tug':
        H.applyEffect('pulse', item);
        H.applyEffect('highlight', item, { color, duration: 1200 });
        break;
      case 'inspect':
      case 'hide':
      case 'perch':
        H.applyEffect('pulse', item);
        H.touch?.(item, 0.5);
        break;
      case 'jostle': {
        const now = performance.now();
        if (now - this.lastScatter > 20000 && !item.heading) {
          this.lastScatter = now;
          H.applyEffect('scatter', item, { strength: 0.55, restoreAfter: 7000 });
        } else H.applyEffect('pulse', item);
        break;
      }
      default:
        H.applyEffect(effect, item, info); // let unknown verbs through untouched
    }
  }

  /**
   * Where a foot can grip near (x, y): the nearest edge of a line of text
   * (top or bottom of a word box), or null on bare paper. Feet stand on the
   * page's own structure instead of hovering over it.
   */
  footHold(x, y, reach) {
    const hit = this.host.queryNear(x, y, reach, { kinds: ['word'], limit: 4 });
    let best = null, bd = Infinity;
    for (const it of hit) {
      const px = Math.min(Math.max(x, it.x + 1), it.x + it.w - 1);
      for (const py of [it.y + 1, it.y + it.h - 1]) {
        const d = Math.hypot(px - x, py - y);
        if (d < bd) { bd = d; best = { x: px, y: py, id: it.id }; }
      }
    }
    return best;
  }

  /** A planted foot presses the word under it (no colour, just weight). */
  footstep(x, y, crawler, holdId) {
    if (crawler?.passive) return; // helpers are too light to press the page (and three pressers cost frames)
    const now = performance.now();
    if (now - this.footT < 60) return;
    this.footT = now;
    const id = holdId || this.host.queryNear(x, y, 2, { kinds: ['word'], limit: 1 })[0]?.id;
    if (id) this.host.applyEffect('press', id);
  }
}

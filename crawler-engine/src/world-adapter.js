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
    this.memory = []; // recently read words, for 'connect' threads
    this.lastScatter = -1e9;
    this.lastFootWord = null;
    this.footT = 0;
  }

  queryNear(x, y, radius) {
    const items = this.host.queryNear(x, y, radius, { kinds: ['word', 'link', 'image'], limit: 24 });
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
      case 'read':
        H.applyEffect('highlight', item, { color, duration: 2400 });
        this._remember(item, color, c);
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

  /** Every so often a read word gets tied back to one read earlier. */
  _remember(item, color, c) {
    if (item.kind !== 'word') return;
    const m = this.memory;
    if (m.length > 3 && (c ? c.rng.next() : Math.random()) < 0.3) {
      const earlier = m[Math.floor((c ? c.rng.next() : Math.random()) * (m.length - 2))];
      if (earlier.id !== item.id) this.host.applyEffect('connect', [earlier, item], { color });
    }
    m.push(item);
    if (m.length > 10) m.shift();
  }

  /** Feet light up the words they land on (rate-limited). */
  footstep(x, y, crawler) {
    const now = performance.now();
    if (now - this.footT < 180) return;
    this.footT = now;
    const hit = this.host.queryNear(x, y, 0, { kinds: ['word'], limit: 1 })[0];
    if (!hit || hit.id === this.lastFootWord) return;
    this.lastFootWord = hit.id;
    this.host.applyEffect('highlight', hit, { color: crawler.traits.palette.tint, duration: 900 });
  }
}

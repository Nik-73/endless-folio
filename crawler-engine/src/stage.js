// A Stage owns one canvas: sizing (devicePixelRatio + resize), pointer/touch
// input, waking creatures on interaction, and drawing. All stages share a
// single requestAnimationFrame ticker, so six demo canvases cost one loop.
//
// Two modes:
//  - standalone: the stage sizes the canvas and listens to pointer events on
//    `pointerTarget` (default: the canvas' parent element).
//  - host: the world already sizes the canvas and tracks the pointer
//    (world.viewport / world.pointer / world.on, as in the Folio). The stage
//    just reads them and follows world 'tap', 'scroll' and 'visibility' events.
// Neither mode calls preventDefault, so pages keep scrolling natively on touch.

const MAX_DPR = 2;
const POINTER_FADE = 2.5; // s after the last move/touch before the pointer stops attracting

// ---------------------------------------------------------------- shared ticker
const live = new Set();
let raf = 0, last = 0;
function tick(now) {
  raf = 0;
  let dt = last ? (now - last) / 1000 : 1 / 60;
  last = now;
  if (dt > 0.25) dt = 1 / 60; // returning from a background tab: don't jump
  else if (dt > 1 / 30) dt = 1 / 30; // slow frame: slow motion rather than tunnelling legs
  for (const s of live) s._frame(dt, now);
  if (live.size) raf = requestAnimationFrame(tick);
  else last = 0;
}
function schedule() { if (!raf && live.size) raf = requestAnimationFrame(tick); }

const stagesByCanvas = new WeakMap();

/** One stage per canvas; repeated calls return the same stage. */
export function getStage(canvas, opts = {}) {
  let s = stagesByCanvas.get(canvas);
  if (!s) { s = new Stage(canvas, opts); stagesByCanvas.set(canvas, s); }
  return s;
}

export class Stage {
  constructor(canvas, { world = null, pointerTarget = null, maxDpr = MAX_DPR, tapToSteer = true } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true }) || canvas.getContext('2d');
    this.world = world;
    this.host = !!(world && world.viewport && world.pointer && typeof world.on === 'function');
    this.maxDpr = maxDpr;
    this.tapToSteer = tapToSteer;
    this.crawlers = [];
    this.running = false;
    this.hidden = typeof document !== 'undefined' && document.hidden;
    this.speedScale = 1;
    this.width = 0; this.height = 0; this.dpr = 1;
    // Effective pointer the creatures read each frame (reused, never reallocated).
    this.ptr = { x: 0, y: 0, vx: 0, vy: 0, active: false, down: false, type: 'mouse' };
    this._raw = { x: 0, y: 0, active: false, down: false, type: 'mouse', lastMove: 0 };
    this._lastSeenMove = 0;
    this.stats = { fps: 60, frameMs: 0, updateMs: 0, drawMs: 0 };
    this._frames = 0; this._acc = 0; this._work = 0; this._upd = 0; this._drw = 0;
    this._offs = [];
    this._listenersOn = false;
    this.pointerTarget = pointerTarget;
  }

  add(c) {
    if (this.crawlers.includes(c)) return c;
    c.stage = this;
    this.crawlers.push(c);
    this._ensureListeners();
    return c;
  }

  remove(c) {
    const i = this.crawlers.indexOf(c);
    if (i >= 0) this.crawlers.splice(i, 1);
    if (!this.crawlers.length) this.destroy();
  }

  start() {
    this._ensureListeners();
    this.running = true;
    if (!this.hidden) { live.add(this); schedule(); }
  }

  stop() { this.running = false; live.delete(this); }

  destroy() {
    this.stop();
    this._offs.forEach((off) => off());
    this._offs = []; this._listenersOn = false;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    stagesByCanvas.delete(this.canvas);
  }

  // -------------------------------------------------------------- input
  _ensureListeners() {
    if (this._listenersOn || typeof window === 'undefined') return;
    this._listenersOn = true;
    const offs = this._offs;
    const on = (t, type, fn, o = { passive: true }) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
    const setHidden = (h) => {
      this.hidden = h;
      if (h) live.delete(this); else if (this.running) { live.add(this); schedule(); }
    };

    if (this.host) {
      const W = this.world;
      this._raw = W.pointer; // live object owned by the host
      offs.push(W.on('tap', (e) => this._tap(e.x, e.y, e.pointerType, e)));
      offs.push(W.on('scroll', ({ dx, dy }) => {
        // Creatures live on the page, not the glass: move them with the text.
        for (const c of this.crawlers) c.translate(-dx, -dy);
      }));
      offs.push(W.on('visibility', ({ hidden }) => setHidden(hidden)));
      if (W.state) {
        const rm = () => { this.speedScale = W.state.reducedMotion ? 0.6 : 1; };
        rm(); offs.push(W.on('motion', rm));
      }
      return;
    }

    // standalone: size the canvas ourselves
    this._resize();
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => this._resize());
      ro.observe(this.canvas);
      offs.push(() => ro.disconnect());
    }
    on(window, 'resize', () => this._resize());
    on(document, 'visibilitychange', () => setHidden(document.hidden));
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq) { this.speedScale = mq.matches ? 0.6 : 1; }

    const target = this.pointerTarget || this.canvas.parentElement || this.canvas;
    const raw = this._raw;
    let downAt = null;
    const local = (cx, cy) => {
      const r = this.canvas.getBoundingClientRect();
      return [cx - r.left, cy - r.top];
    };
    const move = (cx, cy, type) => {
      const [x, y] = local(cx, cy);
      raw.x = x; raw.y = y; raw.type = type; raw.active = true; raw.lastMove = performance.now();
    };
    on(target, 'pointerdown', (e) => {
      raw.down = true; move(e.clientX, e.clientY, e.pointerType || 'mouse');
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    on(target, 'pointermove', (e) => move(e.clientX, e.clientY, e.pointerType || 'mouse'));
    on(window, 'pointerup', (e) => {
      if (!raw.down) return;
      raw.down = false;
      if (downAt && performance.now() - downAt.t < 350 && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 12) {
        const [x, y] = local(e.clientX, e.clientY);
        if (x >= 0 && y >= 0 && x <= this.width && y <= this.height) this._tap(x, y, e.pointerType);
      }
      downAt = null;
    });
    on(window, 'pointercancel', () => { raw.down = false; downAt = null; });
    // During a native touch scroll pointermove stops but touchmove keeps flowing.
    on(target, 'touchmove', (e) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY, 'touch'); });
    on(target, 'touchend', () => { raw.down = false; });
    on(target, 'pointerleave', (e) => { if (e.pointerType === 'mouse') raw.active = false; });
  }

  _resize() {
    if (this.host) return;
    const dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w; this.height = h; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    if (this.running && !this.hidden) this._draw(); // a resize clears the canvas
  }

  /** e (host taps): { pad, claim() }. A claimed tap cancels the click that follows, so poking a creature on a link doesn't follow the link. */
  _tap(x, y, pointerType = 'mouse', e = null) {
    this._interacted = true;
    let hit = null;
    const pad = e?.pad ?? this.world?.tapPad ?? (pointerType === 'mouse' ? 12 : 20); // a fingertip needs a bigger target
    for (const c of this.crawlers) if (c.placed && !c.passive && c.hitTest(x, y, pad)) { hit = c; break; }
    if (hit) { e?.claim?.(); hit.poke(x, y); return; } // only pokes claim; calls still follow links
    if (!this.tapToSteer) return;
    // Tap elsewhere: the nearest creature is called over.
    let best = null, bd = Infinity;
    for (const c of this.crawlers) {
      if (!c.placed || c.passive) continue; // helpers never answer your taps
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) best.call(x, y);
  }

  // -------------------------------------------------------------- frame
  _syncPointer(now) {
    const raw = this._raw, p = this.ptr;
    // pointer velocity (px/s), for creatures that hop back from a lunge
    const pdt = Math.max(0.004, (now - (this._pt || now)) / 1000 || 0.016);
    this._pt = now;
    if (p.active && raw.active) {
      p.vx += ((raw.x - p.x) / pdt - p.vx) * 0.5; p.vy += ((raw.y - p.y) / pdt - p.vy) * 0.5;
    } else { p.vx = 0; p.vy = 0; }
    const fresh = raw.down || (raw.lastMove && (now - raw.lastMove) / 1000 < POINTER_FADE);
    p.x = raw.x; p.y = raw.y; p.down = !!raw.down; p.type = raw.type;
    p.active = !!raw.active && !!fresh;
    const moved = raw.lastMove !== this._lastSeenMove;
    this._lastSeenMove = raw.lastMove;
    return moved;
  }

  _frame(dt, now) {
    const t0 = performance.now();
    if (this.host) {
      const v = this.world.viewport;
      this.width = v.width; this.height = v.height;
      this.dpr = this.canvas.width / (v.width || 1);
    }
    const moved = this._syncPointer(now);
    // Sleep until interaction. The very first move or press anywhere wakes every
    // sleeper (so nothing ever looks dead on arrival); after that, only a pointer
    // moving near a sleeper, or a press, wakes it.
    if (this.ptr.active && (moved || this.ptr.down)) {
      const first = !this._interacted;
      this._interacted = true;
      for (const c of this.crawlers) {
        if (!c.asleep || !c.placed) continue;
        const reach = c.traits.temperament.senseRadius * 1.5 + c.length + (this.ptr.down ? 120 : 0);
        if (first || Math.hypot(c.x - this.ptr.x, c.y - this.ptr.y) < reach) c.wake(first ? 'first-interaction' : 'pointer');
      }
    }
    for (const c of this.crawlers) c.update(dt);
    const t1 = performance.now();
    this._draw();
    const t2 = performance.now();
    // rolling stats, reported once per ~second
    this._frames++; this._acc += dt; this._upd += t1 - t0; this._drw += t2 - t1;
    if (this._acc >= 1) {
      const s = this.stats;
      s.fps = Math.round(this._frames / this._acc);
      s.updateMs = +(this._upd / this._frames).toFixed(2);
      s.drawMs = +(this._drw / this._frames).toFixed(2);
      s.frameMs = +(s.updateMs + s.drawMs).toFixed(2);
      this._frames = 0; this._acc = 0; this._upd = 0; this._drw = 0;
    }
  }

  _draw() {
    const ctx = this.ctx, k = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    for (const c of this.crawlers) c.draw(ctx);
  }

  /** Bounds the creatures stay inside, in canvas CSS px. */
  bounds() { return { x: 0, y: 0, w: this.width, h: this.height }; }
}

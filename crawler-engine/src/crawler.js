// One creature: spine physics, distributed leg stepping, two-bone IK legs,
// a small steering "brain", and a riso-print style renderer.
//
// Coordinates are canvas CSS pixels, time is seconds. Nothing here allocates
// per frame on the hot path (legs, segments and prints are reused).
import { generateTraits } from './traits.js?v=20261028143806';
import { createRng } from './rng.js?v=20261028143806';
import { Voice } from './audio.js?v=20261028143806';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const ease = (t) => t * t * (3 - 2 * t);
function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return d;
}

const MAX_PRINTS = 48, PRINT_LIFE = 2.4, MAX_Z = 3;

export class Crawler {
  constructor(opts = {}) {
    const T = (this.traits = opts.traits || generateTraits(opts.seed));
    this.seed = T.seed;
    this.world = opts.world || null;
    this.stage = opts.stage || null;
    this.bounds = opts.bounds || null;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0, ...(opts.insets || {}) };
    this.debug = !!opts.debug;
    this.rng = createRng(T.seed + ':life');
    this.scale = opts.scale || 1;
    const U = (this.U = T.body.unit * this.scale);

    // --- body
    this.segs = T.body.segments.map((s) => ({ x: 0, y: 0, a: 0, px: 0, py: 0, vx: 0, vy: 0, r: s.r * U, shape: s.shape, spacing: 0 }));
    let len = this.segs[0].r;
    for (let i = 1; i < this.segs.length; i++) {
      this.segs[i].spacing = (this.segs[i - 1].r + this.segs[i].r) * T.body.gap;
      len += this.segs[i].spacing;
    }
    this.length = len + this.segs[this.segs.length - 1].r;
    this.bend = T.body.bend * DEG;
    this.yaw = T.body.yaw * DEG;
    this.rigid = T.body.rigid;

    // --- legs (index = 2*pair + (side>0)); matches traits.voice.notes order
    this.legs = [];
    const np = T.legs.pairs.length;
    let maxLeg = 0;
    T.legs.pairs.forEach((p, k) => {
      for (const side of [-1, 1]) {
        const idx = this.legs.length;
        this.legs.push({
          idx, k, side, seg: p.seg, ang: p.angle * DEG,
          femur: p.femur * U, tibia: p.tibia * U, reach: p.reach * U,
          hx: 0, hy: 0, kx: 0, ky: 0, fx: 0, fy: 0, tx: 0, ty: 0, sx: 0, sy: 0,
          swing: false, t: 0, dur: 0, lift: 0, excite: 0,
          contra: idx ^ 1, front: k > 0 ? idx - 2 : -1, back: k < np - 1 ? idx + 2 : -1,
        });
        maxLeg = Math.max(maxLeg, (p.femur + p.tibia) * U);
      }
    });
    this.extent = this.length + maxLeg * 1.4; // rough diameter incl. legs
    this.maxSwing = Math.max(1, Math.round(this.legs.length * T.gait.maxSwing));

    // --- motion + brain
    this.time = 0;
    this.heading = opts.heading ?? this.rng.range(0, TAU);
    this.speed = 0;
    this.turnVel = 0;
    this.maxSpeed = T.motion.speed * Math.sqrt(this.scale);
    this.state = opts.startAwake ? 'awake' : 'asleep';
    this.sleepK = opts.startAwake ? 0 : 1; // 0 = legs out, 1 = folded
    this.mode = 'roam';
    this.moving = false;
    this.goT = 0.4;
    this.boutSpeed = 0.7;
    this.wanderBase = this.heading;
    this.noise = [this.rng.range(0.3, 0.7), this.rng.range(0, TAU), this.rng.range(1.1, 1.9), this.rng.range(0, TAU)];
    this.lastStimulus = 0;
    this.senseT = this.rng.range(0.2, 0.6);
    this.goal = null; // {x, y, until}
    this.engage = null;
    this.cooldown = new Map();
    this.startle = 0; this.startleDir = 0;
    this.audioT = 0;
    this.offT = 0; // seconds spent outside the visible roaming area
    this.noSleepUntil = opts.startAwake ? 20 : 0; // first impression: stay up a while
    this.headTurn = 0; // drawn head/antennae offset from the body axis (rad), toward what it attends to
    this.aimA = null; // world angle it is looking at, or null
    this.callMark = null; // {x, y, t}: contracting marker acknowledging a tap
    this.skitPending = 0; // skittish: a second tap before this time brings it all the way
    this.wary = null; // skittish after a partial call: {x, y, until}
    this.orbitDir = this.rng.sign(); this.orbitT = this.rng.range(2, 4);
    this.lastScrollAt = -1e9;
    this.sprintUntil = 0; this.abseil = false;
    this.lastRead = 0;
    this.readUrge = 2.5 + (1 - T.temperament.curiosity) * 3; // s between reading chains while roaming

    // --- look
    const pa = T.print.angle * DEG;
    this.printOx = Math.cos(pa) * T.print.offset;
    this.printOy = Math.sin(pa) * T.print.offset;
    this.prints = new Float32Array(MAX_PRINTS * 3).fill(-1e9);
    this.printI = 0;
    this.zs = new Float32Array(MAX_Z * 3).fill(-1e9);
    this.zI = 0; this.zT = 0;

    this.voice = opts.sound === false ? null : new Voice(T.voice);
    this.listeners = new Map();
    this.placed = false;
    if (opts.x !== undefined && opts.y !== undefined) this.place(opts.x, opts.y, this.heading);
  }

  // ------------------------------------------------------------------ public

  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name)?.delete(fn);
  }

  get x() { return this.segs[0].x; }
  get y() { return this.segs[0].y; }
  get asleep() { return this.state === 'asleep'; }

  wake(reason = 'api') {
    if (this.state === 'awake') { this.lastStimulus = this.time; return; }
    this.noSleepUntil = Math.max(this.noSleepUntil, this.time + 8);
    this.state = 'awake';
    this.lastStimulus = this.time;
    this.moving = false; this.goT = 0.35 + this.rng.next() * 0.4;
    this.voice?.chirp('wake');
    this._emit('wake', { reason });
  }

  sleep(reason = 'api') {
    if (this.state === 'asleep') return;
    this.state = 'asleep';
    this.mode = 'roam'; this.engage = null; this.goal = null;
    this.voice?.chirp('sleep');
    this._emit('sleep', { reason });
  }

  /** Walk to a point (canvas CSS px). Wakes the creature. */
  setTarget(x, y, { duration = 6 } = {}) {
    this.wake('target');
    const I = this._inner();
    this.goal = { x: clamp(x, I.x, I.x + I.w), y: clamp(y, I.y, I.y + I.h), until: this.time + duration };
    this.engage = null;
  }
  clearTarget() { this.goal = null; }

  /**
   * Tap-to-call. Acknowledged on the same frame (head snaps toward the tap,
   * chirp, contracting marker), then a fast walk over. Skittish creatures come
   * 60% of the way and freeze, facing you; a second tap brings them all the way.
   */
  call(x, y) {
    const wasAsleep = this.asleep;
    this.wake('call');
    if (!wasAsleep) this.voice?.chirp('wake');
    const h = this.segs[0], B = this._bounds();
    const tx = clamp(x, B.x + 6, B.x + B.w - 6), ty = clamp(y, B.y + 6, B.y + B.h - 6);
    this.aimA = Math.atan2(y - h.y, x - h.x);
    this.headTurn = clamp(angDiff(h.a, this.aimA), -1.3, 1.3); // snap, no easing
    this.callMark = { x, y, t: this.time };
    let gx = tx, gy = ty, partial = false;
    if (this.traits.temperament.name === 'skittish' && this.time > this.skitPending) {
      gx = h.x + (tx - h.x) * 0.6; gy = h.y + (ty - h.y) * 0.6; partial = true;
      this.skitPending = this.time + 6;
    } else this.skitPending = 0;
    this.goal = { x: gx, y: gy, until: this.time + 7, call: true, d0: Math.max(1, Math.hypot(gx - h.x, gy - h.y)), partial, fx: x, fy: y };
    this.engage = null; this.wary = null; this.startle = 0;
    this.mode = 'called';
    this.lastStimulus = this.time;
    this._emit('call', { x, y, partial });
  }

  /** Teleport (e.g. respawn). Re-plants the legs. */
  place(x, y, heading = this.heading) {
    this.heading = heading;
    const h = this.segs[0];
    h.x = h.px = x; h.y = h.py = y; h.a = heading + this.yaw;
    for (let i = 1; i < this.segs.length; i++) {
      const p = this.segs[i - 1], s = this.segs[i];
      s.a = p.a;
      s.x = s.px = p.x - Math.cos(p.a) * s.spacing;
      s.y = s.py = p.y - Math.sin(p.a) * s.spacing;
    }
    for (const s of this.segs) s.vx = s.vy = 0;
    for (const l of this.legs) { this._rest(l); l.fx = l.tx; l.fy = l.ty; l.swing = false; l.lift = 0; this._ik(l); }
    this.placed = true;
  }

  /** Shift everything (e.g. to keep creatures attached to a scrolling page). */
  translate(dx, dy) {
    for (const s of this.segs) { s.x += dx; s.y += dy; s.px += dx; s.py += dy; }
    for (const l of this.legs) { l.fx += dx; l.fy += dy; l.sx += dx; l.sy += dy; }
    for (let i = 0; i < MAX_PRINTS; i++) { this.prints[i * 3] += dx; this.prints[i * 3 + 1] += dy; }
    if (this.goal) { this.goal.x += dx; this.goal.y += dy; this.goal.fx += dx; this.goal.fy += dy; }
    if (this.engage) {
      const e = this.engage; e.x0 += dx; e.x1 += dx; e.y0 += dy; e.y1 += dy;
      if (e.words) for (const w of e.words) { w.x += dx; w.y += dy; }
    }
    if (this.callMark) { this.callMark.x += dx; this.callMark.y += dy; }
    if (this.wary) { this.wary.x += dx; this.wary.y += dy; }
    if (dx || dy) this.lastScrollAt = this.time;
  }

  /** Called by the stage on a tap/click that hits the body. */
  poke(px, py) {
    this.wake('poke');
    const h = this.segs[0];
    this.startleDir = Math.atan2(h.y - py, h.x - px);
    this.startle = this.traits.temperament.boldness > 0.8 ? -0.5 : 0.45; // bold ones turn to face you
    this.engage = null;
    this.voice?.chirp('poke');
    this._emit('poke', { x: px, y: py });
  }

  hitTest(x, y, pad = 10) {
    for (const s of this.segs) {
      const dx = x - s.x, dy = y - s.y, r = s.r + pad;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  destroy() {
    this.stage?.remove(this);
    this.voice?.dispose();
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    if (!this.placed) this._autoPlace();
    this.time += dt;
    this._think(dt);
    this._move(dt);
    this._stepLegs(dt);
    const target = this.state === 'asleep' ? 1 : 0;
    this.sleepK += (target - this.sleepK) * Math.min(1, dt * (target ? 1.4 : 3.5));
    if ((this.audioT -= dt) <= 0 && this.voice) {
      this.audioT = 0.1;
      const B = this._bounds();
      this.voice.motion(this.speed / this.maxSpeed, clamp(((this.x - B.x) / (B.w || 1)) * 2 - 1, -1, 1), this.state === 'awake');
    }
    if (this.state === 'asleep' && (this.zT -= dt) <= 0) {
      this.zT = 1.3 + this.rng.next() * 0.6;
      const h = this.segs[0], i = this.zI++ % MAX_Z;
      this.zs[i * 3] = h.x; this.zs[i * 3 + 1] = h.y - h.r; this.zs[i * 3 + 2] = this.time;
    }
  }

  /** Visible roaming area (canvas CSS px), minus host insets such as toolbars. */
  _bounds() {
    let B;
    if (typeof this.bounds === 'function') B = this.bounds();
    else if (this.bounds) B = this.bounds;
    else if (this.world?.bounds) B = this.world.bounds();
    else if (this.stage) B = { x: 0, y: 0, w: this.stage.width, h: this.stage.height };
    else B = { x: 0, y: 0, w: 800, h: 600 };
    const n = this.insets, sw = this.stage?.width, sh = this.stage?.height;
    let x0 = B.x, y0 = B.y, x1 = B.x + B.w, y1 = B.y + B.h;
    if (sw) { x0 = Math.max(x0, n.left); x1 = Math.min(x1, sw - n.right); }
    if (sh) { y0 = Math.max(y0, n.top); y1 = Math.min(y1, sh - n.bottom); }
    // Degenerate (column scrolled away, tiny window): fall back to the whole canvas.
    if (x1 - x0 < 80 || y1 - y0 < 80) {
      if (sw && sh) { x0 = n.left; y0 = n.top; x1 = sw - n.right; y1 = sh - n.bottom; }
    }
    const b = this._bb || (this._bb = { x: 0, y: 0, w: 0, h: 0 });
    b.x = x0; b.y = y0; b.w = Math.max(1, x1 - x0); b.h = Math.max(1, y1 - y0);
    return b;
  }

  /** Where the head may settle so the whole creature stays in view. */
  _inner(B = this._bounds()) {
    const m = Math.min(this.extent * 0.32 + 6, B.w * 0.3, B.h * 0.3);
    const r = this._ib || (this._ib = { x: 0, y: 0, w: 0, h: 0 });
    r.x = B.x + m; r.y = B.y + m; r.w = B.w - 2 * m; r.h = B.h - 2 * m;
    return r;
  }

  _autoPlace() {
    const B = this._bounds();
    if (!B.w || !B.h) return;
    const I = this._inner(B);
    this.place(I.x + this.rng.next() * I.w, I.y + this.rng.next() * I.h, this.heading);
  }

  _pointer() {
    const P = this.stage?.ptr;
    if (!P || !P.active) return null;
    const h = this.segs[0], dx = P.x - h.x, dy = P.y - h.y;
    return { x: P.x, y: P.y, dx, dy, d: Math.hypot(dx, dy), touch: P.type === 'touch', down: P.down };
  }

  _think(dt) {
    const T = this.traits, tm = T.temperament, h = this.segs[0], r = this.rng;
    this.targetSpeed = 0;
    this.desired = this.heading;
    if (!this.placed) return;

    // Off-screen check: pushed out by a scroll, or wandered to the edge.
    const B0 = this._bounds(), I = this._inner(B0);
    const cx = clamp(h.x, I.x, I.x + I.w), cy = clamp(h.y, I.y, I.y + I.h);
    const out = Math.hypot(h.x - cx, h.y - cy);
    this.offT = out > 2 ? this.offT + dt : 0;
    // Pushed out of sight by a scroll: once scrolling settles, re-enter from
    // just past the nearest edge and sprint in (spiders abseil from the top).
    const hidden = h.x < B0.x || h.x > B0.x + B0.w || h.y < B0.y || h.y > B0.y + B0.h;
    if (hidden && this.time - this.lastScrollAt > 0.25 && this.time > this.sprintUntil) {
      if (this.asleep) this.wake('return');
      this._reenter(B0, I);
    }
    if (this.state === 'asleep') return;

    const ptr = this._pointer();
    const attention = tm.senseRadius * 1.8 + this.length;
    const fear = tm.senseRadius * 1.1 + this.length;
    let dirX = 0, dirY = 0, spd = 0, followMode = false;

    const answering = this.goal?.call && !hidden; // a call may take it to the very edge of the column
    if (!answering && out > (ptr && ptr.d < tm.senseRadius * 2 ? 40 : 4) && this.startle >= 0 && !(ptr && ptr.down)) { // walk back into view
      if (this.engage && !this._inView(this.engage.x0, this.engage.y0, I)) this.engage = null;
      this.goal = null;
      this.mode = 'return';
      this.lastStimulus = this.time;
      dirX = cx - h.x; dirY = cy - h.y; spd = clamp(0.55 + out / 200, 0.55, 1.1);
      if (this.time < this.sprintUntil) spd = Math.max(1.4, 110 / this.maxSpeed);
    } else if (this.startle > 0) { // jump away from a poke
      this.startle = Math.max(0, this.startle - dt);
      dirX = Math.cos(this.startleDir); dirY = Math.sin(this.startleDir); spd = 1.4;
    } else if (this.startle < 0) { // bold: turn to face the poker
      this.startle = Math.min(0, this.startle + dt);
      dirX = -Math.cos(this.startleDir); dirY = -Math.sin(this.startleDir); spd = 0.05;
    } else if (this.goal) {
      const g = this.goal, dx = g.x - h.x, dy = g.y - h.y, d = Math.hypot(dx, dy);
      dirX = dx; dirY = dy;
      if (g.call) {
        // Fast for the first 60% of the way, then ease in (never crawl).
        this.mode = 'called';
        const fast = Math.max(1.35, 120 / this.maxSpeed);
        spd = 1 - d / g.d0 < 0.6 ? fast : Math.min(fast, Math.max(30, d * 2.2) / this.maxSpeed);
        this.aimA = Math.atan2(g.fy - h.y, g.fx - h.x);
      } else spd = clamp(d / 80, 0.15, 1);
      if (d < 6 || this.time > g.until) {
        this.goal = null;
        if (g.partial) { this.wary = { x: g.fx, y: g.fy, until: this.time + 1.5 }; this.skitPending = Math.max(this.skitPending, this.time + 3); }
      }
      this.lastStimulus = this.time;
    } else if (this.wary && this.time < this.wary.until) { // skittish: stop short, face the tap, freeze
      this.mode = 'wary';
      dirX = this.wary.x - h.x; dirY = this.wary.y - h.y; spd = 0;
      this.aimA = Math.atan2(dirY, dirX);
      this.lastStimulus = this.time;
    } else if (ptr && ptr.d < (ptr.touch ? attention * 1.4 : attention)) {
      this.lastStimulus = this.time;
      // Pressing (mouse held / finger down) is a call: most creatures come.
      const bold = tm.boldness + (ptr.down ? 0.5 : 0);
      if (bold < 0.35 && ptr.d < fear) {
        this.mode = 'flee'; this.engage = null;
        dirX = -ptr.dx / ptr.d; dirY = -ptr.dy / ptr.d; spd = 1.25;
        // cornered: slide sideways, toward open space
        const ccx = I.x + I.w / 2 - h.x, ccy = I.y + I.h / 2 - h.y, side = dirX * ccy - dirY * ccx > 0 ? 1 : -1;
        if (out > 0 || h.x < I.x + 30 || h.x > I.x + I.w - 30 || h.y < I.y + 30 || h.y > I.y + I.h - 30) { dirX += -dirY * side * 1.2; dirY += dirX * side * 1.2; }
      } else if (bold > 0.55) {
        this.mode = 'follow'; this.engage = null; followMode = true;
        const stop = this.length * 0.5 + 8;
        if (ptr.d > stop) { dirX = ptr.dx; dirY = ptr.dy; spd = clamp((ptr.d - stop) / 120, 0.2, 1); }
        else { dirX = -ptr.dy; dirY = ptr.dx; spd = 0.22; } // circle under the pointer
      } else if (bold < 0.35) { // timid, not yet frightened: freeze and stare
        this.mode = 'watch'; this.engage = null;
        dirX = ptr.dx; dirY = ptr.dy; spd = 0;
      } else { // middle temperaments: come to a keep ring, then orbit and watch
        this.mode = 'watch'; this.engage = null;
        const ring = 70 + 0.5 * this.length;
        const P = this.stage.ptr, toward = ptr.d > 1 ? -(P.vx * ptr.dx + P.vy * ptr.dy) / ptr.d : 0;
        if (toward > 600 && ptr.d < ring && tm.boldness < 0.8) { // hop back from a fast lunge
          this.startle = 0.25; this.startleDir = Math.atan2(-ptr.dy, -ptr.dx);
        }
        if ((this.orbitT -= dt) <= 0) { this.orbitDir = -this.orbitDir; this.orbitT = r.range(2, 4); }
        if (ptr.d > ring + 12) { dirX = ptr.dx; dirY = ptr.dy; spd = Math.max(0.4, 26 / this.maxSpeed); }
        else if (ptr.d < ring - 18) { dirX = -ptr.dx; dirY = -ptr.dy; spd = Math.max(0.25, 18 / this.maxSpeed); }
        else {
          const k = (ptr.d - ring) / 30; // small radial correction keeps it on the ring
          dirX = -ptr.dy * this.orbitDir + ptr.dx * k; dirY = ptr.dx * this.orbitDir + ptr.dy * k;
          spd = Math.max(0.15, 10 / this.maxSpeed);
        }
      }
    } else if (this.mode === 'flee' || this.mode === 'follow' || this.mode === 'watch' || this.mode === 'return' || this.mode === 'called' || this.mode === 'wary') {
      this.mode = 'roam';
      this.wanderBase = this.heading;
    }

    if (dirX === 0 && dirY === 0 && spd === 0) {
      if (this.engage) {
        const e = this._engageStep(dt);
        if (e) { dirX = e[0]; dirY = e[1]; spd = e[2]; }
      }
      if (!this.engage && (this.mode === 'roam' || this.mode === 'engage')) {
        this.mode = 'roam';
        if ((this.goT -= dt) <= 0) {
          this.moving = !this.moving;
          const rest = tm.restlessness;
          this.goT = this.moving ? r.range(1.2, 5) * (0.6 + rest) : r.range(0.25, 2.2) * (1.2 - rest);
          this.boutSpeed = r.range(0.45, 0.95);
          if (!this.moving && r.chance(0.35)) this.wanderBase += r.range(-1.6, 1.6);
        }
        this.wanderBase += (r.next() - 0.5) * dt * (0.5 + tm.restlessness * 2);
        const n = this.noise, t = this.time;
        const a = this.wanderBase + Math.sin(t * n[0] + n[1]) * 0.9 + Math.sin(t * n[2] + n[3]) * 0.45;
        dirX = Math.cos(a); dirY = Math.sin(a);
        spd = this.moving ? this.boutSpeed : 0;
        if (this.time - this.lastStimulus > tm.sleepAfter && this.time > this.noSleepUntil && !this.moving) { this.sleep('idle'); return; }
      }
    }

    // sensing the page
    if (this.world && (this.senseT -= dt) <= 0) {
      this.senseT = 0.28 + r.next() * 0.22;
      const busy = this.mode === 'return' || this.mode === 'watch' || this.mode === 'called' || this.mode === 'wary';
      if (!this.engage && !followMode && !this.goal && this.startle === 0 && !busy) this._sense();
    }

    // What it attends to: a call or the pointer, else the word it is reading.
    if (this.mode === 'called' || this.mode === 'wary') { /* aimA set above */ }
    else if (ptr && ptr.d < attention * 1.4 && this.mode !== 'flee') this.aimA = Math.atan2(ptr.dy, ptr.dx);
    else if (this.engage?.words) { const w = this.engage.words[Math.min(this.engage.idx, this.engage.words.length - 1)]; this.aimA = Math.atan2(w.y + w.h / 2 - h.y, w.x + w.w / 2 - h.x); }
    else this.aimA = null;
    const want = this.aimA === null ? 0 : clamp(angDiff(h.a, this.aimA), -0.9, 0.9);
    this.headTurn += (want - this.headTurn) * Math.min(1, dt * 9);

    // edges + neighbours
    const B = this._bounds(), m = 36 + this.length * 0.35;
    let ex = 0, ey = 0;
    if (h.x < B.x + m) ex += (B.x + m - h.x) / m;
    if (h.x > B.x + B.w - m) ex -= (h.x - (B.x + B.w - m)) / m;
    if (h.y < B.y + m) ey += (B.y + m - h.y) / m;
    if (h.y > B.y + B.h - m) ey -= (h.y - (B.y + B.h - m)) / m;
    if (this.stage) {
      for (const c of this.stage.crawlers) {
        if (c === this || !c.placed) continue;
        const dx = h.x - c.segs[0].x, dy = h.y - c.segs[0].y, d = Math.hypot(dx, dy) || 1;
        const min = (this.length + c.length) * 0.45 + 10;
        if (d < min) { const k = ((min - d) / min) * 1.2; ex += (dx / d) * k; ey += (dy / d) * k; }
      }
    }
    const dl = Math.hypot(dirX, dirY) || 1;
    const ew = followMode ? 0.6 : 2.2;
    dirX = dirX / dl + ex * ew; dirY = dirY / dl + ey * ew;
    if ((ex || ey) && spd === 0 && this.mode === 'roam') spd = 0.3; // never sulk in a corner
    if (this.mode === 'return') { dirX = cx - h.x; dirY = cy - h.y; } // edges must not fight the return
    if (this.mode === 'called') { dirX = this.goal ? this.goal.x - h.x : dirX; dirY = this.goal ? this.goal.y - h.y : dirY; }
    if ((ex || ey) && this.mode === 'roam') this.wanderBase = Math.atan2(dirY, dirX);
    this.desired = Math.atan2(dirY, dirX);
    if (spd < 0.05 && this.yaw && this.mode !== 'roam') this.desired -= this.yaw; // crab-walkers turn their face, not their path
    this.targetSpeed = spd * this.maxSpeed;
  }

  _sense() {
    const tm = this.traits.temperament, h = this.segs[0];
    let items;
    try { items = this.world.queryNear(h.x, h.y, tm.senseRadius); } catch (e) { return; }
    if (!items || !items.length) return;
    const inner = this._inner();
    let best = null, bestScore = 0;
    for (const it of items) {
      if ((this.cooldown.get(it.id) || 0) > this.time) continue;
      if (!this._inView(it.x + it.w / 2, it.y + it.h / 2, inner)) continue; // never chase what can't be seen
      let pref = tm.prefs[it.type] || 0;
      if (this.mode === 'flee') pref = it.type === 'image' ? 3 : 0; // run for cover
      const d = Math.hypot(it.x + it.w / 2 - h.x, it.y + it.h / 2 - h.y);
      const score = pref * clamp(1 - d / (tm.senseRadius * 1.6), 0.1, 1);
      if (score > bestScore) { best = it; bestScore = score; }
    }
    // It reads: every few seconds of roaming, the nearest line of text wins.
    if (this.mode !== 'flee' && this.time - this.lastRead > this.readUrge && this._startReading(items, inner)) return;
    if (!best) return;
    const p = this.mode === 'flee' ? 1 : tm.curiosity * bestScore * 0.22;
    if (this.rng.next() < p) {
      if (best.type === 'text') this._startReading(items, inner); // text is always read along the line
      else this._startEngage(best);
    }
  }

  /** Words following `start` on the same line, in reading order, up to `max`, stopping at . ; : ! ? */
  _lineChain(start, max, pool) {
    const cy = start.y + start.h / 2, chain = [start];
    if (/[.;:!?]["'’”)]*$/.test(start.text || '')) return chain;
    const line = pool.filter((it) => it.type === 'text' && it.id !== start.id && Math.abs(it.y + it.h / 2 - cy) < 4 && it.x > start.x).sort((a, b) => a.x - b.x);
    let prev = start;
    for (const it of line) {
      if (chain.length >= max) break;
      if (it.id === prev.id) continue;
      if (it.x - (prev.x + prev.w) > 40) break;
      chain.push(it); prev = it;
      if (/[.;:!?]["'’”)]*$/.test(it.text || '')) break;
    }
    return chain;
  }

  _startReading(items, inner) {
    const tm = this.traits.temperament, h = this.segs[0];
    const max = 3 + Math.round(tm.curiosity * 4);
    // Look a little further than the sense radius for a line worth reading.
    for (const R of [Math.max(240, tm.senseRadius * 1.8), 520]) { // nothing readable close by? look further
      try { items = this.world.queryNear(h.x, h.y, R, 160) || items; } catch (e) { break; }
      if (items.filter((it) => it.type === 'text').length >= 12) break;
    }
    const cands = items.filter((it) => it.type === 'text' && (this.cooldown.get(it.id) || 0) <= this.time
      && this._inView(it.x, it.y + it.h / 2, inner) && this._inView(it.x + it.w, it.y + it.h / 2, inner, 40));
    if (!cands.length) return false;
    cands.sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y));
    let chain = null, best = -Infinity;
    for (const c of cands.slice(0, 40)) {
      const ch = this._lineChain(c, max, cands);
      const score = Math.min(ch.length, max) * 70 - Math.hypot(c.x - h.x, c.y + c.h / 2 - h.y) - (ch.length < 3 ? 400 : 0);
      if (score > best) { best = score; chain = ch; }
    }
    if (chain.length < 2) { this.lastRead = this.time - this.readUrge + 1.2; return false; } // headings and fragments: look again soon
    const first = chain[0], last = chain[chain.length - 1], y = first.y + first.h * 0.55;
    const words = chain.map((it) => ({ item: it, x: it.x, y: it.y, w: it.w, h: it.h }));
    const effect = tm.name === 'glutton' ? 'nibble' : 'read';
    this.engage = { item: first, words, idx: 0, effect, x0: first.x - 3, y0: y, x1: last.x + last.w + 3, y1: y, phase: 'approach', until: this.time + 7, hold: 0, nextFx: 0 };
    this.mode = 'engage'; this.moving = true;
    this.lastRead = this.time;
    this._emit('engage', { target: first, effect, words: chain });
    return true;
  }

  _startEngage(it) {
    const tm = this.traits.temperament, r = this.rng;
    const effect = tm.effects[it.type] || 'inspect';
    let x0, y0, x1, y1;
    if (it.type === 'text' && effect !== 'jostle') { // walk along the word
      y0 = y1 = it.y + it.h * 0.55;
      x0 = it.x - 3; x1 = it.x + it.w + 3;
      if (r.chance(0.3)) { const t = x0; x0 = x1; x1 = t; }
    } else {
      x0 = x1 = it.x + it.w * r.range(0.3, 0.7);
      y0 = y1 = it.y + it.h * r.range(0.3, 0.7);
    }
    const I = this._inner();
    x0 = clamp(x0, I.x, I.x + I.w); x1 = clamp(x1, I.x, I.x + I.w);
    y0 = clamp(y0, I.y, I.y + I.h); y1 = clamp(y1, I.y, I.y + I.h);
    const hold = effect === 'hide' || effect === 'perch' ? r.range(4, 8) : effect === 'read' ? 0 : r.range(1.5, 3.5);
    this.engage = { item: it, effect, x0, y0, x1, y1, phase: 'approach', until: this.time + 7, hold, nextFx: 0 };
    this.mode = 'engage';
    this.moving = true;
    this._emit('engage', { target: it, effect });
  }

  _engageStep(dt) {
    const e = this.engage, h = this.segs[0], t = this.time;
    this.lastStimulus = t;
    const done = () => {
      this.cooldown.set(e.item.id, t + this.rng.range(12, 25));
      this.engage = null; this.mode = 'roam'; this.moving = false; this.goT = this.rng.range(0.4, 1.2);
      if (this.cooldown.size > 64) for (const [k, v] of this.cooldown) if (v < t) this.cooldown.delete(k);
      if ((e.effect === 'perch' || e.effect === 'hide') && this.traits.temperament.name === 'drowsy' && t - this.lastRead < 8) this.sleep('perch');
      return null;
    };
    if (!this._inView(e.x0, e.y0, this._inner(), 30)) return done(); // scrolled away
    if (e.words) return this._readStep(e, done);
    if (e.phase === 'approach') {
      const dx = e.x0 - h.x, dy = e.y0 - h.y, d = Math.hypot(dx, dy);
      if (t > e.until) return done();
      if (d < 5 + h.r) {
        e.phase = 'act'; e.until = t + (e.hold || 6);
        this._effect(e.effect, e.item); e.nextFx = t + 0.8;
      } else return [dx, dy, Math.max(clamp(d / 60, 0.3, 0.85), d > 30 ? 45 / this.maxSpeed : 0)];
    }
    // act
    if (t > e.until) return done();
    if (e.item.type !== 'text' && t - this.lastRead > this.readUrge + 2.5) return done(); // the page calls

    if (e.effect !== 'read' && e.effect !== 'hide' && e.effect !== 'perch' && t > e.nextFx) {
      this._effect(e.effect, e.item); e.nextFx = t + (e.effect === 'nibble' ? 0.9 : 0.6);
    }
    if (e.x1 !== e.x0 || e.y1 !== e.y0) { // reading along a word
      const dx = e.x1 - h.x, dy = e.y1 - h.y, d = Math.hypot(dx, dy);
      if (d < 4) return done();
      return [dx, dy, 0.3];
    }
    // sit and fidget
    const a = this.heading + Math.sin(t * 1.7) * 0.8;
    return [Math.cos(a), Math.sin(a), e.effect === 'jostle' || e.effect === 'tug' ? 0.12 : 0.0001];
  }

  /** Walk along the line; each word is read (or eaten) as the head passes it. */
  _readStep(e, done) {
    const h = this.segs[0], t = this.time, W = e.words;
    if (e.phase === 'approach') {
      const dx = e.x0 - h.x, dy = e.y0 - h.y, d = Math.hypot(dx, dy);
      if (t > e.until) return done();
      if (d > 6 + h.r * 0.5) return [dx, dy, Math.max(clamp(d / 60, 0.4, 1.1), Math.min(80, 30 + d) / this.maxSpeed)];
      e.phase = 'act'; e.until = t + 2 + W.length * 1.5;
    }
    while (e.idx < W.length && h.x >= W[e.idx].x + W[e.idx].w * 0.3) this._readWord(e);
    const dx = e.x1 - h.x, dy = e.y1 - h.y;
    if (e.idx >= W.length || dx < 3 || t > e.until) {
      while (e.idx < W.length) this._readWord(e);
      this._finishChain(e);
      return done();
    }
    return [dx, dy * 3, clamp(this.maxSpeed * 0.55, 34, 70) / this.maxSpeed];
  }

  _readWord(e) {
    const w = e.words[e.idx++];
    this.cooldown.set(w.item.id, this.time + this.rng.range(15, 30));
    this._effect(e.effect, w.item);
  }

  _finishChain(e) {
    const W = e.words, tm = this.traits.temperament;
    this.lastRead = this.time;
    if (W.length > 1) this._effect('thread', W[0].item, { to: W[W.length - 1].item });
    if (tm.effects.text === 'jostle' && this.rng.chance(0.5)) this._effect('jostle', W[W.length - 1].item);
    this._emit('chain', { words: W.map((w) => w.item), effect: e.effect });
  }

  _reenter(B, I) {
    const h = this.segs[0];
    const cx = clamp(h.x, I.x, I.x + I.w), cy = clamp(h.y, I.y, I.y + I.h);
    // nearest visible edge, just outside it
    const out = 2; // head right at the edge, body and legs trailing outside
    let x = cx, y = cy, edge;
    const dT = Math.abs(h.y - B.y), dB = Math.abs(h.y - (B.y + B.h)), dL = Math.abs(h.x - B.x), dR = Math.abs(h.x - (B.x + B.w));
    const m = Math.min(dT, dB, dL, dR);
    if (m === dT) { y = B.y - out; edge = 'top'; } else if (m === dB) { y = B.y + B.h + out; edge = 'bottom'; }
    else if (m === dL) { x = B.x - out; edge = 'left'; } else { x = B.x + B.w + out; edge = 'right'; }
    this.engage = null; this.goal = null;
    this.place(x, y, Math.atan2(cy - y, cx - x));
    this.sprintUntil = this.time + 1.2;
    this.speed = Math.max(this.speed, 90); // arrive moving, not from a standstill
    this.abseil = edge === 'top' && this.traits.plan === 'spider';
    this.mode = 'return';
    this._emit('reenter', { edge });
  }

  _inView(x, y, I, pad = 0) {
    return x >= I.x - pad && x <= I.x + I.w + pad && y >= I.y - pad && y <= I.y + I.h + pad;
  }

  _effect(type, item, extra) {
    const h = this.segs[0];
    this._emit('effect', { type, target: item, ...extra });
    if (!this.world?.applyEffect) return;
    try { this.world.applyEffect(type, item, { crawler: this, x: h.x, y: h.y, intensity: this.speed / this.maxSpeed, ...extra }); }
    catch (err) { console.warn('[crawler] world.applyEffect failed', err); }
  }

  _move(dt) {
    const T = this.traits, h = this.segs[0];
    const dA = angDiff(this.heading, this.desired);
    const urgent = this.mode === 'called' || this.time < this.sprintUntil;
    const maxTurn = (urgent ? Math.max(8, T.motion.turn * 3) : T.motion.turn) * dt;
    const turn = clamp(dA * Math.min(1, dt * 8), -maxTurn, maxTurn);
    this.heading += turn;
    this.turnVel = turn / (dt || 1 / 60);
    const turnSlow = 1 - Math.min(urgent ? 0.4 : 0.75, Math.abs(dA) / Math.PI);
    this.speed += (this.targetSpeed * turnSlow * (this.stage?.speedScale ?? 1) - this.speed) * Math.min(1, T.motion.accel * dt);
    if (this.speed < 0.5 && this.targetSpeed === 0) this.speed = 0;

    for (const s of this.segs) { s.px = s.x; s.py = s.y; }
    h.x += Math.cos(this.heading) * this.speed * dt;
    h.y += Math.sin(this.heading) * this.speed * dt;
    // Loose leash: the head may be briefly off-screen (scrolling carries it with
    // the text) and then walks back. Far away, it re-enters from just off-screen.
    const B = this._bounds(), lim = this.extent * 0.6 + 24;
    const lx0 = B.x - lim, lx1 = B.x + B.w + lim, ly0 = B.y - lim, ly1 = B.y + B.h + lim;
    if (h.x < lx0 - lim * 2 || h.x > lx1 + lim * 2 || h.y < ly0 - lim * 2 || h.y > ly1 + lim * 2) {
      const nx = clamp(h.x, lx0, lx1), ny = clamp(h.y, ly0, ly1);
      this.place(nx, ny, Math.atan2(B.y + B.h / 2 - ny, B.x + B.w / 2 - nx));
      return;
    }
    h.x = clamp(h.x, lx0, lx1);
    h.y = clamp(h.y, ly0, ly1);
    h.a = this.heading + this.yaw;

    // follow-the-leader spine with a bend limit
    for (let i = 1; i < this.segs.length; i++) {
      const p = this.segs[i - 1], s = this.segs[i];
      let a;
      if (this.rigid) a = p.a;
      else {
        a = Math.atan2(p.y - s.y, p.x - s.x);
        const rel = angDiff(p.a, a);
        if (rel > this.bend) a = p.a + this.bend; else if (rel < -this.bend) a = p.a - this.bend;
      }
      s.a = a;
      s.x = p.x - Math.cos(a) * s.spacing;
      s.y = p.y - Math.sin(a) * s.spacing;
    }
    const k = Math.min(1, dt * 12), inv = 1 / (dt || 1 / 60);
    for (const s of this.segs) {
      s.vx += ((s.x - s.px) * inv - s.vx) * k;
      s.vy += ((s.y - s.py) * inv - s.vy) * k;
    }
  }

  _rest(l) {
    const s = this.segs[l.seg];
    const fold = this.sleepK;
    const a = s.a + l.side * (l.ang + (Math.PI / 2 - l.ang) * 0.35 * fold);
    const ca = Math.cos(a), sa = Math.sin(a);
    l.hx = s.x + ca * s.r * 0.8;
    l.hy = s.y + sa * s.r * 0.8;
    const reach = l.reach * (1 - 0.5 * fold);
    const lt = this.traits.gait.stepTime * (0.6 + this.traits.gait.lead);
    l.tx = l.hx + ca * reach + s.vx * lt;
    l.ty = l.hy + sa * reach + s.vy * lt;
  }

  _stepLegs(dt) {
    const G = this.traits.gait, legs = this.legs;
    const speedK = this.speed / this.maxSpeed;
    let swinging = 0;
    for (const l of legs) {
      this._rest(l);
      l.excite = Math.max(0, l.excite - dt * 3);
      if (!l.swing) continue;
      l.t += dt / l.dur;
      if (l.t >= 1) this._land(l, speedK);
      else {
        const e = ease(l.t);
        l.fx = l.sx + (l.tx - l.sx) * e;
        l.fy = l.sy + (l.ty - l.sy) * e;
        l.lift = Math.sin(Math.PI * l.t);
        swinging++;
      }
    }
    // Distributed stepping: each leg wants to step when its foot lags its rest
    // spot; neighbours that are mid-step inhibit it, recently landed neighbours
    // excite it. Gaits emerge from these local rules (after Cruse's Walknet).
    const thrK = this.state === 'asleep' ? 0.55 : 1;
    for (let iter = 0; iter < 3; iter++) {
      let best = null, bestScore = 1;
      for (const l of legs) {
        if (l.swing) continue;
        const dx = l.tx - l.fx, dy = l.ty - l.fy;
        const thr = l.reach * G.threshold * thrK * (1 - 0.45 * l.excite);
        const score = Math.sqrt(dx * dx + dy * dy) / thr;
        if (score > 2.2) { this._lift(l, speedK); swinging++; continue; } // never overstretch
        if (score > bestScore && swinging < this.maxSwing && !this._inhibited(l)) { best = l; bestScore = score; }
      }
      if (!best) break;
      this._lift(best, speedK); swinging++;
      if (G.name === 'bound') { // pairs move together
        const c = legs[best.contra];
        if (!c.swing) { this._lift(c, speedK); swinging++; }
      }
    }
  }

  _inhibited(l) {
    const L = this.legs;
    if (l.front >= 0 && L[l.front].swing) return true;
    if (l.back >= 0 && L[l.back].swing) return true;
    if (this.traits.gait.name !== 'bound' && L[l.contra].swing) return true;
    return false;
  }

  _lift(l, speedK) {
    l.swing = true; l.t = 0; l.sx = l.fx; l.sy = l.fy;
    l.dur = (this.traits.gait.stepTime * this.rng.range(0.85, 1.15)) / (1 + speedK * 0.5) * (this.state === 'asleep' ? 1.8 : 1);
  }

  _land(l, speedK) {
    const L = this.legs, G = this.traits.gait;
    l.swing = false; l.lift = 0; l.fx = l.tx; l.fy = l.ty;
    switch (G.name) {
      case 'tripod': L[l.contra].excite = 0.8; if (l.back >= 0) L[l.back].excite = 0.6; break;
      case 'tetrapod': if (l.back >= 0) L[l.back].excite = 0.7; break;
      case 'amble': if (l.back >= 0) L[l.back].excite = 0.5; break;
      case 'wave': { const n = G.waveDir > 0 ? l.front : l.back; if (n >= 0) L[n].excite = 0.9; break; }
    }
    const i = this.printI++ % MAX_PRINTS;
    this.prints[i * 3] = l.fx; this.prints[i * 3 + 1] = l.fy; this.prints[i * 3 + 2] = this.time;
    const intensity = this.state === 'asleep' ? 0.05 : 0.15 + speedK * 0.85;
    this.voice?.footstep(l.idx, intensity);
    if (this.listeners.has('footstep')) this._emit('footstep', { leg: l.idx, x: l.fx, y: l.fy, intensity });
  }

  _ik(l) {
    const dx = l.fx - l.hx, dy = l.fy - l.hy;
    const a = l.femur, b = l.tibia;
    const d = clamp(Math.hypot(dx, dy), Math.abs(a - b) + 0.01, a + b - 0.01);
    let A = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    A = Math.min(Math.PI * 0.95, A + l.lift * 0.3); // lifted legs raise the knee
    const s = this.segs[l.seg];
    const sgn = -dy * (l.hx - s.x) + dx * (l.hy - s.y) >= 0 ? 1 : -1; // knee bends away from body
    const ka = Math.atan2(dy, dx) + sgn * A;
    l.kx = l.hx + Math.cos(ka) * a;
    l.ky = l.hy + Math.sin(ka) * a;
  }

  _emit(name, payload) {
    const set = this.listeners.get(name);
    if (!set) return;
    payload.crawler = this;
    for (const fn of set) { try { fn(payload); } catch (e) { console.error(e); } }
  }

  // ------------------------------------------------------------------ draw

  draw(ctx) {
    if (!this.placed) return;
    const T = this.traits, pal = T.palette, legs = this.legs, segs = this.segs, t = this.time;
    const sleepy = this.sleepK;

    // footprints
    if (T.trail !== 'none') {
      ctx.fillStyle = pal.tint;
      for (let i = 0; i < MAX_PRINTS; i++) {
        const age = t - this.prints[i * 3 + 2];
        if (age > PRINT_LIFE || age < 0) continue;
        ctx.globalAlpha = 0.5 * (1 - age / PRINT_LIFE);
        const x = this.prints[i * 3], y = this.prints[i * 3 + 1];
        if (T.trail === 'dots') ctx.fillRect(x - 1, y - 1, 2, 2);
        else ctx.fillRect(x - 2, y - 0.5, 4, 1);
      }
      ctx.globalAlpha = 1;
    }

    this._drawMarks(ctx);

    // Paper knockout: legs, spine and body sit on a thin halo of paper so ink
    // legs don't merge with ink letters underneath.
    for (const l of legs) this._ik(l);
    const paper = this._paper();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = paper; ctx.fillStyle = paper;
    ctx.lineWidth = T.legs.width + 2.6;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const l of legs) { ctx.moveTo(l.hx, l.hy); ctx.lineTo(l.kx, l.ky); ctx.lineTo(l.fx, l.fy); }
    if (segs.length > 1) { ctx.moveTo(segs[0].x, segs[0].y); for (let i = 1; i < segs.length; i++) ctx.lineTo(segs[i].x, segs[i].y); }
    ctx.stroke();
    ctx.beginPath();
    for (const s of segs) this._shape(ctx, s, 0, 0, 1, 1.6);
    ctx.fill();
    ctx.globalAlpha = 1;

    // legs
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = T.legs.width;
    if (T.legs.style === 'dash') ctx.setLineDash([T.legs.width * 2.2, T.legs.width * 1.6]);
    ctx.beginPath();
    for (const l of legs) { ctx.moveTo(l.hx, l.hy); ctx.lineTo(l.kx, l.ky); ctx.lineTo(l.fx, l.fy); }
    ctx.stroke();
    if (T.legs.style === 'dash') ctx.setLineDash([]);

    // joints: knees, beads and planted feet in ink; lifted feet as hollow tint
    ctx.fillStyle = pal.ink;
    ctx.beginPath();
    const kn = T.legs.knee, ks = T.legs.width + 0.6;
    for (const l of legs) {
      if (kn === 'square') ctx.rect(l.kx - ks, l.ky - ks, ks * 2, ks * 2);
      else if (kn === 'dot') { ctx.moveTo(l.kx + ks, l.ky); ctx.arc(l.kx, l.ky, ks, 0, TAU); }
      if (T.legs.style === 'bead') {
        const mx = (l.kx + l.fx) / 2, my = (l.ky + l.fy) / 2;
        ctx.moveTo(mx + 1.3, my); ctx.arc(mx, my, 1.3, 0, TAU);
      }
      if (l.swing) continue;
      const fs = T.legs.width + 0.4;
      if (T.legs.foot === 'square') ctx.rect(l.fx - fs, l.fy - fs, fs * 2, fs * 2);
      else if (T.legs.foot === 'dot') { ctx.moveTo(l.fx + fs, l.fy); ctx.arc(l.fx, l.fy, fs, 0, TAU); }
    }
    ctx.fill();
    if (T.legs.foot === 'tick') {
      ctx.beginPath();
      for (const l of legs) if (!l.swing) { const a = segs[l.seg].a; ctx.moveTo(l.fx - Math.cos(a) * 2.5, l.fy - Math.sin(a) * 2.5); ctx.lineTo(l.fx + Math.cos(a) * 2.5, l.fy + Math.sin(a) * 2.5); }
      ctx.stroke();
    }
    ctx.strokeStyle = pal.tint; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const l of legs) if (l.swing) { const s = 1.5 + l.lift * 1.6; ctx.rect(l.fx - s, l.fy - s, s * 2, s * 2); }
    ctx.stroke();

    // spine
    if (segs.length > 1) {
      ctx.strokeStyle = pal.ink; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(segs[0].x, segs[0].y);
      for (let i = 1; i < segs.length; i++) ctx.lineTo(segs[i].x, segs[i].y);
      ctx.stroke();
    }

    const breath = 1 + sleepy * 0.05 * Math.sin(t * 2.2);
    // misregistered accent layer, offset in screen space like a riso print
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    for (const s of segs) this._shape(ctx, s, this.printOx, this.printOy, breath);
    ctx.fill();
    // ink outlines
    ctx.strokeStyle = pal.ink; ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (const s of segs) if (s.shape !== 'grain') this._shape(ctx, s, 0, 0, breath);
    ctx.stroke();
    // ink details
    ctx.fillStyle = pal.ink;
    ctx.beginPath();
    for (const s of segs) {
      if (s.shape === 'disc') { ctx.moveTo(s.x + 1.4, s.y); ctx.arc(s.x, s.y, 1.4, 0, TAU); }
      else if (s.shape === 'grain') {
        for (let j = 0; j < 3; j++) {
          const a = s.a + j * 2.094, x = s.x + Math.cos(a) * s.r * 0.55, y = s.y + Math.sin(a) * s.r * 0.55;
          ctx.moveTo(x + 1.5, y); ctx.arc(x, y, 1.5, 0, TAU);
        }
      }
    }
    ctx.fill();
    ctx.beginPath();
    for (const s of segs) if (s.shape === 'ring') { const rr = s.r * 0.45; ctx.moveTo(s.x + rr, s.y); ctx.arc(s.x, s.y, rr, 0, TAU); }
    ctx.stroke();

    this._drawHead(ctx, sleepy);
    this._drawTail(ctx);

    // sleeping: little hollow squares drift up
    if (this.state === 'asleep' || sleepy > 0.5) {
      ctx.strokeStyle = pal.ink; ctx.lineWidth = 1;
      for (let i = 0; i < MAX_Z; i++) {
        const age = t - this.zs[i * 3 + 2];
        if (age < 0 || age > 2.4) continue;
        const s = 1.5 + age * 1.6;
        ctx.globalAlpha = (1 - age / 2.4) * 0.7;
        ctx.strokeRect(this.zs[i * 3] + age * 6 - s, this.zs[i * 3 + 1] - age * 14 - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
    }

    if (this.debug) this._drawDebug(ctx);
  }

  _paper() {
    return this.world?.paperColor || this.stage?.world?.paperColor || '#f2ecdf';
  }

  /** Tap acknowledgement marker and the spider's abseil thread. */
  _drawMarks(ctx) {
    const pal = this.traits.palette, t = this.time;
    const M = this.callMark;
    if (M) {
      const k = (t - M.t) / 0.4;
      if (k >= 1) this.callMark = null;
      else {
        const d = 14 * (1 - k), q = 2.4;
        ctx.globalAlpha = 1 - k * 0.6;
        ctx.fillStyle = pal.ink;
        ctx.fillRect(M.x - d - q / 2, M.y - q / 2, q, q); ctx.fillRect(M.x + d - q / 2, M.y - q / 2, q, q);
        ctx.fillRect(M.x - q / 2, M.y - d - q / 2, q, q); ctx.fillRect(M.x - q / 2, M.y + d - q / 2, q, q);
        ctx.globalAlpha = 1;
      }
    }
    if (this.abseil && t < this.sprintUntil) {
      const s = this.segs[this.segs.length - 1];
      const bx = s.x - Math.cos(s.a) * s.r, by = s.y - Math.sin(s.a) * s.r;
      ctx.strokeStyle = pal.ink; ctx.lineWidth = 0.8; ctx.globalAlpha = Math.min(1, (this.sprintUntil - t) * 2);
      ctx.beginPath(); ctx.moveTo(bx, Math.min(by, this._bounds().y - 40)); ctx.lineTo(bx, by); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _shape(ctx, s, ox, oy, k, grow = 0) {
    const x = s.x + ox, y = s.y + oy, r = s.r * k + grow;
    switch (s.shape) {
      case 'block': {
        const c = Math.cos(s.a) * r * 0.9, d = Math.sin(s.a) * r * 0.9;
        ctx.moveTo(x + c - d, y + d + c); ctx.lineTo(x - c - d, y - d + c);
        ctx.lineTo(x - c + d, y - d - c); ctx.lineTo(x + c + d, y + d - c); ctx.closePath();
        break;
      }
      case 'lozenge': {
        const fx = Math.cos(s.a), fy = Math.sin(s.a);
        ctx.moveTo(x + fx * r * 1.3, y + fy * r * 1.3); ctx.lineTo(x - fy * r * 0.85, y + fx * r * 0.85);
        ctx.lineTo(x - fx * r * 1.3, y - fy * r * 1.3); ctx.lineTo(x + fy * r * 0.85, y - fx * r * 0.85); ctx.closePath();
        break;
      }
      default:
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
    }
  }

  _drawHead(ctx, sleepy) {
    const T = this.traits, H = T.head, pal = T.palette, h0 = this.segs[0], t = this.time;
    const ha = h0.a + this.headTurn;
    const h = { x: h0.x, y: h0.y, r: h0.r, a: ha }; // the head looks where it attends
    const aim = this.aimA;
    const fx = Math.cos(h.a), fy = Math.sin(h.a);
    ctx.strokeStyle = pal.ink; ctx.lineWidth = 1;
    if (H.antennae) {
      const len = H.antennaLength * this.U * (1 - 0.45 * sleepy);
      ctx.beginPath();
      for (const side of [-1, 1]) {
        const sway = Math.sin(t * 3.1 + side) * 0.22 + this.turnVel * 0.05;
        const ba = h.a + side * 0.5, bx = h.x + Math.cos(ba) * h.r * 0.9, by = h.y + Math.sin(ba) * h.r * 0.9;
        let ta = h.a + side * (0.45 + sleepy * 0.9) + sway;
        if (aim !== null) ta += angDiff(ta, aim + side * 0.18) * 0.6; // feelers reach toward it
        const ca = h.a + side * 0.2;
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + Math.cos(ca) * len * 0.6, by + Math.sin(ca) * len * 0.6, bx + Math.cos(ta) * len, by + Math.sin(ta) * len);
      }
      ctx.stroke();
      ctx.fillStyle = pal.ink;
      ctx.beginPath();
      for (const side of [-1, 1]) {
        const sway = Math.sin(t * 3.1 + side) * 0.22 + this.turnVel * 0.05;
        const ba = h.a + side * 0.5, bx = h.x + Math.cos(ba) * h.r * 0.9, by = h.y + Math.sin(ba) * h.r * 0.9;
        let ta = h.a + side * (0.45 + sleepy * 0.9) + sway;
        if (aim !== null) ta += angDiff(ta, aim + side * 0.18) * 0.6;
        const x = bx + Math.cos(ta) * len, y = by + Math.sin(ta) * len;
        ctx.moveTo(x + 1.2, y); ctx.arc(x, y, 1.2, 0, TAU);
      }
      ctx.fill();
    }
    if (H.mandibles) {
      const open = this.mode === 'engage' ? 0.25 + 0.2 * Math.sin(t * 18) : 0.18;
      ctx.beginPath();
      for (const side of [-1, 1]) {
        const ba = h.a + side * 0.55, bx = h.x + Math.cos(ba) * h.r, by = h.y + Math.sin(ba) * h.r;
        const ta = h.a + side * open;
        ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(ta) * h.r * 0.9, by + Math.sin(ta) * h.r * 0.9);
      }
      ctx.stroke();
    }
    if (H.eyes) {
      ctx.fillStyle = sleepy > 0.5 ? pal.ink : pal.tint;
      ctx.beginPath();
      const n = H.eyes, rows = n > 4 ? 2 : 1, perRow = Math.ceil(n / rows);
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / perRow), j = i % perRow;
        const spreadA = perRow > 1 ? (j / (perRow - 1) - 0.5) * 1.3 : 0;
        const rr = h.r * (0.62 - row * 0.28), a = h.a + spreadA;
        const x = h.x + Math.cos(a) * rr, y = h.y + Math.sin(a) * rr, er = 0.9 + (row === 0 ? 0.2 : 0);
        ctx.moveTo(x + er, y); ctx.arc(x, y, er, 0, TAU);
      }
      ctx.fill();
    }
    void fx; void fy;
  }

  _drawTail(ctx) {
    const T = this.traits, s = this.segs[this.segs.length - 1], pal = T.palette;
    if (T.tail === 'none') return;
    const bx = s.x - Math.cos(s.a) * s.r, by = s.y - Math.sin(s.a) * s.r;
    ctx.strokeStyle = pal.ink; ctx.lineWidth = 1;
    ctx.beginPath();
    if (T.tail === 'cerci') {
      for (const side of [-1, 1]) {
        const a = s.a + Math.PI + side * 0.35, L = this.U * 1.8;
        ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a) * L, by + Math.sin(a) * L);
      }
      ctx.stroke();
    } else if (T.tail === 'stinger') {
      const a = s.a + Math.PI, L = this.U * 1.5, x = bx + Math.cos(a) * L, y = by + Math.sin(a) * L;
      ctx.moveTo(bx, by); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = pal.ink; ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3);
      ctx.lineTo(x + Math.cos(a + 2.2) * 2.2, y + Math.sin(a + 2.2) * 2.2);
      ctx.lineTo(x + Math.cos(a - 2.2) * 2.2, y + Math.sin(a - 2.2) * 2.2);
      ctx.fill();
    } else if (T.tail === 'spinneret') {
      const r = Math.max(1.4, s.r * 0.22);
      ctx.moveTo(bx + r, by); ctx.arc(bx, by, r, 0, TAU); ctx.stroke();
    }
  }

  _drawDebug(ctx) {
    const h = this.segs[0], tm = this.traits.temperament;
    ctx.save();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(h.x, h.y, tm.senseRadius, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,0,0,0.6)';
    ctx.beginPath();
    for (const l of this.legs) { ctx.moveTo(l.tx - 2, l.ty); ctx.lineTo(l.tx + 2, l.ty); ctx.moveTo(l.tx, l.ty - 2); ctx.lineTo(l.tx, l.ty + 2); }
    ctx.stroke();
    if (this.engage) {
      ctx.strokeStyle = 'rgba(0,120,255,0.7)';
      const it = this.engage.item; ctx.strokeRect(it.x, it.y, it.w, it.h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(this.state === 'asleep' ? 'asleep' : this.mode, h.x + 10, h.y - 10);
    ctx.restore();
  }
}

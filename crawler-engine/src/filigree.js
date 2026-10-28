// Filigree renderer: the creature as dense technical linework. Ribs bow back
// from a beaded spine of small squares, rotated frames hang off the rib ends,
// legs are double-lined with square knees and lit feet, and every planted foot
// leaves a square echo that slowly opens and fades.
//
// Render only. It reads the creature's existing traits (segments, legs,
// palette) and takes extra ornament from its own fork of the seed, so a seed is
// still the same creature, just drawn in more detail.
import { createRng } from './rng.js?v=20261028175358';

const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function hexToRgb(c) {
  const m = String(c).match(/^#?([0-9a-f]{6})$/i);
  if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  const r = String(c).match(/rgba?\(([^)]+)\)/);
  if (r) return r[1].split(/[ ,/]+/).filter(Boolean).slice(0, 3).map(Number);
  return [242, 236, 223];
}
const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

// Per-creature ornament, decided once from its own fork of the seed.
export function filigreeStyle(seed) {
  const r = createRng(String(seed) + ':filigree');
  return {
    density: r.range(0.75, 1.05), // ribs per body unit
    ribLayers: r.weighted([[2, 5], [3, 3], [1, 1]]),
    ribBow: r.range(0.45, 0.95), // how far a rib bows back
    ribLift: r.range(0.15, 0.5), // how far the rib ends sweep forward
    beads: r.int(3, 6),
    frameEvery: r.weighted([[1, 2], [2, 4], [3, 2]]),
    frameSize: r.range(0.45, 0.8),
    frameTwist: r.range(0.15, 0.6),
    spine: r.weighted([['square', 5], ['diamond', 3], ['ring', 2]]),
    headBox: r.weighted([['grid', 4], ['bracket', 3], ['lens', 2]]),
    gridCols: r.int(2, 4),
    legLines: r.weighted([[2, 5], [1, 2]]),
    legBeads: r.int(2, 4),
    halo: r.range(3.5, 6),
    echo: r.weighted([['square', 6], ['ring', 2], ['cross', 2]]),
    shimmer: r.range(0.6, 1.4),
  };
}

const MAX_PTS = 48;

export function drawFiligree(c, ctx) {
  const T = c.traits, pal = T.palette, segs = c.segs, legs = c.legs, t = c.time, U = c.U;
  const S = c.filigree || (c.filigree = filigreeStyle(c.seed));
  const sleepy = c.sleepK;
  const paper = hexToRgb(c._paper());
  const dark = lum(paper) < 0.45;
  const ink = hexToRgb(dark ? '#f4efe6' : pal.ink);
  const acc = hexToRgb(pal.accent), tint = hexToRgb(pal.tint);
  // On light paper the accent is deepened toward ink so thin lines still read.
  const ribHead = dark ? acc : mix(acc, hexToRgb(pal.ink), 0.12);
  const ribTail = dark ? tint : mix(tint, hexToRgb(pal.ink), 0.22);
  const lw = Math.max(0.8, U * 0.12);

  // ---- spine samples: head tip -> segment centres -> tail tip ---------------
  const P = c._fp || (c._fp = { x: new Float32Array(MAX_PTS), y: new Float32Array(MAX_PTS), a: new Float32Array(MAX_PTS), w: new Float32Array(MAX_PTS), n: 0 });
  const h0 = segs[0], last = segs[segs.length - 1];
  const ctrl = [{ x: h0.x + Math.cos(h0.a) * h0.r, y: h0.y + Math.sin(h0.a) * h0.r, r: h0.r * 0.55 }];
  for (const s of segs) ctrl.push({ x: s.x, y: s.y, r: s.r });
  ctrl.push({ x: last.x - Math.cos(last.a) * last.r * 1.1, y: last.y - Math.sin(last.a) * last.r * 1.1, r: last.r * 0.35 });
  const cum = [0];
  for (let i = 1; i < ctrl.length; i++) cum.push(cum[i - 1] + Math.hypot(ctrl[i].x - ctrl[i - 1].x, ctrl[i].y - ctrl[i - 1].y));
  const L = cum[cum.length - 1] || 1;
  const n = clamp(Math.round((L / U) * S.density * 1.7), 9, MAX_PTS);
  for (let k = 0; k < n; k++) {
    const d = (k + 0.5) / n * L;
    let i = 1; while (i < ctrl.length - 1 && cum[i] < d) i++;
    const a0 = ctrl[i - 1], a1 = ctrl[i], f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    P.x[k] = a0.x + (a1.x - a0.x) * f;
    P.y[k] = a0.y + (a1.y - a0.y) * f;
    P.a[k] = Math.atan2(a0.y - a1.y, a0.x - a1.x); // points toward the head
    // width follows the segments, pinched between them like a waist
    const pinch = 1 - 0.18 * Math.sin(Math.PI * f);
    P.w[k] = Math.max(U * 1.5, (a0.r + (a1.r - a0.r) * f) * 2.0) * pinch * (k === 0 ? 0.6 : 1);
  }
  P.n = n;

  const moving = clamp(c.speed / (c.maxSpeed || 1), 0, 1);
  const breathe = 1 + (sleepy * 0.04 + 0.015) * Math.sin(t * 2.1);

  // rib geometry for sample k: left end, right end, back-bowed control
  const rib = (k, layer = 0) => {
    const x = P.x[k], y = P.y[k], a = P.a[k], w = P.w[k] * breathe;
    const fx = Math.cos(a), fy = Math.sin(a), nx = -fy, ny = fx;
    const ripple = Math.sin(t * (3 + moving * 6) * S.shimmer - k * 0.7) * moving * 0.18;
    const lift = (S.ribLift + ripple) * w, bow = S.ribBow * w + layer * lw * 1.6;
    return {
      lx: x + nx * w + fx * lift, ly: y + ny * w + fy * lift,
      rx: x - nx * w + fx * lift, ry: y - ny * w + fy * lift,
      cx: x - fx * bow, cy: y - fy * bow, a, w, x, y,
    };
  };

  // ---- footprint echoes: square frames that open and fade ------------------
  if (T.trail !== 'none' || true) {
    const life = 1.5;
    ctx.lineWidth = lw * 0.8;
    for (let i = 0; i < c.prints.length / 3; i++) {
      const age = t - c.prints[i * 3 + 2];
      if (age > life || age < 0) continue;
      const k = age / life, x = c.prints[i * 3], y = c.prints[i * 3 + 1];
      const s = U * (0.35 + k * 0.7), rot = i * 0.9 + k * 0.8;
      ctx.strokeStyle = rgba(mix(ribTail, ink, 0.3), 0.28 * (1 - k));
      ctx.beginPath();
      if (S.echo === 'ring') { ctx.moveTo(x + s, y); ctx.arc(x, y, s, 0, TAU); }
      else if (S.echo === 'cross') { const q = s * 0.7; ctx.moveTo(x - q, y - q); ctx.lineTo(x + q, y + q); ctx.moveTo(x + q, y - q); ctx.lineTo(x - q, y + q); }
      else squarePath(ctx, x, y, s, rot);
      ctx.stroke();
    }
  }

  c._drawMarks(ctx);
  for (const l of legs) c._ik(l);

  // ---- shadow + paper sheet under the body, so it sits on the page ---------
  const hull = new Path2D();
  { const r0 = rib(0); hull.moveTo(r0.lx, r0.ly); }
  for (let k = 1; k < n; k++) { const r = rib(k); hull.lineTo(r.lx, r.ly); }
  for (let k = n - 1; k >= 0; k--) { const r = rib(k); hull.lineTo(r.rx, r.ry); }
  hull.closePath();
  ctx.save();
  ctx.translate(U * 0.5, U * 0.9);
  ctx.shadowColor = rgba(dark ? [0, 0, 0] : hexToRgb(pal.ink), dark ? 0.6 : 0.22);
  ctx.shadowBlur = U * 2.2;
  ctx.fillStyle = rgba(dark ? [0, 0, 0] : hexToRgb(pal.ink), dark ? 0.35 : 0.06);
  ctx.fill(hull);
  ctx.restore();
  ctx.fillStyle = rgba(paper, dark ? 0.55 : 0.82);
  ctx.fill(hull);

  if (dark) ctx.globalCompositeOperation = 'lighter';

  // ---- legs: double femur, square knee, beaded tibia, lit foot -------------
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // paper knockout so leg lines don't merge with letters
  ctx.strokeStyle = rgba(paper, 0.85); ctx.lineWidth = lw * 3.2;
  ctx.beginPath();
  for (const l of legs) { ctx.moveTo(l.hx, l.hy); ctx.lineTo(l.kx, l.ky); ctx.lineTo(l.fx, l.fy); }
  ctx.stroke();
  ctx.strokeStyle = rgba(ink, 0.85); ctx.lineWidth = lw;
  ctx.beginPath();
  for (const l of legs) {
    ctx.moveTo(l.hx, l.hy); ctx.lineTo(l.kx, l.ky); ctx.lineTo(l.fx, l.fy);
    if (S.legLines > 1) {
      const a = Math.atan2(l.ky - l.hy, l.kx - l.hx), o = lw * 1.4, ox = -Math.sin(a) * o, oy = Math.cos(a) * o;
      ctx.moveTo(l.hx + ox, l.hy + oy); ctx.lineTo(l.kx + ox, l.ky + oy);
    }
  }
  ctx.stroke();
  // knees
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  for (const l of legs) { const a = Math.atan2(l.fy - l.ky, l.fx - l.kx); squarePath(ctx, l.kx, l.ky, lw * 1.6, a); }
  ctx.stroke();
  // tibia beads
  ctx.fillStyle = rgba(mix(ribHead, ink, 0.2), 0.95);
  ctx.beginPath();
  for (const l of legs) {
    for (let j = 1; j <= S.legBeads; j++) {
      const f = j / (S.legBeads + 1), x = l.kx + (l.fx - l.kx) * f, y = l.ky + (l.fy - l.ky) * f, r = lw * 0.9;
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
    }
  }
  ctx.fill();
  // feet: planted = lit dot with a halo ring, lifted = open ring
  for (const l of legs) {
    const r = lw * 1.5;
    if (l.swing) {
      ctx.strokeStyle = rgba(ribHead, 0.8); ctx.lineWidth = lw * 0.8;
      ctx.beginPath(); ctx.arc(l.fx, l.fy, r * (1.2 + l.lift), 0, TAU); ctx.stroke();
    } else {
      ctx.fillStyle = rgba(ribHead, 1);
      ctx.beginPath(); ctx.arc(l.fx, l.fy, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(ribHead, 0.35); ctx.lineWidth = lw * 0.7;
      ctx.beginPath(); ctx.arc(l.fx, l.fy, r * S.halo * 0.5, 0, TAU); ctx.stroke();
    }
  }

  // ---- side frames off the rib ends ----------------------------------------
  ctx.lineWidth = lw * 0.8;
  for (let k = 1; k < n; k += S.frameEvery) {
    const r = rib(k), f = k / (n - 1), col = mix(ribHead, ribTail, f);
    ctx.strokeStyle = rgba(mix(col, ink, 0.2), 0.32);
    const s = r.w * S.frameSize * 0.55, tw = r.a + Math.sin(t * 0.9 + k) * S.frameTwist * (0.3 + moving);
    ctx.beginPath();
    squarePath(ctx, r.lx, r.ly, s, tw); squarePath(ctx, r.rx, r.ry, s, -tw);
    ctx.stroke();
  }

  // ---- ribs -----------------------------------------------------------------
  for (let layer = S.ribLayers - 1; layer >= 0; layer--) {
    ctx.lineWidth = layer ? lw * 0.8 : lw * 1.3;
    for (let k = 1; k < n; k++) {
      const r = rib(k, layer), f = k / (n - 1);
      ctx.strokeStyle = rgba(mix(ribHead, ribTail, f), layer ? 0.4 : 1);
      ctx.beginPath(); ctx.moveTo(r.lx, r.ly); ctx.quadraticCurveTo(r.cx, r.cy, r.rx, r.ry); ctx.stroke();
    }
  }
  // outline: the two flanks joining rib ends
  ctx.strokeStyle = rgba(ink, 0.35); ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  for (let k = 0; k < n; k++) { const r = rib(k); k ? ctx.lineTo(r.lx, r.ly) : ctx.moveTo(r.lx, r.ly); }
  for (let k = 0; k < n; k++) { const r = rib(k); k ? ctx.lineTo(r.rx, r.ry) : ctx.moveTo(r.rx, r.ry); }
  ctx.stroke();
  // beads along each rib
  ctx.fillStyle = rgba(dark ? tint : mix(tint, hexToRgb(pal.ink), 0.45), 1);
  ctx.beginPath();
  for (let k = 1; k < n; k++) {
    const r = rib(k);
    for (let j = 0; j < S.beads; j++) {
      const u = (j + 0.5) / S.beads, v = 1 - u;
      const x = v * v * r.lx + 2 * v * u * r.cx + u * u * r.rx, y = v * v * r.ly + 2 * v * u * r.cy + u * u * r.ry;
      const br = lw * (0.55 + 0.45 * Math.sin(u * Math.PI));
      ctx.moveTo(x + br, y); ctx.arc(x, y, br, 0, TAU);
    }
  }
  ctx.fill();
  // spine: chain of small squares down the middle
  ctx.strokeStyle = rgba(ink, 0.95); ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const x = P.x[k], y = P.y[k];
    k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.beginPath();
  for (let k = 1; k < n; k++) {
    const x = P.x[k], y = P.y[k], s = Math.max(lw * 1.5, P.w[k] * 0.11);
    if (S.spine === 'ring') { ctx.moveTo(x + s, y); ctx.arc(x, y, s, 0, TAU); }
    else squarePath(ctx, x, y, s, P.a[k] + (S.spine === 'diamond' ? Math.PI / 4 : 0));
  }
  ctx.fillStyle = rgba(paper, 1); ctx.fill(); ctx.stroke();

  drawHead(c, ctx, S, { ink, ribHead, lw, sleepy, paper });
  ctx.globalCompositeOperation = 'source-over';

  // sleeping: small hollow squares drift up
  if (c.state === 'asleep' || sleepy > 0.5) {
    ctx.strokeStyle = rgba(ink, 1); ctx.lineWidth = 1;
    for (let i = 0; i < c.zs.length / 3; i++) {
      const age = t - c.zs[i * 3 + 2];
      if (age < 0 || age > 2.4) continue;
      const s = 1.5 + age * 1.6;
      ctx.globalAlpha = (1 - age / 2.4) * 0.7;
      ctx.strokeRect(c.zs[i * 3] + age * 6 - s, c.zs[i * 3 + 1] - age * 14 - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
  }
}

function drawHead(c, ctx, S, { ink, ribHead, lw, sleepy, paper }) {
  const T = c.traits, H = T.head, h0 = c.segs[0], t = c.time, U = c.U;
  const a = h0.a + c.headTurn, fx = Math.cos(a), fy = Math.sin(a), nx = -fy, ny = fx;
  const hx = h0.x + fx * h0.r * 0.35, hy = h0.y + fy * h0.r * 0.35;
  const W = h0.r * 1.5, D = h0.r * 0.95; // across, along

  // antennae: long curves ending in lit dots with halos
  const len = (H.antennae ? H.antennaLength : 2.2) * U * 1.25 * (1 - 0.45 * sleepy);
  const aim = c.aimA;
  ctx.strokeStyle = rgba(ink, 0.9); ctx.lineWidth = lw * 0.8;
  const tips = [];
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const bx = hx + fx * D * 0.5 + nx * side * W * 0.35, by = hy + fy * D * 0.5 + ny * side * W * 0.35;
    let ta = a + side * (0.5 + sleepy * 0.9) + Math.sin(t * 2.7 + side) * 0.2;
    if (aim !== null) { let d = (aim + side * 0.15 - ta) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; ta += d * 0.6; }
    const mx = bx + Math.cos(a + side * 0.15) * len * 0.55, my = by + Math.sin(a + side * 0.15) * len * 0.55;
    const ex = bx + Math.cos(ta) * len, ey = by + Math.sin(ta) * len;
    ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, ex, ey);
    tips.push([ex, ey]);
  }
  ctx.stroke();
  for (const [x, y] of tips) {
    ctx.fillStyle = rgba(ribHead, 1); ctx.beginPath(); ctx.arc(x, y, lw * 1.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(ribHead, 0.35); ctx.beginPath(); ctx.arc(x, y, lw * 1.5 * S.halo * 0.6, 0, TAU); ctx.stroke();
  }

  // mandibles
  if (H.mandibles) {
    const open = c.mode === 'work' ? 0.3 + 0.25 * Math.sin(t * 16) : 0.2;
    ctx.strokeStyle = rgba(ink, 0.95); ctx.lineWidth = lw;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      const bx = hx + fx * D * 0.55 + nx * side * W * 0.25, by = hy + fy * D * 0.55 + ny * side * W * 0.25;
      const ta = a + side * open;
      ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(ta) * h0.r * 0.9, by + Math.sin(ta) * h0.r * 0.9);
      ctx.lineTo(bx + Math.cos(ta - side * 1.2) * h0.r * 0.9 + Math.cos(ta) * h0.r * 0.2, by + Math.sin(ta - side * 1.2) * h0.r * 0.9 + Math.sin(ta) * h0.r * 0.2);
    }
    ctx.stroke();
  }

  // the head box
  const corner = (u, v) => [hx + fx * D * u + nx * W * v, hy + fy * D * u + ny * W * v];
  ctx.fillStyle = rgba(paper, 1); ctx.strokeStyle = rgba(ink, 1); ctx.lineWidth = lw * 1.1;
  ctx.beginPath();
  if (S.headBox === 'lens') {
    ctx.ellipse(hx, hy, D * 0.6, W * 0.5, a, 0, TAU);
  } else {
    const p = [corner(0.5, 0.5), corner(0.5, -0.5), corner(-0.5, -0.5), corner(-0.5, 0.5)];
    ctx.moveTo(...p[0]); for (const q of p.slice(1)) ctx.lineTo(...q); ctx.closePath();
  }
  ctx.fill(); ctx.stroke();
  ctx.lineWidth = lw * 0.6;
  ctx.beginPath();
  if (S.headBox === 'grid') {
    for (let i = 1; i < S.gridCols; i++) { const v = -0.5 + i / S.gridCols; ctx.moveTo(...corner(0.5, v)); ctx.lineTo(...corner(-0.5, v)); }
    ctx.moveTo(...corner(0, 0.5)); ctx.lineTo(...corner(0, -0.5));
  } else if (S.headBox === 'bracket') {
    for (const v of [0.5, -0.5]) { ctx.moveTo(...corner(0.75, v * 0.7)); ctx.lineTo(...corner(0.75, v)); ctx.lineTo(...corner(0.5, v * 1.2)); }
  }
  ctx.stroke();
  // eyes in the front cells
  const eyes = Math.max(2, H.eyes || 2);
  ctx.fillStyle = rgba(sleepy > 0.5 ? ink : ribHead, 1);
  ctx.beginPath();
  for (let i = 0; i < eyes; i++) {
    const v = eyes > 1 ? -0.32 + (0.64 * i) / (eyes - 1) : 0, u = 0.25 - (i % 2) * 0.12;
    const [x, y] = corner(u, v), r = lw * (i % 2 ? 0.8 : 1.15);
    ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fill();
  void U;
}

function squarePath(ctx, x, y, s, a) {
  const c = Math.cos(a) * s, d = Math.sin(a) * s;
  ctx.moveTo(x + c - d, y + d + c); ctx.lineTo(x - c - d, y - d + c);
  ctx.lineTo(x - c + d, y - d - c); ctx.lineTo(x + c + d, y + d - c); ctx.closePath();
}

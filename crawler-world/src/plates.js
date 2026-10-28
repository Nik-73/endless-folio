// Procedural "plates": seeded inline SVG illustrations in an engraved,
// ink-on-paper style. Inline SVG keeps them crisp, cheap and hit-testable.

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function frame(w, h, label) {
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label, class: 'plate-svg' });
  el('rect', { x: 0.5, y: 0.5, width: w - 1, height: h - 1, class: 'plate-bg' }, svg);
  return svg;
}

// Contour chart: stacked noisy rings around a few peaks.
function chart(rng, w, h) {
  const svg = frame(w, h, 'Contour chart');
  const peaks = Array.from({ length: rng.int(2, 4) }, () => ({ x: rng.float(0.2, 0.8) * w, y: rng.float(0.25, 0.75) * h, s: rng.float(0.5, 1.2) }));
  const g = el('g', { class: 'plate-ink', fill: 'none' }, svg);
  for (const p of peaks) {
    const rings = rng.int(5, 9);
    const ph = rng.float(0, 6.28);
    for (let r = 1; r <= rings; r++) {
      const rad = r * 9 * p.s;
      let d = '';
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const wob = 1 + 0.18 * Math.sin(a * 3 + ph + r * 0.4) + 0.08 * Math.sin(a * 7 - ph);
        const x = p.x + Math.cos(a) * rad * wob * 1.25;
        const y = p.y + Math.sin(a) * rad * wob;
        d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      }
      el('path', { d: d + 'Z', 'stroke-width': r === rings ? 1.2 : 0.6, opacity: 1 - r / (rings + 3) }, g);
    }
  }
  // Dotted route between peaks.
  let route = '';
  peaks.forEach((p, i) => (route += (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)));
  el('path', { d: route, class: 'plate-route', fill: 'none' }, svg);
  // Compass rose.
  const cx = w - 26, cy = h - 26;
  const c = el('g', { class: 'plate-ink', transform: `translate(${cx} ${cy})` }, svg);
  el('circle', { r: 12, fill: 'none', 'stroke-width': 0.6 }, c);
  el('path', { d: 'M0 -16 L3 0 L0 16 L-3 0 Z', class: 'plate-solid' }, c);
  el('path', { d: 'M-16 0 L0 2 L16 0 L0 -2 Z', fill: 'none', 'stroke-width': 0.6 }, c);
  return svg;
}

// Specimen: a bilaterally symmetric winged/segmented form, engraved hatching.
function specimen(rng, w, h) {
  const svg = frame(w, h, 'Specimen plate');
  const g = el('g', { class: 'plate-ink', transform: `translate(${w / 2} ${h / 2})` }, svg);
  const span = Math.min(w, h) * 0.42;
  const lobes = rng.int(1, 3);
  for (let side of [-1, 1]) {
    for (let l = 0; l < lobes; l++) {
      const ang = -0.6 + l * 0.7 + rng.float(-0.1, 0.1);
      const len = span * rng.float(0.6, 1) * (1 - l * 0.18);
      const wid = len * rng.float(0.35, 0.6);
      const tx = Math.cos(ang) * len * side, ty = Math.sin(ang) * len;
      const d = `M0 0 C ${(tx * 0.3 - wid * 0.4 * side).toFixed(1)} ${(ty - wid).toFixed(1)}, ${(tx + wid * 0.2 * side).toFixed(1)} ${(ty - wid * 0.6).toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)} C ${(tx - wid * 0.1 * side).toFixed(1)} ${(ty + wid * 0.7).toFixed(1)}, ${(tx * 0.4).toFixed(1)} ${(ty + wid * 0.5).toFixed(1)}, 0 0 Z`;
      el('path', { d, fill: 'none', 'stroke-width': 1 }, g);
      // Hatching veins.
      const veins = rng.int(3, 6);
      for (let v = 1; v <= veins; v++) {
        const f = v / (veins + 1);
        el('path', { d: `M0 0 Q ${(tx * f).toFixed(1)} ${(ty * f - wid * 0.3).toFixed(1)} ${(tx * (0.6 + f * 0.35)).toFixed(1)} ${(ty * (0.6 + f * 0.35) + (f - 0.5) * wid * 0.6).toFixed(1)}`, fill: 'none', 'stroke-width': 0.4 }, g);
      }
      if (rng.chance(0.6)) el('circle', { cx: (tx * 0.62).toFixed(1), cy: (ty * 0.62).toFixed(1), r: (wid * 0.12).toFixed(1), class: 'plate-solid' }, g);
    }
  }
  // Segmented body.
  const segs = rng.int(4, 9);
  for (let i = 0; i < segs; i++) {
    const r = span * 0.08 * (1 - i / (segs * 1.6));
    el('ellipse', { cx: 0, cy: (i - 1) * r * 1.5, rx: r * 0.8, ry: r, fill: 'none', 'stroke-width': 0.8 }, g);
  }
  // Antennae.
  for (let side of [-1, 1]) el('path', { d: `M0 ${-span * 0.12} q ${side * span * 0.15} ${-span * 0.2} ${side * span * 0.28} ${-span * 0.22}`, fill: 'none', 'stroke-width': 0.6 }, g);
  return svg;
}

// Type specimen: a grid of glyphs, some "eaten" into ghosts.
function typeSheet(rng, w, h) {
  const svg = frame(w, h, 'Type specimen');
  const glyphs = 'aeghkmoqrsvwyzAEGKMQRSW&?';
  const cols = 7, rows = 4;
  const cw = (w - 20) / cols, ch = (h - 20) / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const t = el('text', { x: 10 + cw * (c + 0.5), y: 10 + ch * (r + 0.72), 'text-anchor': 'middle', class: 'plate-glyph', 'font-size': ch * 0.7 }, svg);
    t.textContent = rng.pick(glyphs);
    if (rng.chance(0.18)) t.setAttribute('class', 'plate-glyph ghost');
  }
  return svg;
}

const MAKERS = { chart, specimen, type: typeSheet };

export function makePlate(rng, kind = rng.pick(Object.keys(MAKERS)), w = 320, h = 220) {
  return { kind, svg: MAKERS[kind](rng, w, h) };
}

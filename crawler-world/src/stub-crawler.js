// Placeholder creature until ../crawler-engine lands. Same signature as the
// real engine: createCrawler({ seed, canvas, world }) -> { start, stop, destroy }.
// It exists to exercise the world API: follows the pointer/finger, otherwise
// wanders between nearby words, and triggers every effect type.

import { makeRng } from './prng.js?v=20261028144733';

export function createCrawler({ seed, canvas, world }) {
  const rng = makeRng(seed ?? 1);
  const ctx = canvas.getContext('2d');
  const hue = Math.floor(rng.float(0, 360));
  const colour = `hsl(${hue} 70% 38%)`;
  const vp = world.viewport;
  const p = { x: vp.width * rng.float(0.3, 0.7), y: vp.height * rng.float(0.3, 0.6), vx: 0, vy: 0 };
  const trail = [];
  let target = null; // { x, y } or a world item
  let raf = 0, running = false, lastQuery = 0, lastTouchId = null, quietSince = performance.now();
  let blockDwell = { id: null, since: 0 };
  const memory = [];
  const offs = [];

  function blip(text) {
    const a = world.audio;
    if (!a.context || a.muted) return;
    const t = a.context.currentTime;
    const o = a.context.createOscillator();
    const g = a.context.createGain();
    // Long words sound low, short words sound high.
    o.frequency.value = 880 / Math.max(1, Math.min(9, text.length) / 2);
    o.type = 'triangle';
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(a.output);
    o.start(t); o.stop(t + 0.2);
  }

  function pickWanderTarget() {
    const near = world.queryNear(p.x, p.y, 220, { kinds: ['word', 'link', 'image'], limit: 40 }).filter((i) => i.id !== lastTouchId && i.cy > 0 && i.cy < vp.height);
    if (near.length) { const it = rng.pick(near); target = { x: it.cx, y: it.cy, id: it.id }; return; }
    const b = world.bounds();
    target = { x: rng.float(Math.max(0, b.x), Math.min(vp.width, b.x + b.w)), y: rng.float(vp.height * 0.2, vp.height * 0.8) };
  }

  function sense(now) {
    const hits = world.queryNear(p.x, p.y, 10, { limit: 4 });
    const hit = hits.find((h) => h.kind !== 'link') || hits[0];
    if (!hit) return;
    if (hit.blockId !== blockDwell.id) blockDwell = { id: hit.blockId, since: now };
    if (hit.id === lastTouchId) {
      // Lingering in one paragraph while unattended eventually breaks it apart.
      if (now - blockDwell.since > 3500 && now - quietSince > 2500 && hit.kind === 'word' && !hit.heading && rng.chance(0.02)) {
        world.applyEffect('scatter', hit, { strength: 1 });
        blockDwell.since = now;
      }
      return;
    }
    lastTouchId = hit.id;
    if (hit.kind === 'image') world.applyEffect('pulse', hit);
    else world.applyEffect('highlight', hit, { color: colour });
    world.touch(hit);
    blip(hit.text);
    memory.push(hit);
    if (memory.length > 12) memory.shift();
    // Every few words, tie the current word back to one touched earlier.
    if (hit.kind === 'word' && memory.length > 4 && rng.chance(0.18)) {
      const earlier = memory[Math.floor(rng.float(0, memory.length - 3))];
      if (earlier.kind === 'word') world.applyEffect('connect', [earlier, hit], { color: colour });
    }
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const ptr = world.pointer;
    const followPointer = ptr.active && now - ptr.lastMove < 2500;
    if (followPointer) { target = { x: ptr.x, y: ptr.y }; quietSince = now; }
    else if (!target || Math.hypot(target.x - p.x, target.y - p.y) < 4) pickWanderTarget();

    const dx = target.x - p.x, dy = target.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const maxSpeed = followPointer ? 6 : 1.4;
    p.vx += (dx / d) * 0.35; p.vy += (dy / d) * 0.35;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > maxSpeed) { p.vx *= maxSpeed / sp; p.vy *= maxSpeed / sp; }
    if (d < 30) { p.vx *= 0.85; p.vy *= 0.85; }
    p.x += p.vx; p.y += p.vy;
    p.x = Math.max(0, Math.min(vp.width, p.x));
    p.y = Math.max(0, Math.min(vp.height, p.y));

    // Sense at ~12 Hz rather than every frame; saves battery on phones.
    if (now - lastQuery > 80) { lastQuery = now; sense(now); }

    trail.push({ x: p.x, y: p.y });
    if (trail.length > 24) trail.shift();
    draw();
  }

  function draw() {
    const dpr = vp.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vp.width, vp.height);
    ctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      ctx.strokeStyle = `hsl(${hue} 70% 38% / ${(i / trail.length) * 0.5})`;
      ctx.lineWidth = (i / trail.length) * 5;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  offs.push(world.on('visibility', ({ hidden }) => (hidden ? api.stop() : api.start())));
  // Stay with the text while scrolling: shift by the scroll delta so the
  // creature appears to sit on the page rather than on the glass.
  offs.push(world.on('scroll', ({ dy }) => {
    if (world.pointer.down) return;
    p.y -= dy; trail.forEach((t) => (t.y -= dy));
    if (target && target.id) target.y -= dy;
  }));
  offs.push(world.on('resize', () => draw()));

  const api = {
    kind: 'stub',
    start() { if (running || world.state.hidden) return; running = true; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    destroy() { api.stop(); offs.forEach((off) => off()); ctx.clearRect(0, 0, canvas.width, canvas.height); },
    get position() { return { x: p.x, y: p.y }; },
  };
  return api;
}

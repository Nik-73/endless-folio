// Runtime plumbing shared by the host page world and the bookmarklet world:
// event emitter, canvas sizing, passive pointer/touch tracking, audio unlock,
// visibility and reduced-motion. Nothing here ever calls preventDefault, so the
// page always scrolls natively on touch devices.

export function createEmitter() {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    off(type, fn) { handlers.get(type)?.delete(fn); },
    emit(type, detail) {
      const set = handlers.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(detail); } catch (err) { console.error('[world] handler for', type, err); }
      }
    },
  };
}

// Extra hit radius (CSS px) around a creature for a tap, by pointer type. 28 px on
// touch makes even a small creature a ~44 px+ target without drawing it bigger.
export const TAP_PAD = { mouse: 10, pen: 14, touch: 28 };

const MAX_DPR = 2; // Higher backing stores cost battery for little visible gain.

export function createEnv({ canvas, win = window, startMuted = true } = {}) {
  const em = createEmitter();
  const doc = win.document;
  const listeners = [];
  const listen = (target, type, fn, opts = { passive: true }) => {
    target.addEventListener(type, fn, opts);
    listeners.push(() => target.removeEventListener(type, fn, opts));
  };

  // ---- viewport + canvas -------------------------------------------------
  const viewport = { width: 0, height: 0, dpr: 1, scrollX: 0, scrollY: 0 };

  function sizeCanvas() {
    const dpr = Math.min(MAX_DPR, win.devicePixelRatio || 1);
    // The canvas is CSS-sized to the *large* viewport (100lvh) so mobile URL
    // bar show/hide does not resize (and clear) the backing store mid-scroll.
    const w = canvas ? canvas.clientWidth : win.innerWidth;
    const h = canvas ? canvas.clientHeight : win.innerHeight;
    if (w === viewport.width && h === viewport.height && dpr === viewport.dpr) return false;
    viewport.width = w; viewport.height = h; viewport.dpr = dpr;
    if (canvas) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return true;
  }
  sizeCanvas();
  viewport.scrollX = win.scrollX; viewport.scrollY = win.scrollY;

  if (canvas && 'ResizeObserver' in win) {
    const ro = new win.ResizeObserver(() => { if (sizeCanvas()) em.emit('resize', { ...viewport }); });
    ro.observe(canvas);
    listeners.push(() => ro.disconnect());
  }
  listen(win, 'resize', () => { if (sizeCanvas()) em.emit('resize', { ...viewport }); });

  // Coalesced to one event per frame; dx/dy is the total movement since the
  // previous emitted event.
  let scrollQueued = false;
  listen(win, 'scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    win.requestAnimationFrame(() => {
      scrollQueued = false;
      const dx = win.scrollX - viewport.scrollX, dy = win.scrollY - viewport.scrollY;
      viewport.scrollX = win.scrollX; viewport.scrollY = win.scrollY;
      if (dx || dy) em.emit('scroll', { scrollX: viewport.scrollX, scrollY: viewport.scrollY, dx, dy });
    });
  });

  // ---- pointer / touch -----------------------------------------------------
  // On touch devices the browser fires pointercancel as soon as it decides to
  // scroll, after which pointermove stops. touchmove keeps flowing (passively)
  // during the scroll, so we listen to both and merge them.
  const pointer = { x: viewport.width / 2, y: viewport.height / 2, active: false, down: false, type: 'mouse', lastMove: 0 };
  let downAt = null;
  let claimedTap = null;

  // Host UI marked [data-cw-ignore] (toolbars, buttons) never steers the creature.
  const ignored = (e) => e.target?.closest?.('[data-cw-ignore]');
  function update(x, y, type, phase) {
    pointer.x = x; pointer.y = y; pointer.type = type; pointer.lastMove = performance.now();
    pointer.active = true;
    em.emit('pointer', { phase, x, y, pointerType: type });
  }
  listen(win, 'pointerdown', (e) => {
    if (ignored(e)) { unlockAudio(); return; }
    pointer.down = true;
    // Event timestamps, not the clock: a busy main thread must not turn taps into holds.
    downAt = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    update(e.clientX, e.clientY, e.pointerType || 'mouse', 'down');
    unlockAudio();
  });
  listen(win, 'pointermove', (e) => ignored(e) || update(e.clientX, e.clientY, e.pointerType || 'mouse', 'move'));
  listen(win, 'pointerup', (e) => {
    if (ignored(e) && !downAt) return;
    pointer.down = false;
    const type = e.pointerType || 'mouse';
    update(e.clientX, e.clientY, type, 'up');
    // A finger is less precise than a cursor: slightly longer and looser taps count.
    // A real scroll never reaches here: the browser fires pointercancel first.
    const touchy = type !== 'mouse';
    if (downAt && e.timeStamp - downAt.t < (touchy ? 400 : 300) && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < (touchy ? 16 : 12)) {
      const tap = { x: e.clientX, y: e.clientY, pointerType: type, pad: TAP_PAD[type] ?? TAP_PAD.touch, claimed: false };
      // A handler that "owns" the tap (e.g. it hit the creature) calls claim() so the
      // click that follows does not also follow a link underneath. Scrolling is untouched.
      tap.claim = () => { tap.claimed = true; claimedTap = { x: tap.x, y: tap.y, t: e.timeStamp }; };
      em.emit('tap', tap);
    }
    downAt = null;
  });
  // Swallow only the click that belongs to a claimed tap (same spot, within 600 ms).
  listen(win, 'click', (e) => {
    if (!claimedTap) return;
    const c = claimedTap; claimedTap = null;
    if (e.timeStamp - c.t < 600 && Math.hypot(e.clientX - c.x, e.clientY - c.y) < 24) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true, passive: false });
  listen(win, 'pointercancel', () => { pointer.down = false; downAt = null; });
  listen(win, 'touchmove', (e) => {
    const t = e.touches[0];
    if (t && !ignored(e)) update(t.clientX, t.clientY, 'touch', 'move');
  });
  listen(win, 'touchend', () => { pointer.down = false; });
  listen(doc, 'mouseleave', () => { pointer.active = false; em.emit('pointer', { phase: 'leave', x: pointer.x, y: pointer.y, pointerType: 'mouse' }); });

  // ---- audio ---------------------------------------------------------------
  // Web Audio needs a user gesture (iOS especially). We create the context on
  // the first pointerdown/keydown and hand the engine a master gain node.
  const audio = { context: null, output: null, muted: startMuted, unlocked: false };
  function unlockAudio() {
    if (audio.unlocked) return;
    const AC = win.AudioContext || win.webkitAudioContext;
    if (!AC) return;
    try {
      audio.context = new AC();
      audio.output = audio.context.createGain();
      audio.output.gain.value = audio.muted ? 0 : 0.8;
      audio.output.connect(audio.context.destination);
      audio.unlocked = true;
      if (audio.context.state === 'suspended') audio.context.resume();
      em.emit('audio', { ...audio });
    } catch (err) {
      console.warn('[world] audio unavailable', err);
    }
  }
  listen(win, 'keydown', unlockAudio);
  function setMuted(m) {
    audio.muted = !!m;
    if (audio.output) audio.output.gain.setTargetAtTime(audio.muted ? 0 : 0.8, audio.context.currentTime, 0.05);
    em.emit('audio', { ...audio });
  }

  // ---- visibility / motion -------------------------------------------------
  const state = { hidden: doc.hidden, reducedMotion: false };
  listen(doc, 'visibilitychange', () => {
    state.hidden = doc.hidden;
    if (audio.context) (state.hidden ? audio.context.suspend() : audio.context.resume()).catch(() => {});
    em.emit('visibility', { hidden: state.hidden });
  });
  const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (mq) {
    state.reducedMotion = mq.matches;
    const onMq = () => { state.reducedMotion = mq.matches; em.emit('motion', { reducedMotion: state.reducedMotion }); };
    mq.addEventListener ? mq.addEventListener('change', onMq) : mq.addListener(onMq);
  }

  return {
    ...em,
    tapPad: TAP_PAD,
    viewport,
    pointer,
    audio,
    state,
    setMuted,
    unlockAudio,
    destroy() {
      listeners.forEach((off) => off());
      if (audio.context) audio.context.close().catch(() => {});
    },
  };
}

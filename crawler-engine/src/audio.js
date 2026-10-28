// Web Audio: one shared context, unlocked on the first user gesture (iOS needs
// the gesture), and a lightweight voice per crawler. Footsteps are tiny one-shot
// notes picked from the creature's seeded scale, so its gait is audible as rhythm.
// Every call is a cheap no-op until the context is actually running.

let ctx = null, master = null, noiseBuf = null, hostMuted = null;
let muted = false, volume = 0.7, installed = false, wasRunning = false;
let budgetT = 0, budgetN = 0; // global footstep cap per 40ms window
const readyListeners = new Set();

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function build() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC({ latencyHint: 'interactive' });
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4;
  comp.attack.value = 0.003; comp.release.value = 0.15;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  master.connect(comp); comp.connect(ctx.destination);
  makeNoise();
  ctx.onstatechange = () => { if (ctx.state === 'running') readyListeners.forEach((f) => f()); };
  return true;
}

function makeNoise() {
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

/**
 * Route all voices through a context the host page already owns (e.g. the
 * Folio's env.audio). The host keeps control of unlock and mute; isMuted is
 * polled so muted voices skip creating nodes at all.
 */
export function adoptAudio(context, output, isMuted = null) {
  if (!context || !output) return false;
  if (ctx === context && master === output) return true;
  ctx = context; master = output; hostMuted = isMuted;
  makeNoise();
  return true;
}

/** Create/resume the context. Must run inside a user gesture handler on iOS. */
export function unlockAudio() {
  if (typeof window === 'undefined') return false;
  if (!ctx && !build()) return false;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  // iOS: play one silent sample inside the gesture.
  const s = ctx.createBufferSource();
  s.buffer = ctx.createBuffer(1, 1, 22050);
  s.connect(ctx.destination);
  s.start(0);
  return ctx.state === 'running';
}

/** Listen for the first gesture anywhere and unlock. Idempotent. */
export function installAudioUnlock(target = typeof window !== 'undefined' ? window : null) {
  if (installed || !target) return;
  installed = true;
  const evs = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  const h = () => {
    unlockAudio();
    if (ctx && ctx.state === 'running') evs.forEach((e) => target.removeEventListener(e, h, true));
  };
  evs.forEach((e) => target.addEventListener(e, h, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { wasRunning = ctx.state === 'running'; ctx.suspend().catch(() => {}); }
    else if (wasRunning) ctx.resume().catch(() => {});
  });
}

export const audio = {
  get context() { return ctx; },
  get running() { return !!ctx && ctx.state === 'running'; },
  get muted() { return muted; },
  setMuted(m) {
    muted = !!m;
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
  },
  setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master && !muted) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  },
  onReady(fn) { readyListeners.add(fn); return () => readyListeners.delete(fn); },
};

export class Voice {
  constructor(v) {
    this.v = v;
    this.bus = null; this.pan = null; this.hum = null; this.humGain = null; this.humFilter = null;
    this.lastStep = 0;
  }
  get ready() { return !!ctx && ctx.state === 'running' && !muted && !(hostMuted && hostMuted()); }

  _ensureBus() {
    if (this.bus && this.busCtx === ctx) return;
    if (this.bus) { this.bus.disconnect(); this.hum = null; } // context was swapped (adoptAudio)
    this.busCtx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    if (ctx.createStereoPanner) {
      this.pan = ctx.createStereoPanner();
      this.bus.connect(this.pan); this.pan.connect(master);
    } else this.bus.connect(master);
  }

  /** legIndex picks the note; intensity 0..1 scales loudness. */
  footstep(legIndex, intensity) {
    if (!this.ready || intensity <= 0.02) return;
    const t = ctx.currentTime;
    if (t - this.lastStep < 0.035) return;
    if (t - budgetT > 0.04) { budgetT = t; budgetN = 0; }
    if (++budgetN > 6) return;
    this.lastStep = t;
    this._ensureBus();
    const v = this.v;
    const f = midiHz(v.root + v.notes[legIndex % v.notes.length]);
    const peak = v.stepGain * (0.35 + 0.65 * intensity);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    let src, dur;
    if (v.timbre === 'click') {
      src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f * 4; bp.Q.value = 9;
      src.connect(bp); bp.connect(g);
      dur = 0.035;
      g.gain.linearRampToValueAtTime(peak * 2.2, t + 0.002);
      src.start(t, Math.random() * 0.4, dur + 0.02);
    } else {
      src = ctx.createOscillator();
      if (v.timbre === 'pluck') {
        src.type = 'square';
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(f * 6, t); lp.frequency.exponentialRampToValueAtTime(f * 1.2, t + 0.08);
        src.connect(lp); lp.connect(g);
        dur = 0.11;
        g.gain.linearRampToValueAtTime(peak * 0.55, t + 0.003);
      } else if (v.timbre === 'wood') {
        src.type = 'triangle';
        src.frequency.setValueAtTime(f * 2, t);
        src.connect(g);
        dur = 0.04;
        g.gain.linearRampToValueAtTime(peak * 1.3, t + 0.001);
      } else { // pip
        src.type = 'sine';
        src.frequency.setValueAtTime(f * 1.5, t);
        src.frequency.exponentialRampToValueAtTime(f, t + 0.03);
        src.connect(g);
        dur = 0.09;
        g.gain.linearRampToValueAtTime(peak, t + 0.004);
      }
      src.start(t);
      src.stop(t + dur + 0.03);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.bus);
  }

  /** Called ~10x/s. speed01 drives the hum; pan is -1..1 from screen x. */
  motion(speed01, pan, awake) {
    if (!this.ready) { if (this.hum && ctx) this._releaseHum(ctx.currentTime); return; }
    const t = ctx.currentTime, v = this.v;
    this._ensureBus();
    if (this.pan) this.pan.pan.setTargetAtTime(pan, t, 0.1);
    if (!v.hum) return;
    if (awake && !this.hum) {
      this.hum = ctx.createOscillator();
      this.hum.type = v.humWave;
      this.humFilter = ctx.createBiquadFilter();
      this.humFilter.type = 'lowpass'; this.humFilter.Q.value = 6;
      this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
      this.hum.connect(this.humFilter); this.humFilter.connect(this.humGain); this.humGain.connect(this.bus);
      this.hum.frequency.value = midiHz(v.root - 12);
      this.hum.start();
    }
    if (!this.hum) return;
    const base = midiHz(v.root - 12);
    const gain = awake ? v.hum * Math.min(1, speed01 * 1.4) : 0;
    this.hum.frequency.setTargetAtTime(base * (1 + 0.35 * speed01), t, 0.15);
    this.humFilter.frequency.setTargetAtTime(base * (2 + 6 * speed01), t, 0.15);
    this.humGain.gain.setTargetAtTime(gain, t, 0.12);
    if (!awake) this._releaseHum(t); // stop the oscillator after it fades
  }

  _releaseHum(t) {
    const h = this.hum; this.hum = null;
    if (this.humGain) this.humGain.gain.setTargetAtTime(0, t, 0.08);
    try { h.stop(t + 0.6); } catch (e) { /* already stopped */ }
  }

  /** Short gesture sounds: 'wake' glides up, 'poke' drops, 'sleep' sighs down. */
  chirp(kind) {
    if (!this.ready) return;
    this._ensureBus();
    const t = ctx.currentTime, v = this.v;
    const f = midiHz(v.root + 12);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    const [a, b, d] = kind === 'wake' ? [0.7, 1.25, 0.18] : kind === 'poke' ? [1.6, 0.8, 0.09] : [1, 0.6, 0.35];
    o.frequency.setValueAtTime(f * a, t);
    o.frequency.exponentialRampToValueAtTime(f * b, t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v.stepGain * 0.9, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
    o.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + d + 0.08);
  }

  dispose() {
    try { if (this.hum) this.hum.stop(); } catch (e) { /* noop */ }
    if (this.bus) this.bus.disconnect();
    this.hum = this.bus = this.pan = null;
  }
}

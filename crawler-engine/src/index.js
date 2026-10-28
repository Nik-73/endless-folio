// Public entry point. See ../API.md.
//
//   import { createCrawler } from './crawler-engine/src/index.js';
//   const c = createCrawler({ seed: 42, canvas, world });
//   c.start();
import { Crawler } from './crawler.js';
import { getStage } from './stage.js';
import { adaptWorld, isFolioWorld } from './world-adapter.js';
import { installAudioUnlock, adoptAudio, audio } from './audio.js';
import { generateTraits, toAttributes, TRAITS_VERSION } from './traits.js';

export { generateTraits, toAttributes, TRAITS_VERSION, audio };
export { createStubWorld } from './stub-world.js';

export const ENGINE_VERSION = '0.2.0';

/**
 * Create a creature on a canvas. Several creatures may share one canvas.
 * Returns a handle; call start() to begin animating.
 */
export function createCrawler({
  seed, canvas, world = null,
  x, y, heading, scale = 1,
  startAwake = true, sound = true, debug = false,
  pointerTarget = null, tapToSteer = true, bounds = null, insets = null,
} = {}) {
  if (seed === undefined || seed === null) throw new Error('createCrawler: seed is required');
  if (!canvas || !canvas.getContext) throw new Error('createCrawler: canvas is required');

  const engineWorld = adaptWorld(world);
  const stage = getStage(canvas, { world, pointerTarget, tapToSteer });
  const crawler = new Crawler({
    seed, world: engineWorld, stage, bounds, insets,
    x, y, heading, scale, startAwake, sound, debug,
  });
  stage.add(crawler);

  const offs = [];
  if (sound) offs.push(...connectAudio(world));
  if (engineWorld?.footstep) offs.push(crawler.on('footstep', (e) => { if (!crawler.asleep) engineWorld.footstep(e.x, e.y, crawler); }));

  const handle = {
    seed: crawler.seed,
    traits: crawler.traits,
    attributes: toAttributes(crawler.traits),
    crawler,
    stage,
    start() { stage.start(); return handle; },
    stop() { stage.stop(); return handle; },
    destroy() { offs.forEach((off) => off()); crawler.destroy(); },
    wake: (reason) => crawler.wake(reason),
    sleep: (reason) => crawler.sleep(reason),
    poke: (px, py) => crawler.poke(px, py),
    setTarget: (tx, ty, opts) => crawler.setTarget(tx, ty, opts),
    clearTarget: () => crawler.clearTarget(),
    place: (px, py, h) => crawler.place(px, py, h),
    /** Keep clear of host UI, in canvas CSS px: { top, right, bottom, left }. */
    setInsets(n) { Object.assign(crawler.insets, n); },
    on: (name, fn) => crawler.on(name, fn),
    setDebug(on) { crawler.debug = !!on; },
    get position() { return { x: crawler.x, y: crawler.y, heading: crawler.heading }; },
    get state() { return crawler.state; },
    get mode() { return crawler.state === 'asleep' ? 'asleep' : crawler.mode; },
    get stats() { return stage.stats; },
  };
  return handle;
}

// Use the host's audio bus when there is one (Folio env.audio), otherwise
// unlock our own context on the first user gesture.
function connectAudio(world) {
  const A = world?.audio;
  if (!A || !isFolioWorld(world) && !('context' in A)) { installAudioUnlock(); return []; }
  const tryAdopt = () => { if (A.context && A.output) adoptAudio(A.context, A.output, () => !!A.muted); };
  tryAdopt();
  return typeof world.on === 'function' ? [world.on('audio', tryAdopt)] : [];
}

export default createCrawler;

import { makeRng, parseSeed, hashString } from './prng.js';
import { CORPUS } from './corpus.js';
import { createPredictor } from './predictor.js';
import { createArticleBuilder } from './article.js';
import { createEnv } from './env.js';
import { createWorld } from './world.js';
import { createCrawler as createStubCrawler } from './stub-crawler.js';

// Where to look for the real engine. ?engine=stub forces the stub;
// ?engine=<url> loads a specific module.
const ENGINE_CANDIDATES = ['../crawler-engine/src/index.js', '../crawler-engine/index.js'];
const MAX_SECTIONS = 400; // Safety valve on DOM size for very long sessions.

const params = new URLSearchParams(location.search);
let seed = parseSeed(params.get('seed'));
if (seed == null) {
  seed = (Math.random() * 2 ** 32) >>> 0;
  params.set('seed', String(seed));
  history.replaceState(null, '', '?' + params.toString() + location.hash);
}
const pageSlug = params.get('page');
const pageRng = makeRng(pageSlug ? hashString(pageSlug) ^ seed : seed);

const predictor = createPredictor(CORPUS, { rng: pageRng.fork('predictor') });
const builder = createArticleBuilder({ rng: pageRng.fork('article'), predictor, creatureSeed: params.get('seed'), pageSlug });
const { el: article, continuation, title } = builder.build();
const pageEl = document.getElementById('page');
pageEl.append(article);
document.title = `${title} — The Endless Folio`;
document.getElementById('seed-label').textContent = `specimen ${seed}`;

const canvas = document.getElementById('crawler-canvas');
const env = createEnv({ canvas, startMuted: true });
const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#f2ecdf';
const world = createWorld({ root: pageEl, env, predictor, rng: pageRng.fork('world'), paperColor: paper });

// ---- endless page ----------------------------------------------------------
const sentinel = document.getElementById('sentinel');
let sections = 0;
let writing = false;
function writeMore() {
  if (writing || sections >= MAX_SECTIONS) return;
  writing = true;
  const sec = builder.section();
  sec.classList.add('fresh');
  continuation.append(sec);
  sections++;
  world.addBlocks([...sec.querySelectorAll('[data-block]')]);
  writing = false;
  // If the sentinel is still within reach (short sections, tall screens), keep going next frame.
  requestAnimationFrame(() => {
    if (sentinel.getBoundingClientRect().top < innerHeight * 2.5) writeMore();
  });
}
new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) writeMore();
}, { rootMargin: '0px 0px 150% 0px' }).observe(sentinel);

// ---- chrome ------------------------------------------------------------------
const soundBtn = document.getElementById('sound-toggle');
function renderSound() {
  const label = env.audio.muted ? 'Sound off' : 'Sound on';
  soundBtn.setAttribute('aria-pressed', String(!env.audio.muted));
  soundBtn.setAttribute('aria-label', label);
  soundBtn.querySelector('.lbl').textContent = label;
}
soundBtn.addEventListener('click', () => { env.unlockAudio(); env.setMuted(!env.audio.muted); renderSound(); });
renderSound();
document.getElementById('new-specimen').addEventListener('click', () => {
  const q = new URLSearchParams();
  q.set('seed', String((Math.random() * 2 ** 32) >>> 0));
  location.search = q.toString();
});
const bm = document.getElementById('bookmarklet-link');
if (bm) bm.href = `bookmarklet/?seed=${encodeURIComponent(params.get('seed'))}`;

// ---- creature -------------------------------------------------------------
async function loadEngine() {
  const choice = params.get('engine');
  if (choice === 'stub') return { createCrawler: createStubCrawler, source: 'stub' };
  const urls = choice ? [choice] : ENGINE_CANDIDATES;
  for (const url of urls) {
    try {
      const mod = await import(new URL(url, location.href).href);
      const fn = mod.createCrawler || mod.default?.createCrawler || mod.default;
      if (typeof fn === 'function') return { createCrawler: fn, source: url };
    } catch { /* not there yet */ }
  }
  return { createCrawler: createStubCrawler, source: 'stub' };
}

const { createCrawler, source } = await loadEngine();
document.documentElement.dataset.engine = source === 'stub' ? 'stub' : 'engine';
const crawler = await createCrawler({ seed, canvas, world, startAwake: true }); // alive on arrival; sleep comes later, by temperament
crawler?.start?.();

// ---- phone controls: hide while reading down ---------------------------------
// Back on scroll up, on any tap, or after a short pause. They also step aside
// whenever the creature walks underneath, so they never block poking it.
const controls = document.getElementById('controls');
const phone = matchMedia('(max-width: 600px)');
let idleTimer = 0;
function showControls() { controls.classList.remove('is-hidden'); }
env.on('scroll', ({ dy }) => {
  if (!phone.matches) return;
  clearTimeout(idleTimer);
  if (dy > 2 && scrollY > 80) controls.classList.add('is-hidden');
  else if (dy < -2) showControls();
  idleTimer = setTimeout(showControls, 1500);
});
env.on('tap', showControls);
phone.addEventListener?.('change', showControls);
setInterval(() => {
  if (!phone.matches || env.state.hidden || !crawler?.position) return;
  const { x, y } = crawler.position, r = controls.getBoundingClientRect(), pad = 36;
  controls.classList.toggle('is-yielding', x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad);
}, 250);

// Debug / test handle. Not part of the engine contract.
window.__folio = { world, crawler, predictor, seed, engine: source, writeMore };

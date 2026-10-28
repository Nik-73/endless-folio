// The creature's job loop. A crawler is not decoration: at every moment it has
// one visible job, and you can see what it is, where it is going and what it
// brought back.
//
//   aim   a sight-line and bracket lock onto the target before it moves
//   go    it sprints there and plants itself on the target
//   take  it tears a link out of the page, bites words out of their lines, or
//         ploughs through a paragraph and leaves the words knocked askew
//   haul  what it took dangles from its jaws on silk; at the column edge it
//         flings the haul into its ledger
//   write the ledger keeps the links (still clickable), the quotes and a line
//         it writes from the words it ate
//
// Tap a word and it drops what it is doing to fetch that sentence for you.
// Tap the creature and it startles as before. Everything it changes on the page
// heals after a while, so the page stays readable.
//
// Shared by the Folio (src/main.js) and other people's pages (host-page.js).

const NS = 'http://www.w3.org/2000/svg';
const STOP = new Set('a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its may more most much not of on once one or our out over she so some such than that the their them then there these they this those though to too under upon very was we were what when where which while who whom why will with would you your also only other same been being about after again against all any because before below between both down during each few further here just like made make many must never nothing now off often own said say says should since still through until whether within without yet'.split(' '));

const CSS = `
.cw-work { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.cw-work svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.cw-work .sight { stroke: var(--cw-ink); stroke-width: 1; stroke-dasharray: 3 4; fill: none; opacity: .7; }
.cw-work .bracket { stroke: var(--cw-hot); stroke-width: 2; fill: none; }
.cw-work .silk { stroke: var(--cw-ink); stroke-width: 1; fill: none; opacity: .8; }
.cw-tag { position: fixed; left: 0; top: 0; white-space: nowrap; pointer-events: none; will-change: transform;
  font: 600 12px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .02em;
  padding: 2px 6px; background: var(--cw-paper); color: var(--cw-ink); border: 1px solid var(--cw-ink); box-shadow: 2px 2px 0 var(--cw-ink); }
.cw-tag.is-link { color: var(--cw-hot); border-color: var(--cw-hot); box-shadow: 2px 2px 0 var(--cw-hot); }
.cw-tag.is-quote { font-weight: 500; font-style: italic; }
.cw-torn { color: transparent !important; text-decoration: none !important; border-radius: 2px;
  background: repeating-linear-gradient(-45deg, var(--cw-hot) 0 1.5px, transparent 1.5px 5px) !important; }
.cw-torn * { color: transparent !important; }
.cw-bitten { color: transparent !important; outline: 1px dashed var(--cw-hot); outline-offset: -1px; border-radius: 2px; }
.cw-knocked { transition: transform .35s cubic-bezier(.2,.8,.2,1), opacity .35s; }
.cw-ledger { position: fixed; pointer-events: auto; box-sizing: border-box; color: var(--cw-ink);
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--cw-paper);
  border: 1px solid var(--cw-ink); box-shadow: 3px 3px 0 var(--cw-ink); }
.cw-ledger * { box-sizing: border-box; }
.cw-ledger header { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid var(--cw-ink); cursor: pointer; user-select: none; }
.cw-ledger header b { font-weight: 700; letter-spacing: .06em; text-transform: uppercase; font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-ledger header .n { font-variant-numeric: tabular-nums; }
.cw-ledger .now { padding: 6px 10px; border-bottom: 1px dashed var(--cw-ink); display: flex; gap: 6px; align-items: baseline; }
.cw-ledger .now i { font-style: normal; color: var(--cw-hot); }
.cw-ledger .now span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-ledger .dot { width: 7px; height: 7px; background: var(--cw-hot); flex: none; animation: cw-blink 1s steps(2) infinite; }
@keyframes cw-blink { 50% { opacity: .15; } }
.cw-ledger .body { max-height: min(56vh, 520px); overflow: auto; }
.cw-ledger section { padding: 6px 10px 8px; border-bottom: 1px dashed color-mix(in srgb, var(--cw-ink) 35%, transparent); }
.cw-ledger section:last-child { border-bottom: 0; }
.cw-ledger h4 { margin: 0 0 4px; font: inherit; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; opacity: .6; }
.cw-ledger ol { margin: 0; padding: 0; list-style: none; }
.cw-ledger li { padding: 2px 0; animation: cw-land .6s ease-out; }
.cw-ledger li a { color: var(--cw-hot); text-decoration: none; border-bottom: 1px solid currentColor; overflow-wrap: anywhere; }
.cw-ledger li q { font-family: Georgia, serif; font-size: 13px; quotes: "“" "”"; }
.cw-ledger li .eaten { opacity: .65; }
.cw-ledger li .wrote { display: block; font-family: Georgia, serif; font-size: 13px; font-style: italic; }
.cw-ledger .empty { opacity: .5; }
.cw-ledger footer { display: flex; gap: 6px; padding: 6px 10px; border-top: 1px solid var(--cw-ink); }
.cw-ledger footer button { font: inherit; font-size: 11px; padding: 3px 8px; background: none; color: inherit; border: 1px solid var(--cw-ink); cursor: pointer; }
.cw-ledger footer button:hover { background: var(--cw-ink); color: var(--cw-paper); }
.cw-ledger.is-closed .body, .cw-ledger.is-closed footer { display: none; }
.cw-ledger.is-closed .now { border-bottom: 0; max-width: 64vw; }
.cw-ledger.is-chip { max-width: calc(100vw - 20px); }
.cw-ledger.is-chip.is-closed header { padding: 6px 10px; }
.cw-ledger.is-chip.is-closed header b { max-width: 52vw; }
@keyframes cw-land { 0% { background: color-mix(in srgb, var(--cw-hot) 30%, transparent); } 100% { background: transparent; } }
@media (prefers-reduced-motion: reduce) { .cw-knocked { transition: none; } .cw-ledger .dot { animation: none; } }
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CANCEL = Symbol('cancel');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * @param {object} o
 * @param {object} o.crawler   engine handle (setTarget/mouth/arrived/on/position)
 * @param {object} o.world     world API (queryNear, bounds, touch, reflow, on)
 * @param {object} [o.predictor] text predictor, for the line it writes
 * @param {string} [o.name]    shown on the ledger ("Nimisha's crawler")
 * @param {number} [o.z]       z-index of the work overlay; the ledger sits one above
 * @param {object} [o.colors]  { ink, paper, hot }
 * @param {string} [o.uiClass] class put on everything we add (host pages tear down by it)
 * @param {function} [o.avoid] () => [DOMRect] host UI the ledger and creature keep clear of
 */
export function createWorker({ crawler, world, predictor = null, name = 'Crawler', z = 45, colors = {}, uiClass = 'cw-work-ui', doc = document, avoid = () => [] }) {
  const win = doc.defaultView;
  const added = [];
  const ink = colors.ink || '#1d1915', paper = colors.paper || '#f6f0e3', hot = colors.hot || '#c2410c';

  const style = doc.createElement('style');
  style.className = uiClass;
  style.dataset.cwUi = '';
  // Page marks (torn links, bitten words) live in the host page, so the colours go on :root too.
  style.textContent = `:root { --cw-ink: ${ink}; --cw-paper: ${paper}; --cw-hot: ${hot}; }\n` + CSS;
  doc.head.append(style);
  added.push(style);

  // ---- overlay: sight-line, bracket, silk -----------------------------------
  const layer = doc.createElement('div');
  layer.className = `cw-work ${uiClass}`;
  layer.dataset.cwUi = '';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.zIndex = String(z);
  setVars(layer);
  const svg = doc.createElementNS(NS, 'svg');
  const sight = doc.createElementNS(NS, 'path'); sight.setAttribute('class', 'sight');
  const bracket = doc.createElementNS(NS, 'path'); bracket.setAttribute('class', 'bracket');
  const silk = doc.createElementNS(NS, 'path'); silk.setAttribute('class', 'silk');
  svg.append(sight, bracket, silk);
  layer.append(svg);
  doc.body.append(layer);
  added.push(layer);

  function setVars(el) {
    el.style.setProperty('--cw-ink', ink);
    el.style.setProperty('--cw-paper', paper);
    el.style.setProperty('--cw-hot', hot);
  }

  // ---- ledger -------------------------------------------------------------
  const ledger = doc.createElement('aside');
  ledger.className = `cw-ledger ${uiClass}`;
  ledger.dataset.cwUi = '';
  ledger.dataset.cwIgnore = '';
  ledger.style.zIndex = String(z + 1); // under the creature, so it can stand on its ledger
  ledger.setAttribute('aria-label', `${name}'s ledger`);
  setVars(ledger);
  ledger.innerHTML = `
    <header role="button" tabindex="0" aria-expanded="true"><b></b><span class="n">0</span></header>
    <div class="now"><span class="dot"></span><span><i>now</i> <em class="what">looking around</em></span></div>
    <div class="body">
      <section class="s-links"><h4>Links it tore out</h4><ol></ol><div class="empty">none yet</div></section>
      <section class="s-quotes"><h4>Sentences you sent it for</h4><ol></ol><div class="empty">tap any word on the page</div></section>
      <section class="s-lines"><h4>What it wrote from what it ate</h4><ol></ol><div class="empty">nothing yet</div></section>
    </div>
    <footer><button type="button" data-do="copy">Copy ledger</button><button type="button" data-do="mend">Mend page</button><button type="button" data-do="pause">Pause</button></footer>`;
  ledger.querySelector('header b').textContent = `${name}'s ledger`;
  doc.body.append(ledger);
  added.push(ledger);
  const $ = (s) => ledger.querySelector(s);
  const whatEl = $('.what');
  const counter = $('.n');
  let total = 0;
  const entries = { links: [], quotes: [], lines: [] };

  const head = $('header');
  const toggle = () => { const closed = ledger.classList.toggle('is-closed'); head.setAttribute('aria-expanded', String(!closed)); place(); };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  ledger.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-do]');
    if (!b) return;
    if (b.dataset.do === 'copy') copyLedger(b);
    if (b.dataset.do === 'mend') { mendAll(); }
    if (b.dataset.do === 'pause') { paused = !paused; b.textContent = paused ? 'Resume' : 'Pause'; if (paused) { cancel(); status('paused'); } else status('looking around'); }
  });

  // Where the ledger lives: the free margin beside the column, or a chip at the top.
  let dock = 'side';
  function place() {
    const B = world.bounds();
    const vw = win.innerWidth;
    const right = vw - (B.x + B.w);
    if (right >= 250) {
      dock = 'side';
      ledger.classList.remove('is-chip');
      Object.assign(ledger.style, { left: '', right: '18px', top: '72px', bottom: '', width: Math.min(320, right - 36) + 'px' });
    } else {
      dock = 'chip';
      if (!ledger.classList.contains('is-chip')) { ledger.classList.add('is-chip', 'is-closed'); head.setAttribute('aria-expanded', 'false'); }
      Object.assign(ledger.style, { left: '', right: '10px', top: 'max(10px, env(safe-area-inset-top))', bottom: '', width: ledger.classList.contains('is-closed') ? 'auto' : 'min(340px, calc(100vw - 20px))' });
    }
  }
  place();
  win.addEventListener('resize', place);

  function status(text) { whatEl.textContent = text; }
  function bump() { total++; counter.textContent = String(total); }
  function addEntry(kind, li) {
    const sec = $('.s-' + kind);
    sec.querySelector('.empty')?.remove();
    sec.querySelector('ol').prepend(li);
    const ol = sec.querySelector('ol');
    while (ol.children.length > 30) ol.lastElementChild.remove();
    bump();
  }

  function copyLedger(btn) {
    const L = [`${name}'s ledger — ${doc.title}`, location.href, ''];
    if (entries.links.length) { L.push('Links:'); for (const e of entries.links) L.push(`- ${e.text} — ${e.href}`); L.push(''); }
    if (entries.quotes.length) { L.push('Quotes:'); for (const q of entries.quotes) L.push(`- “${q}”`); L.push(''); }
    if (entries.lines.length) { L.push('Written:'); for (const l of entries.lines) L.push(`- ${l.words.join(' · ')} → ${l.text}`); }
    const text = L.join('\n');
    (win.navigator.clipboard?.writeText(text) || Promise.reject()).catch(() => {
      const ta = doc.createElement('textarea'); ta.value = text; doc.body.append(ta); ta.select(); doc.execCommand('copy'); ta.remove();
    }).finally(() => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy ledger'; }, 1500); });
  }

  // ---- page marks (all reversible) -------------------------------------------
  const marks = new Set(); // elements we gave cw-torn / cw-bitten
  const knocked = new Set(); // words we pushed
  // Bites and tears heal after a while so the page stays readable.
  function markEl(el, cls) {
    const m = [el, cls];
    el.classList.add(cls); marks.add(m);
    setTimeout(() => { if (marks.delete(m)) el.classList.remove(cls); }, cls === 'cw-torn' ? 90000 : 45000);
  }
  function mendAll() {
    for (const [el, cls] of marks) el.classList.remove(cls);
    marks.clear();
    unknock([...knocked]);
  }
  function unknock(list) {
    for (const w of list) { w.style.transform = ''; w.style.opacity = ''; knocked.delete(w); setTimeout(() => w.classList.remove('cw-knocked'), 400); }
    setTimeout(() => { if (!destroyed) world.reflow?.(); }, 450);
  }

  // ---- carried things --------------------------------------------------------
  // A chain: mouth -> tag0 -> tag1 ... each hanging a little behind the last.
  let carried = [];
  function makeTag(text, kind, from) {
    const t = doc.createElement('div');
    t.className = `cw-tag ${uiClass}` + (kind ? ' is-' + kind : '');
    t.dataset.cwUi = '';
    setVars(t);
    t.style.zIndex = String(z + 2);
    t.textContent = text;
    doc.body.append(t);
    added.push(t);
    const r = t.getBoundingClientRect();
    const tag = { el: t, w: r.width, h: r.height, x: from.x - r.width / 2, y: from.y - r.height / 2, rot: (Math.random() - 0.5) * 16, pop: 1.25 };
    drawTag(tag);
    return tag;
  }
  function drawTag(t) { t.el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) rotate(${t.rot.toFixed(1)}deg) scale(${t.pop.toFixed(3)})`; }
  function dropCarried() { for (const t of carried) { t.el.style.transition = 'opacity .4s'; t.el.style.opacity = '0'; setTimeout(() => t.el.remove(), 450); } carried = []; }

  // ---- targeting visuals ------------------------------------------------------
  let aimEl = null; // element being aimed at
  let aimK = 0; // bracket snap-in 0..1
  function aimAt(el) { aimEl = el; aimK = 0; }
  function clearAim() { aimEl = null; sight.setAttribute('d', ''); bracket.setAttribute('d', ''); }

  // ---- steering -----------------------------------------------------------------
  let follow = null; // { el, opts } keeps the goal glued to an element through scrolls
  // Speeds are absolute (about k × 170 px/s) so slow temperaments still get the job done.
  const fast = (k) => Math.max(k, (k * 200) / (crawler.crawler?.maxSpeed || 200));
  function goToPoint(x, y, opts = {}) {
    follow = null;
    crawler.setTarget(x, y, { duration: 30, hold: true, free: true, ...opts, speed: fast(opts.speed || 1.6) });
  }
  function goToEl(el, opts = {}) {
    const c = centre(el);
    crawler.setTarget(c.x, c.y, { duration: 30, hold: true, free: true, look: c, ...opts, speed: fast(opts.speed || 2) });
    follow = { el };
  }
  function centre(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; }
  function holdHere(look) {
    const p = crawler.position;
    follow = null;
    crawler.setTarget(p.x, p.y, { duration: 30, hold: true, free: true, look });
  }

  // ---- frame loop ---------------------------------------------------------------
  let raf = 0, last = performance.now();
  function frame(now) {
    raf = win.requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const m = crawler.mouth;
    // keep the goal on a moving element (scroll, reflow)
    const g = crawler.crawler?.goal;
    if (follow && g && follow.el.isConnected) {
      const c = centre(follow.el);
      g.x = c.x; g.y = c.y; if (g.look) g.look = { x: c.x, y: c.y };
    }
    // sight-line + bracket
    if (aimEl && aimEl.isConnected) {
      aimK = Math.min(1, aimK + dt * 4);
      const r = aimEl.getBoundingClientRect();
      const pad = 4 + (1 - aimK) * 18, L = Math.min(8, r.width / 2 + pad);
      const x0 = r.left - pad, y0 = r.top - pad, x1 = r.right + pad, y1 = r.bottom + pad;
      bracket.setAttribute('d', `M${x0} ${y0 + L}V${y0}H${x0 + L}M${x1 - L} ${y0}H${x1}V${y0 + L}M${x1} ${y1 - L}V${y1}H${x1 - L}M${x0 + L} ${y1}H${x0}V${y1 - L}`);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const d = Math.hypot(cx - m.x, cy - m.y);
      sight.setAttribute('d', d > 30 ? `M${m.x.toFixed(1)} ${m.y.toFixed(1)}L${cx.toFixed(1)} ${cy.toFixed(1)}` : '');
    }
    // the haul swings behind the mouth on silk
    if (carried.length) {
      let px = m.x, py = m.y, path = `M${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
      const hd = crawler.position.heading;
      carried.forEach((t, i) => {
        const gap = 14 + t.h;
        const tx = px - Math.cos(hd) * gap - t.w / 2, ty = py - Math.sin(hd) * gap * 0.6 + 6 - t.h / 2;
        const k = Math.min(1, dt * (9 - i));
        t.x += (tx - t.x) * k; t.y += (ty - t.y) * k + Math.sin(now / 260 + i) * 0.15;
        t.rot += ((Math.sin(now / 400 + i * 1.7) * 6) - t.rot) * Math.min(1, dt * 3);
        t.pop += (1 - t.pop) * Math.min(1, dt * 6);
        drawTag(t);
        const ax = t.x + t.w / 2, ay = t.y;
        path += `L${ax.toFixed(1)} ${ay.toFixed(1)}`;
        px = ax; py = t.y + t.h;
        if (i < carried.length - 1) path += `M${ax.toFixed(1)} ${(t.y + t.h).toFixed(1)}`;
      });
      silk.setAttribute('d', path);
    } else silk.setAttribute('d', '');
    // ploughing: knock words aside as the head passes
    if (plough) ploughStep();
  }
  raf = win.requestAnimationFrame(frame);

  // ---- waiting helpers ------------------------------------------------------------
  let token = 0; // bumps on cancel
  function check(tok) { if (tok !== token || destroyed) throw CANCEL; }
  async function wait(ms, tok) { const end = performance.now() + ms; while (performance.now() < end) { await sleep(Math.min(60, end - performance.now())); check(tok); } }
  async function until(fn, ms, tok) {
    const t0 = performance.now();
    while (!fn()) { await sleep(60); check(tok); if (performance.now() - t0 > ms) return false; }
    return true;
  }
  const arrived = () => crawler.arrived;
  function cancel() { token++; dropCarried(); clearAim(); plough = null; follow = null; }

  // ---- what is on screen ------------------------------------------------------------
  function visibleItems(kinds) {
    const B = world.bounds();
    if (B.w < 40 || B.h < 40) return [];
    const L = ledger.getBoundingClientRect();
    const blocked = [L, ...avoid()];
    const items = world.queryNear(B.x + B.w / 2, B.y + B.h / 2, Math.hypot(B.w, B.h) / 2 + 10, { kinds, limit: 600 });
    return items.filter((it) => {
      if (it.y < B.y + 8 || it.y + it.h > B.y + B.h - 8 || it.x < B.x || it.x + it.w > B.x + B.w) return false;
      if (blocked.some((r) => r && it.cx > r.left - 10 && it.cx < r.right + 10 && it.cy > r.top - 10 && it.cy < r.bottom + 10)) return false;
      const el = it.el;
      return el && !el.classList.contains('cw-torn') && !el.classList.contains('cw-bitten') && !el.closest('.cw-torn') && !knocked.has(el);
    });
  }
  const meaty = (t) => { const w = clean(t).replace(/^[“"‘(]+|[”"’).,;:!?]+$/g, ''); return /^[a-zà-ÿ][a-zà-ÿ'-]{4,}$/i.test(w) && !STOP.has(w.toLowerCase()); };
  // Running prose first (paragraphs, list items), infobox and table scraps last.
  const prose = (it) => !!it.el.closest('p, li, blockquote, dd') && !it.el.closest('table, figure, .infobox, nav, aside');
  const preferProse = (list) => { const p = list.filter(prose); return p.length >= 3 ? p : list; };

  // ---- jobs ---------------------------------------------------------------------------
  let lastJob = '';
  async function harvestLink(tok, link) {
    const text = clean(link.text);
    status(`going for the link “${clip(text, 28)}”`);
    aimAt(link.el);
    holdHere(centre(link.el));
    await wait(320, tok);
    goToEl(link.el);
    await until(arrived, 9000, tok);
    status(`tearing out “${clip(text, 28)}”`);
    clearAim();
    crawler.crawler?.voice?.chirp('poke');
    const c = centre(link.el);
    world.touch?.(link.id, 1.5);
    markEl(link.el, 'cw-torn');
    carried.push(makeTag(clip(text, 34), 'link', c));
    await wait(300, tok);
    await haul(tok, () => {
      const href = link.href || link.el.getAttribute('href') || '#';
      const abs = (() => { try { return new URL(href, location.href).href; } catch { return href; } })();
      entries.links.unshift({ text, href: abs });
      const li = doc.createElement('li');
      const a = doc.createElement('a'); a.href = abs; a.textContent = clip(text, 60); a.title = abs;
      li.append(a);
      addEntry('links', li);
    }, `filing “${clip(text, 24)}”`);
  }

  async function splice(tok) {
    const words = preferProse(visibleItems(['word']).filter((w) => meaty(w.text)));
    if (words.length < 3) return false;
    // nearest meaty word first, then two more from other lines nearby
    const p = crawler.position;
    words.sort((a, b) => Math.hypot(a.cx - p.x, a.cy - p.y) - Math.hypot(b.cx - p.x, b.cy - p.y));
    const pick = [words[Math.floor(Math.random() * Math.min(4, words.length))]];
    for (const w of words) {
      if (pick.length >= 3) break;
      if (pick.some((q) => Math.abs(q.cy - w.cy) < 6 || q.text.toLowerCase() === w.text.toLowerCase())) continue;
      if (Math.hypot(w.cx - pick[pick.length - 1].cx, w.cy - pick[pick.length - 1].cy) > 360) continue;
      if (Math.random() < 0.45) pick.push(w);
    }
    if (pick.length < 2) return false;
    const eaten = [];
    for (const w of pick) {
      const word = clean(w.text).replace(/[.,;:!?”“"()]+$|^[“"(]+/g, '');
      status(`eating “${word}” (${eaten.length + 1} of ${pick.length})`);
      aimAt(w.el);
      holdHere(centre(w.el));
      await wait(260, tok);
      goToEl(w.el);
      await until(arrived, 8000, tok);
      clearAim();
      crawler.crawler?.voice?.chirp('poke');
      world.touch?.(w.id, 2);
      markEl(w.el, 'cw-bitten');
      carried.push(makeTag(word, '', centre(w.el)));
      eaten.push(word);
      await wait(200, tok);
    }
    await haul(tok, () => {
      const text = writeLine(eaten);
      entries.lines.unshift({ words: eaten, text });
      const li = doc.createElement('li');
      const s = doc.createElement('span'); s.className = 'eaten'; s.textContent = eaten.join(' · ') + ' →';
      const wr = doc.createElement('span'); wr.className = 'wrote';
      li.append(s, wr);
      addEntry('lines', li);
      typeOut(wr, text);
    }, `writing with “${eaten.join('”, “')}”`);
    return true;
  }

  function writeLine(eaten) {
    let line = '';
    try { line = predictor?.sentence?.(eaten[0]) || ''; } catch { line = ''; }
    const has = (w) => line.toLowerCase().includes(w.toLowerCase());
    if (!line || !eaten.some(has)) {
      const [a, b, c] = eaten;
      const forms = [
        `${cap(a)} is where the ${b} keeps its ${c || 'place'}.`,
        `No ${a} without ${b}${c ? `, and no ${b} without ${c}` : ''}.`,
        `Read ${a} as ${b}${c ? ` and you arrive at ${c}` : ''}.`,
        `The ${a} came first; the ${b} followed${c ? `; the ${c} is still arriving` : ''}.`,
      ];
      line = forms[Math.floor(Math.random() * forms.length)];
    }
    return line;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function typeOut(el, text) {
    let i = 0;
    const step = () => { if (!el.isConnected) return; el.textContent = text.slice(0, ++i); if (i < text.length) setTimeout(step, 28); };
    step();
  }

  // Plough: walk diagonally through a paragraph, knocking each word the head passes.
  let plough = null;
  function ploughStep() {
    const m = crawler.mouth, hd = crawler.position.heading;
    const R = Math.max(20, (crawler.length || 60) * 0.28);
    for (const w of plough.words) {
      if (knocked.has(w)) continue;
      const r = w.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(cx - m.x, cy - m.y);
      if (d > R) continue;
      // shove sideways off the path, a little forward
      const side = (Math.sin(hd) * (cx - m.x) - Math.cos(hd) * (cy - m.y)) < 0 ? 1 : -1;
      const push = 10 + Math.random() * 18;
      const dx = -Math.sin(hd) * side * push + Math.cos(hd) * 6, dy = Math.cos(hd) * side * push + Math.sin(hd) * 6;
      w.classList.add('cw-knocked');
      w.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${((Math.random() - 0.5) * 40).toFixed(1)}deg)`;
      w.style.opacity = String(0.55 + Math.random() * 0.35);
      knocked.add(w);
      plough.hit.push(w);
    }
  }

  async function ploughThrough(tok) {
    const words = visibleItems(['word']).filter(prose);
    const byBlock = new Map();
    for (const w of words) { if (!byBlock.has(w.blockId)) byBlock.set(w.blockId, []); byBlock.get(w.blockId).push(w); }
    const blocks = [...byBlock.values()].filter((l) => l.length >= 18 && !l[0].heading);
    if (!blocks.length) return false;
    // only the part on screen, at most ~8 lines, so it breaks a patch, not the page
    const p0 = crawler.position;
    const near = (l) => Math.min(...l.map((w) => Math.hypot(w.cx - p0.x, w.cy - p0.y)));
    blocks.sort((a, b2) => near(a) - near(b2));
    let ws = blocks[Math.floor(Math.random() * Math.min(2, blocks.length))];
    const top = Math.min(...ws.map((w) => w.y));
    ws = ws.filter((w) => w.y < top + 190).sort((a, b2) => (Math.abs(a.y - b2.y) < 4 ? a.x - b2.x : a.y - b2.y));
    const els = ws.map((w) => w.el);
    const x0 = Math.min(...ws.map((w) => w.x)), x1 = Math.max(...ws.map((w) => w.x + w.w));
    const y0 = Math.min(...ws.map((w) => w.y)), y1 = Math.max(...ws.map((w) => w.y + w.h));
    const fromLeft = Math.random() < 0.5;
    const first = clip(tidy(ws.slice(0, 5).map((w) => w.text).join(' ')), 30);
    status(`breaking up “${first}”`);
    const blockEl = els[0].closest('[data-block]') || els[0].parentElement;
    aimAt(blockEl);
    goToPoint(fromLeft ? x0 - 6 : x1 + 6, y0 + 4, { speed: 1.4, look: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } });
    await until(arrived, 8000, tok);
    clearAim();
    crawler.crawler?.voice?.chirp('wake');
    plough = { words: els, hit: [] };
    // zig-zag down through the paragraph
    const rows = Math.max(1, Math.min(2, Math.round((y1 - y0) / 70)));
    for (let i = 1; i <= rows; i++) {
      const y = y0 + ((y1 - y0) * i) / rows;
      const x = (i % 2 === 1) === fromLeft ? x1 + 4 : x0 - 4;
      goToPoint(x, y, { speed: 1.15 });
      await until(arrived, 7000, tok);
    }
    const hit = plough.hit;
    plough = null;
    for (const w of hit.slice(0, 6)) world.touch?.(w.dataset.cwId || '', 1);
    status(`broke ${hit.length} words loose`);
    setTimeout(() => { if (!destroyed) unknock(hit.filter((w) => knocked.has(w))); }, 16000);
    await wait(700, tok);
    return true;
  }

  // Fetch: you tapped a word; bring back its sentence.
  async function fetchSentence(tok, item) {
    const sentence = sentenceAround(item.el);
    status(`fetching the sentence with “${clean(item.text)}”`);
    aimAt(item.el);
    goToEl(item.el, { speed: 1.9 });
    await until(arrived, 8000, tok);
    clearAim();
    crawler.crawler?.voice?.chirp('poke');
    world.touch?.(item.id, 2);
    markEl(item.el, 'cw-bitten');
    carried.push(makeTag(clip(sentence, 40), 'quote', centre(item.el)));
    await wait(220, tok);
    await haul(tok, () => {
      entries.quotes.unshift(sentence);
      const li = doc.createElement('li');
      const q = doc.createElement('q'); q.textContent = clip(sentence, 240);
      li.append(q);
      addEntry('quotes', li);
      if (dock === 'chip' && ledger.classList.contains('is-closed')) {
        toggle(); // show what it brought, then get out of the way
        const t = setTimeout(() => { if (!ledger.classList.contains('is-closed')) toggle(); }, 5000);
        ledger.addEventListener('pointerdown', () => clearTimeout(t), { once: true });
      }
    }, 'bringing it to the ledger');
  }
  function sentenceAround(el) {
    const block = el.closest('[data-block]') || el.parentElement;
    const words = [...block.querySelectorAll('.w')];
    const i = words.indexOf(el);
    if (i < 0) return clean(el.textContent);
    let a = i, b = i;
    while (a > 0 && !/[.!?]["”’)]*$/.test(words[a - 1].textContent) && i - a < 40) a--;
    while (b < words.length - 1 && !/[.!?]["”’)]*$/.test(words[b].textContent) && b - i < 40) b++;
    return tidy(words.slice(a, b + 1).map((w) => w.textContent).join(' '));
  }
  function tidy(t) {
    return clean(t).replace(/\[\s*(\d+|[a-z]|citation needed)\s*\]/gi, '').replace(/\s+([,.;:!?)\]’”])/g, '$1').replace(/([(\[“‘])\s+/g, '$1').replace(/\s{2,}/g, ' ').trim();
  }

  // Carry the haul to the column edge nearest the ledger, then fling it in.
  async function haul(tok, land, label) {
    status(label);
    const B = world.bounds();
    const L = ledger.getBoundingClientRect();
    const p = crawler.position;
    let ex = dock === 'side' ? B.x + B.w - 14 : Math.min(B.x + B.w - 14, L.left + L.width / 2);
    let ey = dock === 'side' ? Math.max(B.y + 30, Math.min(B.y + B.h - 30, L.top + 40, p.y)) : Math.min(B.y + B.h - 40, L.bottom + 36);
    // walk at most ~260 px of the way; the fling covers the rest
    const dx = ex - p.x, dy = ey - p.y, d = Math.hypot(dx, dy), MAXW = 260;
    if (d > MAXW) { ex = p.x + (dx / d) * MAXW; ey = p.y + (dy / d) * MAXW; }
    goToPoint(ex, ey, { speed: 1.7, look: { x: L.left + L.width / 2, y: L.top + 20 } });
    await until(arrived, 4000, tok);
    await wait(120, tok);
    // fling
    const flying = carried; carried = [];
    silk.setAttribute('d', '');
    const tx = L.left + 16, ty = L.top + Math.min(70, L.height / 2);
    await Promise.all(flying.map((t, i) => fly(t, tx + i * 6, ty + i * 4, 480 + i * 80)));
    land();
  }
  function fly(t, x, y, ms) {
    return new Promise((res) => {
      const x0 = t.x, y0 = t.y, t0 = performance.now(), lift = 60 + Math.random() * 40;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms), e = k * k * (3 - 2 * k);
        t.x = x0 + (x - x0) * e; t.y = y0 + (y - y0) * e - Math.sin(Math.PI * e) * lift;
        t.rot += 14; t.pop = 1 - 0.5 * e;
        drawTag(t);
        if (k < 1) win.requestAnimationFrame(step); else { t.el.remove(); res(); }
      };
      win.requestAnimationFrame(step);
    });
  }

  // ---- the loop ----------------------------------------------------------------------
  let paused = false, held = false, pointing = false, destroyed = false, queued = null, running = false, pauseUntil = 0;
  async function loop() {
    if (running) return;
    running = true;
    while (!destroyed) {
      const tok = token;
      try {
        if (paused || held || pointing || doc.hidden || crawler.state === 'asleep' && !queued || performance.now() < pauseUntil) { await sleep(400); continue; }
        if (queued) { const q = queued; queued = null; await fetchSentence(tok, q); lastJob = 'fetch'; await wait(600, tok); continue; }
        const links = preferProse(visibleItems(['link']).filter((l) => (clean(l.text).match(/[a-zà-ÿ]/gi) || []).length >= 3 && l.href && !/^(javascript:|#)/i.test(l.getAttribute ? '' : l.href) && !/^javascript:/i.test(l.href) && !/^\[?\d+\]?$/.test(clean(l.text))));
        const roll = Math.random();
        let did = false;
        if (links.length && (roll < 0.45 || lastJob !== 'link') && lastJob !== 'link') {
          const p = crawler.position;
          links.sort((a, b) => Math.hypot(a.cx - p.x, a.cy - p.y) - Math.hypot(b.cx - p.x, b.cy - p.y));
          await harvestLink(tok, links[Math.floor(Math.random() * Math.min(3, links.length))]);
          lastJob = 'link'; did = true;
        } else if (lastJob !== 'plough' && roll < 0.35) {
          did = await ploughThrough(tok); if (did) lastJob = 'plough';
        }
        if (!did) { did = await splice(tok); if (did) lastJob = 'splice'; }
        if (!did) { status('looking for something to read'); await wait(1500, tok); continue; }
        status('looking around');
        holdHere(null);
        await wait(500 + Math.random() * 700, tok);
      } catch (e) {
        if (e !== CANCEL) { console.warn('[crawler worker]', e); await sleep(1000); }
      }
    }
    running = false;
  }

  // ---- you can direct it --------------------------------------------------------------
  const offs = [];
  offs.push(crawler.on('call', () => { cancel(); pauseUntil = performance.now() + 2600; status('coming to you'); }));
  offs.push(crawler.on('poke', () => { pauseUntil = performance.now() + 900; }));
  offs.push(world.on('tap', (e) => {
    if (e.claimed) return; // tapped the creature itself
    const hit = world.queryNear(e.x, e.y, 6, { kinds: ['word'], limit: 1 })[0];
    if (!hit || hit.el.closest('a')) return; // links keep working as links
    cancel();
    pauseUntil = 0;
    queued = hit;
  }));

  loop();

  function destroy() {
    destroyed = true;
    cancel();
    win.cancelAnimationFrame(raf);
    win.removeEventListener('resize', place);
    offs.forEach((off) => { try { off?.(); } catch { /* already gone */ } });
    mendAll();
    added.forEach((el) => el.remove());
  }

  return {
    destroy,
    pause() { paused = true; cancel(); },
    resume() { paused = false; },
    /** Stop taking new jobs (e.g. while its owner is chatting with it); false resumes. */
    hold(on) { on = !!on; if (on === held) return; held = on; if (on) { if (!pointing) cancel(); status('listening'); } else status('looking around'); },
    /**
     * Go and point at an element: bracket on, walk over, stand there facing it.
     * The agent's way of answering "where": its body goes to the place.
     */
    async point(el, { label = 'here', ms = 6000 } = {}) {
      if (!el?.isConnected) return false;
      cancel();
      const tok = token;
      pointing = true;
      try {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > win.innerHeight) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); await wait(500, tok); }
        status(label);
        aimAt(el);
        goToEl(el, { speed: 1.9 });
        await until(arrived, 8000, tok);
        await wait(ms, tok);
        clearAim();
      } catch (e) { if (e !== CANCEL) throw e; } finally { if (tok === token) { clearAim(); pointing = false; } }
      return true;
    },
    /** Ask it to fetch the sentence around a page element (used by the extension's brain). */
    fetch(el) { const id = el?.dataset?.cwId; const it = id && world.getItem(id); if (it) { cancel(); queued = it; } },
    status,
    get ledger() { return ledger; },
    get entries() { return entries; },
  };
}

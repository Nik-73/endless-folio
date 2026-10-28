// Reads a whole page and picks the sentences that carry it: TextRank over the
// page's prose (sentences that share words with many others score high), with
// a small bonus for the opening. Runs on the device, no model, a few ms.
//
//   digestPage(document) -> { title, sentences: N, words: N, key: [{ text, el, index }] }
// `el` is the block the sentence lives in, so the creature can walk to it.

const STOP = new Set('a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its may more most much not of on once one or our out over she so some such than that the their them then there these they this those though to too under upon very was we were what when where which while who whom why will with would you your also only other same being about after again against all any because before below between both down during each few further here just like made make many must never nothing now off often own said say says should since still through until whether within without yet'.split(' '));

const PROSE = 'p, li, dd, blockquote';
const SKIP = 'nav, header, footer, aside, table, figure, [role="navigation"], .navbox, .reflist, .references, .infobox, [data-cw-ui], .mw-references-wrap';

const ABBR = /\b(pl|sing|e\.g|i\.e|etc|vs|cf|approx|ca|c|no|fig|mr|mrs|ms|dr|st|jr|sr|prof|inc|ltd|co|vol|pp|p|ed|eds|lit|var|sp|spp|al|u\.s|[A-Z])\.$/i;
function sentencesOf(text) {
  const clean = text
    .replace(/\[\s*(\d+|[a-z]|citation needed|note \d+|[a-z ]+\d*)\s*\]/gi, '') // [12], [a], [note 1]
    .replace(/:\s*\d+(?:[–-]\d+)?(?=\s)/g, '') // page cites like ": 85"
    .replace(/\s+/g, ' ').trim();
  const out = [];
  let cur = '';
  for (const part of clean.split(/(?<=[.!?]["”’)]?)\s+(?=[A-Z0-9“"(])/)) {
    cur = cur ? cur + ' ' + part : part;
    if (ABBR.test(cur.split(' ').pop())) continue; // "pl." / "e.g." / an initial: not the end
    out.push(cur); cur = '';
  }
  if (cur) out.push(cur);
  return out.map((s) => s.replace(/^[^A-Za-z0-9“"(]+/, '').replace(/\(\s*[;:,]?\s*\)/g, '').replace(/\s+([,.;:])/g, '$1').trim())
    .filter((s) => s.length > 30 && s.length < 420 && /^[A-Z0-9“"(]/.test(s));
}
function terms(s) {
  return [...new Set(s.toLowerCase().replace(/[^a-z0-9à-ÿ' -]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ies|es|s)$/, '')))];
}

export function digestPage(doc = document, { max = 400, keep = 5, root = null } = {}) {
  const scope = root || doc.querySelector('main, article, #content, #mw-content-text, [role="main"]') || doc.body;
  const S = [];
  let words = 0;
  for (const el of scope.querySelectorAll(PROSE)) {
    if (S.length >= max) break;
    if (el.closest(SKIP) || el.querySelector(PROSE)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    for (const text of sentencesOf(el.textContent || '')) {
      const t = terms(text);
      if (t.length < 4) continue;
      words += text.split(/\s+/).length;
      S.push({ text, el, t, index: S.length });
      if (S.length >= max) break;
    }
  }
  const n = S.length;
  if (!n) return { title: doc.title, sentences: 0, words: 0, key: [] };
  // similarity graph
  const W = Array.from({ length: n }, () => new Float32Array(n));
  const deg = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = new Set(S[i].t);
    for (let j = i + 1; j < n; j++) {
      let ov = 0;
      for (const w of S[j].t) if (a.has(w)) ov++;
      if (!ov) continue;
      const v = ov / (Math.log(S[i].t.length + 1) + Math.log(S[j].t.length + 1));
      W[i][j] = W[j][i] = v; deg[i] += v; deg[j] += v;
    }
  }
  let rank = new Float32Array(n).fill(1 / n);
  for (let it = 0; it < 24; it++) {
    const next = new Float32Array(n).fill(0.15 / n);
    for (let i = 0; i < n; i++) {
      if (!deg[i]) continue;
      const share = 0.85 * rank[i] / deg[i];
      const row = W[i];
      for (let j = 0; j < n; j++) if (row[j]) next[j] += share * row[j];
    }
    rank = next;
  }
  // opening bonus, then pick the best without near-duplicates
  const scored = S.map((s, i) => ({ s, score: rank[i] * (1 + 0.6 * Math.exp(-i / 6)) })).sort((a, b) => b.score - a.score);
  const picked = [];
  for (const { s } of scored) {
    if (picked.length >= keep) break;
    const a = new Set(s.t);
    if (picked.some((p) => p.t.filter((w) => a.has(w)).length > Math.min(p.t.length, s.t.length) * 0.6)) continue;
    picked.push(s);
  }
  picked.sort((a, b) => a.index - b.index);
  return { title: doc.title, sentences: n, words, key: picked.map(({ text, el, index }) => ({ text, el, index })) };
}

/** The word spans of `text` inside a wrapped block, or [] if not wrapped yet. */
export function sentenceSpans(block, text) {
  const ws = [...block.querySelectorAll('.w')];
  if (!ws.length) return [];
  const want = terms(text);
  if (!want.length) return [];
  const toks = ws.map((w) => w.textContent.toLowerCase().replace(/[^a-z0-9à-ÿ']/g, ''));
  const first = text.split(/\s+/).slice(0, 3).map((w) => w.toLowerCase().replace(/[^a-z0-9à-ÿ']/g, ''));
  const len = text.split(/\s+/).length;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === first[0] && (toks[i + 1] ?? '') === (first[1] ?? '')) return ws.slice(i, i + len);
  }
  return [];
}

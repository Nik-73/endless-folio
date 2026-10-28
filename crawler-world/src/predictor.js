// A tiny word-level text predictor: interpolated trigram/bigram counts trained
// in the browser from CORPUS (a few KB). Words the creature touches are fed in
// through `touch()` and bias what gets written next, so the endless page drifts
// toward whatever the crawler has been eating.

const PUNCT = new Set(['.', ',', ';', ':', '?', '!']);
const START = '<s>';

function tokenize(text) {
  return text
    .replace(/\[\[|\]\]/g, '')
    .replace(/([.,;:?!])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (PUNCT.has(t) ? t : t.toLowerCase()));
}

function bump(map, key, sub) {
  let m = map.get(key);
  if (!m) map.set(key, (m = new Map()));
  m.set(sub, (m.get(sub) || 0) + 1);
}

export function normalizeWord(w) {
  return String(w).toLowerCase().replace(/[^a-zÀ-ɏ'-]/g, '');
}

export function createPredictor(corpus, { rng } = {}) {
  const rand = rng ? rng.next : Math.random;
  const tri = new Map();
  const bi = new Map();
  const uni = new Map();
  const sentences = new Set();
  const linkPhrases = new Set();
  // touched word -> weight (decays every paragraph)
  const bias = new Map();

  for (const m of corpus.matchAll(/\[\[([^\]]+)\]\]/g)) linkPhrases.add(m[1].toLowerCase());

  function learn(text) {
    for (const para of text.split(/\n\s*\n/)) {
      const toks = tokenize(para);
      let a = START, b = START, sent = [];
      for (const t of toks) {
        bump(tri, a + ' ' + b, t);
        bump(bi, b, t);
        uni.set(t, (uni.get(t) || 0) + 1);
        sent.push(t);
        if (t === '.' || t === '?' || t === '!') {
          sentences.add(sent.join(' '));
          sent = [];
          a = START; b = START;
        } else {
          a = b; b = t;
        }
      }
    }
  }
  learn(corpus);

  function weighted(dist, boost) {
    let total = 0;
    const entries = [];
    for (const [w, c] of dist) {
      const k = c * (boost ? 1 + (bias.get(w) || 0) : 1);
      entries.push([w, k]);
      total += k;
    }
    let r = rand() * total;
    for (const [w, k] of entries) if ((r -= k) <= 0) return w;
    return entries[entries.length - 1][0];
  }

  function nextToken(a, b) {
    const t = tri.get(a + ' ' + b);
    const useTri = t && (t.size > 1 ? rand() < 0.7 : rand() < 0.55);
    if (useTri) return weighted(t, true);
    const d = bi.get(b);
    if (d) return weighted(d, true);
    return weighted(uni, true);
  }

  // Pick an opening pair that leads into a touched word when we have one.
  function opening(focus) {
    if (focus && rand() < 0.65) {
      const cands = [];
      for (const [ctx, dist] of tri) {
        if (!dist.has(focus)) continue;
        const [a, b] = ctx.split(' ');
        if (a === START) cands.push([b, focus]);
      }
      if (cands.length) return cands[Math.floor(rand() * cands.length)];
      // Fall back to "the <focus>" if the word follows "the" anywhere.
      if (bi.get('the')?.has(focus)) return ['the', focus];
    }
    return null;
  }

  function sentence(focus, maxLen = 32) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const out = [];
      let a = START, b = START;
      const open = opening(focus);
      if (open) { out.push(...open); a = open[0]; b = open[1]; }
      while (out.length < maxLen) {
        const t = nextToken(a, b);
        out.push(t);
        if (t === '.' || t === '?' || t === '!') break;
        a = b; b = t;
      }
      if (out[out.length - 1] !== '.') out.push('.');
      const words = out.filter((t) => !PUNCT.has(t)).length;
      if (words < 5) continue;
      // Prefer novel sentences over verbatim corpus lines.
      if (sentences.has(out.join(' ')) && attempt < 3) continue;
      return out;
    }
    return ['crawlers', 'move', 'slowly', 'across', 'the', 'page', '.'];
  }

  function detok(tokens, aliases) {
    let s = '';
    let cap = true;
    for (let t of tokens) {
      if (aliases && aliases[t]) t = aliases[t];
      if (PUNCT.has(t)) { s += t; cap = t !== ',' && t !== ';' && t !== ':'; continue; }
      if (cap) { t = t.charAt(0).toUpperCase() + t.slice(1); cap = false; }
      s += (s ? ' ' : '') + t;
    }
    return s;
  }

  // Split a string into [{text}, {text, link}] segments for known link phrases.
  function segment(text, extraPhrases = []) {
    const phrases = [...linkPhrases, ...extraPhrases].sort((x, y) => y.length - x.length);
    const re = new RegExp('\\b(' + phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')s?\\b', 'gi');
    const segs = [];
    let last = 0;
    const seen = new Set();
    for (const m of text.matchAll(re)) {
      const key = m[1].toLowerCase();
      if (seen.has(key)) continue; // link each phrase once per paragraph
      seen.add(key);
      if (m.index > last) segs.push({ text: text.slice(last, m.index) });
      segs.push({ text: m[0], link: key });
      last = m.index + m[0].length;
    }
    if (last < text.length) segs.push({ text: text.slice(last) });
    return segs;
  }

  function focusWord() {
    if (!bias.size) return null;
    let total = 0;
    for (const v of bias.values()) total += v;
    let r = rand() * total;
    for (const [w, v] of bias) if ((r -= v) <= 0) return w;
    return null;
  }

  return {
    linkPhrases,
    vocabularySize: uni.size,
    learn,
    /** Register a word the creature touched. Strength stacks, then decays. */
    touch(word, strength = 1) {
      const w = normalizeWord(word);
      if (!w || w.length < 3 || !uni.has(w)) return false;
      bias.set(w, Math.min(12, (bias.get(w) || 0) + strength * 3));
      return true;
    },
    touchedWords() {
      return [...bias.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
    },
    /** Generate one paragraph as plain text (+ link segments). */
    paragraph({ sentences: n = 3 + Math.floor(rand() * 3), aliases, extraLinks } = {}) {
      const parts = [];
      for (let i = 0; i < n; i++) parts.push(detok(sentence(focusWord()), aliases));
      for (const [w, v] of bias) {
        const nv = v * 0.6;
        if (nv < 0.3) bias.delete(w); else bias.set(w, nv);
      }
      const text = parts.join(' ');
      return { text, segments: segment(text, extraLinks) };
    },
    sentence: (focus, aliases) => detok(sentence(focus ? normalizeWord(focus) : focusWord()), aliases),
  };
}

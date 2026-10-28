// Deterministic seeded randomness.
// Only integer math (Math.imul, >>>) is used here, so a seed produces the same
// stream in every JS engine. Trait generation builds on this; keep it that way.

/** Canonical string form of a seed. 1 and "1" are the same seed; hex is case-insensitive. */
export function normalizeSeed(seed) {
  if (seed === undefined || seed === null) throw new Error('crawler: seed is required');
  let s = typeof seed === 'bigint' ? seed.toString() : String(seed).trim();
  if (/^0x[0-9a-f]+$/i.test(s)) s = s.toLowerCase();
  return s;
}

/** cyrb128: string -> four 32-bit words. */
export function hashSeed(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32 generator -> float in [0, 1). */
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function createRng(seed) {
  const [a, b, c, d] = hashSeed(normalizeSeed(seed));
  const next = sfc32(a, b, c, d);
  for (let i = 0; i < 12; i++) next(); // warm up
  const rng = {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** entries: [[value, weight], ...] */
    weighted(entries) {
      let total = 0;
      for (const e of entries) total += e[1];
      let r = next() * total;
      for (const e of entries) { r -= e[1]; if (r < 0) return e[0]; }
      return entries[entries.length - 1][0];
    },
    hex(n) {
      let s = '';
      for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(next() * 16)];
      return s;
    },
  };
  return rng;
}

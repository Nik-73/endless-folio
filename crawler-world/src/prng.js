// Seeded randomness. Everything visual or textual derives from these so a
// given ?seed= always produces the same page and creature.

export function hashString(str) {
  // cyrb53-style 32-bit hash; stable across browsers.
  let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small helper bundle around one generator.
export function makeRng(seed) {
  const n = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  const next = mulberry32(n);
  const rng = {
    seed: n,
    next,
    float: (a = 0, b = 1) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    fork: (label) => makeRng(hashString(n + ':' + label)),
  };
  return rng;
}

// Normalise whatever ?seed= holds (number, hex, 0x…, free text) into a uint32.
export function parseSeed(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (/^\d+$/.test(s) && s.length < 10) return Number(s) >>> 0;
  if (/^0x[0-9a-f]{1,8}$/i.test(s)) return parseInt(s.slice(2), 16) >>> 0;
  return hashString(s);
}

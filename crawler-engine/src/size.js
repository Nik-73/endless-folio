// Size floor: every creature is at least word-sized on screen. Applied as a
// render scale, so trait generation (and every seed's creature) is unchanged.
//   presence = max(leg span tip to tip, 0.6 × body length), CSS px at scale 1.
// After Creature Designer's tuning.js (DESIGN_SPEC item 3); cap raised from
// 1.45 to 1.7 so no seed stays under the floor.

export const MIN_PRESENCE = 52;
export const MAX_BOOST = 1.7;

export function presence(t) {
  const U = t.body.unit, s = t.body.segments;
  let maxR = 0, reach = 0;
  for (const q of s) maxR = Math.max(maxR, q.r);
  for (const p of t.legs.pairs) reach = Math.max(reach, p.reach);
  let len = s[0].r * U;
  for (let k = 1; k < s.length; k++) len += (s[k - 1].r + s[k].r) * U * t.body.gap;
  len += s[s.length - 1].r * U;
  return Math.max((reach + maxR) * U * 2, len * 0.6);
}

export function sizeFloorScale(t, min = MIN_PRESENCE) {
  const p = presence(t);
  return p >= min ? 1 : Math.min(MAX_BOOST, min / p);
}

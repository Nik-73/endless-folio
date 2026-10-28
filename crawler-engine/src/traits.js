// Seeded trait system. generateTraits(seed) is pure and deterministic.
//
// Rules that keep tokens reproducible forever:
//  - Only arithmetic + Math.floor/round/abs/min/max here (no sin/cos/pow), so
//    every JS engine produces bit-identical numbers. Angles are stored in degrees.
//  - Each aspect draws from its own seeded stream, so tuning one aspect later
//    does not reshuffle the others. Still: any change here changes creatures.
//    Bump TRAITS_VERSION and keep old versions callable once tokens are minted.
import { createRng, normalizeSeed } from './rng.js?v=20261028160256';

export const TRAITS_VERSION = 1;

const q = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export const PALETTES = [
  { name: 'Fluoro', ink: '#1b1f4a', accent: '#ff3f8e', tint: '#ffcf1f', w: 10 },
  { name: 'Tangerine', ink: '#132d33', accent: '#ff7a2f', tint: '#00a6a6', w: 10 },
  { name: 'Bruise', ink: '#2b1640', accent: '#7c5cff', tint: '#ff7cc4', w: 8 },
  { name: 'Moss', ink: '#1f2a12', accent: '#7bbf2a', tint: '#e8b400', w: 8 },
  { name: 'Clinic', ink: '#0e2a47', accent: '#00b3ff', tint: '#ff4b4b', w: 8 },
  { name: 'Rust', ink: '#2d1a12', accent: '#e2552b', tint: '#1fa58f', w: 8 },
  { name: 'Sea Glass', ink: '#103a3a', accent: '#2fcfae', tint: '#ff8f7a', w: 7 },
  { name: 'Ultramarine', ink: '#0b1a8f', accent: '#ff6ec7', tint: '#ffc800', w: 6 },
  { name: 'Ochre', ink: '#3a2a08', accent: '#e0a100', tint: '#3d6bff', w: 6 },
  { name: 'Graphite', ink: '#151515', accent: '#a8a8a8', tint: '#ff5a1f', w: 3 },
];

export const SCALES = {
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  hirajoshi: [0, 2, 3, 7, 8],
  'whole tone': [0, 2, 4, 6, 8, 10],
  lydian: [0, 4, 6, 7, 11],
  fifths: [0, 7, 12, 19],
};

export const EFFECT_TYPES = ['read', 'nibble', 'tug', 'inspect', 'hide', 'perch', 'jostle'];

const TEMPERAMENTS = {
  curious:  { w: 5, cur: [0.75, 1], bold: [0.55, 0.75], sleep: [18, 35], rest: [0.3, 0.5], speed: 1,
              prefs: { text: 1, link: 0.8, image: 0.5 }, fx: { text: 'read', link: 'tug', image: 'inspect' },
              epithets: ['curiosa', 'lectrix', 'scrutans'] },
  skittish: { w: 4, cur: [0.3, 0.5], bold: [0.05, 0.25], sleep: [12, 25], rest: [0.5, 0.8], speed: 1.15,
              prefs: { text: 0.25, link: 0.2, image: 1 }, fx: { text: 'read', link: 'tug', image: 'hide' },
              epithets: ['fugax', 'timida', 'trepida'] },
  glutton:  { w: 3, cur: [0.6, 0.85], bold: [0.4, 0.6], sleep: [15, 30], rest: [0.2, 0.4], speed: 0.9,
              prefs: { text: 1, link: 0.45, image: 0.2 }, fx: { text: 'nibble', link: 'nibble', image: 'inspect' },
              epithets: ['verbivora', 'gulosa', 'edax'] },
  drowsy:   { w: 3, cur: [0.2, 0.4], bold: [0.35, 0.55], sleep: [6, 12], rest: [0.05, 0.2], speed: 0.75,
              prefs: { text: 0.3, link: 0.1, image: 1 }, fx: { text: 'read', link: 'tug', image: 'perch' },
              epithets: ['somnolens', 'sopora', 'lenta'] },
  restless: { w: 3, cur: [0.35, 0.6], bold: [0.4, 0.6], sleep: [30, 60], rest: [0.8, 1], speed: 1.3,
              prefs: { text: 0.4, link: 1, image: 0.2 }, fx: { text: 'jostle', link: 'tug', image: 'inspect' },
              epithets: ['vagans', 'inquieta', 'cursor'] },
  bold:     { w: 2, cur: [0.5, 0.7], bold: [0.85, 1], sleep: [20, 40], rest: [0.4, 0.6], speed: 1.1,
              prefs: { text: 0.6, link: 0.8, image: 0.6 }, fx: { text: 'jostle', link: 'tug', image: 'perch' },
              epithets: ['audax', 'ferox', 'impavida'] },
};

const GAITS = {
  tripod:   { maxSwing: 0.5 },
  tetrapod: { maxSwing: 0.5 },
  wave:     { maxSwing: 0.34 },
  amble:    { maxSwing: 0.25 },
  bound:    { maxSwing: 0.5 },
};

const SHAPES = [['disc', 5], ['ring', 3], ['block', 3], ['lozenge', 2], ['grain', 1]];

// Leg spread helper: n angles evenly from a0 to a1 (degrees from forward axis).
function spread(n, a0, a1) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(n === 1 ? (a0 + a1) / 2 : a0 + ((a1 - a0) * k) / (n - 1));
  return out;
}

function buildPlan(plan, r) {
  // returns { radii[], legSegs[], angles[], L, gap, bend, rigid, yaw, stepTime, threshold, gaitW, profile }
  switch (plan) {
    case 'spider': {
      const head = r.chance(0.35);
      const radii = head ? [0.55, 1, r.range(1.3, 1.9)] : [1, r.range(1.2, 1.9)];
      const pairs = r.weighted([[4, 6], [3, 2], [5, 1]]);
      return { radii, legSegs: Array(pairs).fill(head ? 1 : 0), angles: spread(pairs, r.range(30, 45), r.range(140, 160)),
        L: r.range(4.2, 7.5), gap: 0.85, bend: 20, rigid: false, yaw: 0,
        stepTime: r.range(0.11, 0.17), threshold: r.range(0.3, 0.45),
        gaitW: [['tetrapod', 5], ['amble', 3], ['bound', 1]], profile: 'bulb' };
    }
    case 'centipede': {
      const n = r.int(8, 14);
      const taper = r.chance(0.6);
      const radii = [0.95];
      for (let i = 1; i < n; i++) radii.push(taper ? 0.88 - (0.33 * i) / (n - 1) : 0.8);
      const pairs = n - 2, skew = r.range(0, 20), base = r.range(80, 95);
      const angles = [], legSegs = [];
      for (let k = 0; k < pairs; k++) { legSegs.push(k + 1); angles.push(base + (skew * k) / Math.max(1, pairs - 1)); }
      return { radii, legSegs, angles, L: r.range(2.2, 3.4), gap: 1.05, bend: 28, rigid: false, yaw: 0,
        stepTime: r.range(0.09, 0.14), threshold: r.range(0.35, 0.5),
        gaitW: [['wave', 7], ['tripod', 1]], profile: taper ? 'taper' : 'even' };
    }
    case 'millipede': {
      const n = r.int(12, 17);
      const radii = [0.75];
      for (let i = 1; i < n; i++) radii.push(i === n - 1 ? 0.5 : 0.66);
      const pairs = n - 2, angles = [], legSegs = [];
      for (let k = 0; k < pairs; k++) { legSegs.push(k + 1); angles.push(r.range(86, 96)); }
      return { radii, legSegs, angles, L: r.range(1.4, 2.0), gap: 1.0, bend: 22, rigid: false, yaw: 0,
        stepTime: r.range(0.07, 0.1), threshold: r.range(0.4, 0.55),
        gaitW: [['wave', 1]], profile: 'even' };
    }
    case 'beetle': {
      const radii = [0.7, 0.95, r.range(1.4, 1.8)];
      const back = r.chance(0.5) ? 2 : 1;
      return { radii, legSegs: [1, 1, back], angles: [r.range(40, 55), r.range(85, 100), r.range(125, 145)],
        L: r.range(3.0, 4.4), gap: 0.9, bend: 12, rigid: false, yaw: 0,
        stepTime: r.range(0.09, 0.14), threshold: r.range(0.3, 0.45),
        gaitW: [['tripod', 8], ['amble', 1]], profile: 'swell' };
    }
    case 'strider': {
      const n = r.int(2, 3);
      const radii = n === 3 ? [0.6, 0.85, 0.7] : [0.75, 0.9];
      const pairs = r.weighted([[2, 2], [3, 3]]);
      return { radii, legSegs: Array(pairs).fill(n === 3 ? 1 : 0), angles: spread(pairs, r.range(35, 50), r.range(130, 150)),
        L: r.range(7, 10.5), gap: 1.0, bend: 15, rigid: false, yaw: 0,
        stepTime: r.range(0.18, 0.28), threshold: r.range(0.22, 0.35),
        gaitW: [['amble', 3], ['bound', 2]], profile: 'even' };
    }
    case 'scuttler':
    default: {
      const pairs = r.int(3, 5);
      return { radii: [r.range(1.4, 1.9)], legSegs: Array(pairs).fill(0), angles: spread(pairs, r.range(45, 60), r.range(120, 135)),
        L: r.range(3.2, 5), gap: 1, bend: 0, rigid: true, yaw: r.sign() * r.range(70, 95),
        stepTime: r.range(0.08, 0.12), threshold: r.range(0.3, 0.45),
        gaitW: [['tripod', 4], ['tetrapod', 3]], profile: 'single' };
    }
  }
}

const GENUS_A = ['ar', 'bel', 'cor', 'dra', 'em', 'fil', 'gra', 'hex', 'ix', 'lum', 'mor', 'nod', 'or', 'pli', 'quo', 'rha', 'sil', 'tor', 'ul', 'vex', 'xen', 'zy'];
const GENUS_B = ['ac', 'en', 'il', 'om', 'ur', 'ar', 'iph', 'ot', 'yr', 'el'];
const GENUS_C = ['us', 'a', 'ia', 'is', 'ops', 'ax', 'on', 'ella'];

export function generateTraits(seedInput) {
  const seed = normalizeSeed(seedInput);
  const R = (k) => createRng(seed + ':' + k);
  const rPlan = R('plan'), rBody = R('body'), rLegs = R('legs'), rGait = R('gait'), rTemp = R('temperament'),
    rPal = R('palette'), rVoice = R('voice'), rName = R('name'), rHead = R('head');

  const plan = rPlan.weighted([['spider', 22], ['centipede', 20], ['beetle', 18], ['strider', 12], ['millipede', 10], ['scuttler', 9]]);
  const P = buildPlan(plan, rPlan);

  // Body
  const unit = q(rBody.range(4.6, 7.4));
  const shape = rBody.weighted(SHAPES);
  const headShape = rBody.chance(0.3) ? rBody.weighted(SHAPES) : shape;
  const segments = P.radii.map((rad, i) => ({ r: q(rad * rBody.range(0.94, 1.06)), shape: i === 0 ? headShape : shape }));

  // Legs
  const style = plan === 'strider' ? 'thread' : rLegs.weighted([['line', 5], ['dash', 2], ['bead', 2], ['thread', 1]]);
  const femurShare = rLegs.range(0.42, 0.55);
  const pairs = P.angles.map((angle, k) => {
    const n = P.angles.length, mid = (n - 1) / 2;
    const edge = mid > 0 ? Math.abs(k - mid) / mid : 0;
    const len = P.L * (plan === 'spider' || plan === 'strider' ? 0.88 + 0.28 * edge : 1) * rLegs.range(0.95, 1.05);
    return { seg: P.legSegs[k], angle: q(angle), femur: q(len * femurShare), tibia: q(len * (1 - femurShare)), reach: q(len * rLegs.range(0.6, 0.7)) };
  });
  let lenSum = 0;
  for (const p of pairs) lenSum += p.femur + p.tibia;
  const legs = {
    pairs,
    count: pairs.length * 2,
    length: q(lenSum / pairs.length),
    style,
    width: q(style === 'thread' ? rLegs.range(0.7, 0.95) : rLegs.range(1.1, 1.7)),
    knee: rLegs.weighted([['square', 4], ['dot', 3], ['none', 2]]),
    foot: rLegs.weighted([['square', 4], ['dot', 3], ['tick', 2]]),
  };

  // Gait
  const gaitName = rGait.weighted(P.gaitW);
  const temperamentName = rTemp.weighted(Object.keys(TEMPERAMENTS).map((k) => [k, TEMPERAMENTS[k].w]));
  const TM = TEMPERAMENTS[temperamentName];
  const gait = {
    name: gaitName,
    stepTime: q(P.stepTime),
    threshold: q(P.threshold),
    lead: q(rGait.range(0.5, 1.0)),
    waveDir: rGait.sign(), // +1: waves travel tail-to-head, -1: head-to-tail
    maxSwing: GAITS[gaitName].maxSwing,
  };
  // Speed derived from stride so legs can keep up, then flavoured by temperament.
  const avgReach = lenSum / pairs.length * 0.65;
  const stride = avgReach * gait.threshold * 2.2;
  const speed = clamp(((stride * unit) / (gait.stepTime * 2.2)) * rGait.range(0.85, 1.2) * TM.speed, 28, 230);
  const motion = { speed: q(speed), turn: q(rGait.range(2.5, 6.5)), accel: q(rGait.range(3, 7)) };

  const temperament = {
    name: temperamentName,
    curiosity: q(rTemp.range(TM.cur[0], TM.cur[1])),
    boldness: q(rTemp.range(TM.bold[0], TM.bold[1])),
    sleepAfter: q(rTemp.range(TM.sleep[0], TM.sleep[1])),
    restlessness: q(rTemp.range(TM.rest[0], TM.rest[1])),
    senseRadius: q(rTemp.range(90, 170)),
    prefs: { ...TM.prefs },
    effects: { ...TM.fx },
  };

  // Look
  const pal = rPal.weighted(PALETTES.map((p) => [p, p.w]));
  const palette = { name: pal.name, ink: pal.ink, accent: pal.accent, tint: pal.tint };
  const print = { offset: q(rPal.range(0.7, 2.0)), angle: rPal.int(0, 359) };
  const head = {
    antennae: plan === 'spider' || plan === 'scuttler' ? (rHead.chance(0.2) ? 2 : 0) : rHead.chance(0.8) ? 2 : 0,
    antennaLength: q(rHead.range(1.6, plan === 'centipede' ? 5 : 3.6)),
    eyes: plan === 'spider' ? rHead.weighted([[8, 4], [6, 2], [4, 1], [2, 1]]) : rHead.weighted([[0, 2], [2, 5], [3, 1]]),
    mandibles: rHead.chance(plan === 'centipede' ? 0.8 : 0.35),
  };
  const tail = plan === 'scuttler' ? 'none'
    : plan === 'spider' ? rHead.weighted([['spinneret', 3], ['none', 2]])
    : rHead.weighted([['none', 4], ['cerci', 3], ['stinger', 1]]);
  const trail = rHead.weighted([['dots', 5], ['ticks', 2], ['none', 2]]);

  // Voice: bigger creatures sing lower.
  const maxR = Math.max(...segments.map((s) => s.r));
  const bulk = unit * maxR + unit * legs.length * 0.2;
  const scaleName = rVoice.weighted([['major pentatonic', 4], ['minor pentatonic', 4], ['hirajoshi', 2], ['whole tone', 1], ['lydian', 2], ['fifths', 1]]);
  const scale = SCALES[scaleName];
  const pattern = rVoice.weighted([['ascending', 3], ['mirror', 3], ['scatter', 2]]);
  const notes = [];
  for (let k = 0; k < pairs.length; k++) {
    for (let s = 0; s < 2; s++) {
      let deg = pattern === 'ascending' ? k * 2 + s : pattern === 'mirror' ? k : rVoice.int(0, scale.length * 2 - 1);
      if (pattern === 'mirror' && s === 1) deg += 1;
      deg = deg % (scale.length * 2);
      notes.push(scale[deg % scale.length] + 12 * Math.floor(deg / scale.length));
    }
  }
  const voice = {
    root: clamp(Math.round(86 - bulk * 1.5) + rVoice.int(-3, 3), 43, 79),
    scale: scaleName,
    pattern,
    notes, // semitone offset per leg index (pair-major, left then right)
    timbre: rVoice.weighted([['pip', 4], ['click', 3], ['pluck', 2], ['wood', 2]]),
    stepGain: q(rVoice.range(0.05, 0.11)),
    hum: rVoice.chance(0.35) ? 0 : q(rVoice.range(0.012, 0.035)),
    humWave: rVoice.weighted([['sine', 3], ['triangle', 3], ['sawtooth', 1]]),
  };

  const genus = rName.pick(GENUS_A) + (rName.chance(0.6) ? rName.pick(GENUS_B) : '') + rName.pick(GENUS_C);
  const name = { genus: genus[0].toUpperCase() + genus.slice(1), species: rName.pick(TM.epithets) };
  name.full = name.genus + ' ' + name.species;

  return {
    version: TRAITS_VERSION,
    seed,
    id: 'CRW-' + R('id').hex(4).toUpperCase(),
    name,
    plan,
    body: {
      unit, segmentCount: segments.length, segments, shape, headShape, profile: P.profile,
      gap: P.gap, bend: P.bend, rigid: P.rigid, yaw: q(P.yaw),
    },
    legs, gait, motion, temperament, palette, print, head, tail, trail, voice,
  };
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** OpenSea-style attributes for token metadata. */
export function toAttributes(t) {
  return [
    { trait_type: 'Body plan', value: cap(t.plan) },
    { trait_type: 'Legs', value: t.legs.count, display_type: 'number' },
    { trait_type: 'Segments', value: t.body.segmentCount, display_type: 'number' },
    { trait_type: 'Gait', value: cap(t.gait.name) },
    { trait_type: 'Temperament', value: cap(t.temperament.name) },
    { trait_type: 'Palette', value: t.palette.name },
    { trait_type: 'Shell', value: cap(t.body.shape) },
    { trait_type: 'Leg style', value: cap(t.legs.style) },
    { trait_type: 'Antennae', value: t.head.antennae ? 'Yes' : 'No' },
    { trait_type: 'Eyes', value: t.head.eyes, display_type: 'number' },
    { trait_type: 'Tail', value: cap(t.tail) },
    { trait_type: 'Voice', value: cap(t.voice.timbre) + ' / ' + t.voice.scale },
  ];
}

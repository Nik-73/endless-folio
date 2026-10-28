# Crawler engine — API

Plain ES modules, no dependencies, Canvas 2D. Engine version `0.3.0`, traits version `1`.

```
crawler-engine/
  index.html            demo: six seeds side by side
  API.md                this file
  src/index.js          public entry (createCrawler, generateTraits, …)
  src/traits.js         deterministic seed -> traits
  src/rng.js            seeded PRNG (cyrb128 + sfc32, integer-only)
  src/crawler.js        one creature: spine, legs, IK, brain, renderer
  src/stage.js          canvas sizing, input, shared rAF loop
  src/audio.js          Web Audio voices
  src/world-adapter.js  maps the Folio world onto the engine's vocabulary
  src/stub-world.js     minimal DOM world used by the demo
```

## Quick start

```js
import { createCrawler } from '../crawler-engine/src/index.js';

const c = createCrawler({ seed: 42, canvas, world });
c.start();
```

The Folio host (`crawler-world/src/main.js`) already finds the engine at `../crawler-engine/src/index.js` and calls exactly this. `?engine=stub` still forces the old stub.

## `createCrawler(options) -> handle`

| option | default | meaning |
|---|---|---|
| `seed` | **required** | number, string, bigint or `0x…` hex. `42` and `"42"` are the same seed; hex is case-insensitive. |
| `canvas` | **required** | a `<canvas>`. Several creatures may share one canvas (they share one stage). |
| `world` | `null` | the page the creature lives on (see below). Without it the creature just roams the canvas. |
| `x`, `y`, `heading` | random from seed | start position (canvas CSS px) and heading (radians). |
| `scale` | `1` | size multiplier. Speed scales with √scale. Multiplied by the size floor below. |
| `sizeFloor` | `true` | render small creatures bigger so presence (max of leg span and 0.6 × body length) is at least 52 px, up to 1.7×. A number sets a different floor; `false` turns it off. **Traits are untouched**: it is a render scale, so every seed keeps its body, palette and temperament. `handle.scale` reports the scale used. |
| `startAwake` | `true` | start awake (and stay up at least 20 s). Pass `false` to start curled up until the first interaction (the demo does). |
| `sound` | `true` | `false` disables the voice for this creature. |
| `debug` | `false` | draws sense radius, foot targets, engaged item and mode. |
| `pointerTarget` | canvas parent | element to listen to for pointer/touch (standalone mode only). |
| `tapToSteer` | `true` | tapping empty space calls the nearest creature over. |
| `bounds` | auto | `{x,y,w,h}` or a function returning it, to confine the creature. Default: `world.bounds()` (visible column), else the canvas. |
| `insets` | `0` | `{top,right,bottom,left}` canvas CSS px to keep clear of host UI (toolbars). Also `handle.setInsets()`. |

Handle:

| member | |
|---|---|
| `start()` / `stop()` | start or pause the canvas's stage (all creatures on that canvas). |
| `destroy()` | remove the creature; the stage is torn down (and canvas cleared) when its last creature goes. |
| `wake(reason?)`, `sleep(reason?)` | |
| `poke(x, y)` | as if tapped at that point. |
| `call(x, y)` | same as a tap on empty space: instant acknowledgement, then a fast walk over (skittish: see Behaviour). |
| `setTarget(x, y, {duration=6})`, `clearTarget()` | walk somewhere quietly (wakes it). |
| `place(x, y, heading?)` | teleport and re-plant the legs. |
| `setInsets({top,right,bottom,left})` | change UI insets at runtime. |
| `on(event, fn) -> off` | events below. |
| `setDebug(bool)` | |
| `seed`, `traits`, `attributes` | normalised seed, full trait object, OpenSea-style attribute array. |
| `position` | `{x, y, heading}` of the head, canvas CSS px. |
| `state` | `'asleep' \| 'awake'`. |
| `mode` | `'asleep' \| 'roam' \| 'watch' \| 'follow' \| 'flee' \| 'engage' \| 'return' \| 'called' \| 'wary'`. |
| `stats` | `{fps, frameMs, updateMs, drawMs}` for the stage, refreshed each second. |
| `crawler`, `stage` | internals, for debugging. |

Events (payload always includes `crawler`):

| event | payload |
|---|---|
| `wake` | `{reason}` — `'first-interaction' 'pointer' 'poke' 'call' 'target' 'return' 'api' …` |
| `call` | `{x, y, partial}` — a tap called it (`partial`: skittish, first tap) |
| `chain` | `{words, effect}` — finished reading (or eating) a run of words |
| `reenter` | `{edge}` — came back on-screen after a scroll |
| `sleep` | `{reason}` — `'idle' 'perch' 'api'` |
| `poke` | `{x, y}` |
| `engage` | `{target, effect}` — it has picked an item to go to |
| `effect` | `{type, target}` — fired whenever it calls `world.applyEffect` |
| `footstep` | `{leg, x, y, intensity}` — a foot landed |

Other exports: `generateTraits(seed)`, `presence(traits)`, `sizeFloorScale(traits, min?)`, `toAttributes(traits)`, `TRAITS_VERSION`, `ENGINE_VERSION`, `createStubWorld({root, canvas})`, and `audio` (`audio.setMuted(bool)`, `audio.setVolume(0..1)`, `audio.running`, `audio.onReady(fn)`).

## Coordinates, sizing, input

- All coordinates are **canvas CSS pixels**. For the Folio's fixed full-screen canvas that equals viewport CSS px.
- **Host mode** — if `world` has `viewport`, `pointer` and `on()` (the Folio world), the host owns canvas sizing (DPR capped at 2 there) and pointer tracking. The engine reads `world.viewport`, the live `world.pointer`, and listens for `tap`, `scroll`, `visibility` and `motion`. On `scroll` creatures are translated with the text so they stay on the page.
- **Standalone mode** — the stage sizes the canvas itself (ResizeObserver + `resize`, DPR capped at 2) and listens to pointer and passive `touchmove` on `pointerTarget`.
- The engine never calls `preventDefault`; the canvas should have `pointer-events: none` so taps and scrolls reach the page.
- One shared `requestAnimationFrame` loop runs every started stage. It pauses when the page is hidden; `dt` is clamped so a returning tab doesn't make creatures jump.
- `prefers-reduced-motion` slows creatures to 60%.

## Behaviour

- **Awake on arrival, sleep later.** By default creatures start awake and won't doze for the first 20 s (8 s after any later wake). After that, `temperament.sleepAfter` seconds with nothing happening sends them to sleep (legs folded, slow breathing, little squares drifting up). The **first** pointer move, press or tap anywhere on the page wakes every sleeper. After that, a pointer moving within roughly `senseRadius × 1.5` wakes one, as do a press, a tap or `wake()`. A sleeper that ends up off-screen wakes and walks back.
- **Staying in view.** The creature roams `world.bounds()` (the visible part of the column, clipped to `visualViewport` so a phone's URL bar doesn't hide it), minus `insets`, with a margin so its legs stay visible. Scrolling carries it with the text. Once scrolling settles (0.25 s) a creature that ends up off-screen re-enters at the nearest edge, already moving, and sprints in (spiders entering from the top drop in on a thread). Measured: back in view 0.25–0.5 s after scrolling stops. A creature that merely wanders near the edge walks back in (mode `return`). It ignores page items that aren't in view and abandons any it was visiting once they scroll away.
- **Attention.** The head and antennae turn toward whatever it attends to (pointer, a call, the word it's reading); antenna tips reach 60% of the way toward it. Crab-walking scuttlers turn their face, not their path.
- **Pointer.** Bold creatures (boldness > 0.55) follow and circle under it. Middle temperaments (0.35–0.55) **watch**: they approach to a keep ring (70 + ½ body length), orbit it sideways (reversing every 2–4 s) and hop back from a lunge faster than 600 px/s. Timid ones freeze and stare, and flee (toward images, sliding along walls when cornered) once it comes within their fear radius. **Pressing/holding** adds +0.5 boldness, so most come to a held finger or mouse. The pointer stops attracting 2.5 s after the last move.
- **Tap on a creature** pokes it (it startles away; very bold ones turn to face you). The hit pad is 12 px for a mouse and 20 px for touch.
- **Tap empty space** calls the nearest creature (mode `called`). It acknowledges on the same frame: the head snaps toward the tap, a wake chirp sounds, and four ink squares contract onto the spot over 0.4 s. It then runs at ≥ 1.35× its top speed (at least 120 px/s) for the first 60% of the way and eases in. A 150 px call takes about 1.1–1.4 s. **Skittish** creatures come 60% of the way, then freeze facing the tap for 1.5 s (mode `wary`); a second tap within the next few seconds brings them all the way.
- **Reading.** Every 2.5–5.5 s of roaming (sooner for curious creatures) it picks a line of text and reads along it: 3 + round(curiosity × 4) words on the same line, stopping at `. ; : ! ?`. It walks along the line at 34–70 px/s and each word is `read` as its head passes. Gluttons `nibble` the phrase instead. When the chain ends it ties the first word to the last with a `thread`; restless and bold ones may `jostle` the last word. If nothing readable is close it looks up to 520 px away and walks over.
- **Other page items.** About 3 times a second an idle creature calls `world.queryNear(x, y, senseRadius)` and may walk to an image or link weighted by temperament (`prefs`) to perch, hide, inspect or tug it. Those visits end early when it's time to read again. Each item then has a 12–30 s cooldown.
- **Locomotion.** Legs step on their own when their foot lags behind its rest spot. Neighbours that are mid-step hold a leg back; neighbours that just landed nudge it forward (a simplified Cruse/Walknet scheme). Tripod, tetrapod, wave and other gaits emerge from those local rules. Each leg is a two-bone IK chain with the knee bent outward. The spine follows the head with a per-joint bend limit.
- **Sound.** Each footstep is a short note: the leg index picks a degree of the creature's seeded scale, and speed sets the loudness. Some creatures also hum, with pitch and filter rising with speed. Voices are panned by screen x. There are chirps on wake, poke and sleep. Overall output is capped at 6 notes per 40 ms. In host mode the engine routes through the host's `world.audio.output` and respects `world.audio.muted`. Standalone, it unlocks its own context on the first gesture (works on iOS). When the page is hidden, audio is suspended.

## The world contract

The engine needs only two methods; everything else is optional.

```ts
queryNear(x, y, radius, limit?): Item[]   // nearest first; the engine may ask for up to 160 items
paperColor?: string                       // page background, for the paper halo (default #f2ecdf)
applyEffect(effect, item, info): void     // info = { crawler, x, y, intensity }
bounds?(): {x, y, w, h}                   // where creatures may roam (default: whole canvas)

Item = { id: string, type: 'text' | 'link' | 'image', x, y, w, h, ...anything }
```

The `effect` names are the engine's behaviour verbs:

| verb | who does it | meaning |
|---|---|---|
| `read` | everyone except gluttons | one word of a reading chain, as the head passes it |
| `nibble` | gluttons | eats one word of a chain |
| `thread` | at the end of a chain | `info.to` is the chain's last word; tie it to the first |
| `tug` | most, on links | pulls at a link |
| `inspect` | on images | circles and looks |
| `hide` | skittish on images | shelters on an image |
| `perch` | drowsy, bold on images | sits on it (drowsy ones fall asleep there) |
| `jostle` | restless, bold, after a chain | shoves the text around |

`createStubWorld` implements this contract for any DOM container. It indexes `.w` (words), `a` and `.img, img`, and turns effects into `.cw-fx-<verb>` classes plus `.cw-eaten`.

### Folio world mapping (automatic)

When `world.kinds` includes `'word'`, `world-adapter.js` wraps it. Item kinds map `word→text`, `link→link`, `image→image`. Verbs map as follows:

| verb | Folio effect |
|---|---|
| read | `highlight` (creature accent colour, 4.2 s), so a chain leaves a visible trail along the line |
| thread | `connect` from the chain's first word to its last |
| nibble | `fade` to 0.2, undone after 45 s |
| tug | `pulse` + short `highlight` |
| inspect / hide / perch | `pulse` + `world.touch(item, 0.5)` |
| jostle | `scatter` (strength 0.55, restored after 7 s), at most once per 20 s; otherwise `pulse` |

On top of that, each footstep that lands on a word `highlight`s it in the creature's tint colour (at most about 5 per second). The creature visibly writes over the text it walks on, and those highlights feed the Folio predictor through its `touch`.

Bounds are the article column (±24 px) clipped to the viewport.

## Traits

`generateTraits(seed)` is pure and deterministic. It uses only integer hashing and plain arithmetic (no `sin` or `pow`), so every JS engine gives identical output. Each aspect (plan, body, legs, gait, temperament, palette, voice, name, head) draws from its own sub-stream, so tuning one aspect doesn't reshuffle the others. **Any change to traits.js changes creatures.** After mint, bump `TRAITS_VERSION` and keep the old generator callable.

```
version, seed, id ('CRW-XXXX'), name {genus, species, full}
plan            spider 22 · centipede 20 · beetle 18 · strider 12 · millipede 10 · scuttler 9 (weights)
body            unit (px per body unit), segmentCount, segments[{r, shape}], shape, headShape,
                profile, gap, bend (deg), rigid, yaw (deg)
                shape: disc · ring · block · lozenge · grain
legs            pairs[{seg, angle, femur, tibia, reach}], count (4–30), length,
                style line · dash · bead · thread, width, knee square · dot · none, foot square · dot · tick
gait            name tripod · tetrapod · wave · amble · bound, stepTime, threshold, lead, waveDir, maxSwing
motion          speed (px/s, 28–230), turn (rad/s), accel
temperament     name curious · skittish · glutton · drowsy · restless · bold,
                curiosity, boldness, sleepAfter (s), restlessness, senseRadius (px), prefs, effects
palette         name + ink / accent / tint (10 palettes: Fluoro, Tangerine, Bruise, Moss, Clinic, Rust,
                Sea Glass, Ultramarine, Ochre, Graphite)
print           offset, angle — misregistration of the accent layer (riso-print look)
head            antennae (0|2), antennaLength, eyes (0–8), mandibles
tail            none · cerci · stinger · spinneret
trail           dots · ticks · none (fading footprints)
voice           root (MIDI), scale, pattern, notes[] (one per leg), timbre pip · click · pluck · wood,
                stepGain, hum, humWave
```

Distribution over 2000 seeds: 6 legs 37%, 8 legs 20%, 4 legs 6%, 10–30 legs the rest (centipedes and millipedes). The six temperaments run from 25% (curious) down to 10% (bold).

`toAttributes(traits)` returns the 12 metadata attributes for the mint (body plan, legs, segments, gait, temperament, palette, shell, leg style, antennae, eyes, tail, voice).

## Visual language

Legs, spine and body are drawn over a thin halo in `world.paperColor` (line width + 2.6 px, body radius + 1.6 px, 90% alpha), so ink legs don't merge with ink letters. This replaces the CSS drop-shadow idea, which re-rasterises a full-screen canvas every frame.

The look is deliberately simple: hollow or filled discs, blocks and lozenges for the body, and hairline legs with square or dot joints. The accent fill is printed slightly off-register from the ink outline, like a two-colour riso print. Fading footprints mark where it has walked; lifted feet show as hollow tint squares. All of this is my own design and not taken from the reference work.

## Performance

Measured in headless Chrome:

- **Desktop**, 1366 px, DPR 2: 60 fps with six creatures on six canvases, about 0.1–0.3 ms of script per frame in total.
- **Phone**, 390×844, DPR 3 (capped at 2), 4× CPU throttle: 60 fps and about 0.3 ms per frame, both for the six-creature demo and for one creature on the Folio.

Rasterisation cost isn't included in those numbers, so real devices still need checking. Nothing on the hot path allocates per frame.

## Demo

Open `crawler-engine/index.html` over HTTP (it uses ES modules), e.g. `http://127.0.0.1:8731/crawler-engine/`. Default seeds are `4, 12, 10, 1, 77, 365` (one of each body plan). Use `?seeds=a,b,c` for others, or the buttons for sound, wake all, new seeds and debug.

QA script: `qa/engine.mjs` (puppeteer-core + local Chrome) tests the demo and Folio at desktop and 390 px phone sizes.

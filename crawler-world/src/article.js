// Builds the encyclopedia-style article DOM from a page seed. All prose words
// are wrapped in <span class="w"> so the world can hit-test and animate them.

import { NAME_PARTS, KINDS, PLACES, SECTION_TITLES } from './corpus.js?v=20261028144733';
import { makePlate } from './plates.js?v=20261028144733';
import { hashString } from './prng.js?v=20261028144733';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') el.className = attrs[k];
    else if (k === 'text') el.textContent = attrs[k];
    else el.setAttribute(k, attrs[k]);
  }
  for (const c of kids) if (c != null) el.append(c);
  return el;
}

// Wrap each word in a span; whitespace stays as text nodes so wrapping and
// copy/paste behave like normal prose.
export function wordsInto(parent, text) {
  const parts = text.split(/(\s+)/);
  for (const p of parts) {
    if (!p) continue;
    if (/^\s+$/.test(p)) parent.append(document.createTextNode(p));
    else parent.append(h('span', { class: 'w', text: p }));
  }
  return parent;
}

export function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function unslug(s) {
  const t = decodeURIComponent(s).replace(/-/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function inventName(rng) {
  const n = rng.pick(NAME_PARTS.onset) + rng.pick(NAME_PARTS.middle) + rng.pick(NAME_PARTS.coda);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export function createArticleBuilder({ rng, predictor, creatureSeed, pageSlug }) {
  const kind = rng.pick(KINDS);
  const place = rng.pick(PLACES);
  const name = inventName(rng);
  const title = pageSlug ? unslug(pageSlug) : `${name} ${kind.noun}`;
  const related = Array.from({ length: 4 }, () => `${inventName(rng)} ${rng.pick(KINDS).noun}`);
  const extraLinks = related.map((r) => r.toLowerCase());
  const sectionOrder = rng.shuffle(SECTION_TITLES);
  let sectionCount = 0;
  let plateCount = 0;

  const hrefFor = (phrase) => {
    const q = new URLSearchParams(location.search);
    if (creatureSeed != null) q.set('seed', String(creatureSeed));
    q.set('page', slugify(phrase));
    return '?' + q.toString();
  };

  function para(segments, cls = '') {
    const p = h('p', { 'data-block': '', class: cls });
    for (const s of segments) {
      if (s.link) {
        const a = h('a', { class: 'xref', href: hrefFor(s.link) });
        wordsInto(a, s.text);
        p.append(a);
      } else wordsInto(p, s.text);
    }
    return p;
  }

  function plate(kindName, caption) {
    plateCount++;
    const { svg, kind: k } = makePlate(rng.fork('plate' + plateCount), kindName);
    const fig = h('figure', { class: 'plate', 'data-block': '', 'aria-label': caption, 'data-kind': k });
    fig.dataset.caption = caption;
    fig.append(svg);
    const cap = wordsInto(h('figcaption'), `Plate ${ROMAN[(plateCount - 1) % 12] || plateCount}. ${caption}`);
    fig.append(cap);
    return fig;
  }

  function heading(level, text, id) {
    const el = h('h' + level, { 'data-block': '', id: id || slugify(text) });
    wordsInto(el, text);
    return el;
  }

  function nextSectionTitle() {
    const touchedWords = predictor.touchedWords();
    sectionCount++;
    if (sectionCount <= sectionOrder.length && !(touchedWords.length && rng.chance(0.35))) return sectionOrder[sectionCount - 1];
    if (touchedWords.length) return `On the ${touchedWords[0]}`;
    return `Addendum ${ROMAN[(sectionCount - sectionOrder.length - 1) % 12]}`;
  }

  // One section: heading + 1–3 paragraphs, sometimes a plate.
  function section(titleText) {
    const t = titleText || nextSectionTitle();
    const sec = h('section', { class: 'entry-section' });
    sec.append(heading(2, t, slugify(t) + '-' + sectionCount));
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      sec.append(para(predictor.paragraph({ extraLinks }).segments));
      if (i === 0 && rng.chance(0.35)) {
        const cap = predictor.sentence(null).replace(/\.$/, '');
        sec.append(plate(rng.pick(['chart', 'specimen', 'type']), cap.length > 90 ? cap.slice(0, 88) + '…' : cap));
      }
    }
    return sec;
  }

  function build() {
    const art = h('article', { class: 'entry', 'data-page': pageSlug || slugify(title) });

    const head = h('header', { class: 'entry-head' });
    head.append(heading(1, title, 'top'));
    const syll = title.toLowerCase().split(' ')[0].replace(/([aeiou]+)/g, '$1·').replace(/·$/, '');
    head.append(h('p', { class: 'entry-meta', text: `${syll} · ${kind.group} · first catalogued in ${place}` }));
    art.append(head);

    // Specimen card (our answer to an infobox).
    const card = h('aside', { class: 'card', 'aria-label': 'Specimen card' });
    card.append(plate(kind.group === 'map' ? 'chart' : kind.group === 'reference work' ? 'type' : 'specimen', `${title}, drawn from a pressed example`));
    const dl = h('dl', { 'data-block': '' });
    const facts = [
      ['Kind', kind.group],
      ['Habitat', kind.habitat],
      ['Range', place.replace(/^the /, '')],
      ['Legs', String(rng.int(6, 40))],
      ['Diet', rng.pick(['heading ink', 'footnotes', 'full stops', 'marginal notes', 'gutter dust', 'bold type'])],
      ['Status', rng.pick(['common', 'rarely seen', 'disputed', 'presumed asleep', 'catalogued'])],
    ];
    for (const [k, v] of facts) {
      dl.append(wordsInto(h('dt'), k), wordsInto(h('dd'), v));
    }
    card.append(dl);
    art.append(card);

    // Lead: one templated sentence + predicted text.
    const lead = `The ${title.toLowerCase()} is a ${kind.group} of ${place}, known chiefly from ${kind.habitat} and from the notes of careful readers. ` + predictor.paragraph({ sentences: 3, extraLinks }).text;
    // Re-segment the whole lead so the templated sentence also gets links.
    art.append(para(segmentLead(lead), 'lead'));

    // Contents (filled in for the first few sections).
    const toc = h('nav', { class: 'toc', 'aria-label': 'Contents' });
    toc.append(h('p', { class: 'toc-title', text: 'In this entry' }));
    const ol = h('ol');
    toc.append(ol);
    art.append(toc);

    const sections = [];
    for (let i = 0; i < 3; i++) {
      const s = section();
      sections.push(s);
      art.append(s);
      const hd = s.querySelector('h2');
      ol.append(h('li', {}, h('a', { href: '#' + hd.id, text: hd.textContent })));
    }
    ol.append(h('li', { class: 'toc-more', text: 'and further, as it is written' }));

    // See also: links to sibling articles.
    const see = h('section', { class: 'entry-section see-also' });
    see.append(heading(2, 'See also', 'see-also'));
    const ul = h('ul', { 'data-block': '' });
    for (const r of related) {
      const a = h('a', { class: 'xref', href: hrefFor(r) });
      wordsInto(a, r);
      ul.append(h('li', {}, a));
    }
    see.append(ul);
    art.append(see);

    const cont = h('div', { class: 'continuation', 'aria-live': 'off' });
    cont.append(h('p', { class: 'continuation-note', text: 'The entry continues below. Nothing past this line was written in advance.' }));
    art.append(cont);
    return { el: art, continuation: cont, title };
  }

  // Lead segmentation reuses the predictor's link phrases plus related names.
  function segmentLead(text) {
    const phrases = [...predictor.linkPhrases, ...extraLinks].sort((a, b) => b.length - a.length);
    const re = new RegExp('\\b(' + phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')s?\\b', 'gi');
    const out = [];
    const seen = new Set([title.toLowerCase()]);
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (seen.has(m[1].toLowerCase())) continue;
      seen.add(m[1].toLowerCase());
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push({ text: m[0], link: m[1].toLowerCase() });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  return { build, section, title, seedFor: (s) => hashString(s) };
}

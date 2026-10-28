// Document-space SVG layer for threads between words. Lives at the document
// origin so lines scroll with the text and need no per-frame work; they are
// only recomputed after reflow (resize, font load, scatter).

const NS = 'http://www.w3.org/2000/svg';

export function createThreadLayer({ doc = document, mount = doc.documentElement, className = 'cw-threads', max = 80, zIndex = 2147483000 } = {}) {
  const host = doc.createElement('div');
  host.className = className;
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'absolute', left: '0', top: '0', width: '1px', height: '1px', overflow: 'visible', pointerEvents: 'none', zIndex: String(zIndex) });
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('width', '1');
  svg.setAttribute('height', '1');
  svg.style.overflow = 'visible';
  svg.style.position = 'absolute';
  host.appendChild(svg);
  mount.appendChild(host);

  const threads = [];

  function centre(el) {
    const r = el.getBoundingClientRect();
    const win = doc.defaultView;
    return { x: r.left + r.width / 2 + win.scrollX, y: r.top + r.height / 2 + win.scrollY, ok: r.width > 0 || r.height > 0 };
  }

  function shape(t) {
    const a = centre(t.a), b = centre(t.b);
    const visible = a.ok && b.ok && t.a.isConnected && t.b.isConnected;
    t.path.style.display = visible ? '' : 'none';
    if (!visible) return;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    // Sag like a thread under its own weight; deterministic per thread.
    const sag = Math.min(80, 12 + dist * 0.18) * t.bend;
    t.path.setAttribute('d', `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${mx.toFixed(1)} ${(my + sag).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
  }

  return {
    host,
    add(a, b, { color, width = 1.2, bend = 1, animate = true } = {}) {
      const path = doc.createElementNS(NS, 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('class', 'cw-thread');
      path.setAttribute('stroke', color || 'currentColor');
      path.setAttribute('stroke-width', String(width));
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);
      const t = { a, b, path, bend };
      shape(t);
      if (animate && path.getTotalLength) {
        const len = path.getTotalLength();
        path.style.strokeDasharray = `${len}`;
        path.style.strokeDashoffset = `${len}`;
        path.getBoundingClientRect();
        path.style.transition = 'stroke-dashoffset 900ms ease-out';
        path.style.strokeDashoffset = '0';
        setTimeout(() => { path.style.strokeDasharray = ''; path.style.transition = ''; }, 950);
      }
      threads.push(t);
      while (threads.length > max) threads.shift().path.remove();
      return { remove: () => { const i = threads.indexOf(t); if (i >= 0) threads.splice(i, 1); path.remove(); } };
    },
    redraw() { threads.forEach(shape); },
    clear() { threads.splice(0).forEach((t) => t.path.remove()); },
    count: () => threads.length,
    destroy() { host.remove(); threads.length = 0; },
  };
}

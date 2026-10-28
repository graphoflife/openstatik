// Interaktive SVG-Zeichenfläche mit Weltkoordinaten (y nach oben), Zoom und Pan.
//
// Drei Ebenen:
//   world   – Geometrie in Weltkoordinaten [m]; Strichstärken bleiben beim Zoomen konstant
//   overlay – Texte und Symbole in Pixelgrösse, an einem Weltpunkt verankert
//   screen  – fest am Bildschirm (Legende, Massstab)
import { svgEl } from './ui.js';
import { fmt, niceNum } from './format.js';

const STYLE_KEYS = { stroke: 'stroke', fill: 'fill', width: 'stroke-width', dash: 'stroke-dasharray', opacity: 'opacity', fillOpacity: 'fill-opacity', cap: 'stroke-linecap', join: 'stroke-linejoin' };

function styleOf(st = {}, defaults = {}) {
  const s = { ...defaults, ...st };
  const out = {};
  for (const [k, css] of Object.entries(STYLE_KEYS)) if (s[k] !== undefined) out[css] = String(s[k]);
  return out;
}

export class SvgView {
  /**
   * @param {HTMLElement} container
   * @param {object} opts {onClick(x,y,ev), onCursor(x,y), onHover(x,y,ev), padding}
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.svg = svgEl('svg', { class: 'sv', xmlns: 'http://www.w3.org/2000/svg' });
    this.defs = svgEl('defs');
    this.gWorld = svgEl('g', { class: 'world' });
    this.gOverlay = svgEl('g', { class: 'overlay' });
    this.gScreen = svgEl('g', { class: 'screen' });
    this.gInteract = svgEl('g', { class: 'interact' }); // Bearbeitungshilfen (Bildschirmkoordinaten), wird nicht von clear() gelöscht
    this.gGrid = svgEl('g', { class: 'gridlayer' });       // Zeichenraster unter dem Modell (Bildschirmkoordinaten)
    this.svg.append(this.defs, this.gGrid, this.gWorld, this.gOverlay, this.gScreen, this.gInteract);
    this.changeListeners = new Set();
    this.interaction = null; // {down(w,e) → bool, move(w,e), up(w,e), hover(w,e), leave(), dblclick(w,e) → bool}
    container.append(this.svg);
    this.s = 50; this.tx = 0; this.ty = 0;
    this.items = [];
    this.screenItems = [];
    this.bbox = null;
    this.modelBounds = null;
    this.fitted = false;
    this.width = 1; this.height = 1;
    this._bindEvents();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._resize();
  }

  // -------------------------------------------------------------- Koordinaten
  X(x) { return this.tx + this.s * x; }
  Y(y) { return this.ty - this.s * y; }
  wx(px) { return (px - this.tx) / this.s; }
  wy(py) { return (this.ty - py) / this.s; }
  /** Pixellänge → Weltlänge */
  px(n) { return n / this.s; }
  get scale() { return this.s; }

  _resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, r.width), hgt = Math.max(1, r.height);
    const cx = this.wx(this.width / 2), cy = this.wy(this.height / 2);
    this.width = w; this.height = hgt;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    if (this.userAdjusted) { this.tx = w / 2 - this.s * cx; this.ty = hgt / 2 + this.s * cy; this._apply(); }
    else this.fit();
    this._layoutScreen();
  }

  _apply() {
    this.gWorld.setAttribute('transform', `matrix(${this.s} 0 0 ${-this.s} ${this.tx} ${this.ty})`);
    for (const it of this.items) {
      if (it.layout) it.layout();
      else it.g.setAttribute('transform', `translate(${this.X(it.x).toFixed(2)} ${this.Y(it.y).toFixed(2)})`);
    }
    this._layoutScreen();
    this.opts.onViewChange?.(this);
    for (const fn of this.changeListeners) fn(this);
  }

  /** Rückruf bei jeder Änderung von Zoom/Ausschnitt. */
  onChange(fn) { this.changeListeners.add(fn); return () => this.changeListeners.delete(fn); }

  // -------------------------------------------------------------- Interaktion
  _bindEvents() {
    const svg = this.svg;
    const pointers = new Map();
    let pan = null, pinch = null, act = null;
    const local = (e) => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const W = ([x, y]) => [this.wx(x), this.wy(y)];
    // Leertaste gedrückt halten: Ansicht mit der linken Maustaste verschieben
    this.spaceHeld = false;
    if (typeof document !== 'undefined') {
      const isField = (t) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
      document.addEventListener('keydown', (e) => { if (e.key === ' ' && !isField(e.target) && this.hovered) { this.spaceHeld = true; svg.classList.add('grab'); e.preventDefault(); } });
      document.addEventListener('keyup', (e) => { if (e.key === ' ') { this.spaceHeld = false; svg.classList.remove('grab'); } });
    }
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    svg.addEventListener('pointerenter', () => { this.hovered = true; });
    svg.addEventListener('pointerleave', () => { this.hovered = false; this.interaction?.leave?.(); });

    svg.addEventListener('pointerdown', (e) => {
      if (e.button > 2) return;
      svg.setPointerCapture(e.pointerId);
      const pt = local(e);
      pointers.set(e.pointerId, pt);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.s, wx: this.wx((a[0] + b[0]) / 2), wy: this.wy((a[1] + b[1]) / 2) };
        pan = null;
        if (act) { this.interaction?.cancel?.(); act = null; }
        return;
      }
      const forcePan = e.button === 1 || e.button === 2 || this.spaceHeld;
      if (!forcePan && e.button === 0 && this.interaction?.down?.(W(pt), e) === true) {
        act = { id: e.pointerId };
        return;
      }
      pan = { x: pt[0], y: pt[1], tx: this.tx, ty: this.ty, moved: false, button: e.button, force: forcePan };
    });
    svg.addEventListener('pointermove', (e) => {
      const pt = local(e);
      const [x, y] = pt;
      this.opts.onCursor?.(this.wx(x), this.wy(y));
      if (!pointers.has(e.pointerId)) {
        this.opts.onHover?.(this.wx(x), this.wy(y), e);
        this.interaction?.hover?.(W(pt), e);
        return;
      }
      pointers.set(e.pointerId, pt);
      if (act && act.id === e.pointerId) { this.interaction?.move?.(W(pt), e); return; }
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.s = Math.min(1e6, Math.max(1e-4, pinch.s * d / Math.max(1, pinch.d)));
        const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
        this.tx = cx - this.s * pinch.wx; this.ty = cy + this.s * pinch.wy;
        this.fitted = true; this.userAdjusted = true;
        this._apply();
      } else if (pan) {
        const dx = x - pan.x, dy = y - pan.y;
        if (!pan.moved && Math.hypot(dx, dy) < 4) return;
        pan.moved = true;
        svg.classList.add('panning');
        this.tx = pan.tx + dx; this.ty = pan.ty + dy;
        this.fitted = true; this.userAdjusted = true;
        this._apply();
      }
    });
    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (act && act.id === e.pointerId) {
        act = null;
        if (e.type === 'pointerup') this.interaction?.up?.(W(local(e)), e);
        else this.interaction?.cancel?.();
        return;
      }
      if (pan && !pan.moved && e.type === 'pointerup' && pan.button === 0 && !pan.force) {
        const [x, y] = local(e);
        this.opts.onClick?.(this.wx(x), this.wy(y), e);
      }
      pan = null;
      svg.classList.remove('panning');
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      this.zoomAt(x, y, f);
    }, { passive: false });
    svg.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (this.interaction?.dblclick?.(W(local(e)), e) === true) return;
      this.fit();
    });
  }

  zoomAt(px, py, f) {
    const wx = this.wx(px), wy = this.wy(py);
    this.s = Math.min(1e6, Math.max(1e-4, this.s * f));
    this.tx = px - this.s * wx; this.ty = py + this.s * wy;
    this.fitted = true; this.userAdjusted = true;
    this._apply();
  }
  zoom(f) { this.zoomAt(this.width / 2, this.height / 2, f); }

  /** Passt die Ansicht an die Modellgrenzen (bzw. alle gezeichneten Elemente) an. */
  fit(padding = this.opts.padding ?? 48) {
    const b = this.modelBounds || this.bbox;
    if (!b) { this.s = 50; this.tx = this.width / 2; this.ty = this.height / 2; this._apply(); return; }
    const w = Math.max(b.x1 - b.x0, 1e-9), hh = Math.max(b.y1 - b.y0, 1e-9);
    const place = (il) => {
      const pw = Math.max(10, this.width - il - 2 * padding), ph = Math.max(10, this.height - 2 * padding);
      let s = Math.min(pw / w, ph / hh);
      if (!Number.isFinite(s) || s <= 0) s = 50;
      if (b.x1 - b.x0 < 1e-9 && b.y1 - b.y0 < 1e-9) s = 50;
      return { s, tx: il + (this.width - il) / 2 - s * (b.x0 + b.x1) / 2, ty: this.height / 2 + s * (b.y0 + b.y1) / 2 };
    };
    let f = place(0);
    // Schwebende Fenster (z.B. Eigenschaftsfenster): nur ausweichen, wenn das Modell sonst darunter läge
    const ins = typeof this.insets === 'function' ? this.insets() : this.insets || {};
    if (ins.rect) {
      const X0 = f.tx + f.s * b.x0, X1 = f.tx + f.s * b.x1, Y0 = f.ty - f.s * b.y1, Y1 = f.ty - f.s * b.y0;
      const r = ins.rect;
      const overlap = X0 < r.x1 && X1 > r.x0 && Y0 < r.y1 && Y1 > r.y0;
      if (overlap) f = place(Math.min(r.x1 + 8, this.width * 0.45));
    } else if (ins.left) f = place(Math.min(ins.left, this.width * 0.45));
    this.s = f.s; this.tx = f.tx; this.ty = f.ty;
    this.fitted = true; this.userAdjusted = false;
    this._apply();
  }

  /**
   * Setzt die massgebenden Modellgrenzen für "Einpassen". Ändern sie sich gegenüber dem
   * letzten Aufruf, wird automatisch neu eingepasst.
   */
  setBounds(x0, y0, x1, y1, opts = {}) {
    const nb = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
    const ob = this.modelBounds;
    const tol = 1e-6 * Math.max(1, nb.x1 - nb.x0, nb.y1 - nb.y0);
    const changed = !ob || Math.abs(ob.x0 - nb.x0) > tol || Math.abs(ob.x1 - nb.x1) > tol || Math.abs(ob.y0 - nb.y0) > tol || Math.abs(ob.y1 - nb.y1) > tol;
    this.modelBounds = nb;
    if (changed && !opts.noFit) this._needFit = true;
  }

  /** Grenzen aus einer Punktliste [[x,y],…] setzen. */
  setBoundsFromPoints(pts, margin = 0) {
    if (!pts.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    this.setBounds(x0 - margin, y0 - margin, x1 + margin, y1 + margin);
  }

  // -------------------------------------------------------------- Zeichnen
  /** Löscht alle Elemente (Transformation bleibt). */
  clear() {
    for (const g of [this.gWorld, this.gOverlay, this.gScreen]) while (g.firstChild) g.removeChild(g.firstChild);
    this.items = [];
    this.screenItems = [];
    this.bbox = null;
  }

  /** Nach dem Zeichnen aufrufen: passt bei Bedarf automatisch ein. */
  finish() {
    if (this._needFit || !this.fitted) { this._needFit = false; this.fit(); }
    else this._apply();
    this._layoutScreen();
  }

  _ext(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const b = this.bbox || (this.bbox = { x0: x, y0: y, x1: x, y1: y });
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
  }

  _world(el, parent) {
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    (parent || this.gWorld).append(el);
    return el;
  }

  /** Neue Gruppe in der Weltebene (z.B. für Layer). */
  group(cls) {
    const g = svgEl('g', { class: cls || '' });
    this.gWorld.append(g);
    return g;
  }

  line(x1, y1, x2, y2, st = {}) {
    this._ext(x1, y1); this._ext(x2, y2);
    return this._world(svgEl('line', { x1, y1, x2, y2, style: styleOf(st, { stroke: 'var(--c-struct)', width: 1.5, cap: 'round' }) }), st.parent);
  }

  polyline(pts, st = {}) {
    for (const p of pts) this._ext(p[0], p[1]);
    return this._world(svgEl('polyline', { points: pts.map((p) => `${p[0]},${p[1]}`).join(' '), style: styleOf(st, { stroke: 'var(--c-struct)', width: 1.5, fill: 'none', join: 'round', cap: 'round' }) }), st.parent);
  }

  polygon(pts, st = {}) {
    for (const p of pts) this._ext(p[0], p[1]);
    return this._world(svgEl('polygon', { points: pts.map((p) => `${p[0]},${p[1]}`).join(' '), style: styleOf(st, { stroke: 'var(--c-struct)', width: 1, fill: 'var(--c-struct-fill)', join: 'round' }) }), st.parent);
  }

  /** Pfad aus mehreren Ringen (für Polygone mit Löchern, fill-rule evenodd). */
  rings(rings, st = {}) {
    let d = '';
    for (const r of rings) {
      if (!r.length) continue;
      for (const p of r) this._ext(p[0], p[1]);
      d += 'M' + r.map((p) => `${p[0]},${p[1]}`).join('L') + 'Z';
    }
    const el = svgEl('path', { d, 'fill-rule': 'evenodd', style: styleOf(st, { stroke: 'var(--c-struct)', width: 1, fill: 'var(--c-struct-fill)', join: 'round' }) });
    return this._world(el, st.parent);
  }

  rect(x, y, w, hgt, st = {}) {
    return this.polygon([[x, y], [x + w, y], [x + w, y + hgt], [x, y + hgt]], st);
  }

  /** Kreis mit Radius in Weltkoordinaten. */
  circle(x, y, r, st = {}) {
    this._ext(x - r, y - r); this._ext(x + r, y + r);
    return this._world(svgEl('circle', { cx: x, cy: y, r, style: styleOf(st, { stroke: 'var(--c-struct)', width: 1, fill: 'none' }) }), st.parent);
  }

  /** Kreisbogen (Weltkoordinaten, Winkel in Grad, Gegenuhrzeigersinn). */
  arc(cx, cy, r, a0, a1, st = {}) {
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 5));
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return this.polyline(pts, st);
  }

  // -------------------------------------------------------------- Overlay (Pixelgrösse)
  _overlay(x, y, g, track = true) {
    if (track) this._ext(x, y);
    g.setAttribute('transform', `translate(${this.X(x).toFixed(2)} ${this.Y(y).toFixed(2)})`);
    this.gOverlay.append(g);
    this.items.push({ g, x, y });
    return g;
  }

  /**
   * Text an Weltpunkt. opts: {dx, dy (Pixel, +dy nach unten), anchor:'start'|'middle'|'end',
   * baseline:'middle'|'hanging'|'auto', size, color, bold, halo (Hintergrundkontur), rotate (Grad, Gegenuhrzeigersinn)}
   */
  text(x, y, str, o = {}) {
    const g = svgEl('g');
    const t = svgEl('text', {
      x: o.dx || 0, y: o.dy || 0, 'text-anchor': o.anchor || 'middle', 'dominant-baseline': o.baseline || 'middle',
      transform: o.rotate ? `rotate(${-o.rotate} ${o.dx || 0} ${o.dy || 0})` : undefined,
      style: { fontSize: `${o.size || 11}px`, fill: o.color || 'var(--text)', fontWeight: o.bold ? 700 : 400, paintOrder: 'stroke', stroke: o.halo === false ? 'none' : 'var(--surface-2)', strokeWidth: o.halo === false ? 0 : 3, strokeLinejoin: 'round', fontFamily: o.mono ? 'var(--mono)' : undefined },
      text: str,
    });
    g.append(t);
    if (o.title) g.append(svgEl('title', { text: o.title }));
    return this._overlay(x, y, g, o.track !== false);
  }

  /** Punkt mit Radius in Pixeln. */
  dot(x, y, r = 3, st = {}) {
    const g = svgEl('g');
    g.append(svgEl('circle', { cx: 0, cy: 0, r, style: styleOf(st, { fill: 'var(--c-struct)', stroke: 'var(--surface)', width: 1 }) }));
    if (st.title) g.append(svgEl('title', { text: st.title }));
    return this._overlay(x, y, g);
  }

  /** Beliebiges Symbol: build(g) zeichnet in Pixelkoordinaten relativ zum Anker (y nach unten). */
  symbol(x, y, build, opts = {}) {
    const g = svgEl('g');
    const inner = svgEl('g', { transform: opts.rotate ? `rotate(${-opts.rotate})` : undefined });
    build(inner, svgEl);
    g.append(inner);
    return this._overlay(x, y, g, opts.track !== false);
  }

  /**
   * Pfeil mit Spitze am Weltpunkt (x,y), Richtung (dx,dy) in Weltorientierung (y nach oben).
   * opts: {length (px), color, width, label, head (px), tail:true → Pfeil zeigt vom Punkt weg}
   */
  arrow(x, y, dx, dy, o = {}) {
    const len = o.length ?? 36, head = o.head ?? 8, col = o.color || 'var(--c-load)';
    const n = Math.hypot(dx, dy) || 1;
    const ux = dx / n, uy = -dy / n; // Bildschirmrichtung
    return this.symbol(x, y, (g) => {
      const tip = o.tail ? [ux * len, uy * len] : [0, 0];
      const base = o.tail ? [0, 0] : [-ux * len, -uy * len];
      const offs = o.offset || 0;
      tip[0] -= ux * offs; tip[1] -= uy * offs; base[0] -= ux * offs; base[1] -= uy * offs;
      g.append(svgEl('line', { x1: base[0], y1: base[1], x2: tip[0] - ux * head * 0.6, y2: tip[1] - uy * head * 0.6, style: { stroke: col, strokeWidth: o.width || 1.6 } }));
      const px = -uy, py = ux;
      g.append(svgEl('polygon', { points: `${tip[0]},${tip[1]} ${tip[0] - ux * head + px * head * 0.42},${tip[1] - uy * head + py * head * 0.42} ${tip[0] - ux * head - px * head * 0.42},${tip[1] - uy * head - py * head * 0.42}`, style: { fill: col } }));
      if (o.label) {
        const lx = base[0] - ux * 6, ly = base[1] - uy * 6;
        g.append(svgEl('text', { x: lx, y: ly, 'text-anchor': Math.abs(ux) > 0.5 ? (ux > 0 ? 'end' : 'start') : 'middle', 'dominant-baseline': Math.abs(uy) > 0.5 ? (uy > 0 ? 'auto' : 'hanging') : 'middle', style: { fontSize: '11px', fill: col, paintOrder: 'stroke', stroke: 'var(--surface-2)', strokeWidth: 3 }, text: o.label }));
      }
    }, { track: o.track });
  }

  /** Momentenpfeil (Kreisbogen) um Weltpunkt; sign>0 Gegenuhrzeigersinn. */
  momentArrow(x, y, sign = 1, o = {}) {
    const r = o.radius ?? 16, col = o.color || 'var(--c-load)';
    return this.symbol(x, y, (g) => {
      const a0 = -50 * Math.PI / 180, a1 = 220 * Math.PI / 180;
      const pts = [];
      for (let i = 0; i <= 24; i++) { const a = a0 + (a1 - a0) * i / 24; pts.push([r * Math.cos(a), -r * Math.sin(a)]); }
      if (sign < 0) pts.reverse();
      g.append(svgEl('polyline', { points: pts.map((p) => p.join(',')).join(' '), style: { fill: 'none', stroke: col, strokeWidth: 1.6 } }));
      const [ex, ey] = pts[pts.length - 1], [px, py] = pts[pts.length - 3];
      const ux = ex - px, uy = ey - py, n = Math.hypot(ux, uy) || 1;
      const tx = ux / n, ty = uy / n;
      g.append(svgEl('polygon', { points: `${ex + tx * 3},${ey + ty * 3} ${ex - tx * 5 - ty * 4},${ey - ty * 5 + tx * 4} ${ex - tx * 5 + ty * 4},${ey - ty * 5 - tx * 4}`, style: { fill: col } }));
      if (o.label) g.append(svgEl('text', { x: r + 4, y: -r, 'text-anchor': 'start', style: { fontSize: '11px', fill: col, paintOrder: 'stroke', stroke: 'var(--surface-2)', strokeWidth: 3 }, text: o.label }));
    });
  }

  /**
   * Auflagersymbol. type: 'fixed' | 'pinned' | 'roller' | 'spring' | 'rollerX' (horizontal verschieblich) …
   * angle (Grad): Richtung von Auflager zum Bauteil; 90 = Bauteil oberhalb (Standard).
   */
  support(x, y, type = 'pinned', angle = 90, o = {}) {
    const col = o.color || 'var(--c-support)';
    return this.symbol(x, y, (g) => {
      const st = { stroke: col, strokeWidth: 1.6, fill: 'none', strokeLinejoin: 'round' };
      const hatch = (y0, w) => { for (let i = -w; i < w; i += 5) g.append(svgEl('line', { x1: i, y1: y0, x2: i + 5, y2: y0 - 5 + 10, style: { stroke: col, strokeWidth: 1 } })); };
      if (type === 'fixed') {
        g.append(svgEl('line', { x1: -14, y1: 0, x2: 14, y2: 0, style: { ...st, strokeWidth: 2.4 } }));
        for (let i = -14; i < 14; i += 5) g.append(svgEl('line', { x1: i, y1: 0, x2: i + 5, y2: 6, style: { stroke: col, strokeWidth: 1 } }));
      } else if (type === 'spring') {
        g.append(svgEl('polyline', { points: '0,0 0,4 -5,7 5,11 -5,15 5,19 0,22 0,26', style: st }));
        g.append(svgEl('line', { x1: -10, y1: 26, x2: 10, y2: 26, style: st }));
        hatch(26, 10);
      } else {
        g.append(svgEl('polygon', { points: '0,0 -9,14 9,14', style: { ...st, fill: 'var(--surface)' } }));
        g.append(svgEl('circle', { cx: 0, cy: 0, r: 2.5, style: { fill: 'var(--surface)', stroke: col, strokeWidth: 1.4 } }));
        if (type === 'roller') {
          g.append(svgEl('line', { x1: -13, y1: 18, x2: 13, y2: 18, style: st }));
          hatch(18, 13);
        } else {
          g.append(svgEl('line', { x1: -13, y1: 14, x2: 13, y2: 14, style: st }));
          hatch(14, 13);
        }
      }
    }, { rotate: angle - 90 });
  }

  /** Gelenksymbol (offener Kreis). */
  hinge(x, y, o = {}) {
    return this.symbol(x, y, (g) => g.append(svgEl('circle', { cx: o.dx || 0, cy: o.dy || 0, r: o.r || 4, style: { fill: 'var(--surface)', stroke: o.color || 'var(--c-struct)', strokeWidth: 1.5 } })));
  }

  /**
   * Bemassung zwischen zwei Weltpunkten. Der Versatz ist in Pixeln angegeben (positiv = links der Richtung 1→2)
   * und bleibt beim Zoomen konstant, weil die Bemassung bei jeder Ansichtsänderung neu ausgelegt wird.
   */
  dimension(x1, y1, x2, y2, label, offsetPx = 24, o = {}) {
    const col = o.color || 'var(--c-dim)';
    this._ext(x1, y1); this._ext(x2, y2);
    const g = svgEl('g', { class: 'dim' });
    this.gOverlay.append(g);
    const layout = () => {
      while (g.firstChild) g.removeChild(g.firstChild);
      const X1 = this.X(x1), Y1 = this.Y(y1), X2 = this.X(x2), Y2 = this.Y(y2);
      const L = Math.hypot(X2 - X1, Y2 - Y1);
      if (L < 1e-6) return;
      const ux = (X2 - X1) / L, uy = (Y2 - Y1) / L;
      const nx = uy, ny = -ux; // links der Richtung 1→2 (Bildschirm, y nach unten)
      const sg = Math.sign(offsetPx) || 1, off = offsetPx;
      const st = { stroke: col, strokeWidth: 0.8 };
      const ln = (a, b, c, d, w) => g.append(svgEl('line', { x1: a, y1: b, x2: c, y2: d, style: w ? { ...st, strokeWidth: w } : st }));
      const ax = X1 + nx * off, ay = Y1 + ny * off, bx = X2 + nx * off, by = Y2 + ny * off;
      ln(X1 + nx * 4 * sg, Y1 + ny * 4 * sg, ax + nx * 4 * sg, ay + ny * 4 * sg);
      ln(X2 + nx * 4 * sg, Y2 + ny * 4 * sg, bx + nx * 4 * sg, by + ny * 4 * sg);
      ln(ax, ay, bx, by);
      for (const [px, py] of [[ax, ay], [bx, by]]) ln(px - (ux + nx) * 3.5, py - (uy + ny) * 3.5, px + (ux + nx) * 3.5, py + (uy + ny) * 3.5, 1.2);
      if (label === undefined || label === null || label === '') return;
      let ang = Math.atan2(uy, ux) * 180 / Math.PI;
      if (ang > 90.01) ang -= 180; if (ang < -89.99) ang += 180;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const flip = Math.abs(Math.atan2(uy, ux) * 180 / Math.PI) > 90.01 ? -1 : 1;
      const side = sg * flip; // Text auf der Aussenseite der Masslinie
      g.append(svgEl('text', {
        x: 0, y: side > 0 ? -5 : 5, 'text-anchor': 'middle', 'dominant-baseline': side > 0 ? 'auto' : 'hanging',
        transform: `translate(${mx.toFixed(2)} ${my.toFixed(2)}) rotate(${ang.toFixed(2)})`,
        style: { fontSize: '10.5px', fill: col, paintOrder: 'stroke', stroke: 'var(--surface-2)', strokeWidth: 3 }, text: label,
      }));
    };
    layout();
    this.items.push({ g, layout });
    return g;
  }

  // -------------------------------------------------------------- Bildschirmebene
  _layoutScreen() {
    for (const it of this.screenItems) it.layout(this.width, this.height);
  }

  /**
   * Farblegende oben rechts. opts: {title, unit, min, max, color(t∈[0,1]), steps, digits, levels: [Werte]}
   */
  legend(o) {
    const g = svgEl('g', { class: 'legend' });
    const n = o.steps || 10, bw = 16, bh = 16;
    const levels = o.levels || Array.from({ length: n + 1 }, (_, i) => o.min + (o.max - o.min) * i / n);
    const nb = levels.length - 1;
    const W = 112, H = nb * bh + 40;
    g.append(svgEl('rect', { x: 0, y: 0, width: W, height: H, rx: 6, style: { fill: 'var(--surface)', stroke: 'var(--border)', opacity: 0.94 } }));
    g.append(svgEl('text', { x: 10, y: 17, style: { fontSize: '11.5px', fontWeight: 600, fill: 'var(--text)' }, text: o.title + (o.unit ? ` [${o.unit}]` : '') }));
    const span = (levels[nb] - levels[0]) || 1;
    for (let i = 0; i < nb; i++) {
      const j = nb - 1 - i;
      const t = ((levels[j] + levels[j + 1]) / 2 - levels[0]) / span;
      g.append(svgEl('rect', { x: 10, y: 28 + i * bh, width: bw, height: bh, style: { fill: o.color(t), stroke: 'var(--surface)', strokeWidth: 0.5 } }));
    }
    const d = o.digits ?? 2;
    for (let i = 0; i <= nb; i++) {
      g.append(svgEl('text', { x: 10 + bw + 6, y: 28 + i * bh, 'dominant-baseline': 'middle', style: { fontSize: '10.5px', fill: 'var(--text-2)', fontFamily: 'var(--mono)' }, text: fmt(levels[nb - i], d) }));
    }
    this.gScreen.append(g);
    this.screenItems.push({ g, layout: (w) => g.setAttribute('transform', `translate(${w - W - 12} 12)`) });
    this._layoutScreen();
    return g;
  }

  /** Infotext unten links (z.B. Massstab der Darstellung). */
  caption(text) {
    const g = svgEl('g');
    const t = svgEl('text', { x: 0, y: 0, style: { fontSize: '11px', fill: 'var(--text-2)', paintOrder: 'stroke', stroke: 'var(--surface-2)', strokeWidth: 3 }, text });
    g.append(t);
    this.gScreen.append(g);
    this.screenItems.push({ g, layout: (w, hgt) => g.setAttribute('transform', `translate(12 ${hgt - 12})`) });
    this._layoutScreen();
    return g;
  }

  /** Massstabsbalken unten rechts. */
  scaleBar() {
    const g = svgEl('g');
    this.gScreen.append(g);
    const layout = (w, hgt) => {
      while (g.firstChild) g.removeChild(g.firstChild);
      const L = niceNum(this.px(100), true);
      const pxL = L * this.s;
      g.append(svgEl('line', { x1: 0, y1: 0, x2: pxL, y2: 0, style: { stroke: 'var(--text-2)', strokeWidth: 2 } }));
      g.append(svgEl('line', { x1: 0, y1: -4, x2: 0, y2: 4, style: { stroke: 'var(--text-2)', strokeWidth: 1.5 } }));
      g.append(svgEl('line', { x1: pxL, y1: -4, x2: pxL, y2: 4, style: { stroke: 'var(--text-2)', strokeWidth: 1.5 } }));
      g.append(svgEl('text', { x: pxL / 2, y: -7, 'text-anchor': 'middle', style: { fontSize: '10.5px', fill: 'var(--text-2)' }, text: L >= 1 ? `${fmt(L, L % 1 ? 1 : 0)} m` : `${fmt(L * 100, L * 100 % 1 ? 1 : 0)} cm` }));
      g.setAttribute('transform', `translate(${w - pxL - 16} ${hgt - 14})`);
    };
    this.screenItems.push({ g, layout });
    this._layoutScreen();
    return g;
  }

  /**
   * Zeichenerklärung unten links (über der Bildunterschrift).
   * items: [{label, color, type: 'line' | 'fill' | 'dot', dash}]
   */
  keyLegend(items) {
    const g = svgEl('g', { class: 'key-legend' });
    const rowH = 17;
    items.forEach((it, i) => {
      const y = i * rowH;
      const col = it.color || 'var(--text-2)';
      if (it.type === 'fill') g.append(svgEl('rect', { x: 0, y: y - 6, width: 18, height: 12, rx: 2, style: { fill: it.fill || col, stroke: col, strokeWidth: 1, fillOpacity: it.fill ? 1 : 0.35 } }));
      else if (it.type === 'dot') g.append(svgEl('circle', { cx: 9, cy: y, r: 4, style: { fill: col } }));
      else g.append(svgEl('line', { x1: 0, y1: y, x2: 18, y2: y, style: { stroke: col, strokeWidth: it.width || 2.2, strokeDasharray: it.dash || null } }));
      g.append(svgEl('text', { x: 24, y, 'dominant-baseline': 'middle', style: { fontSize: '11px', fill: 'var(--text-2)', paintOrder: 'stroke', stroke: 'var(--surface-2)', strokeWidth: 3 }, text: it.label }));
    });
    this.gScreen.append(g);
    this.screenItems.push({ g, layout: (w, hgt) => g.setAttribute('transform', `translate(14 ${hgt - 34 - (items.length - 1) * rowH})`) });
    this._layoutScreen();
    return g;
  }

  /** Exportiert die aktuelle Ansicht als eigenständiges SVG-Element (für Berichte). */
  snapshot(width = this.width, height = this.height) {
    const clone = this.svg.cloneNode(true);
    clone.removeAttribute('class');
    // Bearbeitungshilfen (Raster, Auswahl, Fangzeichen) gehören nicht in Berichte und Exporte
    clone.querySelectorAll('.gridlayer, .interact').forEach((g) => g.remove());
    clone.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    clone.setAttribute('width', width);
    clone.setAttribute('height', height);
    clone.style.background = 'var(--surface)';
    return clone;
  }

  destroy() { this._ro.disconnect(); this.svg.remove(); }
}

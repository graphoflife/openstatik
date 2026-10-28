// Querschnitt – Grafik: Geometrie, Dehnungen, Spannungen; Vorzeichenskizze
//
// Weltkoordinaten der Grafik in mm (y nach rechts, z nach oben) – dieselben Einheiten wie die Eingabe und der
// grafische Editor. Der Rechenkern liefert m; Dehnungsgradienten werden auf 1/mm umgerechnet. Farbgebung der Zustände:
// Druck (negativ) blau = var(--c-pos…), Zug (positiv) rosé = var(--c-neg…) – passend zur
// divergierenden Farbskala aus colormap.js (negativ blau, positiv rosé).

import { svgEl } from '../../js/core/ui.js';
import { diverging } from '../../js/core/colormap.js';
import { fmt } from '../../js/core/format.js';
import { projectGeometry, bounds } from './shapes.js';
import { grossProps } from './calc.js';
import { hasOutline } from './model.js';

const MM = 1e-3;
/** m → mm */
const toMm = (v) => v / MM;

export const STATE_OPTIONS = [
  { value: 'auto', label: 'nach Lastfalltyp' },
  { value: 'uls', label: 'GZT – Bemessungslasten' },
  { value: 'ulsR', label: 'GZT – Bruchzustand' },
  { value: 'sls', label: 'GZG – gerissen elastisch' },
];

/** Index des gewählten Lastfalls (begrenzt auf vorhandene Lastfälle). */
export function caseIndex(app) {
  const n = app.project?.loads?.length || 0;
  let i = Math.round(Number(app.viewOpts.lc) || 0);
  if (i >= n) i = n - 1;
  if (i < 0) i = 0;
  return i;
}

/** Dargestellter Zustand eines Lastfalls: {st, key, label, sec}. */
export function viewState(app, c) {
  const R = app.results;
  let key = app.viewOpts.state || 'auto';
  if (key === 'auto') key = c.type === 'GZG' ? 'sls' : 'uls';
  if (key === 'sls') return { st: c.slsState, key, label: 'GZG gerissen, elastisch', sec: R.secs.sls };
  if (key === 'ulsR') {
    const u = c.uls || R.lazy.cap(c.N, c.My, c.Mz);
    return {
      st: u.rstate ? { ok: true, ...u.rstate } : { ok: false, msg: 'Bruchzustand nicht bestimmbar.' },
      key, label: `GZT-Bruchzustand (${u.mode || '–'})`, sec: R.secs.uls,
    };
  }
  return { st: c.ulsState, key: 'uls', label: 'GZT unter Bemessungslasten', sec: R.secs.uls };
}

// ------------------------------------------------------------------ Hilfen

/** Polygon auf den Bereich g(p) ≥ 0 beschneiden (Sutherland–Hodgman, g linear). */
function clipHalf(pts, g) {
  const out = [];
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const ga = g(a), gb = g(b);
    if (ga >= 0) out.push(a);
    if ((ga >= 0) !== (gb >= 0)) {
      const t = ga / (ga - gb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/** Querschnittsringe beschnitten auf lo ≤ f ≤ hi. */
function clipRings(gm, f, lo, hi) {
  const clip = (pts) => clipHalf(clipHalf(pts, (p) => f(p) - lo), (p) => hi - f(p));
  const outer = clip(gm.outer);
  if (outer.length < 3) return [];
  return [outer, ...gm.holes.map(clip).filter((h) => h.length >= 3)];
}

/** Gerade a·y + b·z + c = 0 auf ein Rechteck beschneiden. */
function clipLine(a, b, c, box) {
  const pts = [];
  const { x0, y0, x1, y1 } = box;
  if (Math.abs(b) > 1e-14) for (const x of [x0, x1]) { const y = -(a * x + c) / b; if (y >= y0 - 1e-12 && y <= y1 + 1e-12) pts.push([x, y]); }
  if (Math.abs(a) > 1e-14) for (const y of [y0, y1]) { const x = -(b * y + c) / a; if (x >= x0 - 1e-12 && x <= x1 + 1e-12) pts.push([x, y]); }
  if (pts.length < 2) return null;
  let best = null, dmax = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    if (d > dmax) { dmax = d; best = [pts[i], pts[j]]; }
  }
  return best;
}

const TXT = (size = 11, color = 'var(--text)', weight = 400) => ({ fontSize: `${size}px`, fill: color, fontWeight: weight, paintOrder: 'stroke', stroke: 'var(--surface-2)', strokeWidth: 3, strokeLinejoin: 'round' });

function drawConcrete(v, gm, st = {}) {
  v.rings([gm.outer, ...gm.holes], { fill: 'var(--c-concrete)', stroke: 'var(--c-concrete-line)', width: 1.4, ...st });
}

function centroidSymbol(v, y, z, label, title) {
  v.symbol(y, z, (g, el) => {
    g.append(el('circle', { cx: 0, cy: 0, r: 6, style: { fill: 'var(--surface)', stroke: 'var(--c-struct)', strokeWidth: 1.2 } }));
    g.append(el('path', { d: 'M0,0 L6,0 A6,6 0 0,0 0,-6 Z M0,0 L-6,0 A6,6 0 0,0 0,6 Z', style: { fill: 'var(--c-struct)' } }));
    if (label) g.append(el('text', { x: 9, y: -8, style: TXT(11, 'var(--text)', 700), text: label }));
    if (title) g.append(el('title', { text: title }));
  }, { track: false });
}

function refSymbol(v, y, z) {
  v.symbol(y, z, (g, el) => {
    g.append(el('path', { d: 'M-7,0 L7,0 M0,-7 L0,7', style: { stroke: 'var(--c-load)', strokeWidth: 2 } }));
    g.append(el('circle', { cx: 0, cy: 0, r: 3.5, style: { fill: 'var(--surface)', stroke: 'var(--c-load)', strokeWidth: 1.5 } }));
    g.append(el('text', { x: 9, y: 12, style: TXT(10.5, 'var(--c-load)', 600), text: 'Bezugspunkt' }));
    g.append(el('title', { text: 'Bezugspunkt der Schnittgrössen N, My, Mz' }));
  }, { track: false });
}

function originSymbol(v) {
  v.symbol(0, 0, (g, el) => {
    const st = { stroke: 'var(--text-3)', strokeWidth: 1.3, fill: 'none' };
    g.append(el('path', { d: 'M0,0 L28,0 M22,-4 L28,0 L22,4', style: st }));
    g.append(el('path', { d: 'M0,0 L0,-28 M-4,-22 L0,-28 L4,-22', style: st }));
    g.append(el('circle', { cx: 0, cy: 0, r: 2.5, style: { fill: 'var(--text-3)' } }));
    g.append(el('text', { x: 31, y: 4, style: TXT(10.5, 'var(--text-3)', 600), text: 'y' }));
    g.append(el('text', { x: -3, y: -32, style: TXT(10.5, 'var(--text-3)', 600), text: 'z' }));
    g.append(el('title', { text: 'Koordinatenursprung (0/0) der Eingabe' }));
  }, { track: false });
}

function caption(v, text) { if (text) v.caption(text); }

/**
 * Modellgrenzen setzen und Platz für Bildschirmelemente freihalten (Farblegende oben rechts,
 * Zeichenerklärung unten links), indem die Grenzen um die geschätzte Pixelbreite erweitert werden.
 */
function setBoundsReserved(v, x0, y0, x1, y1, padR = 0, padB = 0, fitKey = null) {
  const s = Math.min((v.width - 96 - padR) / Math.max(x1 - x0, 1e-6), (v.height - 96 - padB) / Math.max(y1 - y0, 1e-6));
  if (s > 0 && Number.isFinite(s)) { x1 += padR / s; y0 -= padB / s; }
  // Beim Bearbeiten (Ziehen von Punkten, Setzen von Stäben) nicht neu einpassen – nur wenn sich Darstellung,
  // Form oder Vorlagenmasse ändern bzw. ein Projekt geladen wird.
  const same = fitKey !== null && fitKey === lastFitKey;
  lastFitKey = fitKey;
  v.setBounds(x0, y0, x1, y1, { noFit: same });
}
let lastFitKey = null;

/** Schlüssel für das automatische Einpassen. */
function fitKeyOf(app, mode) {
  const sh = app.project.shape;
  return `${mode}|${sh.type}|${sh.type === 'poly' ? hasOutline(app.project) : JSON.stringify(sh[sh.type])}`;
}

// ------------------------------------------------------------------ Geometrie

function dimsFor(shape, g) {
  const t = shape.type, p = shape[t] || {};
  const bb = bounds(g.outer);
  const D = [];
  const f0 = (x) => fmt(x, 0);
  const add = (y1, z1, y2, z2, label, off) => D.push([y1, z1, y2, z2, label, off]);
  switch (t) {
    case 'rect':
      add(bb.ymin, bb.zmin, bb.ymax, bb.zmin, f0(p.b), -28);
      add(bb.ymin, bb.zmin, bb.ymin, bb.zmax, f0(p.h), 28);
      break;
    case 'T':
      add(-p.b / 2, p.h, p.b / 2, p.h, f0(p.b), 28);
      add(-p.bw / 2, 0, p.bw / 2, 0, f0(p.bw), -28);
      add(-p.b / 2, 0, -p.b / 2, p.h, f0(p.h), 28);
      add(p.b / 2, p.h - p.hf, p.b / 2, p.h, f0(p.hf), -28);
      break;
    case 'I': {
      const ym = Math.max(p.bo, p.bu) / 2;
      add(-p.bo / 2, p.h, p.bo / 2, p.h, f0(p.bo), 28);
      add(-p.bu / 2, 0, p.bu / 2, 0, f0(p.bu), -28);
      add(-ym, 0, -ym, p.h, f0(p.h), 28);
      add(ym, p.h - p.to, ym, p.h, f0(p.to), -28);
      add(ym, 0, ym, p.tu, f0(p.tu), -28);
      add(-p.bw / 2, p.h / 2, p.bw / 2, p.h / 2, f0(p.bw), 0.001);
      break;
    }
    case 'box':
      add(-p.bo / 2, p.h, p.bo / 2, p.h, f0(p.bo), 28);
      add(-p.bu / 2, 0, p.bu / 2, 0, f0(p.bu), -28);
      add(-p.bo / 2, 0, -p.bo / 2, p.h, f0(p.h), 28);
      add(p.bo / 2, p.h - p.to, p.bo / 2, p.h, f0(p.to), -28);
      add(p.bu / 2 - p.tw, p.h / 2, p.bu / 2, p.h / 2, f0(p.tw), 0.001);
      add(0, 0, 0, p.tu, f0(p.tu), 0.001);
      break;
    case 'circle':
      add(-p.D / 2, bb.zmin, p.D / 2, bb.zmin, `Ø ${f0(p.D)}`, -28);
      break;
    case 'ring':
      add(-p.D / 2, bb.zmin, p.D / 2, bb.zmin, `Ø ${f0(p.D)}`, -28);
      add(p.D / 2 - p.t, 0, p.D / 2, 0, f0(p.t), 0.001);
      break;
    case 'L':
      add(0, 0, p.b, 0, f0(p.b), -28);
      add(0, 0, 0, p.h, f0(p.h), 28);
      add(p.b, 0, p.b, p.tb, f0(p.tb), -28);
      add(0, p.h, p.th, p.h, f0(p.th), 28);
      break;
    default:
      add(bb.ymin, bb.zmin, bb.ymax, bb.zmin, f0(bb.b), -28);
      add(bb.ymin, bb.zmin, bb.ymin, bb.zmax, f0(bb.h), 28);
  }
  return D;
}

function drawAxes(v, gp, size) {
  const L = 0.62 * size;
  const rotated = Math.abs(Math.sin(2 * gp.alpha)) > 1e-6;
  const a = rotated ? gp.alpha : 0;
  const axes = [[Math.cos(a), Math.sin(a), rotated ? '1' : 'y'], [-Math.sin(a), Math.cos(a), rotated ? '2' : 'z']];
  for (const [dx, dz, lab] of axes) {
    v.line(gp.cy - dx * L, gp.cz - dz * L, gp.cy + dx * L, gp.cz + dz * L, { stroke: 'var(--c-dim)', width: 0.9, dash: '10 4 2 4' });
    v.text(gp.cy + dx * L, gp.cz + dz * L, lab, { dx: dx * 10, dy: -dz * 10, size: 11.5, bold: true, color: 'var(--c-dim)', track: false, title: rotated ? `Hauptachse ${lab}` : `Schwerachse ${lab}` });
  }
  if (rotated) v.text(gp.cy, gp.cz, `α = ${fmt(gp.alpha * 180 / Math.PI, 1)}°`, { dx: 12, dy: 18, anchor: 'start', size: 10.5, color: 'var(--c-dim)', track: false, title: 'Winkel der Hauptachse 1 gegenüber der y-Achse (Gegenuhrzeigersinn)' });
}

function drawBars(v, app, bars, opts = {}) {
  const showLabels = app.viewOpts.labels && bars.length <= 48;
  // Beschriftungen ausdünnen: gleiche Werte in der Nähe nur einmal (z.B. Stablagen)
  const placed = [];
  const free = (b, lab) => {
    if (!opts.size) return true;
    const near = (q, f) => Math.hypot(q.y - b.y, q.z - b.z) < f * opts.size;
    if (placed.some((q) => near(q, 0.025) || (q.lab === lab && near(q, 0.14)))) return false;
    placed.push({ y: b.y, z: b.z, lab });
    return true;
  };
  for (const b of bars) {
    const r = b.d / 2;
    const fill = opts.fill ? opts.fill(b) : 'var(--c-rebar)';
    const el = v.circle(b.y, b.z, r, { fill, stroke: opts.stroke || 'var(--c-struct)', width: opts.stroke ? 1 : 0.6 });
    el.append(svgEl('title', { text: opts.title ? opts.title(b) : `Stab ${b.i + 1}: Ø${b.d} mm, y = ${fmt(b.y, 0)} mm, z = ${fmt(b.z, 0)} mm` }));
    if (showLabels && opts.label) {
      const lab = opts.label(b);
      if (lab && free(b, lab)) {
        const dy0 = b.y - opts.cy, dz0 = b.z - opts.cz, L = Math.hypot(dy0, dz0) || 1;
        const ux = L > 1e-9 ? dy0 / L : 1, uz = L > 1e-9 ? dz0 / L : 0;
        v.text(b.y, b.z, lab, { dx: ux * 15, dy: -uz * 15, size: 10, color: opts.labelColor || 'var(--text-2)', track: false, mono: !!opts.mono });
      }
    }
  }
}

/** Leeres Projekt: Zeichenfläche mit Ursprung, allfälligen Stäben/Aussparungen und Hinweis. */
function renderEmpty(v, app, g) {
  const p = app.project;
  const pts = [...g.bars.map((b) => [b.y, b.z]), ...g.holes.flat()];
  const bb = pts.length ? bounds(pts) : null;
  const x0 = Math.min(-400, bb ? bb.ymin - 100 : 0), x1 = Math.max(400, bb ? bb.ymax + 100 : 0);
  const y0 = Math.min(-100, bb ? bb.zmin - 100 : 0), y1 = Math.max(700, bb ? bb.zmax + 100 : 0);
  setBoundsReserved(v, x0, y0, x1, y1, 0, 0, fitKeyOf(app, 'geometrie'));
  for (const h of g.holes) v.polygon(h, { fill: 'none', stroke: 'var(--c-concrete-line)', width: 1, dash: '5 3' });
  // Begonnenes Polygon (weniger als 3 Eckpunkte) andeuten
  const part = (p.shape.poly || []).filter((r) => Number.isFinite(r?.y) && Number.isFinite(r?.z)).map((r) => [r.y, r.z]);
  if (part.length) { v.polyline(part, { stroke: 'var(--c-concrete-line)', width: 1.2, dash: '4 3' }); for (const q of part) v.dot(q[0], q[1], 3, { fill: 'var(--c-concrete-line)', stroke: 'var(--surface)' }); }
  drawBars(v, app, g.bars, { label: (b) => String(b.i + 1), cy: 0, cz: 0 });
  originSymbol(v);
  caption(v, 'Leeres Projekt – «Rechteck» (Q) oder «Polygon» (U) wählen und den Beton zeichnen · mm');
}

function renderGeometry(v, app) {
  const p = app.project;
  const g = projectGeometry(p);
  if (!hasOutline(p)) { app.showViewMessage(''); renderEmpty(v, app, g); return; }
  if (g.errors.length) {
    app.showViewMessage(`Der Querschnitt kann nicht dargestellt werden: ${g.errors[0]}`);
    return;
  }
  app.showViewMessage('');
  const gp = grossProps(g.outer, g.holes);
  const bb = bounds(g.outer);
  const size = Math.max(bb.b, bb.h);
  setBoundsReserved(v, bb.ymin, bb.zmin, bb.ymax, bb.zmax, 0, 40, fitKeyOf(app, 'geometrie'));
  drawConcrete(v, g); // Aussparungen sind als Löcher im Pfad enthalten
  for (const h of g.holes) v.polygon(h, { fill: 'none', stroke: 'var(--c-concrete-line)', width: 1, dash: '5 3' });
  if (app.viewOpts.axes !== false) drawAxes(v, gp, size);
  // Polygonecken
  if (p.shape.type === 'poly') {
    (p.shape.poly || []).forEach((row, i) => {
      if (!Number.isFinite(row.y) || !Number.isFinite(row.z)) return;
      v.dot(row.y, row.z, 3, { fill: 'var(--c-concrete-line)', stroke: 'var(--surface)', title: `Eckpunkt ${i + 1}: y = ${fmt(row.y, 0)} mm, z = ${fmt(row.z, 0)} mm` });
      if (app.viewOpts.labels) {
        const dy0 = row.y - gp.cy, dz0 = row.z - gp.cz, L = Math.hypot(dy0, dz0) || 1;
        v.text(row.y, row.z, String(i + 1), { dx: dy0 / L * 13, dy: -dz0 / L * 13, size: 10, color: 'var(--c-concrete-line)', bold: true, track: false });
      }
    });
  }
  drawBars(v, app, g.bars, { label: (b) => String(b.i + 1), cy: gp.cy, cz: gp.cz });
  centroidSymbol(v, gp.cy, gp.cz, 'S', `Schwerpunkt Beton: y = ${fmt(gp.cy, 1)} mm, z = ${fmt(gp.cz, 1)} mm`);
  const R = app.results;
  if (R && R.refMode !== 'gross') refSymbol(v, toMm(R.ref[0]), toMm(R.ref[1]));
  originSymbol(v);
  if (app.viewOpts.dims !== false) {
    for (const [y1, z1, y2, z2, label, off] of dimsFor(p.shape, g)) v.dimension(y1, z1, y2, z2, label, off);
  }
  const As = g.bars.reduce((s, b) => s + Math.PI * b.d * b.d / 4, 0);
  v.keyLegend([
    { label: 'Beton', color: 'var(--c-concrete-line)', fill: 'var(--c-concrete)', type: 'fill' },
    { label: 'Bewehrungsstab', color: 'var(--c-rebar)', type: 'dot' },
    { label: gp.isotropic || Math.abs(Math.sin(2 * gp.alpha)) <= 1e-6 ? 'Schwerachsen y, z' : 'Hauptachsen 1, 2', color: 'var(--c-dim)', type: 'line', dash: '10 4 2 4', width: 1.2 },
  ]);
  caption(v, `A = ${fmt(gp.A / 1e3, 1)}·10³ mm²   ·   ${g.bars.length} Stäbe, As = ${fmt(As, 0)} mm² (ρ = ${fmt(As / gp.A * 100, 2)} %)   ·   Masse in mm`);
}

// ------------------------------------------------------------------ Dehnungen / Spannungen

function renderState(v, app, mode) {
  const R = app.results;
  const gm = { outer: R.geom.mm.outer, holes: R.geom.mm.holes, bars: R.geom.mm.bars };
  const bb = bounds(gm.outer);
  const size = Math.max(bb.b, bb.h);
  const i = caseIndex(app);
  const c = R.cases[i];
  if (!c) {
    v.setBounds(bb.ymin, bb.zmin, bb.ymax, bb.zmax);
    drawConcrete(v, gm, { opacity: 0.6 });
    drawBars(v, app, gm.bars);
    app.showViewMessage('Noch keine Lastfälle – im Register «Lasten» einen Lastfall erfassen.');
    return;
  }
  const vs = viewState(app, c);
  const st0 = vs.st;
  if (!st0 || !st0.ok) {
    v.setBounds(bb.ymin, bb.zmin, bb.ymax, bb.zmax);
    drawConcrete(v, gm, { opacity: 0.6 });
    drawBars(v, app, gm.bars);
    app.showViewMessage(`${c.name}: ${st0?.msg || 'Kein Zustand verfügbar.'} Die Ausnutzung steht rechts im Ergebnisbereich.`);
    return;
  }
  app.showViewMessage('');
  // Dehnungsebene in Weltkoordinaten (mm), bezogen auf den Betonschwerpunkt
  const st = { ...st0, ky: st0.ky * MM, kz: st0.kz * MM, bars: st0.bars.map((b) => ({ ...b, y: toMm(b.y), z: toMm(b.z) })) };
  const ref = [toMm(R.secRef[0]), toMm(R.secRef[1])];
  const epsAt = (pt) => st.e0 + st.ky * (pt[0] - ref[0]) + st.kz * (pt[1] - ref[1]);
  const k = Math.hypot(st.ky, st.kz);
  const g = k > 1e-12 ? [st.ky / k, st.kz / k] : [0, -1];
  let p = [-g[1], g[0]];
  if (p[0] < -1e-9 || (Math.abs(p[0]) < 1e-9 && p[1] < 0)) p = [-p[0], -p[1]];
  const U = (pt) => (pt[0] - ref[0]) * g[0] + (pt[1] - ref[1]) * g[1];
  const V = (pt) => (pt[0] - ref[0]) * p[0] + (pt[1] - ref[1]) * p[1];
  const P = (u, w) => [ref[0] + u * g[0] + w * p[0], ref[1] + u * g[1] + w * p[1]];
  let umin = Infinity, umax = -Infinity, vmax = -Infinity, vmin = Infinity;
  for (const pt of gm.outer) { const u = U(pt), w = V(pt); umin = Math.min(umin, u); umax = Math.max(umax, u); vmax = Math.max(vmax, w); vmin = Math.min(vmin, w); }
  const eAt = (u) => st.e0 + k * u;
  // Diagrammbreite nach der Querschnittstiefe in Gradientenrichtung (breite, flache Querschnitte nicht stauchen)
  const Ldiag = Math.max(umax - umin, 0.4 * (vmax - vmin));
  const W = 0.45 * Ldiag, gap = 0.2 * Ldiag;
  const law = vs.sec.concreteLaw;
  const isStress = mode === 'spannungen';
  const barsById = new Map(st.bars.map((b) => [b.i, b]));
  const vertMin = gm.outer.reduce((m, pt) => (epsAt(pt) < epsAt(m) ? pt : m), gm.outer[0]);
  const diagPts = [];

  // --- Querschnitt mit Druckzone bzw. Spannungsbändern
  const emin = Math.min(...gm.outer.map(epsAt)), emax = Math.max(...gm.outer.map(epsAt));
  let sigMin = 0;
  if (isStress) {
    sigMin = Math.min(st.sigmaCmin, -1e-6);
    const colorOf = (s) => diverging(0.46 * (1 - s / sigMin));
    drawConcrete(v, gm, { fill: 'var(--c-concrete)', opacity: 0.45, stroke: 'none' });
    if (emin < 0) {
      const lim = Number.isFinite(law.fc) && law.ec2 ? -law.ec2 : -Infinity;
      const bands = [];
      if (emin < lim) bands.push([emin - 1e-9, lim]);
      const a = Math.max(emin - 1e-9, lim), top = Math.min(0, emax + 1e-9);
      const nb = 30;
      for (let j = 0; j < nb; j++) bands.push([a + (top - a) * j / nb, a + (top - a) * (j + 1) / nb]);
      for (const [ea, eb] of bands) {
        const rings = clipRings(gm, epsAt, ea, eb);
        if (!rings.length) continue;
        const col = colorOf(law.sigma((ea + eb) / 2));
        v.rings(rings, { fill: col, stroke: col, width: 0.7 });
      }
    }
    drawConcrete(v, gm, { fill: 'none' });
    v.legend({ title: 'σc', unit: 'MPa', min: sigMin, max: 0, steps: 10, digits: Math.abs(sigMin) < 10 ? 2 : 1, color: (t) => diverging(0.46 * t) });
  } else {
    drawConcrete(v, gm, { opacity: 0.55 });
    if (emin < 0) {
      const rings = clipRings(gm, epsAt, -Infinity, 0);
      if (rings.length) v.rings(rings, { fill: 'var(--c-pos-fill)', stroke: 'var(--c-pos)', width: 1 });
    }
    drawConcrete(v, gm, { fill: 'none' });
  }

  // --- Diagramm neben dem Querschnitt
  const line = (pts, st2) => { v.polyline(pts, st2); diagPts.push(...pts); };
  const poly = (pts, st2) => { if (pts.length >= 3) { v.polygon(pts, st2); diagPts.push(...pts); } };
  const lbl = (pt, text, color, dx = 8, dy = 0, anchor = 'start') => v.text(pt[0], pt[1], text, { dx, dy, anchor, size: 10.5, color, bold: true, track: false });
  // Verbindungslinie Querschnitt → Diagramm
  const proj = (pt, w) => v.line(pt[0], pt[1], ...P(U(pt), w), { stroke: 'var(--c-mesh)', width: 0.8, dash: '2 3' });
  const textDir = (val) => (val < 0 ? ['end', -8] : ['start', 8]);

  if (!isStress) {
    const e1 = eAt(umin), e2 = eAt(umax);
    const barE = st.bars.map((b) => b.eps);
    const eNeg = Math.max(0, -Math.min(e1, e2, ...barE)), ePos = Math.max(0, Math.max(e1, e2, ...barE));
    const sc = W / Math.max(eNeg + ePos, 1e-9);
    const v0 = vmax + gap + eNeg * sc;
    const u0 = Math.abs(e2 - e1) > 1e-15 ? umin - e1 * (umax - umin) / (e2 - e1) : null;
    const part = (ua, ub, fill, stroke) => poly([P(ua, v0), P(ua, v0 + eAt(ua) * sc), P(ub, v0 + eAt(ub) * sc), P(ub, v0)], { fill, stroke, width: 1.3 });
    if (u0 !== null && u0 > umin && u0 < umax) {
      const [ua, ub] = e1 < 0 ? [umin, u0] : [u0, umax];
      part(ua, ub, 'var(--c-pos-fill)', 'var(--c-pos)');
      const [ta, tb] = e1 < 0 ? [u0, umax] : [umin, u0];
      part(ta, tb, 'var(--c-neg-fill)', 'var(--c-neg)');
    } else {
      const neg = (e1 + e2) / 2 < 0;
      part(umin, umax, neg ? 'var(--c-pos-fill)' : 'var(--c-neg-fill)', neg ? 'var(--c-pos)' : 'var(--c-neg)');
    }
    line([P(umin, v0), P(umax, v0)], { stroke: 'var(--text-2)', width: 1.2 });
    // Stäbe als Marken im Diagramm
    for (const b of st.bars) v.dot(...P(U([b.y, b.z]), v0 + b.eps * sc), 2.6, { fill: b.eps < 0 ? 'var(--c-pos)' : 'var(--c-neg)', stroke: 'var(--surface)' });
    // Beschriftung extremer Werte
    const eC = epsAt(vertMin);
    proj(vertMin, v0);
    const [an1, dx1] = textDir(eC);
    lbl(P(U(vertMin), v0 + eC * sc), `εc = ${fmt(eC * 1000, 2)} ‰`, eC < 0 ? 'var(--c-pos)' : 'var(--c-neg)', dx1, -2, an1);
    if (st.bars.length) {
      const bMax = st.bars.reduce((m, b) => (b.eps > m.eps ? b : m));
      proj([bMax.y, bMax.z], v0);
      const [an2, dx2] = textDir(bMax.eps);
      lbl(P(U([bMax.y, bMax.z]), v0 + bMax.eps * sc), `εs = ${fmt(bMax.eps * 1000, 2)} ‰`, bMax.eps < 0 ? 'var(--c-pos)' : 'var(--c-neg)', bMax.eps < 0 ? dx2 : -4, 15, bMax.eps < 0 ? an2 : 'end');
    }
    // Stäbe mit Dehnung
    drawBars(v, app, gm.bars, { cy: toMm(R.gross.cy), cz: toMm(R.gross.cz), size, label: (b) => { const s = barsById.get(b.i); return s ? `${fmt(s.eps * 1000, 2)}‰` : ''; }, labelColor: 'var(--text)', mono: true });
  } else {
    // Betonspannungsblock (Druck links der Grundlinie) und Stahlspannungen (Zug rechts)
    const v0 = vmax + gap + W;
    const scC = W / Math.max(-sigMin, 1e-9);
    const uc0 = k > 1e-12 && emin < 0 && emax > 0 ? -st.e0 / k : (emin < 0 ? umax : umin);
    if (emin < 0) {
      const ua = umin, ub = Math.max(umin, Math.min(umax, uc0));
      const n = 48, pts = [P(ua, v0)];
      for (let j = 0; j <= n; j++) { const u = ua + (ub - ua) * j / n; pts.push(P(u, v0 + law.sigma(eAt(u)) * scC)); }
      pts.push(P(ub, v0));
      poly(pts, { fill: 'var(--c-pos-fill)', stroke: 'var(--c-pos)', width: 1.3 });
      proj(vertMin, v0);
      const sc0 = law.sigma(epsAt(vertMin));
      lbl(P(U(vertMin), v0 + sc0 * scC), `σc = ${fmt(sc0, 1)} MPa`, 'var(--c-pos)', -8, -2, 'end');
    }
    const sMaxAbs = Math.max(1, ...st.bars.map((b) => Math.abs(b.sigma)));
    const scS = 0.75 * W / sMaxAbs;
    for (const b of st.bars) {
      const u = U([b.y, b.z]);
      const col = b.sigma < 0 ? 'var(--c-pos)' : 'var(--c-neg)';
      line([P(u, v0), P(u, v0 + b.sigma * scS)], { stroke: col, width: 2.2 });
      v.dot(...P(u, v0 + b.sigma * scS), 3, { fill: col, stroke: 'var(--surface)' });
    }
    if (st.bars.length) {
      const bMax = st.bars.reduce((m, b) => (b.sigma > m.sigma ? b : m));
      if (bMax.sigma > 0) {
        proj([bMax.y, bMax.z], v0);
        lbl(P(U([bMax.y, bMax.z]), v0 + bMax.sigma * scS), `σs = ${fmt(bMax.sigma, 0)} MPa`, 'var(--c-neg)', -2, -10, 'end');
      }
    }
    line([P(umin, v0), P(umax, v0)], { stroke: 'var(--text-2)', width: 1.2 });
    diagPts.push(P(umin, v0 + 0.75 * W), P(umax, v0 - W));
    drawBars(v, app, gm.bars, {
      cy: toMm(R.gross.cy), cz: toMm(R.gross.cz), stroke: 'var(--c-struct)', size,
      fill: (b) => { const s = barsById.get(b.i); return s ? diverging(0.5 + 0.5 * s.sigma / sMaxAbs) : 'var(--c-rebar)'; },
      label: (b) => { const s = barsById.get(b.i); return s ? fmt(s.sigma, 0) : ''; }, labelColor: 'var(--text)', mono: true,
    });
  }

  // --- Nulllinie
  const all = [...gm.outer, ...diagPts];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of all) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (k > 1e-12 && emin < 0 && emax > 0) {
    const pad = 0.04 * size;
    const seg = clipLine(st.ky, st.kz, st.e0 - st.ky * ref[0] - st.kz * ref[1], { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad });
    if (seg) {
      v.line(seg[0][0], seg[0][1], seg[1][0], seg[1][1], { stroke: 'var(--text-2)', width: 1.2, dash: '7 4' });
      const end = V(seg[0]) < V(seg[1]) ? seg[0] : seg[1];
      const left = end[0] <= (seg[0][0] + seg[1][0]) / 2;
      v.text(end[0], end[1], Number.isFinite(st.x) ? `Nulllinie, x = ${fmt(st.x / MM, 0)} mm` : 'Nulllinie', { dx: left ? 4 : -4, dy: -9, anchor: left ? 'start' : 'end', size: 10.5, color: 'var(--text-2)', track: false });
    }
  }
  setBoundsReserved(v, x0, y0, x1, y1, isStress ? 130 : 0, 58, `${fitKeyOf(app, mode)}|${i}|${vs.key}`);
  v.keyLegend(isStress ? [
    { label: 'Betondruckspannung σc', color: 'var(--c-pos)', type: 'fill' },
    { label: 'Stahl: Zug / Druck', color: 'var(--c-neg)', type: 'line' },
    { label: 'Nulllinie (ε = 0)', color: 'var(--text-2)', type: 'line', dash: '7 4', width: 1.2 },
  ] : [
    { label: 'Druck (ε < 0)', color: 'var(--c-pos)', type: 'fill' },
    { label: 'Zug (ε > 0)', color: 'var(--c-neg)', type: 'fill' },
    { label: 'Nulllinie (ε = 0)', color: 'var(--text-2)', type: 'line', dash: '7 4', width: 1.2 },
  ]);
  centroidSymbol(v, ref[0], ref[1], '', 'Schwerpunkt Beton');
  if (R.refMode !== 'gross') refSymbol(v, toMm(R.ref[0]), toMm(R.ref[1]));

  const head = `${c.name}: N = ${fmt(c.N, 0)} kN, My = ${fmt(c.My, 1)}, Mz = ${fmt(c.Mz, 1)} kNm`;
  const tail = isStress
    ? `σc,min = ${fmt(st.sigmaCmin, 1)} MPa · σs,max = ${fmt(st.sigmaSmax, 0)} MPa`
    : `εc,min = ${fmt(st.ext.ecMin * 1000, 2)} ‰ · εs,max = ${fmt(st.ext.esMax * 1000, 2)} ‰`;
  caption(v, `${head}  ·  ${vs.label}  ·  ${tail}${st.fail ? '  ·  Grenzdehnung überschritten!' : ''}`);
}

/** Zeichenfunktion für createApp.renderView. */
export function renderView(v, app, mode) {
  if ((mode === 'dehnungen' || mode === 'spannungen') && app.results && hasOutline(app.project)) return renderState(v, app, mode);
  return renderGeometry(v, app);
}

// ------------------------------------------------------------------ Vorzeichenskizze

/** Kleine Skizze der Vorzeichenkonvention (N, My, Mz) für das Register «Lasten». */
export function signFigure() {
  const W = 360, H = 150;
  const s = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Vorzeichenkonvention', style: { display: 'block', maxWidth: '380px', margin: '2px auto 6px' } });
  const T = (x, y, text, o = {}) => s.append(svgEl('text', { x, y, 'text-anchor': o.anchor || 'middle', style: { fontSize: `${o.size || 11}px`, fill: o.color || 'var(--text)', fontWeight: o.bold ? 700 : 400 }, text }));
  const panel = (x0, title, sub, edges) => {
    const x = x0 + 30, y = 34, w = 56, hh = 70;
    T(x0 + 58, 16, title, { bold: true, size: 12 });
    s.append(svgEl('rect', { x, y, width: w, height: hh, rx: 3, style: { fill: 'var(--c-concrete)', stroke: 'var(--c-concrete-line)', strokeWidth: 1.2 } }));
    for (const [side, kind] of edges) {
      const col = kind === 'Zug' ? 'var(--c-neg)' : 'var(--c-pos)';
      const seg = { bottom: [x, y + hh, x + w, y + hh], top: [x, y, x + w, y], left: [x, y, x, y + hh], right: [x + w, y, x + w, y + hh] }[side];
      s.append(svgEl('line', { x1: seg[0], y1: seg[1], x2: seg[2], y2: seg[3], style: { stroke: col, strokeWidth: 5, strokeLinecap: 'round' } }));
      const lx = side === 'left' ? x - 6 : side === 'right' ? x + w + 6 : x + w / 2;
      const ly = side === 'top' ? y - 6 : side === 'bottom' ? y + hh + 14 : y + hh / 2 + 4;
      T(lx, ly, kind, { anchor: side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle', color: col, size: 10.5, bold: true });
    }
    // Achsen
    const cx = x + w / 2, cy = y + hh / 2;
    s.append(svgEl('path', { d: `M${cx},${cy} h18 m-5,-3.5 l5,3.5 l-5,3.5 M${cx},${cy} v-18 m-3.5,5 l3.5,-5 l3.5,5`, style: { stroke: 'var(--text-2)', strokeWidth: 1.2, fill: 'none' } }));
    T(cx + 22, cy + 4, 'y', { size: 10, color: 'var(--text-2)', anchor: 'start' });
    T(cx + 4, cy - 20, 'z', { size: 10, color: 'var(--text-2)', anchor: 'start' });
    T(x0 + 58, H - 8, sub, { size: 10.5, color: 'var(--text-2)' });
  };
  panel(0, 'My > 0', 'Zug unten', [['bottom', 'Zug'], ['top', 'Druck']]);
  panel(120, 'Mz > 0', 'Zug rechts', [['right', 'Zug'], ['left', 'Druck']]);
  // Normalkraft
  const x0 = 240;
  T(x0 + 58, 16, 'N > 0', { bold: true, size: 12 });
  s.append(svgEl('rect', { x: x0 + 30, y: 34, width: 56, height: 70, rx: 3, style: { fill: 'var(--c-concrete)', stroke: 'var(--c-neg)', strokeWidth: 2.4 } }));
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const cx = x0 + 58 + dx * 34, cy = 69 + dy * 41;
    const ax = dx * 14, ay = dy * 14;
    s.append(svgEl('path', { d: `M${cx},${cy} l${ax},${ay}`, style: { stroke: 'var(--c-neg)', strokeWidth: 1.6 } }));
    s.append(svgEl('circle', { cx: cx + ax, cy: cy + ay, r: 2.2, style: { fill: 'var(--c-neg)' } }));
  }
  T(x0 + 58, 73, 'Zug', { color: 'var(--c-neg)', size: 10.5, bold: true });
  T(x0 + 58, H - 8, 'Druck: N < 0', { size: 10.5, color: 'var(--text-2)' });
  return s;
}

/** Mini-Symbol einer Querschnittsform für die Formauswahl. */
export function shapeIcon(outer, holes = [], w = 46, hgt = 30) {
  const all = [...outer, ...holes.flat()];
  const bb = bounds(all);
  const sc = Math.min((w - 6) / (bb.b || 1), (hgt - 6) / (bb.h || 1));
  const ox = (w - bb.b * sc) / 2 - bb.ymin * sc, oy = (hgt + bb.h * sc) / 2 + bb.zmin * sc;
  const path = (pts) => 'M' + pts.map(([y, z]) => `${(ox + y * sc).toFixed(1)},${(oy - z * sc).toFixed(1)}`).join('L') + 'Z';
  const s = svgEl('svg', { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, 'aria-hidden': 'true' });
  s.append(svgEl('path', { d: [outer, ...holes].map(path).join(''), 'fill-rule': 'evenodd', style: { fill: 'var(--c-concrete)', stroke: 'var(--c-concrete-line)', strokeWidth: 1.2, strokeLinejoin: 'round' } }));
  return s;
}

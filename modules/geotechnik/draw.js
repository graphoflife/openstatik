// Grafik Geotechnik: Systemskizzen, Erddruckfiguren, Bruchmechanismus, Spannungszwiebeln,
// Gleitkreise mit Suchraster, Winkelstützmauer mit Kräften und Sohldruck.
import { svgEl, fmt } from '../../js/core/ui.js';
import { sequential } from '../../js/core/colormap.js';
import { makeSoil, layerStyle, rad } from './soil.js';
import { prandtlMechanism } from './bearing.js';
import { stressFactor } from './settlement.js';
import { polyY } from './slope.js';
import { wallGeometry } from './wall.js';

// ------------------------------------------------------------------ Darstellungen je Analyse

export const VIEW_MODES = {
  erddruck: [{ id: 'ep', label: 'Erddruckfigur' }, { id: 'wedge', label: 'System & Gleitkeil' }],
  grundbruch: [{ id: 'bc', label: 'Schnitt' }, { id: 'plan', label: 'Grundriss' }, { id: 'mech', label: 'Bruchmechanismus' }],
  setzung: [{ id: 'bulb', label: 'Spannungszwiebeln' }, { id: 'profile', label: 'Δσ-Verlauf' }, { id: 'trough', label: 'Setzungsmulde' }],
  boeschung: [{ id: 'crit', label: 'Kritischer Kreis' }, { id: 'grid', label: 'Suchraster F' }],
  stuetzmauer: [{ id: 'wall', label: 'Geometrie' }, { id: 'forces', label: 'Kräfte & Sohldruck' }],
};

export function viewModes(app) {
  return VIEW_MODES[app.project.analysis] || VIEW_MODES.erddruck;
}

export function viewOptions(app) {
  const common = [
    { key: 'labels', label: 'Beschriftung', type: 'check', default: true },
    { key: 'hatch', label: 'Schraffur', type: 'check', default: true },
  ];
  if (app.project.analysis === 'boeschung') {
    return [
      { key: 'slDesign', label: 'Werte', type: 'select', default: 'd', options: [{ value: 'd', label: 'Bemessung' }, { value: 'k', label: 'charakteristisch' }] },
      { key: 'slices', label: 'Lamellen', type: 'check', default: true },
      { key: 'near', label: 'Nachbarkreise', type: 'check', default: false },
      ...common,
    ];
  }
  return common;
}

/** Ergebnisse passend zur aktuellen Analyse (oder null). */
const res = (app) => (app.results && app.results.type === app.project.analysis ? app.results : null);

export function renderView(v, app, mode) {
  resetClips(v);
  const a = app.project.analysis;
  let soil;
  try { soil = makeSoil(app.project.soil); } catch (e) { app.showViewMessage?.(e.message); return; }
  const ctx = { v, app, p: app.project, r: res(app), soil, mode, o: app.viewOpts };
  if (a === 'erddruck') drawEarthPressure(ctx);
  else if (a === 'grundbruch') drawFooting(ctx);
  else if (a === 'setzung') drawSettlement(ctx);
  else if (a === 'boeschung') drawSlope(ctx);
  else if (a === 'stuetzmauer') drawWall(ctx);
}

// ------------------------------------------------------------------ Hilfen

let clipSeq = 0;
function resetClips(v) { v.defs.querySelectorAll('.geo-clip').forEach((n) => n.remove()); }

function clipY(poly, y0, above) {
  const out = [];
  const inside = (p) => (above ? p[1] >= y0 - 1e-12 : p[1] <= y0 + 1e-12);
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const ia = inside(A), ib = inside(B);
    if (ia) out.push(A);
    if (ia !== ib) { const t = (y0 - A[1]) / (B[1] - A[1]); out.push([A[0] + t * (B[0] - A[0]), y0]); }
  }
  return out;
}
/** Polygon auf ein horizontales Band ya ≤ y ≤ yb beschneiden (Sutherland–Hodgman). */
function clipBand(poly, ya, yb) {
  let p = clipY(poly, ya, true);
  if (p.length >= 3 && Number.isFinite(yb)) p = clipY(p, yb, false);
  return p.length >= 3 ? p : null;
}

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

/** Schraffur (Linien in Weltkoordinaten, auf das Polygon beschnitten). */
function hatch(v, poly, st, gap) {
  if (st.hatch === null || st.hatch === undefined) return;
  const id = `geoclip${++clipSeq}`;
  const cp = svgEl('clipPath', { id, class: 'geo-clip', clipPathUnits: 'userSpaceOnUse' });
  cp.append(svgEl('polygon', { points: poly.map((p) => `${p[0]},${p[1]}`).join(' ') }));
  v.defs.append(cp);
  const g = v.group('geo-hatch');
  g.setAttribute('clip-path', `url(#${id})`);
  const b = bbox(poly);
  const diag = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const angles = st.hatch === 'x' ? [45, -45] : [st.hatch];
  const sp = gap * (st.gap || 1);
  for (const a of angles) {
    const d = [Math.cos(rad(a)), Math.sin(rad(a))], n = [-d[1], d[0]];
    const k = Math.ceil(diag / 2 / sp);
    for (let i = -k; i <= k; i++) {
      const ox = cx + n[0] * i * sp, oy = cy + n[1] * i * sp;
      v.line(ox - d[0] * diag / 2, oy - d[1] * diag / 2, ox + d[0] * diag / 2, oy + d[1] * diag / 2, { parent: g, stroke: 'var(--c-soil)', width: 0.7, opacity: 0.55 });
    }
  }
}

/**
 * Bodenschichten in einem Gebietspolygon zeichnen. elev(z) → Höhenkote der Tiefe z.
 * opts: {labelX, labelAnchor, yMin, gap, labels, hatch}
 */
function drawLayers(v, soil, region, elev, opts) {
  const { layers } = soil;
  const rb = bbox(region);
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const yTop = i === 0 ? Infinity : elev(L.z);
    const yBot = Number.isFinite(L.zBot) ? elev(L.zBot) : -Infinity;
    const poly = clipBand(region, Math.max(yBot, rb.y0 - 1), Math.min(yTop, rb.y1 + 1));
    if (!poly) continue;
    const st = layerStyle(L.col);
    v.polygon(poly, { fill: 'var(--c-soil)', fillOpacity: st.op, stroke: 'none' });
    if (opts.hatch) hatch(v, poly, st, opts.gap);
  }
  // Schichtgrenzen
  for (let i = 1; i < layers.length; i++) {
    const y = elev(layers[i].z);
    if (y <= rb.y0 || y >= rb.y1) continue;
    const segs = hLineInPoly(region, y);
    for (const [xa, xb] of segs) v.line(xa, y, xb, y, { stroke: 'var(--c-soil)', width: 1.1, dash: '5 3' });
  }
  if (opts.labels) {
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      const yTop = Math.min(i === 0 ? rb.y1 : elev(L.z), opts.yTopLabel ?? rb.y1);
      const yBot = Math.max(Number.isFinite(L.zBot) ? elev(L.zBot) : rb.y0, rb.y0);
      if (yTop - yBot <= 0) continue;
      const y = (yTop + yBot) / 2;
      const txt = `${L.name}  ·  φ'=${fmt(L.phi, 1)}°${L.c ? `  c'=${fmt(L.c, 0)}` : ''}${L.cu ? `  cᵤ=${fmt(L.cu, 0)}` : ''}  γ=${fmt(L.gamma, 1)}`;
      v.text(opts.labelX, y, txt, { anchor: opts.labelAnchor || 'end', size: 10.5, color: 'var(--text-2)', dx: opts.labelAnchor === 'start' ? 6 : -6 });
    }
  }
}

/** x-Abschnitte einer horizontalen Linie y innerhalb eines (einfachen) Polygons. */
function hLineInPoly(poly, y) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    if ((A[1] - y) * (B[1] - y) < 0) xs.push(A[0] + (y - A[1]) / (B[1] - A[1]) * (B[0] - A[0]));
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

function waterLine(v, x0, x1, y, opts = {}) {
  v.line(x0, y, x1, y, { stroke: 'var(--c-water)', width: 1.6 });
  waterSymbol(v, opts.xs ?? (x0 + (x1 - x0) * 0.82), y, opts.label);
}
function waterSymbol(v, x, y, label) {
  v.symbol(x, y, (g) => {
    const st = { fill: 'none', stroke: 'var(--c-water)', strokeWidth: 1.4, strokeLinejoin: 'round' };
    g.append(svgEl('path', { d: 'M-6,-10 L6,-10 L0,-1 Z', style: st }));
    g.append(svgEl('line', { x1: -5, y1: 3, x2: 5, y2: 3, style: st }));
    g.append(svgEl('line', { x1: -3, y1: 6, x2: 3, y2: 6, style: st }));
    if (label) g.append(svgEl('text', { x: 9, y: -6, style: { fontSize: '10.5px', fill: 'var(--c-water)', paintOrder: 'stroke', stroke: 'var(--surface-2)', strokeWidth: 3 }, text: label }));
  });
}

const CONCRETE = { fill: 'var(--c-concrete)', stroke: 'var(--c-concrete-line)', width: 1.3 };

/** Gleichmässige Flächenlast als Pfeilreihe entlang einer Linie (Weltkoordinaten). */
function surchargeArrows(v, pts, label, n = 8, color = 'var(--c-load)') {
  if (pts.length < 2) return;
  const L = [];
  let tot = 0;
  for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); L.push(d); tot += d; }
  const at = (s) => {
    let acc = 0;
    for (let i = 0; i < L.length; i++) {
      if (acc + L[i] >= s - 1e-12) { const t = L[i] > 0 ? (s - acc) / L[i] : 0; return [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])]; }
      acc += L[i];
    }
    return pts[pts.length - 1];
  };
  for (let k = 0; k <= n; k++) {
    const p = at(tot * k / n);
    v.arrow(p[0], p[1], 0, -1, { length: 16, head: 6, color, width: 1.2 });
  }
  const b = at(tot);
  if (label) v.text(b[0], b[1], label, { anchor: 'end', dy: -26, color, size: 11 });
}

function legendLine(v, items) {
  v.caption(items.filter(Boolean).join('   ·   '));
}
/** Zeichenerklärung unten links (über der Bildunterschrift). */
function key(v, items) {
  const it = items.filter(Boolean);
  if (it.length && v.keyLegend) v.keyLegend(it);
}
const KEY = {
  epG: { label: 'Erddruck aus Bodeneigengewicht (G)', color: 'var(--c-load)', type: 'fill' },
  epQ: { label: 'Erddruck aus Auflasten (Q)', color: 'var(--c-highlight)', type: 'fill' },
  water: { label: 'Wasserdruck', color: 'var(--c-water)', type: 'fill' },
  res: { label: 'Resultierende', color: 'var(--c-neg)' },
  gw: { label: 'Grundwasserspiegel', color: 'var(--c-water)' },
};

// ------------------------------------------------------------------ 1. Erddruck

function drawEarthPressure({ v, p, r, soil, mode, o }) {
  const ep = p.ep;
  const H = Math.max(0.1, Number(ep.H) || 1);
  const al = Number(ep.alpha) || 0, be = Number(ep.beta) || 0;
  const ta = Math.tan(rad(al)), tb = Math.tan(rad(be));
  const tw = Math.max(0.25, 0.08 * H);
  const xTop = -H * ta;
  const loadsEnd = Math.max(0, ...(ep.loads || []).map((l) => (Number(l.a) || 0) + (Number(l.b) || 0)));
  const X1 = Math.max(1.4 * H, loadsEnd + 0.6 * H);
  const yS = (x) => H + (x - xTop) * tb;
  const X0 = Math.min(xTop, 0) - tw - 0.45 * H;
  const yB = -0.22 * H;
  const size = Math.max(X1 - X0, H);
  // Bodengebiet: hinter der Wand + unter der Sohle + vor der Wand bis Sohlniveau
  const region = [[X0, yB], [X1, yB], [X1, yS(X1)], [xTop, H], [0, 0], [-tw, 0], [X0, 0]];
  drawLayers(v, soil, region, (z) => H - z, { labels: o.labels && mode === 'wedge', labelX: X1, gap: size / 70, hatch: o.hatch, yTopLabel: H });
  // Grundwasser
  const zw = soil.zw;
  if (Number.isFinite(zw) && zw < H + 0.22 * H) waterLine(v, 0, X1, H - zw, { label: o.labels ? `GW ${fmt(zw, 2)} m` : null });
  // Wand
  v.polygon([[0, 0], [xTop, H], [xTop - tw, H], [-tw, 0]], CONCRETE);
  v.line(X0, 0, -tw, 0, { stroke: 'var(--c-soil)', width: 1.2 });
  // Gelände
  v.line(xTop, H, X1, yS(X1), { stroke: 'var(--c-soil)', width: 1.6 });
  // Auflasten
  const q = Number(ep.q) || 0;
  if (q > 0 && ep.kind !== 'passive') surchargeArrows(v, [[xTop + 0.02 * H, yS(xTop + 0.02 * H)], [X1, yS(X1)]], o.labels ? `q = ${fmt(q, 1)} kN/m²` : null, 12);
  for (const ld of ep.kind === 'passive' ? [] : ep.loads || []) {
    const a = xTop + (Number(ld.a) || 0), b = Number(ld.b) || 0, pp = Number(ld.p) || 0;
    if (!pp) continue;
    if (ld.type === 'line') {
      v.arrow(a, yS(a), 0, -1, { length: 44, color: 'var(--c-load)', width: 2, label: o.labels ? `P = ${fmt(pp, 1)} kN/m` : null });
    } else {
      const pts = [];
      for (let k = 0; k <= 6; k++) pts.push([a + b * k / 6, yS(a + b * k / 6)]);
      v.polygon([...pts, ...pts.slice().reverse().map(([x, y]) => [x, y + 0.08 * H])], { fill: 'var(--c-load-fill)', stroke: 'var(--c-load)', width: 1 });
      for (const pt of pts.filter((_, k) => k % 2 === 0)) v.arrow(pt[0], pt[1], 0, -1, { length: 14, head: 6, color: 'var(--c-load)', width: 1.2 });
      if (o.labels) v.text(a + b / 2, yS(a + b / 2) + 0.08 * H, `p = ${fmt(pp, 1)} kN/m²`, { dy: -10, color: 'var(--c-load)' });
    }
  }
  // Bemassung
  v.dimension(-tw, 0, xTop - tw, H, `H = ${fmt(H, 2)} m`, 26);
  if (o.labels && (al || be)) v.text(xTop, H, `α = ${fmt(al, 1)}°   β = ${fmt(be, 1)}°`, { anchor: 'start', dx: 8, dy: -28, color: 'var(--c-dim)', size: 10.5 });

  const R = r?.ep;
  if (R && mode === 'wedge' && R.kind !== 'passive') {
    // Gleitkeil der obersten Schicht
    const th = R.layers[0]?.theta;
    if (Number.isFinite(th)) {
      const t = rad(th);
      const den = Math.sin(t) - Math.cos(t) * tb;
      if (den > 1e-6) {
        const s = (H - xTop * tb) / den;
        const P = [s * Math.cos(t), s * Math.sin(t)];
        v.polygon([[0, 0], P, [xTop, H]], { fill: 'var(--c-highlight)', fillOpacity: 0.12, stroke: 'none' });
        v.line(0, 0, P[0], P[1], { stroke: 'var(--c-highlight)', width: 1.8, dash: '7 4' });
        if (o.labels) v.text(P[0] * 0.55, P[1] * 0.55, `ϑ_a = ${fmt(th, 1)}°`, { anchor: 'start', dx: 8, color: 'var(--c-highlight)', bold: true });
      }
    }
  }
  if (R && mode === 'ep') {
    pressureFigure(v, R, (y) => -y * ta, H, 0, 0.42 * H, o.labels);
    key(v, [R.pts.some((q) => q.ehG > 0) ? { ...KEY.epG, label: R.kind === 'passive' ? 'Erdwiderstand' : KEY.epG.label } : null, R.pts.some((q) => q.ehQ > 1e-9) ? KEY.epQ : null, R.U > 0 ? KEY.water : null, KEY.res]);
  } else if (mode === 'wedge') {
    key(v, [R && R.kind !== 'passive' ? { label: 'Gleitfuge (Coulomb, oberste Schicht)', color: 'var(--c-highlight)', dash: '7 4' } : null, Number.isFinite(zw) ? KEY.gw : null, { label: 'Auflasten (veränderlich)', color: 'var(--c-load)' }]);
  }
  v.setBounds(X0, yB, X1, Math.max(H, yS(X1)) + 0.18 * H);
  if (R) legendLine(v, [R.kind === 'passive' ? `E_ph = ${fmt(R.Eh, 1)} kN/m` : `E_ah = ${fmt(R.Eh, 1)} kN/m`, R.U > 0 ? `W = ${fmt(R.U, 1)} kN/m` : null, `Angriff ${fmt(R.hE, 2)} m über Fuss`]);
}

/**
 * Erddruckfigur an einer Wand: xw(y) Wandrückseite, Druck nach rechts (in den Boden) aufgetragen,
 * gestapelt: Erddruck G, Erddruck Q, Wasser. yBase = Höhenkote zBot, zTop0 = Tiefe der Oberkante.
 */
function pressureFigure(v, R, xw, H, yShift, width, labels, side = 1) {
  const pts = R.pts;
  let emax = 0;
  for (const p of pts) emax = Math.max(emax, p.eh + p.u);
  if (emax <= 0) return;
  const s = width / emax;
  const Y = (z) => yShift + H - z;
  const poly = (f0, f1, st) => {
    const outer = pts.map((p) => [xw(Y(p.z)) + side * s * f1(p), Y(p.z)]);
    const inner = pts.map((p) => [xw(Y(p.z)) + side * s * f0(p), Y(p.z)]).reverse();
    v.polygon([...outer, ...inner], st);
  };
  poly(() => 0, (p) => p.ehG, { fill: 'var(--c-load-fill)', stroke: 'var(--c-load)', width: 1.2, fillOpacity: 0.9 });
  if (pts.some((p) => p.ehQ > 1e-9)) poly((p) => p.ehG, (p) => p.ehG + p.ehQ, { fill: 'var(--c-highlight)', fillOpacity: 0.22, stroke: 'var(--c-highlight)', width: 1 });
  if (pts.some((p) => p.u > 1e-9)) poly((p) => p.eh, (p) => p.eh + p.u, { fill: 'var(--c-water)', fillOpacity: 0.22, stroke: 'var(--c-water)', width: 1 });
  // Pfeile Richtung Wand
  const nA = 9;
  for (let k = 1; k < nA; k++) {
    const z = R.zTop + (R.zBot - R.zTop) * k / nA;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.z - z) < Math.abs(best.z - z)) best = p;
    const len = (best.eh + best.u) * s;
    if (len * v.scale < 10) continue;
    v.arrow(xw(Y(best.z)), Y(best.z), -side, 0, { length: Math.min(len * v.scale, 40), head: 5, width: 1, color: 'var(--c-load)' });
  }
  if (labels) {
    // Werte an Schichtgrenzen und am Fuss
    const shown = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const isEdge = i === 0 || i === pts.length - 1 || Math.abs(pts[i - 1].z - p.z) < 1e-9 || (i + 1 < pts.length && Math.abs(pts[i + 1].z - p.z) < 1e-9);
      if (!isEdge) continue;
      const val = p.eh + p.u;
      if (shown.some((q) => Math.abs(q.z - p.z) < 1e-9 && Math.abs(q.val - val) < 0.05)) continue;
      const dup = shown.filter((q) => Math.abs(q.z - p.z) < 1e-9).length;
      shown.push({ z: p.z, val });
      const yy = Y(p.z);
      v.text(xw(yy) + side * s * val, yy, `${fmt(val, 1)}`, { anchor: side > 0 ? 'start' : 'end', dx: side * 6, dy: dup ? 8 : (i === 0 ? 6 : -6), size: 10.5, color: 'var(--c-load)' });
    }
  }
  // Resultierende
  const yE = Y(R.zE);
  const tanV = R.Eh > 0 ? R.Ev / R.Eh : 0;
  v.arrow(xw(yE), yE, -side, R.kind === 'passive' ? tanV : -tanV, { length: 56, width: 2.4, head: 10, color: 'var(--c-neg)', offset: -2 });
  if (labels) v.text(xw(yE), yE, `${R.kind === 'passive' ? 'E_ph' : 'E_ah'} = ${fmt(R.Eh, 1)} kN/m`, { anchor: side > 0 ? 'start' : 'end', dx: side * 8, dy: -12, color: 'var(--c-neg)', bold: true, size: 11 });
}

// ------------------------------------------------------------------ 2. Grundbruch

function footingDims(f) {
  const shape = f.shape || 'rect';
  const B = Math.max(0.05, Number(f.B) || 1);
  const L = shape === 'strip' ? 1 : shape === 'circle' ? B : Math.max(0.05, Number(f.L) || B);
  const D = Math.max(0, Number(f.D) || 0);
  const t = Math.min(Math.max(0.05, Number(f.t) || Math.min(0.5, 0.3 * B)), Math.max(D, 0.05));
  return { shape, B, L, D, t };
}

function drawFooting({ v, p, r, soil, mode, o }) {
  const f = p.bc;
  const { shape, B, L, D, t } = footingDims(f);
  const R = r?.bc;
  const gov = R?.gov && !R.gov.error ? R.gov : null;
  if (mode === 'plan') return drawPlan(v, shape, B, L, R, o);
  let X = B / 2 + Math.max(1.4 * B, D + 1);
  let depth = D + Math.max(2.4 * B, 2.5);
  let mech = null;
  if (gov && mode === 'mech') {
    const Bp0 = shape === 'circle' ? gov.eff.Bp : B - 2 * Math.abs(gov.eB);
    mech = prandtlMechanism(gov.eB, -D, Bp0, gov.gov.drained ? gov.soil.phi : 0);
    for (const q of [...mech.left, ...mech.right]) X = Math.max(X, Math.abs(q[0]) + 0.3 * B);
    depth = Math.max(depth, D + mech.depth + 0.4 * B);
  }
  const size = Math.max(2 * X, depth);
  const region = [[-X, -depth], [X, -depth], [X, 0], [-X, 0]];
  drawLayers(v, soil, region, (z) => -z, { labels: o.labels, labelX: X, gap: size / 70, hatch: o.hatch, yTopLabel: 0 });
  v.line(-X, 0, X, 0, { stroke: 'var(--c-soil)', width: 1.6 });
  if (Number.isFinite(soil.zw) && soil.zw < depth) waterLine(v, -X, X, -soil.zw, { xs: -X + 0.15 * X, label: o.labels ? `GW ${fmt(soil.zw, 2)} m` : null });
  // Fundament und Stütze
  const bc = Math.min(0.45, 0.3 * B);
  v.rect(-bc / 2, -D + t, bc, D - t + 0.35 * Math.max(B, 1), CONCRETE);
  v.rect(-B / 2, -D, B, t, CONCRETE);
  v.dimension(-B / 2, -D, B / 2, -D, `B = ${fmt(B, 2)} m`, -18);
  if (D > 0) v.dimension(-X + 0.08 * X, 0, -X + 0.08 * X, -D, `D = ${fmt(D, 2)} m`, 14);
  const yTop = -D + t + 0.35 * Math.max(B, 1);
  if (gov) {
    const ld = gov.ld;
    const eB = gov.eB;
    const Bp = shape === 'strip' || shape === 'rect' ? B - 2 * Math.abs(eB) : gov.eff.Bp;
    const xa = eB - Bp / 2;
    // Einwirkungen (massgebende Bemessungskombination)
    const ySide = (-D + t + yTop) / 2;
    v.arrow(0, yTop, 0, -1, { length: 54, width: 2.2, head: 10, color: 'var(--c-load)', label: o.labels ? `V_d = ${fmt(ld.V, 0)}` : null });
    if (Math.abs(ld.HB) > 1e-6) { const sg = Math.sign(ld.HB); v.arrow(-sg * bc / 2, ySide, sg, 0, { length: 44, width: 2, color: 'var(--c-load)', label: o.labels ? `H_d = ${fmt(Math.abs(ld.HB), 0)}` : null }); }
    if (Math.abs(ld.MB) > 1e-6) v.momentArrow(0, yTop, Math.sign(-ld.MB), { radius: 20, label: o.labels ? `M_d = ${fmt(Math.abs(ld.MB), 0)}` : null });
    // wirksame Breite
    const hBand = 0.05 * Math.max(B, 1);
    v.rect(xa, -D - hBand, Bp, hBand, { fill: 'var(--accent)', fillOpacity: 0.35, stroke: 'var(--accent)', width: 1.2 });
    if (mode === 'bc') {
      v.dimension(xa, -D - hBand, xa + Bp, -D - hBand, `B' = ${fmt(Bp, 2)} m`, -44, { color: 'var(--accent)' });
      if (o.labels) v.text(eB, -D, `e = ${fmt(Math.abs(eB), 3)} m`, { anchor: 'start', dx: 8, dy: 12, color: 'var(--c-neg)', size: 10.5 });
      key(v, [{ label: "wirksame Breite B' (Meyerhof)", color: 'var(--accent)', type: 'fill' }, { label: 'Lastausmitte (Resultierende in der Sohle)', color: 'var(--c-neg)', type: 'dot' }, { label: 'Bemessungslasten (massgebende Kombination)', color: 'var(--c-load)' }, Number.isFinite(soil.zw) ? KEY.gw : null]);
    }
    v.dot(eB, -D, 4, { fill: 'var(--c-neg)', title: `Lastausmitte e = ${fmt(eB, 3)} m` });
    if (mode === 'mech') {
      const phi = gov.gov.drained ? gov.soil.phi : 0;
      const m = mech;
      const sideH = Math.sign(ld.HB) || 0;
      for (const [pts, sg] of [[m.right, 1], [m.left, -1]]) {
        const main = sideH === 0 || sg === sideH;
        const E = [xa + Bp / 2 + sg * Bp / 2, -D];
        if (main) v.polygon([E, ...pts], { fill: 'var(--c-neg-fill)', stroke: 'none' });
        v.polyline(pts, { stroke: 'var(--c-neg)', width: main ? 2.2 : 1.2, dash: main ? null : '6 4', opacity: main ? 1 : 0.6 });
        const P = pts[pts.length - 2];
        v.line(E[0], E[1], P[0], P[1], { stroke: 'var(--c-neg)', width: 0.9, dash: '3 3', opacity: main ? 0.8 : 0.4 });
        const pr = pts[pts.length - 1];
        if (D > 0) v.line(pr[0], pr[1], pr[0], 0, { stroke: 'var(--c-neg)', width: 0.8, dash: '2 3', opacity: 0.5 });
      }
      v.polygon(m.wedge, { fill: 'var(--c-neg-fill)', stroke: 'var(--c-neg)', width: 1.2 });
      if (o.labels) v.text(xa + Bp / 2, -D - m.depth, `${gov.gov.drained ? `drainiert, φ_d = ${fmt(phi, 1)}°` : `undrainiert, c_u = ${fmt(gov.soil.cu, 0)} kN/m²`}  ·  Tiefe ≈ ${fmt(m.depth, 2)} m`, { dy: 14, color: 'var(--c-neg)', size: 10.5 });
    }
  } else {
    v.arrow(0, yTop, 0, -1, { length: 50, width: 2, color: 'var(--c-load)' });
  }
  if (gov && mode === 'mech') key(v, [{ label: 'Bruchkörper (Prandtl), massgebende Seite', color: 'var(--c-neg)', type: 'fill' }, { label: 'Gegenseite', color: 'var(--c-neg)', dash: '6 4' }, { label: "wirksame Breite B'", color: 'var(--accent)', type: 'fill' }]);
  v.setBounds(-X, -depth - 0.12 * depth, X, yTop + 0.25 * Math.max(B, 1));
  if (gov) legendLine(v, [`σ_d = ${fmt(gov.sigma, 0)} kN/m² ≤ R_d/A' = ${fmt(gov.Rd / gov.eff.A, 0)} kN/m²`, `η = ${fmt(gov.eta, 2)}`, `γ_G = ${fmt(gov.ld.gG, 2)}, γ_Q = ${fmt(gov.ld.gQ, 2)}`, `Kräfte in kN${shape === 'strip' ? '/m' : ''}`]);
}

function drawPlan(v, shape, B, L, R, o) {
  const gov = R?.gov && !R.gov.error ? R.gov : null;
  const Lp = shape === 'strip' ? Math.max(1, B) : L;
  if (shape === 'circle') {
    v.circle(0, 0, B / 2, { ...CONCRETE });
    v.circle(0, 0, B / 8, { stroke: 'var(--ok)', width: 1.2, dash: '5 3' });
    v.circle(0, 0, 0.59 * B / 2, { stroke: 'var(--warn)', width: 1.2, dash: '5 3' });
  } else {
    v.rect(-B / 2, -Lp / 2, B, Lp, { ...CONCRETE });
    if (shape === 'strip') {
      v.line(-B / 6, -Lp / 2, -B / 6, Lp / 2, { stroke: 'var(--ok)', width: 1.2, dash: '5 3' });
      v.line(B / 6, -Lp / 2, B / 6, Lp / 2, { stroke: 'var(--ok)', width: 1.2, dash: '5 3' });
      v.line(-B / 3, -Lp / 2, -B / 3, Lp / 2, { stroke: 'var(--warn)', width: 1.2, dash: '5 3' });
      v.line(B / 3, -Lp / 2, B / 3, Lp / 2, { stroke: 'var(--warn)', width: 1.2, dash: '5 3' });
    } else {
      v.polygon([[B / 6, 0], [0, L / 6], [-B / 6, 0], [0, -L / 6]], { fill: 'none', stroke: 'var(--ok)', width: 1.2, dash: '5 3' });
      const el = [];
      for (let k = 0; k <= 64; k++) { const a = 2 * Math.PI * k / 64; el.push([B / 3 * Math.cos(a), L / 3 * Math.sin(a)]); }
      v.polyline(el, { stroke: 'var(--warn)', width: 1.2, dash: '5 3' });
    }
  }
  v.dimension(-B / 2, -Lp / 2, B / 2, -Lp / 2, `B = ${fmt(B, 2)} m`, -26);
  if (shape === 'rect') v.dimension(B / 2, -L / 2, B / 2, L / 2, `L = ${fmt(L, 2)} m`, -26);
  if (gov) {
    const eB = gov.eB, eL = shape === 'strip' ? 0 : gov.eL;
    if (shape !== 'circle') {
      const bp = B - 2 * Math.abs(eB), lp = shape === 'strip' ? Lp : L - 2 * Math.abs(eL);
      v.rect(eB - bp / 2, eL - lp / 2, bp, lp, { fill: 'var(--accent)', fillOpacity: 0.18, stroke: 'var(--accent)', width: 1.6 });
      if (o.labels) v.text(eB, eL - lp / 2, shape === 'strip' ? `B' = ${fmt(bp, 2)} m (je Laufmeter)` : `A' = ${fmt(bp, 2)} × ${fmt(lp, 2)} m`, { dy: -10, color: 'var(--accent)', size: 10.5 });
    } else if (o.labels) v.text(0, -B / 2, `A' = ${fmt(gov.eff.A, 2)} m²  (B' = ${fmt(gov.eff.Bp, 2)}, L' = ${fmt(gov.eff.Lp, 2)} m)`, { dy: 14, color: 'var(--accent)', size: 10.5 });
    v.dot(eB, eL, 4.5, { fill: 'var(--c-neg)' });
    if (o.labels) v.text(eB, eL, `e_B = ${fmt(eB, 3)}${shape === 'strip' ? '' : `, e_L = ${fmt(eL, 3)}`} m`, { anchor: 'start', dx: 8, dy: -8, color: 'var(--c-neg)', size: 10.5 });
    if (R.eccPerm) {
      const eg = R.eG;
      v.dot(eg.eB, shape === 'strip' ? 0 : eg.eL, 3.5, { fill: 'var(--ok)', title: 'Lastausmitte ständige Lasten (charakteristisch)' });
    }
  }
  v.setBounds(-B / 2 - 0.15 * B, -Lp / 2 - 0.15 * B, B / 2 + 0.15 * B, Lp / 2 + 0.15 * B);
  key(v, [
    { label: 'Kern: ständige Lasten ohne klaffende Fuge', color: 'var(--ok)', dash: '5 3' },
    { label: 'Grenze klaffende Fuge bis Schwerpunkt (Bemessung)', color: 'var(--warn)', dash: '5 3' },
    gov ? { label: "wirksame Fläche A'", color: 'var(--accent)', type: 'fill' } : null,
    gov ? { label: 'Lastausmitte Bemessung', color: 'var(--c-neg)', type: 'dot' } : null,
    gov ? { label: 'Lastausmitte ständig (charakteristisch)', color: 'var(--ok)', type: 'dot' } : null,
  ]);
}

// ------------------------------------------------------------------ 3. Setzung

function drawSettlement({ v, p, r, soil, mode, o }) {
  const s = p.st;
  const shape = s.shape || 'rect';
  const B = Math.max(0.05, Number(s.B) || 1);
  const Lf = shape === 'rect' ? Math.max(0.05, Number(s.L) || B) : B;
  const D = Math.max(0, Number(s.D) || 0);
  const R = r?.st;
  const zl = R ? R.zLim - D : 2 * B;
  const depth = D + Math.max(zl * 1.15, 2 * B, 2);
  const X = B / 2 + Math.max(1.6 * B, 0.6 * (depth - D));
  const size = Math.max(2 * X, depth);
  const region = [[-X, -depth], [X, -depth], [X, 0], [-X, 0]];
  drawLayers(v, soil, region, (z) => -z, { labels: o.labels && mode === 'bulb', labelX: X, gap: size / 70, hatch: o.hatch && mode !== 'bulb', yTopLabel: 0 });
  v.line(-X, 0, X, 0, { stroke: 'var(--c-soil)', width: 1.6 });
  if (Number.isFinite(soil.zw) && soil.zw < depth) waterLine(v, -X, X, -soil.zw, { xs: -X + 0.12 * X, label: o.labels ? `GW ${fmt(soil.zw, 2)} m` : null });
  const t = Math.min(0.5, 0.25 * B, Math.max(D, 0.1));
  v.rect(-B / 2, -D, B, t, CONCRETE);
  if (D > t) v.rect(-Math.min(0.2, B / 6), -D + t, 2 * Math.min(0.2, B / 6), D - t, CONCRETE);
  v.dimension(-B / 2, -D, B / 2, -D, `B = ${fmt(B, 2)} m`, 30);
  if (R && R.pNet > 0) {
    const fac = (x, z) => stressFactor(shape, B, Lf, x, 0, z);
    if (mode === 'bulb') {
      const levels = [0.1, 0.2, 0.4, 0.6, 0.8];
      const zMax = depth - D;
      for (const lev of levels) {
        const right = [];
        const nz = 90;
        for (let k = 1; k <= nz; k++) {
          const z = zMax * k / nz;
          if (fac(0, z) < lev) {
            // Spitze der Zwiebel: Tiefe mit f(0,z) = lev
            let a = zMax * (k - 1) / nz, b = z;
            for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (fac(0, m) >= lev) a = m; else b = m; }
            right.push([0, (a + b) / 2]);
            break;
          }
          let a = 0, b = X;
          if (fac(b, z) >= lev) { right.push([b, z]); continue; }
          for (let i = 0; i < 34; i++) { const m = (a + b) / 2; if (fac(m, z) >= lev) a = m; else b = m; }
          right.push([(a + b) / 2, z]);
        }
        const pts = [[B / 2, 0], ...right].map(([x, z]) => [x, -D - z]);
        const poly = [...pts, ...pts.slice().reverse().map(([x, y]) => [-x, y])];
        const col = sequential(lev);
        v.polygon(poly, { fill: col, fillOpacity: 0.28, stroke: col, width: 1.4 });
        if (o.labels) {
          let mx = pts[0];
          for (const q of pts) if (q[0] > mx[0]) mx = q;
          v.text(mx[0], mx[1], `${fmt(lev, 1)}·p`, { anchor: 'start', dx: 5, size: 10.5, color: 'var(--text)', bold: true });
        }
      }
      key(v, [{ label: 'Isobaren Δσ/p_netto (Schnitt durch die Mitte)', color: sequential(0.4), type: 'fill' }, { label: 'Grenztiefe', color: 'var(--c-neg)', dash: '8 4' }]);
    } else if (mode === 'profile') {
      // Diagramm rechts der Fundamentmitte
      const x0 = 0;
      const prof = R.profile.filter((row) => row.z <= depth + 1e-9);
      let smax = 0;
      for (const row of prof) smax = Math.max(smax, row.svp, row.centre);
      const sc = (X * 0.92) / Math.max(smax, 1e-9);
      v.line(x0, -D, x0, -depth, { stroke: 'var(--c-dim)', width: 1 });
      const line = (key, st) => v.polyline(prof.map((row) => [x0 + sc * row[key], -row.z]), st);
      line('svp', { stroke: 'var(--c-soil)', width: 1.8 });
      line('lim', { stroke: 'var(--c-soil)', width: 1.4, dash: '6 4' });
      v.polygon([[x0, -D], ...prof.map((row) => [x0 + sc * row.centre, -row.z]), [x0, -prof[prof.length - 1].z]], { fill: 'var(--c-pos-fill)', stroke: 'var(--c-pos)', width: 1.8 });
      line('char', { stroke: 'var(--c-series-2)', width: 1.8 });
      if (o.labels) {
        const last = prof[prof.length - 1];
        v.text(x0 + sc * last.svp, -last.z, "σ'_v0", { anchor: 'end', dx: -4, dy: -8, color: 'var(--c-soil)' });
        v.text(x0 + sc * last.lim, -last.z, `${fmt(R.f, 2)}·σ'_v0`, { anchor: 'start', dx: 4, dy: -8, color: 'var(--c-soil)' });
        const r0 = prof[2];
        v.text(x0 + sc * r0.centre, -r0.z, 'Δσ Mitte', { anchor: 'start', dx: 6, color: 'var(--c-pos)' });
        const r1 = prof[Math.min(prof.length - 1, 8)];
        v.text(x0 + sc * r1.char, -r1.z, 'Δσ kennz. Punkt', { anchor: 'start', dx: 6, color: 'var(--c-series-2)' });
      }
      key(v, [{ label: "σ'_v0 Überlagerung", color: 'var(--c-soil)' }, { label: `${fmt(R.f, 2)}·σ'_v0 (Grenztiefenkriterium)`, color: 'var(--c-soil)', dash: '6 4' }, { label: 'Δσ unter der Mitte', color: 'var(--c-pos)', type: 'fill' }, { label: 'Δσ kennzeichnender Punkt', color: 'var(--c-series-2)' }]);
    } else if (mode === 'trough' && R.trough.length) {
      let sm = 0;
      for (const [, sx] of R.trough) sm = Math.max(sm, sx);
      const k = sm > 0 ? (0.18 * Math.max(B, 1.5)) / sm : 1;
      const pts = R.trough.map(([x, sx]) => [x, -D - k * sx]);
      v.polygon([[R.trough[0][0], -D], ...pts, [R.trough[R.trough.length - 1][0], -D]], { fill: 'var(--c-deform)', fillOpacity: 0.15, stroke: 'none' });
      v.polyline(pts, { stroke: 'var(--c-deform)', width: 2.2 });
      const c = R.points[0];
      v.dot(0, -D - k * c.s, 3.5, { fill: 'var(--c-deform)' });
      if (o.labels) v.text(0, -D - k * c.s, `Mitte: ${fmt(c.s, 1)} mm`, { dy: 14, size: 10.5, color: 'var(--c-deform)' });
      const sr = R.sChar;
      v.line(-B / 2, -D - k * sr, B / 2, -D - k * sr, { stroke: 'var(--c-neg)', width: 1.6, dash: '6 3' });
      if (o.labels) v.text(B / 2, -D - k * sr, `starr: ${fmt(sr, 1)} mm`, { anchor: 'start', dx: 6, size: 10.5, color: 'var(--c-neg)' });
      key(v, [{ label: 'Setzungsmulde (schlaff, Schnitt durch die Mitte)', color: 'var(--c-deform)' }, { label: 'starres Fundament (kennzeichnender Punkt)', color: 'var(--c-neg)', dash: '6 3' }]);
      v.caption(`Setzungen ${fmt(k * 1000, 0)}-fach überhöht · Rand/Ecke: ${fmt(R.sEdge, 1)} mm`);
    }
    // Grenztiefe
    v.line(-X, -R.zLim, X, -R.zLim, { stroke: 'var(--c-neg)', width: 1.3, dash: '8 4' });
    if (o.labels) v.text(-X, -R.zLim, `Grenztiefe z_gr = ${fmt(R.zLim, 2)} m  (Δσ = ${fmt(R.f, 2)}·σ'_v0)`, { anchor: 'start', dx: 6, dy: -8, color: 'var(--c-neg)', size: 10.5 });
    if (mode !== 'trough') legendLine(v, [`p_netto = ${fmt(R.pNet, 1)} kN/m²`, `s = ${fmt(R.sRef, 1)} mm (${R.refKey === 'char' ? 'kennz. Punkt' : 'Mitte'})`]);
  }
  v.setBounds(-X, -depth - 0.12 * depth, X, 0.3 * Math.max(B, 1));
}

// ------------------------------------------------------------------ 4. Böschung

function drawSlope({ v, p, r, soil, mode, o }) {
  const sl = p.sl;
  const raw = (sl.surface || []).map((q) => [Number(q.x), Number(q.y)]).filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1])).sort((a, b) => a[0] - b[0]);
  if (raw.length < 2) { v.setBounds(0, 0, 10, 10); return; }
  let yMax = -Infinity, yMin = Infinity;
  for (const q of raw) { yMax = Math.max(yMax, q[1]); yMin = Math.min(yMin, q[1]); }
  const Hs = Math.max(yMax - yMin, 0.1);
  const R = r?.sl;
  const M = R?.M;
  const yBot = M ? M.yBot : yMin - Math.max(0, Number(sl.depthBelow) || Hs);
  const xmin = raw[0][0], xmax = raw[raw.length - 1][0];
  const size = Math.max(xmax - xmin, yMax - yBot);
  const region = [...raw, [xmax, yBot], [xmin, yBot]];
  const leftHigh = raw[0][1] >= raw[raw.length - 1][1];
  drawLayers(v, soil, region, (z) => yMax - z, { labels: o.labels, labelX: leftHigh ? xmin : xmax, labelAnchor: leftHigh ? 'start' : 'end', gap: size / 80, hatch: o.hatch, yTopLabel: yMax });
  v.polyline(raw, { stroke: 'var(--c-soil)', width: 1.8 });
  v.line(xmin, yBot, xmax, yBot, { stroke: 'var(--c-soil)', width: 1, dash: '2 3' });
  // Wasser
  let wl = null;
  if (sl.waterMode === 'line') {
    const w = (sl.water || []).map((q) => [Number(q.x), Number(q.y)]).filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1])).sort((a, b) => a[0] - b[0]);
    if (w.length >= 2) wl = w;
  } else if (sl.waterMode === 'gw' && Number.isFinite(soil.zw)) wl = [[xmin, yMax - soil.zw], [xmax, yMax - soil.zw]];
  if (wl) {
    const pts = [];
    const n = 120;
    for (let k = 0; k <= n; k++) { const x = xmin + (xmax - xmin) * k / n; pts.push([x, polyY(wl, x)]); }
    v.polyline(pts, { stroke: 'var(--c-water)', width: 1.8 });
    const xs = xmin + 0.08 * (xmax - xmin);
    waterSymbol(v, xs, polyY(wl, xs), o.labels ? 'Wasserspiegel' : null);
  }
  // Auflast
  const q = sl.q;
  if (q && Number(q.p)) {
    const a = Math.min(+q.x1, +q.x2), b = Math.max(+q.x1, +q.x2);
    const pts = [];
    for (let k = 0; k <= 10; k++) { const x = a + (b - a) * k / 10; pts.push([x, polyY(raw, x)]); }
    surchargeArrows(v, pts, o.labels ? `q = ${fmt(+q.p, 1)} kN/m²` : null, 6);
  }
  let bx0 = xmin, bx1 = xmax, by1 = yMax + 0.15 * Hs;
  if (R) {
    const tx = (x) => M.tx(x);
    const useD = o.slDesign !== 'k' && R.design?.best;
    const S = useD ? R.design : R.char;
    const best = S.best;
    // Suchraster
    const g = R.grid;
    const gx0 = Math.min(tx(g.x0), tx(g.x1)), gx1 = Math.max(tx(g.x0), tx(g.x1));
    bx0 = Math.min(bx0, gx0 - 0.5 * S.dx); bx1 = Math.max(bx1, gx1 + 0.5 * S.dx); by1 = Math.max(by1, g.y1 + 0.5 * S.dy);
    const vals = S.map.map((m) => m.F).filter(Number.isFinite);
    if (vals.length) {
      const fmin = Math.min(...vals), fmax = Math.min(Math.max(...vals), fmin * 2.5, fmin + 3);
      const colOf = (F) => sequential(1 - Math.min(1, Math.max(0, (F - fmin) / Math.max(1e-9, fmax - fmin))));
      if (mode === 'grid') {
        for (const m of S.map) {
          if (!Number.isFinite(m.F)) { v.rect(tx(m.xc) - S.dx / 2, m.yc - S.dy / 2, S.dx, S.dy, { fill: 'var(--surface-3)', stroke: 'var(--surface)', width: 0.5 }); continue; }
          v.rect(tx(m.xc) - S.dx / 2, m.yc - S.dy / 2, S.dx, S.dy, { fill: colOf(m.F), fillOpacity: 0.85, stroke: 'var(--surface)', width: 0.6 });
          if (o.labels && S.dx * v.scale > 30 && S.dy * v.scale > 14) v.text(tx(m.xc), m.yc, fmt(m.F, 2), { size: 9, halo: false, color: 'var(--text)' });
        }
        v.rect(gx0 - S.dx / 2, g.y0 - S.dy / 2, gx1 - gx0 + S.dx, g.y1 - g.y0 + S.dy, { fill: 'none', stroke: 'var(--c-dim)', width: 1, dash: '4 3' });
      } else {
        for (const m of S.map) if (Number.isFinite(m.F)) v.dot(tx(m.xc), m.yc, 2.6, { fill: colOf(m.F), stroke: 'none', title: `F = ${fmt(m.F, 3)}` });
      }
      const steps = 8;
      v.legend({ title: useD ? 'F_d' : 'F', min: fmin, max: fmax, steps, digits: 2, color: (t) => sequential(1 - t) });
    }
    // Nachbarkreise
    if (o.near) for (const c of S.near.slice(1, 10)) arcPolyline(v, M, c, { stroke: 'var(--c-neg)', width: 0.8, opacity: 0.45, dash: '4 3' });
    if (best) {
      // Gleitkörper
      const arc = arcPoints(M, best, 60);
      const top = [];
      for (let k = 0; k <= 40; k++) { const x = best.xe - (best.xe - best.xa) * k / 40; top.push([tx(x), polyY(M.surf, x)]); }
      v.polygon([...arc, ...top], { fill: 'var(--c-neg-fill)', stroke: 'none' });
      if (o.slices && best.slices && mode === 'crit') {
        for (const s of best.slices) {
          const xl = s.xm - s.b / 2;
          const yb = best.yc - Math.sqrt(Math.max(0, best.R ** 2 - (xl - best.xc) ** 2));
          v.line(tx(xl), yb, tx(xl), polyY(M.surf, xl), { stroke: 'var(--c-neg)', width: 0.7, opacity: 0.55 });
        }
      }
      v.polyline(arc, { stroke: 'var(--c-neg)', width: 2.6 });
      // Radien und Mittelpunkt
      const ya = best.yc - Math.sqrt(Math.max(0, best.R ** 2 - (best.xa - best.xc) ** 2));
      const ye = best.yc - Math.sqrt(Math.max(0, best.R ** 2 - (best.xe - best.xc) ** 2));
      v.line(tx(best.xc), best.yc, tx(best.xa), ya, { stroke: 'var(--c-neg)', width: 0.9, dash: '3 3' });
      v.line(tx(best.xc), best.yc, tx(best.xe), ye, { stroke: 'var(--c-neg)', width: 0.9, dash: '3 3' });
      v.dot(tx(best.xc), best.yc, 4.5, { fill: 'var(--c-neg)' });
      if (o.labels) v.text(tx(best.xc), best.yc, `${useD ? 'F_d' : 'F'} = ${fmt(best.F, 3)}  (R = ${fmt(best.R, 2)} m)`, { anchor: 'start', dx: 9, dy: -9, bold: true, color: 'var(--c-neg)' });
    }
    key(v, [{ label: `massgebender Gleitkreis (${useD ? 'Bemessung' : 'charakteristisch'})`, color: 'var(--c-neg)' }, { label: 'Gleitkörper', color: 'var(--c-neg)', type: 'fill' }, wl ? { label: 'Wasserspiegel', color: 'var(--c-water)' } : null, mode === 'crit' ? { label: 'Mittelpunkte, Farbe = kleinstes F', color: sequential(0.25), type: 'dot' } : { label: 'Suchraster: kleinstes F je Mittelpunkt', color: sequential(0.25), type: 'fill' }]);
    legendLine(v, [`Bishop: F = ${fmt(R.F, 3)} (charakteristisch)`, `F_d = ${fmt(R.Fd, 3)} (Bemessung)`, `Fellenius: F = ${fmt(R.FF, 3)}`, `${R.circles} Kreise, ${R.ms} ms`]);
  }
  v.setBounds(bx0, yBot - 0.14 * (by1 - yBot), bx1, by1);
}

function arcPoints(M, c, n) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const x = c.xa + (c.xe - c.xa) * k / n;
    pts.push([M.tx(x), c.yc - Math.sqrt(Math.max(0, c.R * c.R - (x - c.xc) ** 2))]);
  }
  return pts;
}
function arcPolyline(v, M, c, st) { v.polyline(arcPoints(M, c, 40), st); }

// ------------------------------------------------------------------ 5. Stützmauer

function drawWall({ v, p, r, soil, mode, o }) {
  let g;
  try { g = wallGeometry(p.rw); } catch { v.setBounds(0, 0, 5, 5); return; }
  const R = r?.rw;
  const tb = Math.tan(rad(g.beta));
  const X1 = g.B + Math.max(1.3 * g.H, 3);
  const X0 = -Math.max(1.2, 0.45 * g.H);
  const yB = -Math.max(1.2, 0.45 * g.H) - (g.key ? g.key.depth : 0);
  const yS = (x) => g.H + (x - g.xb) * tb;
  const size = Math.max(X1 - X0, g.H - yB);
  const region = [[X0, yB], [X1, yB], [X1, yS(X1)], [g.xb, g.H], [g.xb, g.Df], [X0, g.Df]];
  drawLayers(v, soil, region, (z) => g.H - z, { labels: o.labels && mode === 'wall', labelX: X1, gap: size / 75, hatch: o.hatch, yTopLabel: g.H });
  v.line(X0, g.Df, g.Df > g.d ? g.toe + (g.tBot - g.tTop) * (g.Df - g.d) / g.hs : 0, g.Df, { stroke: 'var(--c-soil)', width: 1.6 });
  v.line(g.xb, g.H, X1, yS(X1), { stroke: 'var(--c-soil)', width: 1.6 });
  if (Number.isFinite(soil.zw) && soil.zw < g.H - yB) waterLine(v, g.xb, X1, g.H - soil.zw, { label: o.labels ? `GW ${fmt(soil.zw, 2)} m${p.rw.water ? '' : ' (nicht angesetzt)'}` : null });
  // Beton
  v.polygon([[0, 0], [g.B, 0], [g.B, g.d], [g.xb, g.d], [g.xb, g.H], [g.xb - g.tTop, g.H], [g.toe, g.d], [0, g.d]], CONCRETE);
  if (g.key) v.rect(g.key.x, -g.key.depth, g.key.width, g.key.depth, CONCRETE);
  // Auflast
  const q = Number(p.rw.q) || 0;
  if (q > 0) surchargeArrows(v, [[g.xb + 0.05, yS(g.xb + 0.05)], [X1, yS(X1)]], o.labels ? `q = ${fmt(q, 1)} kN/m²` : null, 10);
  // Ersatzwand
  v.line(g.B, 0, g.B, g.ySurfB, { stroke: 'var(--c-dim)', width: 1.2, dash: '6 4' });
  if (mode === 'wall') {
    if (o.labels) v.text(g.B, g.ySurfB, 'Ersatzwand', { anchor: 'start', dx: 6, dy: 12, color: 'var(--c-dim)', size: 10.5 });
    v.dimension(0, 0, g.toe, 0, fmt(g.toe, 2), -26);
    v.dimension(g.toe, 0, g.xb, 0, fmt(g.tBot, 2), -26);
    v.dimension(g.xb, 0, g.B, 0, fmt(g.heel, 2), -26);
    v.dimension(0, 0, g.B, 0, `B = ${fmt(g.B, 2)} m`, -46 - (g.key ? 26 : 0));
    v.dimension(g.xb - g.tTop, g.H, g.xb, g.H, fmt(g.tTop, 2), 18);
    v.dimension(X0 + 0.2, 0, X0 + 0.2, g.H, `H = ${fmt(g.H, 2)} m`, -16);
    v.dimension(g.B + 0.25, g.d, g.B + 0.25, g.H, `h_s = ${fmt(g.hs, 2)}`, -20);
    v.dimension(g.B + 0.25, 0, g.B + 0.25, g.d, `d = ${fmt(g.d, 2)}`, -20);
    if (g.Df > 0) v.dimension(X0 + 0.8, 0, X0 + 0.8, g.Df, `D_f = ${fmt(g.Df, 2)}`, -16);
    key(v, [{ label: 'Ersatzwand (Erddruckansatz)', color: 'var(--c-dim)', dash: '6 4' }, Number.isFinite(soil.zw) && soil.zw < g.H - yB ? KEY.gw : null]);
  }
  if (R && mode === 'forces') {
    pressureFigure(v, R.ep, () => g.B, g.H, 0, 0.35 * g.H, o.labels, 1);
    // Gewichte
    for (const f of R.forces) {
      if (f.Fy < 0 && f.Fx === 0 && !/Erddruck/.test(f.name)) {
        const col = f.kind === 'G' ? 'var(--c-struct)' : 'var(--c-load)';
        v.arrow(f.x, f.y, 0, -1, { length: 26, head: 7, width: 1.6, color: col });
        if (o.labels) v.text(f.x, f.y, `${fmt(-f.Fy, 1)}`, { dy: -32, size: 10, color: col });
      }
    }
    // Sohldruck (Bemessung)
    const sig = R.sigDesign;
    if (sig.pts.length) {
      const k = (0.3 * g.H) / Math.max(sig.max, 1e-9);
      const yb0 = g.key ? -g.key.depth - 0.05 : 0;
      const pts = sig.pts.map(([x, s]) => [x, yb0 - k * s]);
      v.polygon([[0, yb0], ...pts, [g.B, yb0]], { fill: 'var(--c-pos-fill)', stroke: 'var(--c-pos)', width: 1.4 });
      for (let i = 0; i <= 8; i++) {
        const x = g.B * i / 8;
        const s = interpPts(sig.pts, x);
        if (s * k * v.scale > 8) v.arrow(x, yb0, 0, 1, { length: Math.min(30, s * k * v.scale), head: 5, width: 1, color: 'var(--c-pos)' });
      }
      if (o.labels) {
        v.text(0, yb0 - k * interpPts(sig.pts, 0), `${fmt(interpPts(sig.pts, 0), 0)} kN/m²`, { anchor: 'end', dx: -6, color: 'var(--c-pos)', size: 10.5 });
        v.text(g.B, yb0 - k * interpPts(sig.pts, g.B), `${fmt(interpPts(sig.pts, g.B), 0)} kN/m²`, { anchor: 'start', dx: 6, color: 'var(--c-pos)', size: 10.5 });
      }
      // Resultierende
      const c = R.cA;
      v.arrow(c.xR, 0, -c.H / Math.max(c.N, 1e-9), -1, { length: 56, width: 2.4, head: 10, color: 'var(--c-neg)', tail: false, label: o.labels ? `R_d (e = ${fmt(c.e, 2)} m)` : null });
      v.line(g.B / 2, -0.02 * g.H, g.B / 2, 0.06 * g.H, { stroke: 'var(--c-dim)', width: 1, dash: '3 2' });
      v.line(g.B / 3, -0.02 * g.H, g.B / 3, 0.04 * g.H, { stroke: 'var(--warn)', width: 1, dash: '2 2' });
      v.line(2 * g.B / 3, -0.02 * g.H, 2 * g.B / 3, 0.04 * g.H, { stroke: 'var(--warn)', width: 1, dash: '2 2' });
    }
    key(v, [KEY.epG, R.ep.EhQ > 0 ? KEY.epQ : null, R.ep.U > 0 ? KEY.water : null, { label: 'Eigengewichte (ständig) [kN/m]', color: 'var(--c-struct)' }, { label: 'Sohldruck (Bemessung)', color: 'var(--c-pos)', type: 'fill' }, { label: 'Resultierende in der Sohle', color: 'var(--c-neg)' }]);
    legendLine(v, [`E_ah = ${fmt(R.ep.Eh, 1)} kN/m`, `ΣV_k = ${fmt(R.charAll.N, 1)} kN/m`, `Sohldruck: Bemessung (γ_G = ${fmt(R.cA.fG, 2)}, γ_Q = ${fmt(R.cA.fQe, 2)})`]);
  }
  v.setBounds(X0, Math.min(yB, R && mode === 'forces' ? -0.35 * g.H - (g.key ? g.key.depth : 0) : yB) - 0.22 * g.H, X1, Math.max(g.H, yS(X1)) + 0.2 * g.H);
}

function interpPts(pts, x) {
  for (let i = 0; i < pts.length - 1; i++) if (x >= pts[i][0] - 1e-9 && x <= pts[i + 1][0] + 1e-9) {
    const t = (x - pts[i][0]) / Math.max(1e-12, pts[i + 1][0] - pts[i][0]);
    return pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
  }
  return 0;
}

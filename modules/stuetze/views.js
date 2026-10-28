// Stütze – Grafische Darstellungen (System, Verformung, Momente, Querschnitt)
//
// Ansicht der Stütze: Weltkoordinaten in m, x_welt = Ausbiegung (w, nach rechts positiv),
// y_welt = Stützenachse (0 = Fuss, L = Kopf). Bei zweiachsiger Berechnung werden die beiden
// Biegeebenen nebeneinander dargestellt. Biegemomente werden auf der Zugseite aufgetragen.

import { svgEl } from '../../js/core/ui.js';
import { fmt } from '../../js/core/format.js';
import { SUPPORT_PRESETS, inclination, normalize, axisLoads } from './calc.js';
import { sectionGeometry, axisDistance } from './section.js';

export const VIEW_MODES = [
  { id: 'system', label: 'System' },
  { id: 'deform', label: 'Verformung', needsResults: true },
  { id: 'moments', label: 'Momente', needsResults: true },
  { id: 'section', label: 'Querschnitt' },
];

/** Index des gewählten Lastfalls (begrenzt auf vorhandene Lastfälle). */
export function lcIndex(app) {
  const n = app.project?.loadCases?.length || 1;
  const i = Number(app.viewOpts.lc) || 0;
  return Math.max(0, Math.min(n - 1, i));
}

/** Achsen, die dargestellt werden (y immer, z bei zweiachsiger Biegung oder abweichender Lagerung). */
export function shownAxes(p) {
  return p.biaxial || (p.supportZ && p.supportZ !== 'same') ? ['y', 'z'] : ['y'];
}

function bcOf(p, ax) {
  const key = ax === 'z' && p.supportZ && p.supportZ !== 'same' ? p.supportZ : p.support;
  const c = ax === 'z' && p.supportZ && p.supportZ !== 'same' ? p.customZ : p.custom;
  const pr = SUPPORT_PRESETS[key] || SUPPORT_PRESETS.pinned;
  if (key === 'custom') return { key, bot: c.bot, top: c.top, sway: !!c.sway, beta: null };
  return { key, bot: pr.bot, top: pr.top, sway: pr.sway, beta: pr.beta };
}

const lcLoads = axisLoads;

const kN = (v) => `${fmt(v, Math.abs(v) >= 100 ? 0 : 1)} kN`;
const kNm = (v) => `${fmt(v, Math.abs(v) >= 100 ? 0 : 1)} kNm`;
const mm = (v) => `${fmt(v * 1000, Math.abs(v) >= 0.1 ? 0 : 1)} mm`;

// ------------------------------------------------------------------ Symbole

/** Drehfeder (Spirale) als Pixelsymbol. */
function springSymbol(v, x, y, below = true) {
  v.symbol(x, y, (g) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40 * Math.PI * 3.2, r = 2 + 7 * i / 40;
      pts.push(`${(r * Math.cos(t)).toFixed(1)},${(r * Math.sin(t) * (below ? 1 : -1)).toFixed(1)}`);
    }
    g.append(svgEl('polyline', { points: pts.join(' '), style: { fill: 'none', stroke: 'var(--c-support)', strokeWidth: 1.4 } }));
  });
}

/** Verschiebliche Einspannung (Einspannung mit Rollen). */
function slidingClamp(v, x, y) {
  v.symbol(x, y, (g) => {
    const st = { stroke: 'var(--c-support)', strokeWidth: 2.2 };
    g.append(svgEl('line', { x1: -14, y1: 0, x2: 14, y2: 0, style: st }));
    for (const cx of [-8, 8]) g.append(svgEl('circle', { cx, cy: -5, r: 3.2, style: { fill: 'var(--surface)', stroke: 'var(--c-support)', strokeWidth: 1.3 } }));
    g.append(svgEl('line', { x1: -16, y1: -10, x2: 16, y2: -10, style: { stroke: 'var(--c-support)', strokeWidth: 1.4 } }));
    for (let i = -16; i < 16; i += 5) g.append(svgEl('line', { x1: i, y1: -10, x2: i + 5, y2: -15, style: { stroke: 'var(--c-support)', strokeWidth: 1 } }));
  });
}

function drawSupports(v, bc, x0, hw, L) {
  // Fuss
  if (bc.bot === 'fixed') v.support(x0, 0, 'fixed', 90);
  else {
    v.support(x0, 0, 'pinned', 90);
    if (bc.bot === 'spring') springSymbol(v, x0, 0);
  }
  // Kopf
  if (bc.top === 'fixed') {
    if (bc.sway) slidingClamp(v, x0, L);
    else v.support(x0, L, 'fixed', 270);
  } else {
    if (!bc.sway) v.support(x0 - hw, L, 'roller', 0);
    if (bc.top === 'spring') springSymbol(v, x0, L, false);
  }
}

/** Gefüllter Momentenverlauf entlang der Stütze (auf der Zugseite: Welt-x = −M·s). */
function momentDiagram(v, x0, ys, vals, s, opts = {}) {
  const pts = Array.from(ys, (y, i) => [x0 - vals[i] * s, y]);
  // Flächen getrennt nach Vorzeichen
  let cur = [], sign = 0;
  const flush = () => {
    if (cur.length > 1) {
      const poly = [[x0, cur[0][1]], ...cur, [x0, cur[cur.length - 1][1]]];
      v.polygon(poly, { fill: sign >= 0 ? 'var(--c-pos-fill)' : 'var(--c-neg-fill)', stroke: 'none', width: 0 });
    }
  };
  for (let i = 0; i < ys.length; i++) {
    const sg = Math.sign(vals[i]) || sign;
    if (sign !== 0 && sg !== sign && i > 0) {
      const t = vals[i - 1] / (vals[i - 1] - vals[i]);
      const yc = ys[i - 1] + t * (ys[i] - ys[i - 1]);
      cur.push([x0, yc]);
      flush();
      cur = [[x0, yc]];
    }
    sign = sg;
    cur.push(pts[i]);
  }
  flush();
  v.polyline(pts, { stroke: opts.stroke || 'var(--c-pos)', width: opts.width || 1.8, dash: opts.dash });
}

function extremeIndex(vals) {
  let k = 0;
  for (let i = 1; i < vals.length; i++) if (Math.abs(vals[i]) > Math.abs(vals[k])) k = i;
  return k;
}

// ------------------------------------------------------------------ Querschnitt (auch als Einsatz)

function drawSection(v, geo, sp, cx, cy, sc, o = {}) {
  const T = (y, z) => [cx + y * sc, cy + z * sc];
  if (!o.onlyBars) v.polygon(geo.poly.map(([y, z]) => T(y, z)), { fill: 'var(--c-concrete)', stroke: 'var(--c-concrete-line)', width: 1.4 });
  // Bügel
  if (sp.coverMode !== 'axis' && sp.stirrup > 0) {
    const c = (sp.cover + sp.stirrup / 2) / 1000;
    if (geo.shape === 'circle') {
      const r = geo.R - c;
      if (r > 0) v.circle(cx, cy, r * sc, { stroke: 'var(--c-steel)', width: 1.1 });
    } else {
      const bb = geo.b / 2 - c, hh = geo.h / 2 - c;
      if (bb > 0 && hh > 0) v.polygon([T(-bb, -hh), T(bb, -hh), T(bb, hh), T(-bb, hh)], { fill: 'none', stroke: 'var(--c-steel)', width: 1.1 });
    }
  }
  for (const b of geo.bars) {
    const [x, y] = T(b.y, b.z);
    const el = v.circle(x, y, b.dia / 2000 * sc, { fill: 'var(--c-rebar)', stroke: 'var(--c-rebar)', width: 0.5 });
    if (o.title) el.append(svgEl('title', { text: `Ø${b.dia}` }));
  }
}

// ------------------------------------------------------------------ Hauptfunktion

export function renderView(v, app, mode) {
  const p = normalize(app.project);
  const R = app.results;
  const li = lcIndex(app);
  if (mode === 'section') return viewSection(v, app, p, R, li);
  if ((mode === 'deform' || mode === 'moments') && R) return viewResults(v, app, p, R, li, mode);
  return viewSystem(v, app, p, R, li);
}

export function panelGeometry(p, mode = 'system') {
  let hw = 0.15, hz = 0.15;
  try {
    const g = sectionGeometry(p.section);
    hw = g.h / 2; hz = g.b / 2;
  } catch { /* Eingabe unvollständig */ }
  const axes = shownAxes(p);
  // Momentenbilder brauchen Platz für ±M_Rd beidseits der Achse
  const gap = mode === 'moments' ? Math.max(2, 1.7 * p.L) : mode === 'deform' ? Math.max(1.6, 1.1 * p.L) : Math.max(1.6, 0.9 * p.L);
  return { axes, hw: { y: hw, z: hz }, gap, x0: (ax) => (axes.indexOf(ax)) * gap };
}

function panelTitle(v, x, L, ax, two) {
  if (!two) return;
  v.text(x, L * 1.24 + 0.35, ax === 'y' ? 'Biegung um y' : 'Biegung um z', { bold: true, size: 11.5, color: 'var(--text-2)' });
  v.text(x, L * 1.24 + 0.35, ax === 'y' ? 'Ausbiegung in z' : 'Ausbiegung in y', { dy: 14, size: 10.5, color: 'var(--text-3)' });
}

function axisTriad(v, x, y, ax) {
  v.symbol(x, y, (g) => {
    const st = { stroke: 'var(--text-3)', strokeWidth: 1.2 };
    g.append(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: -26, style: st }));
    g.append(svgEl('polygon', { points: '0,-30 -3,-24 3,-24', style: { fill: 'var(--text-3)' } }));
    g.append(svgEl('line', { x1: 0, y1: 0, x2: 26, y2: 0, style: st }));
    g.append(svgEl('polygon', { points: '30,0 24,-3 24,3', style: { fill: 'var(--text-3)' } }));
    g.append(svgEl('text', { x: 4, y: -28, style: { fontSize: '10.5px', fill: 'var(--text-3)' }, text: 'x' }));
    g.append(svgEl('text', { x: 28, y: 12, style: { fontSize: '10.5px', fill: 'var(--text-3)' }, text: ax === 'y' ? 'z' : 'y' }));
  });
}

/** Form der (überhöht gezeichneten) Imperfektion je Lagerung, t = 0 … 1 vom Fuss zum Kopf. */
function impShape(bc) {
  if (bc.sway) return (t) => t;
  if (bc.key === 'fixedFixed') return (t) => (1 - Math.cos(2 * Math.PI * t)) / 2;
  if (bc.key === 'fixedPinned') return fpMode;
  return (t) => Math.sin(Math.PI * t);
}

/**
 * Lage aller Elemente der Darstellung «System» in Weltkoordinaten (m). Wird für die Zeichnung und für
 * die grafische Bearbeitung (Trefferflächen im Editor) gemeinsam verwendet.
 */
export function systemLayout(p, R, li) {
  const L = p.L > 0 ? p.L : 1;
  const lc = p.loadCases[li] || p.loadCases[0] || null;
  const pg = panelGeometry(p);
  const thetaI = inclination(p.norm, L, p.imperfection);
  const panels = {};
  for (const ax of pg.axes) {
    const x0 = pg.x0(ax), hw = pg.hw[ax];
    const bc = bcOf(p, ax);
    const ld = lc ? lcLoads(lc, ax, p.biaxial) : { H: 0, q: 0, Mt: 0, Mb: 0 };
    const res = R?.lcs?.[li]?.[ax.toUpperCase()];
    const beta = res ? res.beta : (p.betaMode === 'user' ? (ax === 'y' ? p.betaY : p.betaZ) : bc.beta);
    const shape = impShape(bc);
    const sgn = res && res.w0 ? (Math.sign(res.w0[extremeIndex(res.w0)]) || 1) : 1;
    const amp = 0.07 * L * sgn;
    const imp = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; imp.push([x0 + amp * shape(t), t * L]); }
    const tl = ld.q && ld.q > 0 ? 0.3 : 0.62;
    const impLabel = [x0 - hw, tl * L];
    const impHandle = imp[Math.round(tl * 40)];
    let qRing = null, xs = null;
    if (ld.q) {
      const d = Math.sign(ld.q);
      xs = x0 - d * (hw + 0.12 * L);
      qRing = [[x0 - d * hw, 0], [xs, 0], [xs, L], [x0 - d * hw, L]];
    }
    panels[ax] = { ax, x0, hw, bc, ld, beta, imp, impLabel, impHandle, qRing, xs };
  }
  let inset = null;
  let right = pg.x0(pg.axes[pg.axes.length - 1]) + Math.max(pg.hw.y, pg.hw.z);
  try {
    const geo = sectionGeometry(p.section);
    const sc = Math.min(3.5, Math.max(1, 0.22 * L / Math.max(geo.b, geo.h)));
    const cx = right + 0.18 * L + 0.9 + geo.b * sc / 2, cy = L * 0.78;
    inset = { geo, sc, cx, cy, ring: geo.poly.map(([y, z]) => [cx + y * sc, cy + z * sc]), bars: geo.bars.map((b) => [cx + b.y * sc, cy + b.z * sc]) };
    right = cx + geo.b * sc / 2 + 0.3;
  } catch { /* ungültiger Querschnitt */ }
  return { L, lc, axes: pg.axes, panels, inset, thetaI, right };
}

function viewSystem(v, app, p, R, li) {
  const lay = systemLayout(p, R, li);
  const { L, thetaI } = lay;
  const lc = lay.lc || {};
  const labels = app.viewOpts.labels !== false;
  let xmax = 0, xmin = 0;
  for (const ax of lay.axes) {
    const { x0, hw, bc, ld, beta, imp, impLabel, qRing, xs } = lay.panels[ax];
    panelTitle(v, x0, L, ax, lay.axes.length > 1);
    // Stützenkörper
    v.rect(x0 - hw, 0, 2 * hw, L, { fill: 'var(--c-concrete)', stroke: 'var(--c-concrete-line)', width: 1.2 });
    v.line(x0, -0.03 * L, x0, 1.03 * L, { stroke: 'var(--c-concrete-line)', width: 0.8, dash: '6 3 1.5 3' });
    // Imperfektion (überhöht)
    v.polyline(imp, { stroke: 'var(--c-deform)', width: 1.3, dash: '5 4' });
    if (labels && thetaI > 0) {
      const lab = bc.sway ? `θi = 1/${Math.round(1 / thetaI)} (überhöht)` : `ei = ${beta ? mm(thetaI * beta * L / 2) : '–'} (überhöht)`;
      v.text(impLabel[0], impLabel[1], lab, { dx: -10, anchor: 'end', size: 10.5, color: 'var(--c-deform)' });
    }
    drawSupports(v, bc, x0, hw, L);
    // Lasten
    if (lc.N) v.arrow(x0, L, 0, lc.N >= 0 ? -1 : 1, { length: 42, label: labels ? `N = ${kN(lc.N)}` : '', tail: lc.N < 0 });
    if (bc.sway && ld.H) {
      const d = Math.sign(ld.H);
      v.arrow(x0 - d * hw, L * 0.985, d, 0, { length: 44, label: labels ? `H = ${kN(Math.abs(ld.H))}` : '' });
    }
    if (qRing) {
      const d = Math.sign(ld.q);
      v.polygon(qRing, { fill: 'var(--c-load-fill)', stroke: 'none', width: 0 });
      v.line(xs, 0, xs, L, { stroke: 'var(--c-load)', width: 1.2 });
      for (let i = 1; i < 8; i++) {
        v.line(xs, L * i / 8, x0 - d * hw, L * i / 8, { stroke: 'var(--c-load)', width: 1.1 });
        v.arrow(x0 - d * hw, L * i / 8, d, 0, { length: 6, head: 6, width: 1.1 });
      }
      if (labels) v.text(xs, L * 0.5, `q = ${fmt(Math.abs(ld.q), 1)} kN/m`, { anchor: d > 0 ? 'end' : 'start', dx: d > 0 ? -6 : 6, color: 'var(--c-load)', size: 10.5 });
      if (d > 0) xmin = Math.min(xmin, xs - x0); else xmax = Math.max(xmax, xs - x0);
    }
    if (ld.Mt && bc.top !== 'fixed') v.momentArrow(x0, L, ld.Mt > 0 ? -1 : 1, { radius: 18, label: labels ? `M = ${kNm(Math.abs(ld.Mt))}` : '' });
    if (ld.Mb && bc.bot !== 'fixed') v.momentArrow(x0, 0, ld.Mb > 0 ? 1 : -1, { radius: 18, label: labels ? `M = ${kNm(Math.abs(ld.Mb))}` : '' });
    // Bemassung
    v.dimension(x0 + hw, 0, x0 + hw, L, `L = ${fmt(L, 2)} m`, -46);
    if (labels && beta) v.text(x0 + hw, L * 0.5, `Knicklänge l₀ = ${fmt(beta, 2)}·L = ${fmt(beta * L, 2)} m`, { dx: 66, rotate: 90, size: 10.5, color: 'var(--c-dim)' });
    axisTriad(v, x0 - hw - 0.25 * Math.max(0.6, L * 0.1) - 0.15, -0.06 * L, ax);
    xmax = Math.max(xmax, hw);
    xmin = Math.min(xmin, -hw);
  }
  // Querschnitt-Einsatz rechts
  const ins = lay.inset;
  if (ins) {
    const { geo, sc, cx, cy } = ins;
    drawSection(v, geo, p.section, cx, cy, sc);
    if (labels) {
      v.text(cx, cy - geo.h * sc / 2, geo.shape === 'circle' ? `Ø ${fmt(geo.D * 1000, 0)} mm` : `${fmt(geo.b * 1000, 0)} × ${fmt(geo.h * 1000, 0)} mm`, { dy: 14, size: 10.5, color: 'var(--text-2)' });
      v.text(cx, cy - geo.h * sc / 2, `${geo.n} Ø${p.section.dia} · ${p.concrete}`, { dy: 28, size: 10.5, color: 'var(--text-2)' });
      v.text(cx, cy + geo.h * sc / 2, 'Querschnitt', { dy: -40, size: 11, bold: true, color: 'var(--text-2)' });
      // Achsen am Einsatz
      v.arrow(cx + geo.b * sc / 2 + 0.05, cy, 1, 0, { length: 22, tail: true, color: 'var(--text-3)', head: 6, width: 1.1 });
      v.text(cx + geo.b * sc / 2 + 0.05, cy, 'y', { dx: 28, size: 10.5, color: 'var(--text-3)' });
      v.arrow(cx, cy + geo.h * sc / 2 + 0.05, 0, 1, { length: 22, tail: true, color: 'var(--text-3)', head: 6, width: 1.1 });
      v.text(cx, cy + geo.h * sc / 2 + 0.05, 'z', { dx: 8, dy: -20, size: 10.5, color: 'var(--text-3)' });
    }
  }
  // Beim Ziehen des Stützenkopfs nicht neu einpassen (der Kopf bleibt dort, wo er losgelassen wurde)
  const noFit = !!app.stzNoFit;
  app.stzNoFit = false;
  v.setBounds(Math.min(-0.5, xmin - 0.4 - 0.12 * L), -0.15 * L, lay.right + 0.2, L * (lay.axes.length > 1 ? 1.3 : 1.22) + 0.4, { noFit });
  if (!p.loadCases.length) v.caption('Noch keine Lasten – Werkzeug «Last» (F) wählen und den Stützenkopf anklicken');
  else if (labels) v.caption(`${p.loadCases[li]?.name || ''} · Bemessungswerte · ${p.norm === 'EC' ? 'EN 1992-1-1' : 'SIA 262'} · Elemente anklicken zum Bearbeiten`);
}

/** Knickfigur eingespannt – gelenkig (k = 4.4934, tan k = k), normiert auf max = 1. */
function fpMode(t) {
  const k = 4.493409457909064;
  const f = (s) => Math.sin(k * s) - k * Math.cos(k * s) - k * s + k;
  return f(t) / 6.28318; // Maximum = 2π bei t ≈ 0.6
}

function viewResults(v, app, p, R, li, mode) {
  const r = R.lcs[li] || R.lcs[0];
  const L = R.p.L;
  const labels = app.viewOpts.labels !== false;
  const pg = panelGeometry(R.p, mode);
  let xmin = 0, xmax = 0, rdShown = false;
  for (const ax of pg.axes) {
    const A = r[ax.toUpperCase()];
    const x0 = pg.x0(ax);
    panelTitle(v, x0, L, ax, pg.axes.length > 1);
    const bc = bcOf(R.p, ax);
    const st = A.at1 || A.atU;
    v.line(x0, 0, x0, L, { stroke: 'var(--c-concrete-line)', width: 1.1 });
    drawSupports(v, bc, x0, 0.02, L);
    if (mode === 'deform') {
      if (!st) continue;
      const wmax = Math.max(1e-9, ...st.w.map(Math.abs), ...A.w1.map(Math.abs));
      const s = 0.13 * L / wmax;
      const ys = Array.from(A.x);
      v.polyline(ys.map((y, i) => [x0 + A.w0[i] * s, y]), { stroke: 'var(--text-3)', width: 1.1, dash: '5 4' });
      v.polyline(ys.map((y, i) => [x0 + A.w1[i] * s, y]), { stroke: 'var(--c-series-3)', width: 1.4, dash: '2 3' });
      const poly = ys.map((y, i) => [x0 + st.w[i] * s, y]);
      v.polygon([[x0, 0], ...poly, [x0, L]], { fill: 'var(--c-struct-fill)', stroke: 'none', width: 0 });
      v.polyline(poly, { stroke: 'var(--c-deform)', width: 2.4 });
      const k = extremeIndex(st.w);
      v.dot(x0 + st.w[k] * s, ys[k], 3.5, { fill: 'var(--c-deform)' });
      if (labels) {
        const right = st.w[k] >= 0;
        v.text(x0 + st.w[k] * s, ys[k], `w = ${mm(st.w[k])}`, { dx: right ? 8 : -8, anchor: right ? 'start' : 'end', bold: true, color: 'var(--c-deform)' });
        v.text(x0 + st.w[k] * s, ys[k], `= ei ${mm(A.w0[k])} + Δw ${mm(st.u[k])}`, { dx: right ? 8 : -8, dy: 15, anchor: right ? 'start' : 'end', size: 10, color: 'var(--text-2)' });
        const k1 = extremeIndex(A.w1);
        v.text(x0 + A.w1[k1] * s, ys[k1], `1. Ordnung ${mm(A.w1[k1])}`, { dx: right ? 8 : -8, dy: -16, anchor: right ? 'start' : 'end', size: 10, color: 'var(--c-series-3)' });
      }
      xmin = Math.min(xmin, -0.15 * L); xmax = Math.max(xmax, 0.15 * L);
    } else {
      const M2 = st ? st.M : null;
      const M1 = A.M1;
      const mmax = Math.max(1e-9, ...(M2 ? M2.map(Math.abs) : [0]), ...M1.map(Math.abs));
      const s = 0.22 * L / mmax;
      const ys = Array.from(A.x);
      if (M2) momentDiagram(v, x0, ys, M2, s, { stroke: 'var(--c-pos)', width: 2 });
      v.polyline(ys.map((y, i) => [x0 - M1[i] * s, y]), { stroke: 'var(--text-2)', width: 1.3, dash: '5 3' });
      // Widerstand M_Rd als Grenzlinien
      if (A.MRd > 0 && A.MRd * s < 0.6 * L) {
        for (const sg of [-1, 1]) v.line(x0 + sg * A.MRd * s, 0, x0 + sg * A.MRd * s, L, { stroke: 'var(--fail)', width: 1, dash: '3 4', opacity: 0.7 });
        rdShown = true;
        if (labels) v.text(x0 + A.MRd * s, L, `±M_Rd = ${kNm(A.MRd)}`, { dy: -10, anchor: 'middle', size: 10, color: 'var(--fail)' });
        xmin = Math.min(xmin, -A.MRd * s); xmax = Math.max(xmax, A.MRd * s);
      }
      if (labels) {
        if (M2) {
          const k = extremeIndex(M2);
          const xx = x0 - M2[k] * s, left = M2[k] > 0;
          v.dot(xx, ys[k], 3.5, { fill: 'var(--c-pos)' });
          v.text(xx, ys[k], `M_II = ${kNm(M2[k])}`, { dx: left ? -8 : 8, anchor: left ? 'end' : 'start', bold: true, color: 'var(--c-pos)' });
          v.text(xx, ys[k], `x = ${fmt(ys[k], 2)} m`, { dx: left ? -8 : 8, dy: 14, anchor: left ? 'end' : 'start', size: 10, color: 'var(--text-2)' });
          for (const e of [0, ys.length - 1]) if (e !== k && Math.abs(M2[e]) > 0.05 * mmax) v.text(x0 - M2[e] * s, ys[e], kNm(M2[e]), { dx: M2[e] > 0 ? -6 : 6, anchor: M2[e] > 0 ? 'end' : 'start', size: 10, color: 'var(--c-pos)' });
        }
        const k1 = extremeIndex(M1);
        const out = M1[k1] > 0;
        v.text(x0 - M1[k1] * s, ys[k1], `M_I = ${kNm(M1[k1])}`, { dx: out ? -8 : 8, dy: M2 ? -16 : 0, anchor: out ? 'end' : 'start', size: 10.5, color: 'var(--text-2)' });
      }
      xmin = Math.min(xmin, -0.25 * L); xmax = Math.max(xmax, 0.25 * L);
    }
    if (labels && !A.at1) v.text(x0, L, `kein Gleichgewicht bei λ = 1 – Zustand bei λu = ${fmt(A.lambdaU, 2)}`, { dy: -40, size: 10.5, color: 'var(--fail)', bold: true });
  }
  const x1 = pg.x0(pg.axes[pg.axes.length - 1]);
  // unten Platz für die Zeichenerklärung (unten links) lassen
  v.setBounds(xmin - 0.3, -0.3 * L, x1 + xmax + 0.3, L * 1.3 + 0.4);
  if (labels) {
    if (mode === 'deform') {
      v.keyLegend([
        { label: 'Theorie 2. Ordnung (allgemeines Verfahren)', color: 'var(--c-deform)' },
        { label: 'Theorie 1. Ordnung', color: 'var(--c-series-3)', dash: '2 3' },
        { label: 'Imperfektion (Vorverformung)', color: 'var(--text-3)', dash: '5 4' },
      ]);
      v.caption(`${r.name} · Verformung bei Bemessungslast, überhöht dargestellt`);
    } else {
      v.keyLegend([
        { label: 'M 2. Ordnung (allgemeines Verfahren)', color: 'var(--c-pos)', type: 'fill', fill: 'var(--c-pos-fill)' },
        { label: 'M 1. Ordnung inkl. Imperfektion', color: 'var(--text-2)', dash: '5 3' },
        rdShown ? { label: 'Querschnittswiderstand ±M_Rd', color: 'var(--fail)', dash: '3 4', width: 1.2 } : null,
      ].filter(Boolean));
      v.caption(`${r.name} · Biegemomente auf der Zugseite aufgetragen`);
    }
  }
}

function viewSection(v, app, p, R, li) {
  let geo;
  try { geo = sectionGeometry(p.section); } catch (e) { app.showViewMessage?.(e.message); v.setBounds(-0.2, -0.2, 0.2, 0.2); return; }
  const labels = app.viewOpts.labels !== false;
  drawSection(v, geo, p.section, 0, 0, 1, { title: true });
  const b = geo.b, hh = geo.h;
  // Nulllinie im massgebenden Schnitt (einachsig)
  const r = R?.lcs?.[li];
  if (r && labels) {
    const ax = r.governingAxis;
    const A = r[ax.toUpperCase()];
    const st = A.at1;
    if (st && st.tab && Math.abs(st.kapCrit) > 1e-9) {
      const k = st.kapCrit, tab = st.tab;
      // e0 aus Tabelle interpolieren
      const a = Math.abs(k);
      let i = 1;
      while (i < tab.kap.length - 1 && tab.kap[i] < a) i++;
      const t = (a - tab.kap[i - 1]) / ((tab.kap[i] - tab.kap[i - 1]) || 1);
      const e0 = tab.e0[i - 1] + t * (tab.e0[i] - tab.e0[i - 1]);
      const un = e0 / a * Math.sign(k); // ε = e0 − κ·u = 0
      const ext = ax === 'y' ? hh / 2 : b / 2;
      if (Math.abs(un) >= ext) {
        v.caption(`${r.name}: Querschnitt im massgebenden Schnitt (Biegung um ${ax}, x = ${fmt(A.x[st.iM], 2)} m) vollständig überdrückt – keine Nulllinie im Querschnitt`);
      } else {
        const side = Math.sign(k); // Druck auf Seite u > un für κ > 0
        const clip = clipHalf(geo.poly, ax, un, side);
        if (clip.length > 2) v.polygon(clip, { fill: 'var(--c-neg-fill)', stroke: 'none', width: 0 });
        drawSection(v, geo, p.section, 0, 0, 1, { onlyBars: true, title: true });
        if (clip.length > 2) {
          const cxp = clip.reduce((t, q) => t + q[0], 0) / clip.length, cyp = clip.reduce((t, q) => t + q[1], 0) / clip.length;
          v.text(cxp, cyp, 'Druckzone', { size: 10.5, color: 'var(--c-neg)', bold: true });
        }
        const Lx = Math.max(b, hh) * 0.62;
        if (ax === 'y') {
          v.line(-Lx, un, Lx, un, { stroke: 'var(--c-neg)', width: 1.4, dash: '7 4' });
          v.text(Lx, un, 'Nulllinie', { anchor: 'start', dx: 6, size: 10.5, color: 'var(--c-neg)' });
        } else {
          v.line(un, -Lx, un, Lx, { stroke: 'var(--c-neg)', width: 1.4, dash: '7 4' });
          v.text(un, Lx, 'Nulllinie', { dy: -8, size: 10.5, color: 'var(--c-neg)' });
        }
        v.caption(`${r.name}: Druckzone im massgebenden Schnitt (Biegung um ${ax}, x = ${fmt(A.x[st.iM], 2)} m, λ = 1, Theorie 2. Ordnung)`);
      }
    }
  }
  // Bemassung
  if (geo.shape === 'circle') {
    v.dimension(-geo.R, -geo.R, geo.R, -geo.R, `D = ${fmt(geo.D * 1000, 0)}`, -30);
  } else {
    v.dimension(-b / 2, -hh / 2, b / 2, -hh / 2, `b = ${fmt(b * 1000, 0)}`, -30);
    v.dimension(-b / 2, hh / 2, -b / 2, -hh / 2, `h = ${fmt(hh * 1000, 0)}`, -30);
  }
  // Achsen
  const ext = Math.max(b, hh) / 2;
  v.arrow(ext * 1.05 + 0.02, 0, 1, 0, { length: 30, tail: true, color: 'var(--text-3)', head: 7, width: 1.2 });
  v.text(ext * 1.05 + 0.02, 0, 'y', { dx: 36, color: 'var(--text-2)' });
  v.arrow(0, ext * 1.05 + 0.02, 0, 1, { length: 30, tail: true, color: 'var(--text-3)', head: 7, width: 1.2 });
  v.text(0, ext * 1.05 + 0.02, 'z', { dy: -36, color: 'var(--text-2)' });
  v.line(-ext * 1.1, 0, ext * 1.05, 0, { stroke: 'var(--c-concrete-line)', width: 0.7, dash: '6 3 1.5 3' });
  v.line(0, -ext * 1.1, 0, ext * 1.05, { stroke: 'var(--c-concrete-line)', width: 0.7, dash: '6 3 1.5 3' });
  if (labels) {
    const As = geo.As * 1e6;
    v.text(0, -ext, `${geo.n} Ø${p.section.dia}  ·  As = ${fmt(As, 0)} mm²  ·  ρ = ${fmt(geo.As / geo.Ac * 100, 2)} %`, { dy: 58, size: 11, color: 'var(--text)' });
    v.text(0, -ext, `${p.concrete} · ${p.steel} · Achsabstand a = ${fmt(axisDistance(p.section) * 1000, 0)} mm`, { dy: 74, size: 10.5, color: 'var(--text-2)' });
    if (!R || !R.lcs?.[li]) v.caption('Querschnitt massstäblich · Bewehrung rot, Bügel blau');
  }
  v.setBounds(-ext * 1.35 - 0.04, -ext * 1.3 - 0.06, ext * 1.35 + 0.08, ext * 1.25 + 0.06);
}

/** Schneidet das Querschnittspolygon mit der Halbebene u ≥ un (side > 0) bzw. u ≤ un (side < 0). */
function clipHalf(poly, ax, un, side) {
  const u = (pt) => (ax === 'y' ? pt[1] : pt[0]);
  const inside = (pt) => side * (u(pt) - un) >= 0;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (un - u(a)) / (u(b) - u(a));
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

// ------------------------------------------------------------------ Piktogramme für die Lagerungswahl

/** Kleines SVG-Piktogramm einer Lagerungsart mit Knickfigur (46 × 58 px). */
export function supportIcon(key) {
  const s = svgEl('svg', { viewBox: '0 0 46 58', width: 46, height: 58, 'aria-hidden': 'true' });
  const st = { stroke: 'var(--c-struct)', strokeWidth: 2.2, strokeLinecap: 'round' };
  const sup = { stroke: 'var(--c-support)', strokeWidth: 1.6, fill: 'none', strokeLinejoin: 'round' };
  const y0 = 49, y1 = 9;
  s.append(svgEl('line', { x1: 23, y1: y0, x2: 23, y2: y1, style: st }));
  // Knickfigur
  const shapes = {
    pinned: (t) => Math.sin(Math.PI * t),
    cantilever: (t) => 1 - Math.cos(Math.PI * t / 2),
    fixedPinned: fpMode,
    fixedFixed: (t) => (1 - Math.cos(2 * Math.PI * t)) / 2,
    fixedFixedSway: (t) => (1 - Math.cos(Math.PI * t)) / 2,
    custom: (t) => 0.8 * Math.sin(Math.PI * t) + 0.2 * t,
  };
  const f = shapes[key] || shapes.pinned;
  const pts = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(`${(23 + 10 * f(t)).toFixed(1)},${(y0 - t * (y0 - y1)).toFixed(1)}`); }
  s.append(svgEl('polyline', { points: pts.join(' '), style: { fill: 'none', stroke: 'var(--accent)', strokeWidth: 1.4, strokeDasharray: '3 2' } }));
  const pr = SUPPORT_PRESETS[key] || {};
  const bot = key === 'custom' ? 'spring' : pr.bot, top = key === 'custom' ? 'spring' : pr.top;
  const hatch = (y, dir) => { for (let x = 13; x < 33; x += 4) s.append(svgEl('line', { x1: x, y1: y, x2: x + 4, y2: y + 4 * dir, style: { stroke: 'var(--c-support)', strokeWidth: 1 } })); };
  // Fuss
  if (bot === 'fixed') { s.append(svgEl('line', { x1: 12, y1: y0, x2: 34, y2: y0, style: { ...sup, strokeWidth: 2.4 } })); hatch(y0, 1); } else {
    s.append(svgEl('polygon', { points: `23,${y0} 18,${y0 + 6} 28,${y0 + 6}`, style: { ...sup, fill: 'var(--surface)' } }));
    s.append(svgEl('line', { x1: 14, y1: y0 + 6, x2: 32, y2: y0 + 6, style: sup }));
    if (bot === 'spring') s.append(svgEl('path', { d: `M23 ${y0} m-6 0 a6 6 0 1 1 6 6`, style: { ...sup, strokeWidth: 1.2 } }));
  }
  // Kopf
  if (top === 'fixed') {
    s.append(svgEl('line', { x1: 12, y1: y1, x2: 34, y2: y1, style: { ...sup, strokeWidth: 2.4 } }));
    if (pr.sway) { for (const cx of [17, 29]) s.append(svgEl('circle', { cx, cy: y1 - 3.5, r: 2.2, style: { ...sup, strokeWidth: 1.1 } })); s.append(svgEl('line', { x1: 12, y1: y1 - 6.5, x2: 34, y2: y1 - 6.5, style: sup })); } else hatch(y1 - 4, 1);
  } else if (!pr.sway || key === 'custom') {
    s.append(svgEl('polygon', { points: `23,${y1} 18,${y1 - 6} 28,${y1 - 6}`, style: { ...sup, fill: 'var(--surface)' } }));
    if (top === 'spring') s.append(svgEl('path', { d: `M23 ${y1} m6 0 a6 6 0 1 1 -6 -6`, style: { ...sup, strokeWidth: 1.2 } }));
  } else {
    s.append(svgEl('circle', { cx: 23, cy: y1, r: 2.2, style: { fill: 'var(--c-struct)' } }));
  }
  return s;
}

/** Skizze zur Vorzeichenregel der Lasten (Pixelgrafik). */
export function signSketch() {
  const s = svgEl('svg', { viewBox: '0 0 250 132', width: 250, height: 132, role: 'img', 'aria-label': 'Vorzeichenregel' });
  const T = (x, y, t, o = {}) => s.append(svgEl('text', { x, y, 'text-anchor': o.anchor || 'start', style: { fontSize: '10.5px', fill: o.color || 'var(--text-2)', fontWeight: o.bold ? 600 : 400 }, text: t }));
  const arrow = (x1, y1, x2, y2, col) => {
    s.append(svgEl('line', { x1, y1, x2, y2, style: { stroke: col, strokeWidth: 1.6 } }));
    const a = Math.atan2(y2 - y1, x2 - x1), hd = 6;
    s.append(svgEl('polygon', { points: `${x2},${y2} ${x2 - hd * Math.cos(a - 0.4)},${y2 - hd * Math.sin(a - 0.4)} ${x2 - hd * Math.cos(a + 0.4)},${y2 - hd * Math.sin(a + 0.4)}`, style: { fill: col } }));
  };
  // Stütze
  s.append(svgEl('rect', { x: 52, y: 22, width: 16, height: 88, rx: 2, style: { fill: 'var(--c-concrete)', stroke: 'var(--c-concrete-line)' } }));
  s.append(svgEl('line', { x1: 60, y1: 16, x2: 60, y2: 116, style: { stroke: 'var(--c-concrete-line)', strokeDasharray: '4 2 1 2' } }));
  // exzentrische Normalkraft
  arrow(66, 2, 66, 20, 'var(--c-load)');
  arrow(66, 130, 66, 112, 'var(--c-load)');
  T(72, 12, 'N, Exzentrizität e > 0', { color: 'var(--c-load)' });
  T(72, 128, 'M = N·e > 0', { color: 'var(--c-load)' });
  // H und Achsen
  arrow(18, 30, 50, 30, 'var(--c-load)');
  T(14, 26, 'H > 0', { color: 'var(--c-load)' });
  arrow(24, 70, 48, 70, 'var(--c-load)');
  arrow(24, 86, 48, 86, 'var(--c-load)');
  T(4, 80, 'q > 0', { color: 'var(--c-load)' });
  // Koordinaten
  arrow(110, 116, 110, 90, 'var(--text-3)');
  arrow(110, 116, 136, 116, 'var(--text-3)');
  T(114, 94, 'x');
  T(138, 120, 'z (y)');
  T(150, 46, 'Druckseite rechts', { bold: true, color: 'var(--text)' });
  T(150, 60, '⇒ Moment positiv');
  T(150, 78, 'gleiches Vorzeichen', { bold: true, color: 'var(--text)' });
  T(150, 92, 'oben/unten ⇒ einfach');
  T(150, 106, 'gekrümmt (ungünstig)');
  return s;
}


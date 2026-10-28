// Grafik Mauerwerk: Ansicht, Schnitt (Stützlinie), Schub (Spannungsfeld)
import { svgEl, fmt } from '../../js/core/ui.js';
import { typeById } from './materials.js';
import { concentratedEN } from './calc.js';

const SLAB = 0.22; // dargestellte Deckenstärke [m]

/** Massgebende bzw. gewählte Kombination für eine Darstellung. */
export function pickCombo(app, kind) {
  const R = app.results;
  if (!R || !R.combos.length) return null;
  const sel = app.viewOpts.lc;
  if (sel !== undefined && sel !== 'gov') {
    const c = R.combos.find((x) => String(x.idx) === String(sel));
    if (c) return c;
  }
  const keys = {
    schub: ['shear', 'shearEN', 'shearN'],
    schnitt: ['buck', 'buckEN', 'lat', 'top', 'bot'],
    ansicht: ['conc', 'concMid', 'buck', 'buckEN', 'top', 'bot', 'shear', 'shearEN', 'lat'],
  }[kind] || ['buck', 'buckEN', 'top', 'bot'];
  let best = null, be = -1;
  for (const c of R.combos) {
    if (c.type !== 'ULS') continue;
    for (const k of keys) {
      const ck = c.checks[k];
      if (!ck) continue;
      const e = Number.isFinite(ck.eta) ? ck.eta : 1e9;
      if (e > be) { be = e; best = c; }
    }
  }
  return best || R.combos.find((c) => c.type === 'ULS') || R.combos[0];
}

/** Legende oben links (Bildschirmebene). items: [{label, color, dash, fill}] */
function viewLegend(v, items, title) {
  if (!items.length) return;
  const g = svgEl('g', { class: 'legend' });
  const rowH = 17, pad = 9;
  const W = Math.max(title ? title.length * 6.6 : 0, ...items.map((i) => i.label.length * 6.1 + 34)) + pad * 2;
  const H = items.length * rowH + pad * 2 + (title ? 16 : 0) - 4;
  g.append(svgEl('rect', { x: 0, y: 0, width: W, height: H, rx: 8, style: { fill: 'var(--surface)', stroke: 'var(--border)', opacity: 0.95 } }));
  let y = pad + 6;
  if (title) { g.append(svgEl('text', { x: pad, y: y + 2, style: { fontSize: '11px', fontWeight: 600, fill: 'var(--text)' }, text: title })); y += 16; }
  for (const it of items) {
    if (it.fill) g.append(svgEl('rect', { x: pad, y: y - 5, width: 22, height: 10, rx: 2, style: { fill: it.fill, stroke: it.color || 'none', strokeWidth: 1 } }));
    else g.append(svgEl('line', { x1: pad, y1: y, x2: pad + 22, y2: y, style: { stroke: it.color, strokeWidth: it.width || 2.2, strokeDasharray: it.dash || null } }));
    g.append(svgEl('text', { x: pad + 30, y, 'dominant-baseline': 'middle', style: { fontSize: '11px', fill: 'var(--text-2)' }, text: it.label }));
    y += rowH;
  }
  v.gScreen.append(g);
  v.screenItems.push({ g, layout: () => g.setAttribute('transform', 'translate(12 12)') });
}

let lastBoundsKey = '';
/** Setzt die Grenzen und passt vor dem Zeichnen ein, damit Pixelabstände (Bemassung) stimmen. */
function bounds(v, x0, y0, x1, y1) {
  v.setBounds(x0, y0, x1, y1);
  const key = [x0, y0, x1, y1].map((x) => x.toFixed(4)).join('|');
  if (key !== lastBoundsKey || !v.fitted) { lastBoundsKey = key; v.fit(); }
}

// ======================================================================== Ansicht

function drawSlab(v, x0, x1, y0) {
  v.rect(x0, y0, x1 - x0, SLAB, { fill: 'var(--c-concrete)', stroke: 'var(--c-concrete-line)', width: 1 });
}

function masonryPattern(v, x0, x1, y0, y1, course, unit, opts = {}) {
  const st = { stroke: 'var(--c-mesh)', width: 0.7, opacity: 0.85 };
  const nC = Math.max(1, Math.round((y1 - y0) / course));
  const dc = (y1 - y0) / nC;
  for (let i = 1; i < nC; i++) v.line(x0, y0 + i * dc, x1, y0 + i * dc, st);
  if (opts.noHead) return;
  for (let i = 0; i < nC; i++) {
    const off = i % 2 ? unit / 2 : 0;
    for (let x = x0 + off + unit; x < x1 - 0.02; x += unit) v.line(x, y0 + i * dc, x, y0 + (i + 1) * dc, st);
  }
}

function distributedArrows(v, x0, x1, y, label, o = {}) {
  const L = o.length ?? 26, col = o.color || 'var(--c-load)';
  const n = Math.max(3, Math.min(14, Math.round((x1 - x0) / 0.35)));
  for (let i = 0; i <= n; i++) v.arrow(x0 + (x1 - x0) * i / n, y, 0, -1, { length: L, head: 6, color: col });
  // Verbindungslinie der Pfeilenden (Pixelabstand in Weltlänge umgerechnet; Ansicht ist bereits eingepasst)
  v.line(x0, y + v.px(L), x1, y + v.px(L), { stroke: col, width: 1.4 });
  if (label) v.text(o.center ? (x0 + x1) / 2 : x1, y + v.px(L), label, { dy: -10, anchor: o.center ? 'middle' : 'end', color: col, size: 11.5, bold: true });
}

export function drawAnsicht(v, app) {
  const p = app.project, W = p.wall, L = p.loads, R = app.results;
  const l = W.l, hh = W.h, t = W.t / 1000;
  const ty = typeById(p.material.type);
  const margin = 0.18 * Math.max(l, hh);
  bounds(v, -margin, -SLAB - margin * 0.9, l + margin, hh + SLAB + margin * 1.1);
  const c = pickCombo(app, 'ansicht');
  const showLoads = app.viewOpts.loads !== false, showDims = app.viewOpts.dims !== false;

  // Decken
  drawSlab(v, -0.25, l + 0.25, hh);
  drawSlab(v, -0.25, l + 0.25, -SLAB);
  // Querwände (seitliche Halterung)
  const sides = +W.sides || 0;
  if (sides >= 1) v.rect(-0.12, 0, 0.12, hh, { fill: 'var(--c-struct-fill)', stroke: 'var(--c-support)', width: 1.4 });
  if (sides >= 2) v.rect(l, 0, 0.12, hh, { fill: 'var(--c-struct-fill)', stroke: 'var(--c-support)', width: 1.4 });
  // Wand
  v.rect(0, 0, l, hh, { fill: 'var(--c-highlight)', fillOpacity: 0.13, stroke: 'none' });
  masonryPattern(v, 0, l, 0, hh, ty.course, ty.unit);
  // Öffnungen mit Sturz
  for (const o of W.openings || []) {
    if (!(o.b > 0 && o.hgt > 0)) continue;
    const top = Math.min(hh, o.y + o.hgt);
    const lt = Math.min(0.18, Math.max(0, hh - top));
    if (lt > 0.02) v.rect(Math.max(0, o.x - 0.15), top, Math.min(l, o.x + o.b + 0.15) - Math.max(0, o.x - 0.15), lt, { fill: 'var(--c-concrete)', stroke: 'var(--c-concrete-line)', width: 0.8 });
    v.rect(o.x, o.y, o.b, top - o.y, { fill: 'var(--surface-2)', stroke: 'var(--c-struct)', width: 1.2 });
    v.line(o.x, o.y, o.x + o.b, top, { stroke: 'var(--c-dim)', width: 0.6, dash: '4 3' });
    v.line(o.x, top, o.x + o.b, o.y, { stroke: 'var(--c-dim)', width: 0.6, dash: '4 3' });
    if (showDims) v.text(o.x + o.b / 2, o.y + (top - o.y) / 2, `${fmt(o.b, 2)} × ${fmt(top - o.y, 2)}`, { size: 10, color: 'var(--text-2)' });
  }
  v.rect(0, 0, l, hh, { fill: 'none', stroke: 'var(--c-struct)', width: 1.8 });
  if (sides >= 1) v.text(-0.06, hh / 2, 'Querwand', { rotate: 90, size: 10, color: 'var(--c-support)', dx: -10 });
  if (sides >= 2) v.text(l + 0.06, hh / 2, 'Querwand', { rotate: 90, size: 10, color: 'var(--c-support)', dx: 10 });

  // Einzellast mit Lastausbreitung
  const C = L.conc || {};
  if (C.on && C.a > 0) {
    const a = C.a / 1000, x = C.x || 0;
    v.rect(x, hh - 0.05, a, 0.05, { fill: 'var(--c-steel)', stroke: 'var(--c-struct)', width: 1 });
    const ce = concentratedEN({ a, b: (C.b || 0) / 1000, x, l, t, hc: hh, fd: 1, solid: true });
    const xl = Math.max(0, x - ce.spread), xr = Math.min(l, x + a + ce.spread);
    const st = { stroke: 'var(--c-load)', width: 1.1, dash: '6 4' };
    v.line(x, hh - 0.05, x - Math.min(x, ce.spread), hh / 2, st);
    v.line(x + a, hh - 0.05, x + a + Math.min(l - x - a, ce.spread), hh / 2, st);
    v.polygon([[x, hh - 0.05], [x + a, hh - 0.05], [xr, hh / 2], [xl, hh / 2]], { fill: 'var(--c-load-fill)', stroke: 'none' });
    v.line(xl, hh / 2, xr, hh / 2, { stroke: 'var(--c-load)', width: 1.4 });
    if (showDims) v.text((xl + xr) / 2, hh / 2, `lefm = ${fmt(xr - xl, 2)} m`, { dy: 11, size: 10.5, color: 'var(--c-load)' });
    if (showLoads) {
      const Nc = c?.conc ? `Nc,d = ${fmt(c.conc.Nc, 0)} kN` : `Gk + Qk = ${fmt((C.G || 0) + (C.Q || 0), 0)} kN`;
      v.arrow(x + a / 2, hh + SLAB, 0, -1, { length: 54, head: 9, width: 2.2 });
      v.text(x + a / 2, hh + SLAB + v.px(54), Nc, { anchor: 'start', dx: 8, dy: 2, size: 11.5, bold: true, color: 'var(--c-load)' });
    }
  }

  // Lasten
  if (showLoads) {
    const nLabel = c ? `nd = ${fmt(c.nTop, 1)} kN/m (${c.name})` : `gk + qk = ${fmt((L.gW || 0) + (L.qW || 0) + (L.gD || 0) + (L.qD || 0), 1)} kN/m`;
    distributedArrows(v, 0, l, hh + SLAB, nLabel);
    const V = c ? (c.F.w * (L.Vw || 0) + c.F.ae * (L.Ve || 0)) : (L.Vw || 0) + (L.Ve || 0);
    if (Math.abs(V) > 1e-9) {
      const hV = L.hV > 0 ? Math.min(L.hV, hh + SLAB) : hh;
      v.arrow(0, hV, 1, 0, { length: 60, head: 9, width: 2.2, label: `V${c ? 'd' : ''} = ${fmt(Math.abs(V), 1)} kN`, offset: 4 });
    }
  }
  // Bemassung
  if (showDims) {
    v.dimension(0, -SLAB, l, -SLAB, `l = ${fmt(l, 2)} m`, -26);
    v.dimension(0, 0, 0, hh, `h = ${fmt(hh, 2)} m`, sides >= 1 ? 44 : 28);
  }
  v.caption(`Ansicht · ${ty.label} · t = ${fmt(W.t, 0)} mm`);
}

// ======================================================================== Schnitt

export function drawSchnitt(v, app) {
  const p = app.project, W = p.wall, L = p.loads, R = app.results, S = p.settings || {};
  const hh = W.h, t = W.t / 1000;
  const ty = typeById(p.material.type);
  const k = Math.max(1, Math.round(0.3 * hh / t));
  const X = (x) => x * k;
  const tw = X(t / 2);
  const earth = L.earth || {};
  const earthOn = !!earth.on && earth.he > 0;
  const outer = earthOn || L.eMode === 'slab';
  const ext = Math.max(0.9, 0.35 * hh);
  bounds(v, -tw - ext * 1.25, -SLAB - 0.35 * hh, tw + ext * 1.15, hh + SLAB + 0.32 * hh);
  const c = pickCombo(app, 'schnitt');
  const showLoads = app.viewOpts.loads !== false, showDims = app.viewOpts.dims !== false;
  const legend = [];

  // Erdreich
  if (earthOn) {
    const he = Math.min(earth.he, hh + SLAB);
    v.polygon([[-tw - ext * 1.2, -SLAB - 0.15], [-tw, -SLAB - 0.15], [-tw, he], [-tw - ext * 1.2, he]], { fill: 'var(--c-soil-fill)', stroke: 'none' });
    v.line(-tw - ext * 1.2, he, -tw, he, { stroke: 'var(--c-soil)', width: 1.8 });
    for (let x = -tw - ext * 1.2 + 0.06; x < -tw - 0.02; x += 0.14) v.line(x, he, x + 0.07, he - 0.07, { stroke: 'var(--c-soil)', width: 0.9 });
    v.text(-tw - ext * 0.65, he, 'Erdreich', { dy: -10, size: 10.5, color: 'var(--c-soil)' });
  }
  // Decken
  if (outer) {
    drawSlab(v, -tw, tw + ext, hh);
    drawSlab(v, -tw, tw + ext, -SLAB);
  } else {
    drawSlab(v, -tw - ext * 0.8, tw + ext * 0.8, hh);
    drawSlab(v, -tw - ext * 0.8, tw + ext * 0.8, -SLAB);
  }
  // Auflagertiefe a (Dämmstreifen im nicht aufliegenden Bereich)
  if (L.eMode === 'slab' && L.aD > 0 && L.aD < W.t) {
    const a = L.aD / 1000;
    v.rect(-tw, hh, X(t - a), 0.035, { fill: 'var(--surface-3)', stroke: 'var(--c-dim)', width: 0.8 });
  }
  // Wand
  v.rect(-tw, 0, 2 * tw, hh, { fill: 'var(--c-highlight)', fillOpacity: 0.13, stroke: 'none' });
  masonryPattern(v, -tw, tw, 0, hh, ty.course, ty.unit, { noHead: true });
  v.rect(-tw, 0, 2 * tw, hh, { fill: 'none', stroke: 'var(--c-struct)', width: 1.8 });
  // Achse und Kern
  v.line(0, -SLAB - 0.12, 0, hh + SLAB + 0.12, { stroke: 'var(--c-dim)', width: 0.8, dash: '10 3 2 3' });
  if (showDims) {
    for (const s of [-1, 1]) v.line(s * X(t / 6), 0, s * X(t / 6), hh, { stroke: 'var(--c-dim)', width: 0.6, dash: '2 3' });
    legend.push({ label: 'Kern ±t/6', color: 'var(--c-dim)', dash: '2 3', width: 1 });
  }
  if (!(c && showLoads && c.hasLat)) v.text(-tw, hh * 0.86, earthOn ? 'Erdseite' : 'aussen', { anchor: 'end', dx: -6, size: 9.5, color: 'var(--text-3)' });
  v.text(tw, hh * 0.86, 'Raumseite +e', { anchor: 'start', dx: 6, size: 9.5, color: 'var(--text-3)' });

  // Querlast
  if (c && showLoads && c.hasLat) {
    const zs = c.profile.pts.map((q) => q.z);
    const pf = (z) => {
      const F = c.F;
      let pv = F.w * (L.wind || 0);
      if (earthOn && z < earth.he) pv += F.e * (earth.K ?? 0.5) * ((earth.gs ?? 19) * (earth.he - z) + (earth.qs || 0));
      return pv;
    };
    const pmax = Math.max(1e-9, ...zs.map((z) => Math.abs(pf(z))));
    const sc = 0.55 * ext / pmax;
    const x0 = -tw - 0.04;
    const pts = [[x0, 0]];
    for (let i = 0; i <= 40; i++) { const z = hh * i / 40; pts.push([x0 - Math.abs(pf(z)) * sc, z]); }
    pts.push([x0, hh]);
    v.polygon(pts, { fill: 'var(--c-load-fill)', stroke: 'var(--c-load)', width: 1.2 });
    for (let i = 1; i < 8; i++) {
      const z = hh * i / 8;
      const pv = pf(z);
      if (Math.abs(pv) * sc * v.scale > 12) v.arrow(x0, z, Math.sign(pv) || 1, 0, { length: Math.abs(pv) * sc * v.scale, head: 6, width: 1.2 });
    }
    const zl = earthOn ? Math.min(hh, earth.he) * 0.25 : hh * 0.75;
    v.text(x0 - Math.abs(pf(zl)) * sc, zl, `p = ${fmt(Math.abs(pf(earthOn ? 0 : zl)), 2)} kN/m²${earthOn ? ' (Fuss)' : ''}`, { anchor: 'end', dx: -6, size: 10.5, color: 'var(--c-load)' });
  }

  let legendCheck = '';
  // Stützlinie: bei Querlast die Lösung des Querlastnachweises (ggf. mit Bogenwirkung), sonst Knicknachweis
  if (c) {
    const etaN = c.buck ? c.buck.eta : c.checks.buckEN ? c.checks.buckEN.eta : 0;
    const useLat = !!(c.hasLat && c.lat?.profile && (c.lat.eta >= etaN || !c.profile.ok));
    const prof = useLat ? c.lat.profile : c.profile;
    legendCheck = useLat ? 'Querlast' : 'Normalkraft/Knicken';
    v.polyline(prof.pts.map((q) => [X(q.e1 + q.eq), q.z]), { stroke: 'var(--c-dim)', width: 1.4, dash: '6 4' });
    legend.push({ label: 'Exzentrizität Th. 1. O.', color: 'var(--c-dim)', dash: '6 4' });
    if (prof.ok) {
      v.polyline(prof.pts.map((q) => [X(q.e), q.z]), { stroke: 'var(--c-pos)', width: 2.6 });
      legend.push({ label: useLat && c.lat.arching ? `Stützlinie Th. 2. O. (Bogen, eu = ${fmt(c.lat.eU * 1000, 0)} mm)` : 'Stützlinie Th. 2. O. (inkl. e0)', color: 'var(--c-pos)' });
    } else {
      v.text(0, hh / 2, 'Kein Gleichgewicht unter Bemessungslasten', { size: 12, bold: true, color: 'var(--fail)' });
    }
    // massgebender Schnitt mit erforderlichem Spannungsblock
    let zc = null;
    if (useLat && (!c.buck || c.lat.eta >= c.buck.eta)) zc = c.lat.z;
    else if (c.buck) zc = c.buck.z;
    else if (c.en) zc = hh / 2;
    if (zc !== null && prof.ok) {
      const q = prof.pts.reduce((a, b) => (Math.abs(b.z - zc) < Math.abs(a.z - zc) ? b : a));
      v.line(-tw - 0.08, q.z, tw + 0.08, q.z, { stroke: 'var(--c-neg)', width: 1.2, dash: '5 3' });
      const cw = q.n / R.fxd; // erforderliche Breite des Spannungsblocks
      const xa = Math.max(-t / 2, q.e - cw / 2), xb = Math.min(t / 2, q.e + cw / 2);
      const bh = Math.min(0.12 * hh, 0.3);
      v.rect(X(xa), q.z - bh, X(xb - xa), bh, { fill: 'var(--c-neg-fill)', stroke: 'var(--c-neg)', width: 1.2 });
      v.dot(X(q.e), q.z, 3.5, { fill: 'var(--c-pos)' });
      v.text(tw + 0.08, q.z, `z = ${fmt(q.z, 2)} m`, { anchor: 'start', dx: 4, dy: -7, size: 10.5, color: 'var(--c-neg)' });
      legend.push({ label: `Spannungsblock fxd: ${fmt(cw * 1000, 0)} mm ≤ t − 2e = ${fmt((t - 2 * Math.abs(q.e)) * 1000, 0)} mm`, fill: 'var(--c-neg-fill)', color: 'var(--c-neg)' });
      legend.push({ label: `massgebend: z = ${fmt(q.z, 2)} m, e = ${fmt(q.e * 1000, 1)} mm`, color: 'var(--c-neg)', dash: '5 3', width: 1.2 });
    }
    // Normalkraft oben und unten
    if (showLoads) {
      v.arrow(X(c.eTop), hh, 0, -1, { length: 40, head: 9, width: 2.2 });
      v.text(X(c.eTop), hh + v.px(40), `nd,o = ${fmt(c.nTop, 1)} kN/m`, { anchor: 'start', dx: 8, dy: 4, size: 11, bold: true, color: 'var(--c-load)' });
      v.arrow(X(c.eBot), 0, 0, 1, { length: 40, head: 9, width: 2.2, color: 'var(--c-support)' });
      v.text(X(c.eBot), -v.px(40), `nd,u = ${fmt(c.nBot, 1)} kN/m`, { anchor: 'start', dx: 8, dy: -2, size: 11, bold: true, color: 'var(--c-support)' });
    }
    if (showDims && Math.abs(c.eTop) > 1e-5) v.text(X(c.eTop), hh, `eo = ${fmt(c.eTop * 1000, 1)} mm`, { anchor: c.eTop > 0 ? 'start' : 'end', dx: c.eTop > 0 ? 8 : -8, dy: 10, size: 10, color: 'var(--c-load)' });
    if (showDims && Math.abs(c.eBot) > 1e-5) v.text(X(c.eBot), 0, `eu = ${fmt(c.eBot * 1000, 1)} mm`, { anchor: c.eBot > 0 ? 'start' : 'end', dx: c.eBot > 0 ? 8 : -8, dy: -10, size: 10, color: 'var(--c-support)' });
  }
  if (showDims) {
    const xd = outer ? tw + ext : tw + ext * 0.8;
    v.dimension(xd, hh, xd, 0, `h = ${fmt(hh, 2)} m`, 22);
  }
  viewLegend(v, legend, c ? `${c.name} · ${legendCheck}` : null);
  v.caption(`Schnitt · t = ${fmt(W.t, 0)} mm · quer ×${k} überhöht${c ? '' : ' · Stützlinie nach erfolgreicher Berechnung'}`);
}

// ======================================================================== Schub

export function drawSchub(v, app) {
  const p = app.project, W = p.wall, L = p.loads, R = app.results;
  const l = W.l, hh = W.h;
  const ty = typeById(p.material.type);
  const margin = 0.2 * Math.max(l, hh);
  // links Platz für Kraftpfeil und Beschriftung der Horizontalkraft
  bounds(v, -margin * 2.2, -0.45 * hh, l + margin * 0.8, hh + SLAB + margin);
  const showLoads = app.viewOpts.loads !== false, showDims = app.viewOpts.dims !== false;
  // massgebende Kombination mit Schub
  let c = pickCombo(app, 'schub');
  if (c && !c.shear && R) c = R.combos.find((x) => x.shear) || c;
  const s = c?.shear;
  const legend = [];

  drawSlab(v, -0.15, l + 0.15, hh);
  v.rect(0, 0, l, hh, { fill: 'var(--c-highlight)', fillOpacity: 0.1, stroke: 'none' });
  masonryPattern(v, 0, l, 0, hh, ty.course, ty.unit);
  v.rect(0, 0, l, hh, { fill: 'none', stroke: 'var(--c-struct)', width: 1.8 });
  // Einspannung am Wandfuss
  v.line(-0.2, 0, l + 0.2, 0, { stroke: 'var(--c-support)', width: 2.2 });
  for (let x = -0.15; x < l + 0.2; x += 0.16) v.line(x, 0, x - 0.08, -0.08, { stroke: 'var(--c-support)', width: 0.9 });

  if (!s) {
    v.text(l / 2, hh / 2, R ? 'Keine Horizontalkraft in Wandebene' : 'Ergebnisse folgen nach der Berechnung', { size: 13, bold: true, color: 'var(--text-2)' });
    v.text(l / 2, hh / 2, 'Im Register «Lasten» V (Wind bzw. Erdbeben) eingeben', { dy: 18, size: 11, color: 'var(--text-3)' });
    if (showDims) { v.dimension(0, -0.1, l, -0.1, `l = ${fmt(l, 2)} m`, -24); v.dimension(0, 0, 0, hh, `h = ${fmt(hh, 2)} m`, 28); }
    v.caption('Schub in Wandebene');
    return;
  }
  const { N, V, h0, hV } = s;
  const shift = hV * V / N; // Versatz der Resultierenden über die Höhe hV
  const lc = s.lc;
  const yTop = Math.min(hV, hh);
  // Druckfeld (Band zwischen Druckzone Fuss und versetzter Zone oben)
  if (lc > 0) {
    const b0 = l - lc, b1 = l;
    const sh = shift * yTop / hV;
    const t0 = b0 - sh, t1 = b1 - sh;
    const clip = (x) => Math.max(0, Math.min(l, x));
    const xR = Math.min(l, l / 2 + s.e); // Resultierende am Wandfuss
    if (s.method === 'SIA') {
      v.polygon([[b0, 0], [b1, 0], [clip(t1), yTop], [clip(t0), yTop]], { fill: 'var(--c-pos-fill)', stroke: 'var(--c-pos)', width: 1.4 });
      for (let i = 1; i < 4; i++) {
        const f = i / 4;
        v.line(b0 + lc * f, 0, clip(t0 + lc * f), yTop, { stroke: 'var(--c-pos)', width: 0.8, dash: '6 4' });
      }
      legend.push({ label: 'Druckfeld (Spannungsfeld)', fill: 'var(--c-pos-fill)', color: 'var(--c-pos)' });
    } else {
      v.line(clip(xR - sh), yTop, xR, 0, { stroke: 'var(--c-pos)', width: 3 });
      legend.push({ label: 'Wirkungslinie der Resultierenden', color: 'var(--c-pos)', width: 3 });
    }
    // Spannungen am Wandfuss
    const sc = 0.25 * hh;
    let depth = 0;
    if (s.method === 'SIA') {
      const r = Math.min(1, s.sx / R.fxd);
      depth = sc * r + 0.1;
      v.rect(b0, -sc * r - 0.1, lc, sc * r, { fill: 'var(--c-neg-fill)', stroke: 'var(--c-neg)', width: 1.2 });
      v.text(b0 + lc / 2, -sc * r - 0.1, `σx = ${fmt(s.sx / 1000, 2)} MPa · τ = ${fmt(s.tau / 1000, 2)} MPa`, { dy: 12, size: 10.5, color: 'var(--c-neg)' });
      legend.push({ label: 'Druckspannung am Wandfuss', fill: 'var(--c-neg-fill)', color: 'var(--c-neg)' });
      v.text((b0 + t0) / 2 + lc / 2, yTop / 2, `α = ${fmt(s.alpha * 180 / Math.PI, 1)}°`, { size: 11, bold: true, color: 'var(--c-pos)' });
    } else {
      // lineare Spannungsverteilung
      const e = s.e;
      const smax = e <= l / 6 ? N / (W.t / 1000 * l) * (1 + 6 * e / l) : 2 * N / (W.t / 1000 * lc);
      const smin = e <= l / 6 ? N / (W.t / 1000 * l) * (1 - 6 * e / l) : 0;
      const sm = Math.max(smax, 1e-9);
      depth = sc * Math.min(1, sm / R.fxd) + 0.1;
      v.polygon([[b0, -0.1], [b1, -0.1], [b1, -0.1 - sc * Math.min(1, smax / R.fxd)], [b0, -0.1 - sc * Math.min(1, smin / R.fxd)]], { fill: 'var(--c-neg-fill)', stroke: 'var(--c-neg)', width: 1.2 });
      v.text(b1, -0.1 - sc * Math.min(1, sm / R.fxd), `σmax = ${fmt(smax / 1000, 2)} MPa`, { anchor: 'end', dy: 12, size: 10.5, color: 'var(--c-neg)' });
      legend.push({ label: 'Normalspannung (linear, gerissen)', fill: 'var(--c-neg-fill)', color: 'var(--c-neg)' });
    }
    if (showDims) v.dimension(b0, -0.1, b1, -0.1, `lc = ${fmt(lc, 2)} m`, -((depth - 0.1) * v.scale + 38));
  } else {
    v.text(l / 2, hh / 2, 'Keine Druckzone – Wand kippt (V·h0 ≥ N·l/2)', { size: 12, bold: true, color: 'var(--fail)' });
  }
  if (showLoads) {
    distributedArrows(v, 0, l, hh + SLAB, `Nd = ${fmt(N, 0)} kN (inkl. Eigengewicht)`);
    v.arrow(0, yTop, 1, 0, { length: 64, head: 10, width: 2.4, label: `Vd = ${fmt(V, 1)} kN`, offset: 4 });
    if (lc > 0) v.dot(Math.min(l, l / 2 + s.e), 0, 4.5, { fill: 'var(--c-pos)', title: 'Resultierende am Wandfuss' });
  }
  if (showDims) v.dimension(0, 0, 0, hh, `h = ${fmt(hh, 2)} m`, 34);
  viewLegend(v, legend, `Kombination: ${c.name}`);
  v.caption(`Schub · ${s.method === 'SIA' ? 'Spannungsfeld SIA 266' : 'EN 1996-1-1, 6.2'} · h0 = ${fmt(h0, 2)} m${L.topFixed ? ' (Kopf eingespannt)' : ' (Kragscheibe)'}`);
}

// Grafik: System, Schnittgrössen, Verformung, Querschnitt (zeichnet in SvgView, Farben nur über CSS-Variablen)
import { fmt } from '../../js/core/format.js';
import { sectionProps, plasticNeutralAxis } from './profiles.js';
import { beamModel, normLoad } from './beam.js';
import { latRestraintPositions } from './calc.js';

const CAT_COLOR = { G: 'var(--c-series-1)', Nutzlast: 'var(--c-load)', Schnee: 'var(--c-series-6)', Wind: 'var(--c-series-5)' };
const QTY = {
  My: { label: 'My', unit: 'kNm', color: 'var(--c-pos)', down: true },
  Vz: { label: 'Vz', unit: 'kN', color: 'var(--c-series-3)' },
  N: { label: 'N (Druck +)', unit: 'kN', color: 'var(--c-series-4)' },
  Mz: { label: 'Mz', unit: 'kNm', color: 'var(--c-series-6)', down: true },
  Vy: { label: 'Vy', unit: 'kN', color: 'var(--c-series-5)' },
};

/** Gewählte Kombination für die Darstellung. */
export function pickCombo(app, kind = 'ULS') {
  const r = app.results;
  if (!r) return null;
  const key = app.viewOpts.combo;
  const all = r.member.combos;
  if (kind === 'SLS') {
    const sl = all.filter((c) => c.type.startsWith('SLS'));
    const c = sl.find((x) => x.id === key);
    if (c) return c;
    const w = r.checks.filter((x) => x.sls).sort((a, b) => b.eta - a.eta)[0];
    return w?.sls.combo || sl[0] || null;
  }
  if (key === 'env') return 'env';
  const c = all.find((x) => x.id === key && x.type === 'ULS');
  return c || r.govUls.combo;
}

function tick(v, g, x, y, size = 6, color = 'var(--c-load)', up = false) {
  v.symbol(x, y, (gg, svgEl) => gg.append(svgEl('polygon', { points: up ? `0,0 ${-size / 2},${size} ${size / 2},${size}` : `0,0 ${-size / 2},${-size} ${size / 2},${-size}`, style: { fill: color } })));
}

function restraintMark(v, x, y, label) {
  v.symbol(x, y, (g, svgEl) => {
    g.append(svgEl('circle', { cx: 0, cy: 0, r: 5.5, style: { fill: 'var(--surface)', stroke: 'var(--c-highlight)', strokeWidth: 1.6 } }));
    g.append(svgEl('path', { d: 'M-3.6,-3.6L3.6,3.6M-3.6,3.6L3.6,-3.6', style: { stroke: 'var(--c-highlight)', strokeWidth: 1.4 } }));
    if (label) g.append(svgEl('title', { text: label }));
  });
}

// ------------------------------------------------------------------ System

export const LOAD_COLOR = CAT_COLOR;
const SELF_KN_M3 = 78.5;

/**
 * Lage aller Elemente der Systemansicht in Weltkoordinaten (m) – gemeinsam für Zeichnung und Editor.
 * Träger auf y = 0 von 0 bis L; Linienlasten in Spuren darüber, Einzellasten als Pfeile bis yP,
 * Normalkraft rechts vom Trägerende, seitliche Halterungen unter dem Träger (yR).
 */
export function systemLayout(p, sec) {
  const b = p.beam || {};
  const m = beamModel(b);
  const L = m.L;
  if (!(L > 0)) throw new Error('Bitte eine Spannweite bzw. Trägerlänge grösser als 0 eingeben.');
  const u = Math.max(L, 2) / 10;
  const all = (b.loads || []).map((l, idx) => ({ ...normLoad(l, L), idx }));
  const qs = all.filter((l) => l.type === 'q');
  if (b.selfWeight && sec) { const gk = sec.A * 1e-6 * SELF_KN_M3; qs.unshift({ lc: 'EG', type: 'q', dir: 'z', v1: gk, v2: gk, x1: 0, x2: L, self: true, idx: -1 }); }
  const laneH = 0.55 * u, gap = 0.32 * u;
  let y = 0.18 * u;
  const lanes = [];
  for (const ld of qs) {
    const mx = Math.max(Math.abs(ld.v1), Math.abs(ld.v2)) || 1;
    const hMin = 0.12 * laneH;
    const h1 = Math.max(hMin, laneH * Math.abs(ld.v1) / mx), h2 = Math.max(hMin, laneH * Math.abs(ld.v2) / mx);
    const a = Math.min(ld.x1, ld.x2), bb = Math.max(ld.x1, ld.x2);
    lanes.push({ ld, a, b: bb, yb: y, h1, h2, ring: [[a, y], [a, y + h1], [bb, y + h2], [bb, y]] });
    y += laneH + gap;
  }
  const yP = Math.max(y, 0.2 * u) + 0.7 * u;
  const points = [];
  for (const ld of all.filter((l) => l.type === 'P')) {
    const k = points.filter((q) => Math.abs(q.x - ld.x1) < 0.08 * u).length;
    points.push({ ld, x: ld.x1, y0: 0.04 * u, y1: yP + k * 0.45 * u });
  }
  const axial = all.filter((l) => l.type === 'N');
  const Nsum = axial.reduce((t, l) => t + l.v1, 0);
  const nArrow = axial.length ? { x0: L + 0.12 * u, x1: L + 1.3 * u, y: 0, sum: Nsum, ring: [[L + 0.08 * u, -0.16 * u], [L + 1.34 * u, -0.16 * u], [L + 1.34 * u, 0.16 * u], [L + 0.08 * u, 0.16 * u]] } : null;
  const yTop = Math.max(y, ...points.map((q) => q.y1), 1.2 * u);
  return { L, u, model: m, lanes, points, axial, nArrow, yTop, yR: -0.42 * u };
}

export function drawSystem(v, app) {
  const p = app.project;
  if (p.mode === 'forces') return drawForcesSystem(v, app);
  let sec = null;
  try { sec = sectionProps(p.section); } catch { /* Eingabe unvollständig */ }
  let lay;
  try { lay = systemLayout(p, sec); } catch (e) { app.showViewMessage?.(e.message); return; }
  const { L, u, model: geo } = lay;
  const labels = app.viewOpts.labels !== false;
  const lcOf = (id) => (id === 'EG' ? { name: 'Eigengewicht', cat: 'G' } : (p.beam.loadCases || []).find((l) => l.id === id) || { name: id, cat: 'G' });
  // Linienlasten
  for (const ln of lay.lanes) {
    const { ld, a, b, yb, h1, h2 } = ln;
    const lc = lcOf(ld.lc);
    const col = CAT_COLOR[lc.cat] || 'var(--c-load)';
    v.polygon(ln.ring, { fill: col, fillOpacity: 0.16, stroke: col, width: 1.2, dash: ld.self ? '4 3' : undefined });
    const n = Math.max(2, Math.round((b - a) / (0.45 * u)));
    for (let i = 0; i <= n; i++) {
      const xx = a + (b - a) * i / n, hh = h1 + (h2 - h1) * i / n;
      v.line(xx, yb + hh, xx, yb + 0.02 * u, { stroke: col, width: 1 });
      tick(v, null, xx, yb, 6, col, ld.v1 + ld.v2 < 0);
    }
    if (labels) {
      const val = Math.abs(ld.v1 - ld.v2) < 1e-9 ? `${fmt(ld.v1, 2)} kN/m` : `${fmt(ld.v1, 2)} … ${fmt(ld.v2, 2)} kN/m`;
      v.text(b, yb + Math.max(h1, h2) / 2, `${ld.dir === 'y' ? 'horizontal (y): ' : ''}${val} · ${lc.name}`, { anchor: 'start', dx: 8, color: col, size: 11 });
    }
  }
  // Einzellasten (Schaft in Weltkoordinaten, damit der Griff zum Ziehen oben am Pfeil liegt)
  for (const pt of lay.points) {
    const lc = lcOf(pt.ld.lc);
    const col = CAT_COLOR[lc.cat] || 'var(--c-load)';
    const down = pt.ld.v1 >= 0;
    v.line(pt.x, pt.y0, pt.x, pt.y1, { stroke: col, width: 2 });
    if (down) v.arrow(pt.x, pt.y0, 0, -1, { color: col, length: 10, head: 10, width: 2 });
    else v.arrow(pt.x, pt.y1, 0, 1, { color: col, length: 10, head: 10, width: 2 });
    v.dot(pt.x, pt.y1, 3, { fill: col });
    if (labels) v.text(pt.x, pt.y1, `${fmt(Math.abs(pt.ld.v1), 1)} kN${pt.ld.dir === 'y' ? ' (y)' : ''} · ${lc.name}`, { dy: -10, color: col, size: 11 });
  }
  // Normalkraft
  if (lay.nArrow && Math.abs(lay.nArrow.sum) > 1e-9) {
    const na = lay.nArrow, comp = na.sum > 0, col = 'var(--c-series-4)';
    v.line(na.x0, 0, na.x1, 0, { stroke: col, width: 2 });
    if (comp) v.arrow(na.x0, 0, -1, 0, { color: col, length: 10, head: 10, width: 2 });
    else v.arrow(na.x1, 0, 1, 0, { color: col, length: 10, head: 10, width: 2 });
    if (labels) v.text(na.x1, 0, `N = ${fmt(Math.abs(na.sum), 1)} kN ${comp ? '(Druck)' : '(Zug)'}`, { anchor: 'start', dx: 8, color: col, size: 11 });
  }
  // Träger
  v.line(0, 0, L, 0, { stroke: 'var(--c-steel)', width: 4.5 });
  v.dot(L, 0, 3.2, { fill: 'var(--c-steel)', title: 'Trägerende – ziehen ändert die Länge' });
  let firstPin = true;
  for (const s of geo.supports) {
    if (s.type === 'fix') v.support(s.x, 0, 'fixed', s.x < 1e-9 ? 0 : s.x > L - 1e-9 ? 180 : 90);
    else { v.support(s.x, 0, firstPin ? 'pinned' : 'roller', 90); firstPin = false; }
  }
  // Seitliche Halterungen
  const restr = latRestraintPositions(p, L, geo.supports, geo.freeEnds);
  // Auflager sind immer Gabellager – Zeichen nur für zusätzliche Halterungen
  const extra = restr.filter((x) => !geo.supports.some((s) => Math.abs(s.x - x) < 1e-6));
  if (!p.stab?.contRestraint) for (const x of extra) restraintMark(v, x, lay.yR, 'seitliche Halterung (Gabellager)');
  else v.line(0, 0.06 * u, L, 0.06 * u, { stroke: 'var(--c-highlight)', width: 2, dash: '2 4' });
  // Bemassung Felder
  for (const f of geo.fields) v.dimension(f.x0, 0, f.x1, 0, `${fmt(f.L, 2)} m${f.cant ? ' (Kragarm)' : ''}`, -54);
  // Kippsegmente
  if (labels && !p.stab?.contRestraint && restr.length) {
    const segs = [];
    const ptsR = [...restr];
    if (ptsR[0] > 1e-9) segs.push([0, ptsR[0]]);
    for (let i = 0; i < ptsR.length - 1; i++) segs.push([ptsR[i], ptsR[i + 1]]);
    if (ptsR[ptsR.length - 1] < L - 1e-9) segs.push([ptsR[ptsR.length - 1], L]);
    if (segs.length > 1 || geo.fields.length > 1) for (const [a, b] of segs) v.dimension(a, 0, b, 0, `Kipplänge ${fmt(b - a, 2)} m`, -92, { color: 'var(--c-highlight)' });
  }
  const noLoads = !(p.beam.loads || []).length;
  if (labels && noLoads) v.text(L / 2, lay.yTop, 'Werkzeug «Streckenlast» (Q) wählen und auf den Träger klicken', { color: 'var(--text-3)', size: 12 });
  if (labels) {
    const cats = [...new Set(lay.lanes.map((l) => lcOf(l.ld.lc).cat).concat(lay.points.map((q) => lcOf(q.ld.lc).cat)))];
    const names = { G: 'ständige Lasten', Nutzlast: 'Nutzlast', Schnee: 'Schnee', Wind: 'Wind' };
    const items = cats.map((c) => ({ label: names[c] || c, color: CAT_COLOR[c] || 'var(--c-load)', type: 'fill' }));
    if (!p.stab?.contRestraint && extra.length) items.push({ label: 'seitliche Halterung (Gabellager)', color: 'var(--c-highlight)', type: 'dot' });
    else if (p.stab?.contRestraint) items.push({ label: 'Druckgurt durchgehend gehalten', color: 'var(--c-highlight)', dash: '2 4' });
    if (items.length) v.keyLegend(items);
    if (sec) v.caption(`${sec.name} · ${p.steel}`);
  }
  v.setBounds(-0.06 * L - 0.4 * u, -1.9 * u, L * 1.06 + (labels ? 2.6 * u : 0) + (lay.nArrow ? 1.6 * u : 0), lay.yTop + 0.5 * u);
  v.scaleBar();
}

function drawForcesSystem(v, app) {
  const p = app.project, F = p.forces || {};
  const L = Number(F.L) > 0 ? Number(F.L) : 1;
  const vert = F.orient === 'v';
  const P = (s, n) => (vert ? [-n, s] : [s, n]);
  const u = L / 10;
  const labels = app.viewOpts.labels !== false;
  const cases = F.cases || [];
  const res = app.results;
  let ci = 0;
  if (res) { const c = pickCombo(app); if (c && c !== 'env') ci = Math.max(0, res.member.combos.indexOf(c)); }
  const c = cases[ci];
  // Stab
  v.line(...P(0, 0), ...P(L, 0), { stroke: 'var(--c-steel)', width: 4.5 });
  v.support(...P(0, 0), 'pinned', vert ? 90 : 90);
  v.support(...P(L, 0), 'roller', vert ? 270 : 90);
  v.dot(...P(L, 0), 3.2, { fill: 'var(--c-steel)', title: 'Stabende – ziehen ändert die Länge' });
  // Momentenverlauf schematisch
  if (c && res) {
    const cb = res.member.combos[ci];
    const n = 40;
    const draw = (fn, sign, col, name, maxAbs) => {
      if (!(maxAbs > 1e-9)) return;
      const sc = 1.6 * u / maxAbs;
      const pts = [P(0, 0)];
      for (let i = 0; i <= n; i++) { const s = L * i / n; pts.push(P(s, sign * fn(s) * sc)); }
      pts.push(P(L, 0));
      v.polygon(pts, { fill: col, fillOpacity: 0.18, stroke: col, width: 1.4 });
      if (labels) {
        let sm = 0, vm = 0;
        for (let i = 0; i <= n; i++) { const s = L * i / n, val = fn(s); if (Math.abs(val) > Math.abs(vm)) { vm = val; sm = s; } }
        v.text(...P(sm, sign * vm * sc), `${name} = ${fmt(vm, 1)} kNm`, { color: col, dy: vert ? 0 : (sign * vm > 0 ? -10 : 12), dx: vert ? (sign * vm > 0 ? -8 : 8) : 0, anchor: vert ? (sign * vm > 0 ? 'end' : 'start') : 'middle', size: 11 });
      }
    };
    const maxY = Math.max(...Array.from({ length: n + 1 }, (_, i) => Math.abs(cb.My(L * i / n))));
    const maxZ = Math.max(...Array.from({ length: n + 1 }, (_, i) => Math.abs(cb.Mz(L * i / n))));
    draw((s) => cb.My(s), -1, 'var(--c-pos)', 'My', maxY);
    draw((s) => cb.Mz(s), 1, 'var(--c-series-6)', 'Mz', maxZ);
    if (Math.abs(c.N) > 1e-9) {
      const [x, y] = P(L, 0);
      v.arrow(x, y, ...(vert ? [0, c.N > 0 ? -1 : 1] : [c.N > 0 ? -1 : 1, 0]), { color: 'var(--c-series-4)', length: 48, tail: c.N < 0, label: labels ? `N = ${fmt(Math.abs(c.N), 1)} kN ${c.N > 0 ? '(Druck)' : '(Zug)'}` : '' });
    }
    if (labels) v.caption(`${c.name || `Situation ${ci + 1}`}: N = ${fmt(c.N || 0, 1)} kN · My = ${fmt(c.My || 0, 1)} kNm · Mz = ${fmt(c.Mz || 0, 1)} kNm · Vz = ${fmt(c.Vz || 0, 1)} kN`);
  }
  const restr = latRestraintPositions(p, L, [{ x: 0 }, { x: L }], []);
  if (!p.stab?.contRestraint) for (const x of restr) if (x > 1e-6 && x < L - 1e-6) restraintMark(v, ...P(x, 0), 'seitliche Halterung (Gabellager)');
  if (vert) v.dimension(...P(0, 0), ...P(L, 0), `L = ${fmt(L, 2)} m`, 70);
  else v.dimension(...P(0, 0), ...P(L, 0), `L = ${fmt(L, 2)} m`, -54);
  const b = [P(0, -2.6 * u), P(L, 2.6 * u), P(0, 2.6 * u), P(L, -2.6 * u)];
  v.setBounds(Math.min(...b.map((q) => q[0])) - (vert ? 0 : 0.05 * L), Math.min(...b.map((q) => q[1])) - (vert ? 0.05 * L : 0), Math.max(...b.map((q) => q[0])) + (vert ? 0 : 0.05 * L), Math.max(...b.map((q) => q[1])) + (vert ? 0.16 * L : 0));
  v.scaleBar();
}

// ------------------------------------------------------------------ Schnittgrössen

export function drawForces(v, app) {
  const r = app.results;
  if (!r) return;
  const m = r.member, L = m.L, u = L / 10;
  const labels = app.viewOpts.labels !== false;
  const pick = pickCombo(app);
  const ulsC = m.combos.filter((c) => c.type === 'ULS');
  let data, env = null;
  if (pick === 'env') {
    const all = ulsC.map((c) => c.sample());
    data = all[0];
    env = {};
    for (const k of Object.keys(QTY)) {
      env[k] = {
        max: data.x.map((_, i) => Math.max(...all.map((a) => a[k][i]))),
        min: data.x.map((_, i) => Math.min(...all.map((a) => a[k][i]))),
      };
    }
  } else data = pick.sample();
  const rows = Object.keys(QTY).filter((k) => (env ? Math.max(...env[k].max.map(Math.abs), ...env[k].min.map(Math.abs)) : Math.max(...data[k].map(Math.abs))) > 1e-6);
  if (!rows.length) { app.showViewMessage?.('Keine Schnittgrössen – bitte Lasten eingeben.'); return; }
  const H = 1.5 * u, gapRow = 4.2 * u;
  rows.forEach((k, ri) => {
    const q = QTY[k];
    const base = -ri * gapRow;
    const series = env ? [env[k].max, env[k].min] : [data[k]];
    const maxAbs = Math.max(...series.flat().map(Math.abs)) || 1;
    const sc = H / maxAbs;
    const dir = q.down ? -1 : 1;
    v.line(0, base, L, base, { stroke: 'var(--c-struct)', width: 1.4 });
    for (const vals of series) {
      const pts = [[data.x[0], base], ...data.x.map((x, i) => [x, base + dir * vals[i] * sc]), [data.x[data.x.length - 1], base]];
      v.polygon(pts, { fill: q.color, fillOpacity: env ? 0.12 : 0.2, stroke: q.color, width: 1.6 });
    }
    // Extremwerte
    const marks = [];
    for (const vals of series) {
      let iMax = 0, iMin = 0;
      vals.forEach((val, i) => { if (val > vals[iMax]) iMax = i; if (val < vals[iMin]) iMin = i; });
      if (vals[iMax] > 1e-6) marks.push([iMax, vals[iMax]]);
      if (vals[iMin] < -1e-6) marks.push([iMin, vals[iMin]]);
    }
    const seen = [];
    for (const [i, val] of marks) {
      const x = data.x[i];
      if (seen.some((s) => Math.abs(s[0] - x) < 0.04 * L && Math.abs(s[1] - val) < 1e-6 * maxAbs + 1e-9)) continue;
      seen.push([x, val]);
      const yy = base + dir * val * sc;
      v.dot(x, yy, 3, { fill: q.color });
      if (labels) v.text(x, yy, `${fmt(val, 1)}`, { dy: dir * val > 0 ? -11 : 12, color: 'var(--text)', size: 11, bold: true });
    }
    v.text(-0.03 * L, base, `${q.label} [${q.unit}]`, { anchor: 'end', color: q.color, size: 12, bold: true });
  });
  // Auflager auf der obersten Linie
  for (const s of m.supports) v.support(s.x, 0, s.type === 'fix' ? 'fixed' : 'pinned', s.type === 'fix' ? (s.x < L / 2 ? 0 : 180) : 90, { color: 'var(--text-3)' });
  if (labels) v.caption(pick === 'env' ? 'Umhüllende aller Kombinationen der Tragsicherheit' : pick.name);
  v.setBounds(-0.2 * L, -(rows.length - 1) * gapRow - H - 0.6 * u, 1.05 * L, H + 0.8 * u);
}

// ------------------------------------------------------------------ Verformung

export function drawDeflection(v, app) {
  const r = app.results;
  if (!r || r.member.mode !== 'beam') return;
  const m = r.member, L = m.L, u = L / 10;
  const c = pickCombo(app, 'SLS');
  if (!c) return;
  const X = m.an.X, w = c.wz;
  const wmax = Math.max(...w.map(Math.abs)) || 1;
  const sc = 1.6 * u / wmax;
  v.line(0, 0, L, 0, { stroke: 'var(--text-3)', width: 1.2, dash: '5 4' });
  const pts = X.map((x, i) => [x, -w[i] * sc]);
  v.polygon([[0, 0], ...pts, [L, 0]], { fill: 'var(--c-deform)', fillOpacity: 0.12, stroke: 'none' });
  v.polyline(pts, { stroke: 'var(--c-deform)', width: 3 });
  for (const s of m.supports) v.support(s.x, 0, s.type === 'fix' ? 'fixed' : 'pinned', s.type === 'fix' ? (s.x < L / 2 ? 0 : 180) : 90);
  const labels = app.viewOpts.labels !== false;
  const lim = c.type === 'SLS-char' ? Number(app.project.sls?.limitChar) || 300 : Number(app.project.sls?.limitQp) || 250;
  for (const f of m.fields) {
    let iM = -1;
    X.forEach((x, i) => { if (x >= f.x0 - 1e-9 && x <= f.x1 + 1e-9 && (iM < 0 || Math.abs(w[i]) > Math.abs(w[iM]))) iM = i; });
    if (iM < 0 || Math.abs(w[iM]) < 1e-9) continue;
    const Lr = f.cant ? 2 * f.L : f.L;
    const wl = Lr * 1000 / lim;
    const ok = Math.abs(w[iM]) <= wl;
    v.line(f.x0, -Math.sign(w[iM]) * wl * sc, f.x1, -Math.sign(w[iM]) * wl * sc, { stroke: ok ? 'var(--ok)' : 'var(--fail)', width: 1.2, dash: '6 4' });
    v.dot(X[iM], -w[iM] * sc, 3.5, { fill: 'var(--c-deform)' });
    if (labels) {
      v.text(X[iM], -w[iM] * sc, `w = ${fmt(Math.abs(w[iM]), 1)} mm = ${f.cant ? '2·L' : 'L'}/${fmt(Lr * 1000 / Math.abs(w[iM]), 0)}`, { dy: w[iM] > 0 ? 16 : -14, bold: true, size: 11.5 });
      v.text(f.x1, -Math.sign(w[iM]) * wl * sc, `Grenze ${f.cant ? '2·L' : 'L'}/${lim} = ${fmt(wl, 1)} mm`, { anchor: 'end', dy: w[iM] > 0 ? 12 : -10, color: ok ? 'var(--ok)' : 'var(--fail)', size: 10.5 });
    }
  }
  if (labels) {
    v.keyLegend([{ label: 'Biegelinie', color: 'var(--c-deform)' }, { label: `Grenzwert L/${lim}`, color: 'var(--ok)', dash: '6 4', width: 1.4 }]);
    v.caption(`${c.name} · überhöhte Darstellung`);
  }
  v.setBounds(-0.05 * L, -2.6 * u, 1.05 * L, 1.0 * u);
}

// ------------------------------------------------------------------ Querschnitt

export function drawSection(v, app) {
  let s;
  try { s = sectionProps(app.project.section); } catch (e) { app.showViewMessage?.(e.message); return; }
  const k = 1 / 1000; // mm → m
  const labels = app.viewOpts.labels !== false;
  const P = (q) => [q[0] * k, q[1] * k];
  v.rings(s.rings.map((r) => r.map(P)), { fill: 'var(--c-steel)', fillOpacity: s.dashed ? 0.12 : 0.32, stroke: 'var(--c-steel)', width: 1.6, dash: s.dashed ? '6 4' : undefined });
  for (const w of s.welds || []) v.polygon(w.map(P), { fill: 'var(--c-highlight)', fillOpacity: 0.5, stroke: 'var(--c-highlight)', width: 1 });
  const H = s.zMax * k, B = (s.yMax || s.b / 2) * k;
  const yL = (s.yMinEdge ?? -s.b / 2) * k, yR = (s.yMaxEdge ?? s.b / 2) * k;
  const ext = 0.18 * Math.max(H * 2, yR - yL);
  // Achsen
  v.line(yL - ext, 0, yR + ext, 0, { stroke: 'var(--text-3)', width: 1, dash: '10 3 2 3' });
  v.line(0, -H - ext, 0, H + ext, { stroke: 'var(--text-3)', width: 1, dash: '10 3 2 3' });
  v.text(yR + ext, 0, 'y', { anchor: 'start', dx: 5, color: 'var(--text-2)', bold: true });
  v.text(0, -H - ext, 'z', { dy: 10, color: 'var(--text-2)', bold: true });
  v.dot(0, 0, 3.2, { fill: 'var(--c-struct)', title: 'Schwerpunkt S' });
  if (s.type === 'U' && labels) {
    v.dot(s.y0 * k, 0, 3.2, { fill: 'var(--c-highlight)', title: 'Schubmittelpunkt M' });
    v.text(s.y0 * k, 0, 'M', { dy: -10, color: 'var(--c-highlight)', size: 11 });
    v.text(0, 0, 'S', { dx: 8, dy: -9, size: 11 });
  }
  // Bemassung
  if (labels) {
    v.dimension(yR, -H, yR, H, `h = ${fmt(s.h, 0)}`, -34);
    v.dimension(yL, H, yR, H, `b = ${fmt(s.b, 0)}`, 28);
    if (s.type === 'I' || s.type === 'WI' || s.type === 'U') {
      const yw = s.type === 'U' ? (s.yMinEdge + s.tw / 2) * k : 0;
      v.text(yw, -H * 0.42, `tw = ${fmt(s.tw, 1)}`, { anchor: 'start', dx: s.tw * k * v.scale / 2 + 6, size: 10.5, color: 'var(--c-dim)' });
      v.text(yR, H - s.tf * k / 2, `tf = ${fmt(s.tf, 1)}`, { anchor: 'start', dx: 8, size: 10.5, color: 'var(--c-dim)' });
      if (s.r) v.text(yR, -H + s.tf * k / 2, s.type === 'U' ? `r = ${fmt(s.r, 1)}` : `r = ${fmt(s.r, 0)}`, { anchor: 'start', dx: 8, size: 10.5, color: 'var(--c-dim)' });
      if (s.type === 'WI' && s.a) v.text(yR, -H + s.tf * k / 2, `a = ${fmt(s.a, 1)}`, { anchor: 'start', dx: 8, size: 10.5, color: 'var(--c-dim)' });
    } else if (s.type === 'RHS' || s.type === 'CHS') {
      v.text(yR, 0, `t = ${fmt(s.t, 1)}`, { anchor: 'start', dx: 8, dy: -10, size: 10.5, color: 'var(--c-dim)' });
    }
  }
  // Ergebnisse: wirksame Breiten, plastische Nulllinie, Spannungen
  const r = app.results;
  const showStress = app.viewOpts.stress !== false;
  let right = yR + ext;
  if (r && !s.dashed) {
    const u = r.govUls;
    const at = u.cs.NM || {};
    if (u.cls === 4) {
      const eff = (Math.abs(at.My ?? u.MyMax) > 1e-9 || u.MyMax > 1e-9) ? u.effs.My : u.effs.N;
      for (const hh of eff?.holes || []) {
        v.rect((hh.y - hh.dy / 2) * k, (hh.z - hh.dz / 2) * k, hh.dy * k, hh.dz * k, { fill: 'var(--surface)', stroke: 'var(--fail)', width: 1.2, dash: '3 2' });
      }
      if (labels && eff?.holes?.length) v.text(yL, -H - ext * 0.6, 'gestrichelt: nicht wirksame Bereiche (Klasse 4)', { anchor: 'start', size: 10.5, color: 'var(--fail)' });
    }
    if (showStress) {
      const N = (at.N ?? u.Nc) * 1e3, My = (at.My ?? 0) * 1e6;
      const fyd = r.mat.fy / r.mat.gammaM0;
      const Wd = Math.max(H * 0.7, (yR - yL) * 0.45), x0 = yR + ext * 1.4 + Wd;
      const scS = Wd / fyd;
      v.line(x0, -H, x0, H, { stroke: 'var(--text-3)', width: 1 });
      const col = 'var(--c-pos)';
      if (u.cls <= 2 && s.rings && Math.abs(My) > 1e-6) {
        const zp = plasticNeutralAxis(s, Math.abs(N) * Math.sign(N), r.mat.fy);
        if (zp !== null) {
          // Feldmoment (My ≥ 0): Druckzone oben; Stützmoment: Druckzone unten (Querschnitte symmetrisch zur y-Achse)
          const zpp = (My >= 0 ? zp : -zp) * k;
          const comp = My >= 0 ? [zpp, H] : [-H, zpp], tens = My >= 0 ? [-H, zpp] : [zpp, H];
          v.polygon([[x0, comp[0]], [x0 + Wd, comp[0]], [x0 + Wd, comp[1]], [x0, comp[1]]], { fill: 'var(--c-neg)', fillOpacity: 0.22, stroke: 'var(--c-neg)', width: 1.2 });
          v.polygon([[x0, tens[0]], [x0 - Wd, tens[0]], [x0 - Wd, tens[1]], [x0, tens[1]]], { fill: 'var(--c-pos)', fillOpacity: 0.22, stroke: 'var(--c-pos)', width: 1.2 });
          v.line(yL - ext * 0.6, zpp, x0 + Wd, zpp, { stroke: 'var(--c-highlight)', width: 1.4, dash: '6 3' });
          if (labels) {
            v.text(yL - ext * 0.6, zpp, 'plastische Nulllinie', { anchor: 'end', dx: -4, size: 10.5, color: 'var(--c-highlight)' });
            v.text(x0, H, `Spannungsblöcke ±fy/γM0 = ${fmt(fyd, 0)} N/mm²`, { anchor: 'start', dy: -10, size: 10.5, color: 'var(--text-2)' });
            v.text(x0 + Wd, (comp[0] + comp[1]) / 2, 'Druck', { anchor: 'start', dx: 6, size: 10.5, color: 'var(--c-neg)' });
            v.text(x0 - Wd, (tens[0] + tens[1]) / 2, 'Zug', { anchor: 'end', dx: -6, size: 10.5, color: 'var(--c-pos)' });
          }
        }
      } else {
        const Aeff = u.cls === 4 && u.effs.N ? u.effs.N.A : s.A;
        const Iy = u.cls === 4 && u.effs.My ? u.effs.My.Iy : s.Iy;
        const sT = N / Aeff + My * s.zMax / Iy, sB = N / Aeff - My * s.zMax / Iy;
        v.polygon([[x0, H], [x0 + sT * scS, H], [x0 + sB * scS, -H], [x0, -H]], { fill: col, fillOpacity: 0.2, stroke: col, width: 1.4 });
        if (labels) {
          v.text(x0 + sT * scS, H, `σ = ${fmt(sT, 0)} N/mm²`, { anchor: sT >= 0 ? 'start' : 'end', dx: sT >= 0 ? 6 : -6, size: 10.5 });
          v.text(x0 + sB * scS, -H, `σ = ${fmt(sB, 0)} N/mm²`, { anchor: sB >= 0 ? 'start' : 'end', dx: sB >= 0 ? 6 : -6, size: 10.5 });
          v.text(x0, H, 'Elastische Spannungen (Druck +)', { anchor: 'start', dy: -22, size: 10.5, color: 'var(--text-2)' });
        }
      }
      right = x0 + Wd * 1.15;
    }
    if (labels) {
      const items = [{ label: s.name, color: 'var(--c-steel)', type: 'fill' }];
      if (showStress && u.cls <= 2 && Math.abs(at.My ?? 0) > 1e-9) items.push({ label: 'plastische Nulllinie', color: 'var(--c-highlight)', dash: '6 3', width: 1.6 });
      if (u.cls === 4) items.push({ label: 'nicht wirksam (Klasse 4)', color: 'var(--fail)', dash: '3 2', width: 1.4 });
      v.keyLegend(items);
      v.caption(`Klasse ${u.cls} · ${u.combo.name}`);
    }
  } else if (labels) v.caption(s.name);
  v.setBounds(yL - ext * 1.8, -H - ext * 1.2, right + ext * 0.4, H + ext * 1.2);
  v.scaleBar();
}

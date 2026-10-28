// Grafische Darstellungen des Plattenmoduls (System, Netz, Isoflächen, Bewehrung, Reaktionen)
import { svgEl } from '../../js/core/ui.js';
import { fmt, decimalsFor } from '../../js/core/format.js';
import { sequential, diverging } from '../../js/core/colormap.js';
import { contourLevels, isoBands, isoLines, sparseNodes } from './contour.js';
import { allEdges, boundaryEdges } from './mesh.js';
import { principalMoments } from './design.js';
import { geometryOf, layerLabel, comboTypeLabel } from './calc.js';
import { polygonCentroid, bboxOf, triMinAngle } from './geom.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** Pfad in Weltkoordinaten (konstante Strichstärke). */
export function worldPath(view, d, style) {
  const el = svgEl('path', { d, 'vector-effect': 'non-scaling-stroke', style });
  view.gWorld.append(el);
  return el;
}

/** Modellgrenzen (Plattenrand mit Rand für Bemassung und Beschriftung). */
export function slabBounds(project) {
  const { outline } = geometryOf(project);
  if (outline.length < 2) return null;
  const b = bboxOf(outline);
  const m = 0.08 * Math.max(b.w, b.h, 1);
  return { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m, bb: b };
}

function edgesPath(x, y, list) {
  let d = '';
  for (let k = 0; k < list.length; k += 2) {
    const a = list[k], b = list[k + 1];
    d += `M${x[a].toFixed(4)} ${y[a].toFixed(4)}L${x[b].toFixed(4)} ${y[b].toFixed(4)}`;
  }
  return d;
}

function ringPath(r) {
  return r.length ? `M${r.map((p) => `${p[0]} ${p[1]}`).join('L')}Z` : '';
}

const lcName = (p, id) => p.loadCases.find((l) => l.id === id)?.name || id || '?';

// ------------------------------------------------------------------ Ergebnisauswahl

export function defaultSet(r, prefer = 'ULS') {
  return r.sets.find((s) => s.kind === 'combo' && s.type === prefer) || r.sets.find((s) => s.kind === 'combo') || r.sets[0];
}

export function setOptions(r) {
  return r.sets.map((s) => ({ value: s.key, label: s.kind === 'lc' ? `LF: ${s.name}` : `${s.name}${s.type === 'ULS' && !/GZT|Trag/i.test(s.name) ? ' (GZT)' : ''}` }));
}

export function currentSet(app) {
  const r = app.results;
  if (!r) return null;
  return r.sets.find((s) => s.key === app.viewOpts.res) || defaultSet(r);
}

// ------------------------------------------------------------------ System

export function drawSystem(view, app) {
  const p = app.project;
  const { outline, holes } = geometryOf(p);
  const sel = app.selection || {};
  const labels = app.viewOpts.labels !== false;
  if (outline.length >= 3) {
    view.rings([outline, ...holes], { fill: 'var(--c-struct-fill)', stroke: 'var(--c-struct)', width: 2 });
  } else if (outline.length) {
    view.polyline(outline, { stroke: 'var(--c-struct)', width: 2, dash: '4 3' });
  }
  const bb = outline.length ? bboxOf(outline) : { x0: 0, y0: 0, x1: 1, y1: 1, w: 1, h: 1 };
  const L = Math.max(bb.w, bb.h, 1);

  // Lastflächen
  p.loadAreas.forEach((a, i) => {
    const pts = a.pts.map((q) => [num(q.x), num(q.y)]).filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
    if (pts.length < 3) return;
    const hl = sel.kind === 'area' && sel.i === i;
    view.polygon(pts, { fill: 'var(--c-load-fill)', stroke: hl ? 'var(--c-highlight)' : 'var(--c-load)', width: hl ? 3 : 1.2, dash: hl ? null : '6 4' });
    if (labels) {
      const c = polygonCentroid(pts);
      const loads = p.areaLoads.filter((l) => l.region === a.id).map((l) => `${fmt(num(l.q), 2)} kN/m² (${lcName(p, l.lc)})`);
      view.text(c[0], c[1], a.name || `Fläche ${i + 1}`, { color: 'var(--c-load)', bold: true, dy: loads.length ? -7 * loads.length : 0 });
      loads.forEach((t, k) => view.text(c[0], c[1], t, { color: 'var(--c-load)', size: 10, dy: 7 + 13 * k - 7 * (loads.length - 1) }));
    }
  });

  // Hervorhebung Öffnung / Randpunkt
  if (sel.kind === 'opening' && p.openings[sel.i]) {
    const pts = p.openings[sel.i].pts.map((q) => [num(q.x), num(q.y)]);
    view.polygon(pts, { fill: 'none', stroke: 'var(--c-highlight)', width: 3 });
    if (Number.isInteger(sel.j) && pts[sel.j]) view.dot(pts[sel.j][0], pts[sel.j][1], 6, { fill: 'var(--c-highlight)' });
  }
  if (sel.kind === 'outline' && p.outline[sel.i]) view.dot(num(p.outline[sel.i].x), num(p.outline[sel.i].y), 6, { fill: 'var(--c-highlight)' });
  if (sel.kind === 'area' && Number.isInteger(sel.j) && p.loadAreas[sel.i]?.pts[sel.j]) {
    const q = p.loadAreas[sel.i].pts[sel.j];
    view.dot(num(q.x), num(q.y), 6, { fill: 'var(--c-highlight)' });
  }
  if (labels) outline.forEach((q, i) => view.text(q[0], q[1], String(i + 1), { size: 9.5, color: 'var(--text-3)', dx: 8, dy: -8 }));

  // Wände
  p.lineSupports.forEach((w, i) => {
    const x1 = num(w.x1), y1 = num(w.y1), x2 = num(w.x2), y2 = num(w.y2);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
    const hl = sel.kind === 'ls' && sel.i === i;
    view.line(x1, y1, x2, y2, { stroke: hl ? 'var(--c-highlight)' : 'var(--c-support)', width: hl ? 7 : 5, opacity: 0.85 });
    const Lw = Math.hypot(x2 - x1, y2 - y1);
    if (w.clamped && Lw > 0) {
      const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      const n = Math.max(2, Math.min(60, Math.round(Lw / (L / 40))));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        view.symbol(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, (g) => {
          g.append(svgEl('line', { x1: -3, y1: 3, x2: 3, y2: 9, style: { stroke: 'var(--c-support)', strokeWidth: 1.2 } }));
        }, { rotate: ang, track: false });
      }
    }
    if (labels) {
      const nx = -(y2 - y1) / (Lw || 1), ny = (x2 - x1) / (Lw || 1);
      view.text((x1 + x2) / 2, (y1 + y2) / 2, `W${i + 1}${w.clamped ? ' eingesp.' : ''}`, { color: 'var(--c-support)', size: 10.5, dx: nx * 14, dy: -ny * 14, bold: true });
    }
  });

  // Stützen
  p.pointSupports.forEach((s, i) => {
    const x = num(s.x), y = num(s.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const b = Math.max(0, num(s.b) || 0), hc = Math.max(0, num(s.hc) || 0);
    const hl = sel.kind === 'ps' && sel.i === i;
    const col = hl ? 'var(--c-highlight)' : 'var(--c-support)';
    if (b > 0 && hc > 0) {
      view.rect(x - b / 2, y - hc / 2, b, hc, { fill: col, stroke: col, width: 1.5, fillOpacity: 0.45 });
    }
    view.symbol(x, y, (g) => {
      g.append(svgEl('circle', { cx: 0, cy: 0, r: hl ? 6 : 4.5, style: { fill: col, stroke: 'var(--surface)', strokeWidth: 1.2 } }));
      if (num(s.kz) > 0) g.append(svgEl('path', { d: 'M-7 9l3-3 3 3 3-3 3 3', style: { fill: 'none', stroke: col, strokeWidth: 1.2 } }));
      if (num(s.kr) > 0) g.append(svgEl('circle', { cx: 0, cy: 0, r: 8, style: { fill: 'none', stroke: col, strokeWidth: 1.2, strokeDasharray: '2 2' } }));
    });
    if (labels) view.text(x, y, `S${i + 1}`, { color: col, size: 10.5, bold: true, dx: 10, dy: -10, anchor: 'start' });
  });

  // Linienlasten
  p.lineLoads.forEach((l, i) => {
    const x1 = num(l.x1), y1 = num(l.y1), x2 = num(l.x2), y2 = num(l.y2);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
    const hl = sel.kind === 'll' && sel.i === i;
    const col = hl ? 'var(--c-highlight)' : 'var(--c-load)';
    view.line(x1, y1, x2, y2, { stroke: col, width: hl ? 4 : 2.5, dash: '7 4' });
    const Lw = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.min(8, Math.round(Lw / (L / 10))));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      view.arrow(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 0.6, -1, { length: 16, head: 6, color: col, width: 1.3, track: false });
    }
    if (labels) {
      const p2 = l.p2 === null || l.p2 === undefined || l.p2 === '' ? num(l.p1) : num(l.p2);
      const txt = Math.abs(p2 - num(l.p1)) > 1e-9 ? `${fmt(num(l.p1), 1)}…${fmt(p2, 1)} kN/m` : `${fmt(num(l.p1), 1)} kN/m`;
      view.text((x1 + x2) / 2, (y1 + y2) / 2, `${txt} (${lcName(p, l.lc)})`, { color: col, size: 10, dy: 14 });
    }
  });

  // Punktlasten
  p.pointLoads.forEach((l, i) => {
    const x = num(l.x), y = num(l.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const hl = sel.kind === 'pl' && sel.i === i;
    const col = hl ? 'var(--c-highlight)' : 'var(--c-load)';
    view.arrow(x, y, 0.6, -1, { length: 34, head: 8, color: col, width: 1.8, label: labels ? `${fmt(num(l.P), 1)} kN` : null });
    view.dot(x, y, 3, { fill: col });
  });

  // Flächenlasten auf der ganzen Platte
  const whole = p.areaLoads.filter((l) => !l.region || l.region === 'all');
  const sw = p.loadCases.filter((l) => l.sw);
  const parts = [];
  if (sw.length) parts.push(`${sw.map((l) => l.name).join(', ')} ${fmt(25 * p.h, 2)}`);
  for (const l of whole) parts.push(`${lcName(p, l.lc)} ${fmt(num(l.q), 2)}`);
  if (parts.length) parts[parts.length - 1] += ' kN/m²';
  if (parts.length) view.caption(`Flächenlasten auf der ganzen Platte: ${parts.join(' · ')}`);
  const keys = [];
  if (p.lineSupports.length) keys.push({ label: 'Wand (Linienlager)', color: 'var(--c-support)', type: 'line', width: 5 });
  if (p.lineSupports.some((w) => w.clamped)) keys.push({ label: 'eingespannt: Schraffur', color: 'var(--c-support)', type: 'line', dash: '2 3' });
  if (p.pointSupports.length) keys.push({ label: 'Stütze b × h', color: 'var(--c-support)', type: 'fill' });
  if (p.loadAreas.length) keys.push({ label: 'Lastfläche', color: 'var(--c-load)', type: 'fill' });
  if (p.lineLoads.length) keys.push({ label: 'Linienlast', color: 'var(--c-load)', type: 'line', dash: '7 4' });
  if (keys.length && labels) view.keyLegend(keys);

  // Bemassung
  if (outline.length >= 3 && labels) {
    // Achsmasse der Stützen innen, Gesamtmasse aussen
    const xs = [...new Set(p.pointSupports.map((s) => num(s.x)).filter(Number.isFinite).map((v) => +v.toFixed(3)))].sort((a, b) => a - b);
    const chainX = xs.length >= 2 && xs.length <= 14;
    if (chainX) for (let k = 0; k + 1 < xs.length; k++) view.dimension(xs[k], bb.y0, xs[k + 1], bb.y0, fmt(xs[k + 1] - xs[k], 2), -34);
    const ys = [...new Set(p.pointSupports.map((s) => num(s.y)).filter(Number.isFinite).map((v) => +v.toFixed(3)))].sort((a, b) => a - b);
    const chainY = ys.length >= 2 && ys.length <= 14;
    if (chainY) for (let k = 0; k + 1 < ys.length; k++) view.dimension(bb.x0, ys[k], bb.x0, ys[k + 1], fmt(ys[k + 1] - ys[k], 2), 34);
    view.dimension(bb.x0, bb.y0, bb.x1, bb.y0, `${fmt(bb.w, 2)} m`, chainX ? -62 : -34);
    view.dimension(bb.x0, bb.y0, bb.x0, bb.y1, `${fmt(bb.h, 2)} m`, chainY ? 62 : 34);
  }
}

// ------------------------------------------------------------------ Netz

export function drawMesh(view, app, mesh, info = {}) {
  const { x, y, tri } = mesh;
  const nt = tri.length / 3;
  // schlechte Elemente hervorheben
  let poor = '';
  let heads = '';
  for (let t = 0; t < nt; t++) {
    const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
    const tri3 = `M${x[a].toFixed(4)} ${y[a].toFixed(4)}L${x[b].toFixed(4)} ${y[b].toFixed(4)}L${x[c].toFixed(4)} ${y[c].toFixed(4)}Z`;
    if (info.elemFactor && info.elemFactor[t] > 1) heads += tri3;
    else if (triMinAngle(x[a], y[a], x[b], y[b], x[c], y[c]) < 20) poor += tri3;
  }
  if (heads) worldPath(view, heads, { fill: 'var(--c-support)', fillOpacity: '0.35', stroke: 'none' });
  if (poor) worldPath(view, poor, { fill: 'var(--c-highlight)', fillOpacity: '0.35', stroke: 'none' });
  worldPath(view, edgesPath(x, y, allEdges(mesh)), { fill: 'none', stroke: 'var(--c-mesh)', strokeWidth: '0.8' });
  worldPath(view, edgesPath(x, y, boundaryEdges(mesh)), { fill: 'none', stroke: 'var(--c-struct)', strokeWidth: '1.8' });
  drawSupportsLight(view, app.project);
  const q = mesh.quality || {};
  view.caption(`${info.preview ? 'Vorschau · ' : ''}${fmt(mesh.nNodes, 0)} Knoten · ${fmt(mesh.nTri, 0)} Elemente (DKT) · Netzweite ${fmt(mesh.size, 2)} m · kleinster Winkel ${fmt(q.minAngle, 1)}°${q.poor ? ` · ${q.poor} Elemente < 20° (markiert)` : ''}`);
}

function drawSupportsLight(view, p, strong = false) {
  for (const w of p.lineSupports) {
    const v = [num(w.x1), num(w.y1), num(w.x2), num(w.y2)];
    if (v.every(Number.isFinite)) view.line(v[0], v[1], v[2], v[3], { stroke: 'var(--c-support)', width: strong ? 4 : 3, opacity: 0.75 });
  }
  for (const s of p.pointSupports) {
    const x = num(s.x), y = num(s.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const b = num(s.b) || 0, hc = num(s.hc) || 0;
    if (b > 0 && hc > 0) view.rect(x - b / 2, y - hc / 2, b, hc, { fill: 'none', stroke: 'var(--c-support)', width: 1.4 });
    view.dot(x, y, 2.5, { fill: 'var(--c-support)' });
  }
}

// ------------------------------------------------------------------ Isoflächen

/**
 * Farbige Isoflächen eines Knotenfeldes mit Legende, Isolinien, Extremwerten.
 * o: {title, unit, symmetric, digits, caption, zeroLine}
 */
export function drawContour(view, app, values, o) {
  const r = app.results;
  const mesh = r.mesh;
  const { x, y, tri, nNodes: n } = mesh;
  const lv = contourLevels(values, { symmetric: o.symmetric ?? 'auto', target: 12, clip: o.clip ?? 0 }, { sequential, diverging });
  const levels = lv.levels.slice();
  // optional: Bereich ≤ neutralBelow neutral (z.B. «keine Bewehrung erforderlich»)
  const neutral = o.neutralBelow !== undefined && levels[0] <= 0 && levels[1] > o.neutralBelow;
  if (neutral) levels.splice(1, 0, o.neutralBelow);
  const L0 = levels[0], span = (levels[levels.length - 1] - L0) || 1;
  const colorOf = (v) => (neutral && v < o.neutralBelow ? 'var(--c-struct-fill)' : lv.colorOf(v));
  const bands = isoBands(x, y, tri, values, levels);
  bands.forEach((d, k) => {
    if (!d) return;
    const c = colorOf((levels[k] + levels[k + 1]) / 2);
    if (neutral && k === 0) worldPath(view, d, { fill: c, stroke: 'none' });
    else worldPath(view, d, { fill: c, stroke: c, strokeWidth: '0.7', strokeLinejoin: 'round' });
  });
  if (app.viewOpts.iso !== false && levels.length > 2) {
    worldPath(view, isoLines(x, y, tri, values, levels.slice(1, -1).filter((v) => v !== 0)), { fill: 'none', stroke: 'var(--c-struct)', strokeWidth: '0.5', opacity: '0.35' });
  }
  if (o.zeroLine && lv.min < 0 && lv.max > 0) {
    worldPath(view, isoLines(x, y, tri, values, [0]), { fill: 'none', stroke: 'var(--c-struct)', strokeWidth: '1.3', opacity: '0.75', strokeDasharray: '5 3' });
  }
  if (app.viewOpts.meshOv) worldPath(view, edgesPath(x, y, allEdges(mesh)), { fill: 'none', stroke: 'var(--c-struct)', strokeWidth: '0.4', opacity: '0.35' });
  view.rings([r.outline, ...r.holes], { fill: 'none', stroke: 'var(--c-struct)', width: 1.6 });
  drawSupportsLight(view, app.project);
  const digits = o.digits ?? Math.min(3, decimalsFor(lv.step) + 1);
  // Werte an ausgewählten Knoten
  if (app.viewOpts.vals) {
    const b = r.bbox;
    const cell = Math.max(mesh.size * 1.6, Math.max(b.w, b.h) / 16);
    for (const i of sparseNodes(x, y, n, cell)) {
      if (!Number.isFinite(values[i])) continue;
      view.text(x[i], y[i], fmt(values[i], digits), { size: 9.5, color: 'var(--text)', track: false });
    }
  }
  // Extremwerte
  let imin = -1, imax = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(values[i])) continue;
    if (imin < 0 || values[i] < values[imin]) imin = i;
    if (imax < 0 || values[i] > values[imax]) imax = i;
  }
  const mark = (i, label) => {
    view.symbol(x[i], y[i], (g) => {
      g.append(svgEl('circle', { cx: 0, cy: 0, r: 4.5, style: { fill: 'var(--surface)', stroke: 'var(--text)', strokeWidth: 1.6 } }));
      g.append(svgEl('circle', { cx: 0, cy: 0, r: 1.6, style: { fill: 'var(--text)' } }));
    });
    const right = x[i] > (r.bbox.x0 + r.bbox.x1) / 2;
    view.text(x[i], y[i], label, { bold: true, size: 11, dx: right ? -8 : 8, dy: -10, anchor: right ? 'end' : 'start' });
  };
  if (imax >= 0 && (lv.max > 0 || !o.symmetric)) mark(imax, `max ${fmt(values[imax], digits)}${o.unit ? ' ' + o.unit : ''}`);
  if (imin >= 0 && imin !== imax && (lv.min < 0 || o.showMin)) mark(imin, `min ${fmt(values[imin], digits)}${o.unit ? ' ' + o.unit : ''}`);
  view.legend({ title: o.title, unit: o.unit, levels, color: (t) => colorOf(L0 + t * span), digits: Math.min(3, decimalsFor(lv.step)) });
  const keys = [];
  if (imax >= 0) keys.push({ label: 'Extremwert', color: 'var(--text)', type: 'dot' });
  if (o.zeroLine && lv.min < 0 && lv.max > 0) keys.push({ label: 'Nulllinie', color: 'var(--c-struct)', type: 'line', dash: '5 3', width: 1.5 });
  if (keys.length) view.keyLegend(keys);
  if (o.caption) view.caption(o.caption + (lv.clipped ? ' · Skala begrenzt, Spitzen s. min/max' : ''));
  return lv;
}

/** Hauptmomentenrichtungen als Kreuze (Länge ∝ |m|, Farbe nach Vorzeichen). */
export function drawPrincipalCrosses(view, app, set) {
  const r = app.results;
  const { x, y, tri } = r.mesh;
  const nt = tri.length / 3;
  const b = r.bbox;
  const cell = Math.max(r.mesh.size * 1.4, Math.max(b.w, b.h) / 26);
  const cx = new Float64Array(nt), cy = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    cx[t] = (x[tri[3 * t]] + x[tri[3 * t + 1]] + x[tri[3 * t + 2]]) / 3;
    cy[t] = (y[tri[3 * t]] + y[tri[3 * t + 1]] + y[tri[3 * t + 2]]) / 3;
  }
  const chosen = sparseNodes(cx, cy, nt, cell);
  let mmax = 0;
  const pm = chosen.map((t) => {
    const q = principalMoments(set.emx[t], set.emy[t], set.emxy[t]);
    mmax = Math.max(mmax, Math.abs(q.m1), Math.abs(q.m2));
    return [t, q];
  });
  if (!(mmax > 0)) return;
  const Lc = 0.45 * cell;
  let pos = '', neg = '';
  const seg = (xc, yc, ang, m) => {
    const l = Lc * Math.abs(m) / mmax;
    if (l < 1e-6) return;
    const dx = Math.cos(ang) * l, dy = Math.sin(ang) * l;
    const s = `M${(xc - dx).toFixed(4)} ${(yc - dy).toFixed(4)}L${(xc + dx).toFixed(4)} ${(yc + dy).toFixed(4)}`;
    if (m >= 0) pos += s; else neg += s;
  };
  for (const [t, q] of pm) {
    seg(cx[t], cy[t], q.phi, q.m1);
    seg(cx[t], cy[t], q.phi + Math.PI / 2, q.m2);
  }
  worldPath(view, pos, { fill: 'none', stroke: 'var(--c-pos)', strokeWidth: '2', strokeLinecap: 'round' });
  worldPath(view, neg, { fill: 'none', stroke: 'var(--c-neg)', strokeWidth: '2', strokeLinecap: 'round' });
  view.rings([r.outline, ...r.holes], { fill: 'none', stroke: 'var(--c-struct)', width: 1.6 });
  drawSupportsLight(view, app.project);
  view.keyLegend([
    { label: 'm > 0 (Zug unten)', color: 'var(--c-pos)', type: 'line' },
    { label: 'm < 0 (Zug oben)', color: 'var(--c-neg)', type: 'line' },
  ]);
  view.caption(`${set.name} · Hauptmomentenrichtungen, Strichlänge ∝ |m| (grösster Betrag ${fmt(mmax, 1)} kNm/m)`);
}

// ------------------------------------------------------------------ Reaktionen

export function drawReactions(view, app, set) {
  const r = app.results;
  const p = app.project;
  view.rings([r.outline, ...r.holes], { fill: 'var(--c-struct-fill)', stroke: 'var(--c-struct)', width: 1.4 });
  const L = Math.max(r.bbox.w, r.bbox.h);
  // Linienlager: Diagramm senkrecht zur Wand
  let rmax = 0;
  r.supports.forEach((sp, k) => {
    if (sp.kind !== 'line') return;
    const f = set.supportForces[k];
    // Massstab aus den inneren Werten (Eckkräfte an Wandenden sind modellbedingte Spitzen)
    const inner = f.line.length > 2 ? f.line.slice(1, -1) : f.line;
    for (const [, v] of inner) rmax = Math.max(rmax, Math.abs(v));
  });
  const cap = (v) => Math.sign(v) * Math.min(Math.abs(v), 1.5 * rmax);
  const scale = rmax > 0 ? 0.08 * L / rmax : 0;
  r.supports.forEach((sp, k) => {
    const f = set.supportForces[k];
    if (sp.kind === 'line') {
      view.line(sp.x1, sp.y1, sp.x2, sp.y2, { stroke: 'var(--c-support)', width: 3 });
      if (!scale) return;
      const tx = (sp.x2 - sp.x1) / sp.L, ty = (sp.y2 - sp.y1) / sp.L;
      // Diagramm auf die Aussenseite (vom Plattenschwerpunkt weg)
      let nx = -ty, ny = tx;
      const mx = (sp.x1 + sp.x2) / 2, my = (sp.y1 + sp.y2) / 2;
      const cx = (r.bbox.x0 + r.bbox.x1) / 2, cy = (r.bbox.y0 + r.bbox.y1) / 2;
      if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
      let dPos = '', dNeg = '';
      const pts = f.line;
      for (let j = 0; j + 1 < pts.length; j++) {
        const [s0, v0] = pts[j], [s1, v1] = pts[j + 1];
        const P = (s, v) => [sp.x1 + tx * s + nx * cap(v) * scale, sp.y1 + ty * s + ny * cap(v) * scale];
        const a0 = [sp.x1 + tx * s0, sp.y1 + ty * s0], a1 = [sp.x1 + tx * s1, sp.y1 + ty * s1];
        const q0 = P(s0, v0), q1 = P(s1, v1);
        const d = `M${a0[0]} ${a0[1]}L${q0[0]} ${q0[1]}L${q1[0]} ${q1[1]}L${a1[0]} ${a1[1]}Z`;
        if (v0 + v1 >= 0) dPos += d; else dNeg += d;
      }
      if (dPos) worldPath(view, dPos, { fill: 'var(--c-pos-fill)', stroke: 'var(--c-pos)', strokeWidth: '0.8' });
      if (dNeg) worldPath(view, dNeg, { fill: 'var(--c-neg-fill)', stroke: 'var(--c-neg)', strokeWidth: '0.8' });
      // Beschriftung innen, parallel zur Wand
      let ang = Math.atan2(ty, tx) * 180 / Math.PI;
      if (ang > 90.01) ang -= 180; if (ang < -89.99) ang += 180;
      view.text(mx, my, `${sp.name}: Σ ${fmt(f.total, 1)} kN · max ${fmt(f.maxR, 1)} kN/m`, {
        size: 10.5, bold: true, color: 'var(--c-pos)', dx: -nx * 12, dy: ny * 12, rotate: ang, anchor: 'middle',
      });
    }
  });
  // Stützen: Kreis ∝ Kraft
  let pmax = 0;
  r.supports.forEach((sp, k) => { if (sp.kind === 'point') pmax = Math.max(pmax, Math.abs(set.supportForces[k].value)); });
  r.supports.forEach((sp, k) => {
    if (sp.kind !== 'point') return;
    const v = set.supportForces[k].value;
    const rad = pmax > 0 ? 5 + 13 * Math.sqrt(Math.abs(v) / pmax) : 5;
    if (sp.b > 0 && sp.h > 0) view.rect(sp.x - sp.b / 2, sp.y - sp.h / 2, sp.b, sp.h, { fill: 'none', stroke: 'var(--c-support)', width: 1.2 });
    view.symbol(sp.x, sp.y, (g) => {
      g.append(svgEl('circle', { cx: 0, cy: 0, r: rad, style: { fill: v >= 0 ? 'var(--c-pos-fill)' : 'var(--c-neg-fill)', stroke: v >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', strokeWidth: 1.5 } }));
    });
    view.text(sp.x, sp.y, `${sp.name}: ${fmt(v, 1)} kN`, { size: 10.5, bold: true, dx: rad + 4, dy: -rad, anchor: 'start' });
  });
  // Durchstanz-Nachweisschnitte
  if (app.viewOpts.punch !== false) {
    for (const pc of r.punching || []) {
      if (!pc.pieces) continue;
      let eff = '', ineff = '';
      for (const [x1, y1, x2, y2, e] of pc.pieces) {
        const s = `M${x1.toFixed(4)} ${y1.toFixed(4)}L${x2.toFixed(4)} ${y2.toFixed(4)}`;
        if (e) eff += s; else ineff += s;
      }
      const ok = pc.eta <= 1;
      worldPath(view, eff, { fill: 'none', stroke: ok ? 'var(--ok)' : 'var(--fail)', strokeWidth: '1.6' });
      if (ineff) worldPath(view, ineff, { fill: 'none', stroke: 'var(--text-3)', strokeWidth: '1', strokeDasharray: '3 3' });
      view.text(pc.x, pc.y, `η = ${fmt(pc.eta, 2)}`, { size: 10, color: ok ? 'var(--ok)' : 'var(--fail)', dx: 10, dy: 14, anchor: 'start', bold: true });
    }
  }
  const keys = [];
  if (r.supports.some((sp) => sp.kind === 'line')) keys.push({ label: 'Linienlagerkraft [kN/m]', color: 'var(--c-pos)', type: 'fill' });
  if (r.supports.some((sp, k) => sp.kind === 'line' && set.supportForces[k].minR < 0)) keys.push({ label: 'abhebend (z.B. Eckkräfte)', color: 'var(--c-neg)', type: 'fill' });
  if (r.supports.some((sp) => sp.kind === 'point')) keys.push({ label: 'Stützenkraft (Fläche ∝ R)', color: 'var(--c-pos)', type: 'dot' });
  if (app.viewOpts.punch !== false && r.punching?.some((pc) => pc.pieces)) {
    keys.push({ label: 'Nachweisschnitt erfüllt', color: 'var(--ok)', type: 'line' });
    keys.push({ label: 'Nachweisschnitt nicht erfüllt', color: 'var(--fail)', type: 'line' });
    keys.push({ label: 'unwirksamer Teil', color: 'var(--text-3)', type: 'line', dash: '3 3' });
  }
  if (keys.length) view.keyLegend(keys);
  view.caption(`${set.name} · Σ Lasten ${fmt(set.sumF, 1)} kN = Σ Auflagerkräfte ${fmt(set.sumR, 1)} kN`);
}

// ------------------------------------------------------------------ Abfragepunkt

export function drawProbe(view, probe) {
  if (!probe) return;
  const lines = probe.lines || [];
  const W = Math.max(120, ...lines.map((l) => l.length * 6.9)) + 18, H = 10 + lines.length * 15;
  view.symbol(probe.x, probe.y, (g) => {
    g.append(svgEl('circle', { cx: 0, cy: 0, r: 5, style: { fill: 'none', stroke: 'var(--c-highlight)', strokeWidth: 2 } }));
    g.append(svgEl('path', { d: 'M-10 0h5M5 0h5M0 -10v5M0 5v5', style: { stroke: 'var(--c-highlight)', strokeWidth: 1.5 } }));
    const box = svgEl('g', { transform: 'translate(12 12)' });
    box.append(svgEl('rect', { x: 0, y: 0, width: W, height: H, rx: 5, style: { fill: 'var(--surface)', stroke: 'var(--c-highlight)', strokeWidth: 1, opacity: 0.96 } }));
    lines.forEach((t, k) => box.append(svgEl('text', { x: 8, y: 16 + 15 * k, style: { fontSize: '11px', fill: k === 0 ? 'var(--text-2)' : 'var(--text)', fontFamily: 'var(--mono)' }, text: t })));
    g.append(box);
  }, { track: false });
}

export { layerLabel, comboTypeLabel };

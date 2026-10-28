// Isoflächen (Farbbänder) und Isolinien auf linearen Dreiecken (DOM-frei)
import { niceTicks } from '../../js/core/format.js';

/**
 * «Schöne» Stufen und Farbzuordnung für einen Wertebereich.
 * symmetric: true → divergierende Skala bei Werten beider Vorzeichen, 'auto' → nur bei deutlichen Werten beider Vorzeichen.
 * clip (0…1): Perzentil der Beträge, bei dem die Skala begrenzt wird (Spitzenwerte über Stützen/Punktlasten
 *   sollen nicht die ganze Farbskala beanspruchen); Werte ausserhalb fallen in das erste bzw. letzte Band.
 * Rückgabe {levels, symmetric, min, max, step, clipped, colorOf(v), colorT(t)} – colorT für die Legende (t über levels).
 */
export function contourLevels(values, { symmetric = 'auto', target = 12, clip = 0 } = {}, ramps = {}) {
  const fin = [];
  for (const v of values) if (Number.isFinite(v)) fin.push(v);
  let min = Infinity, max = -Infinity;
  for (const v of fin) { if (v < min) min = v; if (v > max) max = v; }
  if (!fin.length) { min = 0; max = 1; }
  const amax = Math.max(Math.abs(min), Math.abs(max));
  let sym = symmetric;
  if (symmetric === 'auto') sym = min < 0 && max > 0 && Math.min(-min, max) > 0.05 * amax;
  if (symmetric === true) sym = min < 0 && max > 0;
  const seq = ramps.sequential, div = ramps.diverging;
  if (amax < 1e-12) {
    const levels = [-1, 0, 1];
    return { levels, symmetric: false, min, max, step: 1, clipped: false, colorOf: () => seq(0.05), colorT: () => seq(0.05) };
  }
  // Begrenzung über Perzentile (getrennt für beide Vorzeichen)
  let lo = min, hi = max;
  if (clip > 0 && fin.length > 30) {
    const pos = fin.filter((v) => v > 0).sort((a, b) => a - b);
    const neg = fin.filter((v) => v < 0).map((v) => -v).sort((a, b) => a - b);
    const pct = (arr) => arr[Math.min(arr.length - 1, Math.floor(clip * (arr.length - 1)))];
    if (pos.length > 10 && max > 0) hi = Math.max(pct(pos), 0.25 * max);
    if (neg.length > 10 && min < 0) lo = -Math.max(pct(neg), 0.25 * -min);
    if (!sym && min >= 0) lo = min;
    if (!sym && max <= 0) hi = max;
  }
  let t;
  if (hi - lo < 1e-9 * amax) t = niceTicks(lo - 0.05 * amax, hi + 0.05 * amax, 4);
  else t = niceTicks(lo, hi, target);
  let levels = t.ticks.slice();
  if (levels.length < 2) levels = [lo, hi];
  const L0 = levels[0], Ln = levels[levels.length - 1];
  const clipped = L0 > min + 1e-9 * amax || Ln < max - 1e-9 * amax;
  let colorOf;
  if (sym) {
    // zweiseitig: 0 = weiss, beide Seiten nutzen die volle Farbintensität
    const sp = Math.max(Ln, 0.3 * -L0, 1e-12), sn = Math.max(-L0, 0.3 * Ln, 1e-12);
    colorOf = (v) => (v >= 0 ? div(0.5 + 0.5 * Math.min(1, v / sp)) : div(0.5 - 0.5 * Math.min(1, -v / sn)));
  } else {
    colorOf = (v) => seq((v - L0) / ((Ln - L0) || 1));
  }
  return { levels, symmetric: sym, min, max, step: t.step, clipped, colorOf, colorT: (tt) => colorOf(L0 + tt * (Ln - L0)) };
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;

/**
 * Farbbänder: für jedes Band [L_k, L_k+1] eine SVG-Pfadbeschreibung (Weltkoordinaten).
 * Werte unter L_0 bzw. über L_n werden dem ersten bzw. letzten Band zugeschlagen.
 */
export function isoBands(x, y, tri, v, levels) {
  const nb = levels.length - 1;
  const out = Array.from({ length: nb }, () => []);
  const band = (val) => {
    if (!(val >= levels[1])) return 0;
    if (val >= levels[nb - 1]) return nb - 1;
    let lo = 1, hi = nb - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (val >= levels[m]) lo = m; else hi = m; }
    return lo;
  };
  const px = [], py = [], pv = [];
  const qx = [], qy = [], qv = [];
  const clip = (sx, sy, sv, dx, dy, dv, lim, keepAbove) => {
    dx.length = 0; dy.length = 0; dv.length = 0;
    const n = sx.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ai = keepAbove ? sv[i] >= lim : sv[i] <= lim;
      const aj = keepAbove ? sv[j] >= lim : sv[j] <= lim;
      if (ai) { dx.push(sx[i]); dy.push(sy[i]); dv.push(sv[i]); }
      if (ai !== aj) {
        const t = (lim - sv[i]) / (sv[j] - sv[i]);
        dx.push(sx[i] + t * (sx[j] - sx[i])); dy.push(sy[i] + t * (sy[j] - sy[i])); dv.push(lim);
      }
    }
  };
  const emit = (k, xs, ys) => {
    if (xs.length < 3) return;
    let s = `M${r4(xs[0])} ${r4(ys[0])}`;
    for (let i = 1; i < xs.length; i++) s += `L${r4(xs[i])} ${r4(ys[i])}`;
    out[k].push(s + 'Z');
  };
  for (let t = 0, nt = tri.length / 3; t < nt; t++) {
    const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
    const va = v[a], vb = v[b], vc = v[c];
    if (!Number.isFinite(va) || !Number.isFinite(vb) || !Number.isFinite(vc)) continue;
    const k0 = band(Math.min(va, vb, vc)), k1 = band(Math.max(va, vb, vc));
    if (k0 === k1) { emit(k0, [x[a], x[b], x[c]], [y[a], y[b], y[c]]); continue; }
    for (let k = k0; k <= k1; k++) {
      px.length = 0; py.length = 0; pv.length = 0;
      px.push(x[a], x[b], x[c]); py.push(y[a], y[b], y[c]); pv.push(va, vb, vc);
      let sx = px, sy = py, sv = pv;
      if (k > 0) { clip(sx, sy, sv, qx, qy, qv, levels[k], true); sx = qx.slice(); sy = qy.slice(); sv = qv.slice(); }
      if (k < nb - 1) { clip(sx, sy, sv, qx, qy, qv, levels[k + 1], false); sx = qx; sy = qy; }
      emit(k, sx, sy);
    }
  }
  return out.map((parts) => parts.join(''));
}

/** Isolinien für die gegebenen Stufen als eine SVG-Pfadbeschreibung. */
export function isoLines(x, y, tri, v, levels) {
  let s = '';
  for (let t = 0, nt = tri.length / 3; t < nt; t++) {
    const id = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]];
    const vs = [v[id[0]], v[id[1]], v[id[2]]];
    if (!vs.every(Number.isFinite)) continue;
    const mn = Math.min(...vs), mx = Math.max(...vs);
    for (const L of levels) {
      if (!(L > mn && L < mx)) continue;
      const pts = [];
      for (let e = 0; e < 3; e++) {
        const i = e, j = (e + 1) % 3;
        if ((vs[i] < L) !== (vs[j] < L)) {
          const f = (L - vs[i]) / (vs[j] - vs[i]);
          pts.push(x[id[i]] + f * (x[id[j]] - x[id[i]]), y[id[i]] + f * (y[id[j]] - y[id[i]]));
        }
      }
      if (pts.length >= 4) s += `M${r4(pts[0])} ${r4(pts[1])}L${r4(pts[2])} ${r4(pts[3])}`;
    }
  }
  return s;
}

/** Wählt gut verteilte Knoten für Wertbeschriftungen (ein Knoten je Rasterzelle). */
export function sparseNodes(x, y, n, cell, filter = null) {
  const best = new Map();
  for (let i = 0; i < n; i++) {
    if (filter && !filter(i)) continue;
    const gi = Math.floor(x[i] / cell), gj = Math.floor(y[i] / cell);
    const cx = (gi + 0.5) * cell, cy = (gj + 0.5) * cell;
    const d = (x[i] - cx) ** 2 + (y[i] - cy) ** 2;
    const k = `${gi},${gj}`;
    const b = best.get(k);
    if (!b || d < b[1]) best.set(k, [i, d]);
  }
  return [...best.values()].map((b) => b[0]);
}

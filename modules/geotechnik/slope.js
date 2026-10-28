// Böschungsstabilität mit kreisförmigen Gleitflächen: Lamellenverfahren nach Bishop (vereinfacht)
// und Fellenius, automatische Suche über ein Raster von Mittelpunkten × Radien (DOM-frei).
//
//  Bishop:    F = Σ [c'·b + (W − u·b)·tan φ'] / m_α  /  Σ W·sin α,   m_α = cos α + sin α·tan φ'/F
//  Fellenius: F = Σ [c'·l + (W·cos α − u·l)·tan φ']  /  Σ W·sin α,   l = b / cos α
//  α = Neigung der Lamellenbasis (positiv, wo die Basis in Bewegungsrichtung fällt).
// Intern wird die Böschung so gespiegelt, dass sie nach rechts abfällt.
import { layerAt, rad } from './soil.js';

/**
 * Modell aufbauen.
 * sl: {surface:[{x,y}], waterMode:'none'|'gw'|'line', water:[{x,y}], q:{p, x1, x2}, depthBelow}
 * soil: makeSoil(...) (Schichttiefen ab höchstem Geländepunkt; GW-Tiefe für waterMode 'gw')
 */
export function buildSlopeModel(soil, sl) {
  const raw = (sl.surface || []).map((p) => [Number(p.x), Number(p.y)]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (raw.length < 2) throw new Error('Die Geländelinie braucht mindestens 2 Punkte (Register «Böschung»).');
  raw.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < raw.length; i++) if (raw[i][0] - raw[i - 1][0] < 1e-6) throw new Error(`Geländelinie: Punkte ${i} und ${i + 1} haben dieselbe x-Koordinate. Senkrechte Abschnitte bitte mit kleinem Versatz eingeben (z.B. 0.01 m).`);
  const dir = raw[0][1] >= raw[raw.length - 1][1] ? 1 : -1;
  const tx = (x) => dir * x;
  const surf = (dir === 1 ? raw : raw.map((p) => [-p[0], p[1]]).reverse());
  let yMax = -Infinity, yMin = Infinity;
  for (const p of surf) { yMax = Math.max(yMax, p[1]); yMin = Math.min(yMin, p[1]); }
  const Hs = yMax - yMin;
  if (Hs < 1e-6) throw new Error('Die Geländelinie ist horizontal – es gibt keine Böschung zu untersuchen.');

  // Wasserspiegel
  let water = null;
  if (sl.waterMode === 'line') {
    const w = (sl.water || []).map((p) => [Number(p.x), Number(p.y)]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (w.length >= 2) water = (dir === 1 ? w : w.map((p) => [-p[0], p[1]])).sort((a, b) => a[0] - b[0]);
  } else if (sl.waterMode === 'gw' && Number.isFinite(soil.zw)) {
    water = [[surf[0][0] - 1e3, yMax - soil.zw], [surf[surf.length - 1][0] + 1e3, yMax - soil.zw]];
  }

  // Böschungskrone und -fuss (für das automatische Suchraster)
  let xCrest = surf[0][0], xToe = surf[surf.length - 1][0];
  for (const p of surf) if (p[1] >= yMax - 0.02 * Hs) xCrest = Math.max(xCrest, p[0]);
  for (let i = surf.length - 1; i >= 0; i--) if (surf[i][1] <= yMin + 0.02 * Hs) xToe = Math.min(xToe, surf[i][0]);
  if (xToe <= xCrest) xToe = xCrest + 1e-3;

  const q = sl.q && Number(sl.q.p) ? (() => {
    const a = tx(Number(sl.q.x1) || 0), b = tx(Number(sl.q.x2) || 0);
    return { p: Number(sl.q.p), x1: Math.min(a, b), x2: Math.max(a, b) };
  })() : null;

  const depthBelow = Number.isFinite(Number(sl.depthBelow)) ? Math.max(0, Number(sl.depthBelow)) : Hs;
  return {
    dir, tx, surf, yMax, yMin, Hs, water, q, soil,
    xmin: surf[0][0], xmax: surf[surf.length - 1][0],
    xCrest, xToe, yBot: yMin - depthBelow,
  };
}

/** Lineare Interpolation in einer Polylinie [[x,y]…] (konstant ausserhalb). */
export function polyY(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  const n = pts.length;
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] <= x) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi];
  return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
}

const waterY = (M, x) => (M.water ? polyY(M.water, x) : -Infinity);

/** Gewicht einer Bodensäule je m Breite zwischen yb und ys an der Stelle x (γ über, γ_sat unter Wasser). */
function columnWeight(M, x, yb, ys, gFac) {
  if (ys <= yb) return 0;
  const { layers } = M.soil;
  const hw = waterY(M, x);
  // Grenzen in Höhenkoten
  const cuts = [yb, ys];
  for (const l of layers) { const y = M.yMax - l.z; if (y > yb && y < ys) cuts.push(y); }
  if (hw > yb && hw < ys) cuts.push(hw);
  cuts.sort((a, b) => a - b);
  let w = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    if (b - a <= 0) continue;
    const m = (a + b) / 2;
    const L = layerAt(layers, M.yMax - m);
    w += (m < hw ? L.gammaSat : L.gamma) * (b - a);
  }
  return w * gFac;
}

/**
 * Scherparameter an einer Höhenkote. P.f: {tanPhi, c, cu, gamma} Divisoren (γ_M), P.undrained.
 */
function strengthAt(M, y, P) {
  const L = layerAt(M.soil.layers, M.yMax - y);
  if (P.undrained && L.cu > 0) return { tanPhi: 0, c: L.cu / P.f.cu, undrained: true, L };
  return { tanPhi: Math.tan(rad(L.phi)) / P.f.tanPhi, c: L.c / P.f.c, undrained: false, L };
}

/** Schnittbereich Kreis–Gelände: [xa, xe] (Eintritt oben, Austritt unten) oder null. */
function circleInterval(M, xc, yc, R, tMin) {
  const x0 = Math.max(M.xmin - 1e-9, xc - R), x1 = Math.min(M.xmax + 1e-9, xc + R);
  if (x1 - x0 < 1e-6) return null;
  const g = (x) => polyY(M.surf, x) - (yc - Math.sqrt(Math.max(0, R * R - (x - xc) ** 2)));
  const N = 48;
  const xs = [];
  for (let k = 0; k <= N; k++) xs.push(x0 + (x1 - x0) * k / N);
  for (const p of M.surf) if (p[0] > x0 && p[0] < x1) xs.push(p[0]);
  xs.sort((a, b) => a - b);
  // längstes zusammenhängendes Intervall mit g > 0
  let best = null, start = null, depth = 0, bestDepth = 0;
  const gv = xs.map(g);
  for (let i = 0; i < xs.length; i++) {
    if (gv[i] > 0) {
      if (start === null) { start = i; depth = 0; }
      depth = Math.max(depth, gv[i]);
    }
    if ((gv[i] <= 0 || i === xs.length - 1) && start !== null) {
      const end = gv[i] > 0 ? i : i - 1;
      if (!best || xs[end] - xs[start] > best[1] - best[0]) { best = [start, end]; bestDepth = depth; }
      start = null;
    }
  }
  if (!best) return null;
  const refine = (a, b) => { // g(a) ≤ 0 < g(b) oder umgekehrt
    let ga = g(a);
    for (let k = 0; k < 30; k++) { const m = (a + b) / 2, gm = g(m); if ((gm > 0) === (ga > 0)) { a = m; ga = gm; } else b = m; }
    return (a + b) / 2;
  };
  let xa, xe;
  if (best[0] === 0) { if (gv[0] > 1e-6) return null; xa = xs[0]; } else xa = refine(xs[best[0] - 1], xs[best[0]]);
  if (best[1] === xs.length - 1) { if (gv[xs.length - 1] > 1e-6) return null; xe = xs[xs.length - 1]; } else xe = refine(xs[best[1]], xs[best[1] + 1]);
  // Kreis verlässt das Modell seitlich?
  if ((xa <= M.xmin + 1e-6 && g(M.xmin) > 1e-6) || (xe >= M.xmax - 1e-6 && g(M.xmax) > 1e-6)) return null;
  if (bestDepth < tMin) return null;
  return { xa, xe, depth: bestDepth };
}

/**
 * Einen Gleitkreis berechnen.
 * P: {n, undrained, f:{tanPhi,c,cu,gamma}, qFac, qFavZero, tMin, keepSlices}
 * Rückgabe {F (Bishop), FF (Fellenius), xa, xe, slices?, warn}
 */
export function evalCircle(M, xc, yc, R, P) {
  if (!(R > 0) || yc - R < M.yBot - 1e-6) return null;
  const iv = circleInterval(M, xc, yc, R, P.tMin ?? 0);
  if (!iv) return null;
  const n = P.n || 30;
  const b = (iv.xe - iv.xa) / n;
  const gw = M.soil.gammaW;
  const S = new Array(n);
  let drive = 0;
  for (let i = 0; i < n; i++) {
    const xm = iv.xa + (i + 0.5) * b;
    const yb = yc - Math.sqrt(Math.max(0, R * R - (xm - xc) ** 2));
    const ys = polyY(M.surf, xm);
    const sa = Math.max(-1, Math.min(1, (xc - xm) / R));
    const alpha = Math.asin(sa);
    let W = columnWeight(M, xm, yb, ys, 1 / P.f.gamma) * b;
    const hw = waterY(M, xm);
    if (hw > ys) W += gw * (hw - ys) * b; // Wasserauflast (Teich)
    let Q = 0;
    if (M.q) {
      const ov = Math.max(0, Math.min(xm + b / 2, M.q.x2) - Math.max(xm - b / 2, M.q.x1));
      if (ov > 0 && !(P.qFavZero && alpha < 0)) Q = M.q.p * ov * (P.qFac ?? 1);
    }
    const s = strengthAt(M, yb + 1e-6, P);
    const u = s.undrained ? 0 : gw * Math.max(0, hw - yb);
    const Wt = W + Q;
    drive += Wt * sa;
    S[i] = { xm, b, yb, ys, alpha, W, Q, u, c: s.c, tanPhi: s.tanPhi, layer: s.L.name, layerIdx: s.L.idx };
  }
  if (drive <= 1e-9) return null;
  // Fellenius
  let resF = 0;
  for (const s of S) {
    const ca = Math.cos(s.alpha), l = s.b / ca;
    resF += s.c * l + Math.max(0, (s.W + s.Q) * ca - s.u * l) * s.tanPhi;
  }
  const FF = resF / drive;
  // Bishop (vereinfacht), Iteration
  let Fb = Math.max(0.2, FF), clipped = 0;
  for (let it = 0; it < 60; it++) {
    let res = 0; clipped = 0;
    for (const s of S) {
      let m = Math.cos(s.alpha) + Math.sin(s.alpha) * s.tanPhi / Fb;
      if (m < 0.2) { m = 0.2; clipped++; }
      res += (s.c * s.b + Math.max(0, s.W + s.Q - s.u * s.b) * s.tanPhi) / m;
    }
    const Fn = res / drive;
    if (Math.abs(Fn - Fb) < 1e-5 * Math.max(1, Fn)) { Fb = Fn; break; }
    Fb = Fn;
  }
  const out = { xc, yc, R, F: Fb, FF, xa: iv.xa, xe: iv.xe, depth: iv.depth, drive, clipped };
  if (P.keepSlices) {
    for (const s of S) {
      const m = Math.max(0.2, Math.cos(s.alpha) + Math.sin(s.alpha) * s.tanPhi / Fb);
      s.mAlpha = m;
      s.T = (s.c * s.b + Math.max(0, s.W + s.Q - s.u * s.b) * s.tanPhi) / m; // Widerstand je Lamelle
      s.drive = (s.W + s.Q) * Math.sin(s.alpha);
    }
    out.slices = S;
  }
  return out;
}

/** Automatisches Suchraster aus der Geometrie. */
export function autoGrid(M) {
  const W = Math.max(M.xToe - M.xCrest, 0.2 * M.Hs);
  const S = Math.max(W, M.Hs);
  return {
    x0: M.xCrest - 0.35 * S, x1: M.xToe + 0.15 * S,
    y0: M.yMax + 0.15 * M.Hs, y1: M.yMax + 1.8 * S,
    nx: 12, ny: 12, nr: 12,
  };
}

/**
 * Suche des massgebenden Gleitkreises.
 * grid: {x0,x1,y0,y1,nx,ny,nr} (interne, gespiegelte Koordinaten); P siehe evalCircle.
 */
export function searchCritical(M, P, grid) {
  const t0 = Date.now();
  const nx = Math.max(2, Math.round(grid.nx)), ny = Math.max(2, Math.round(grid.ny)), nr = Math.max(2, Math.round(grid.nr));
  const dx = (grid.x1 - grid.x0) / (nx - 1), dy = (grid.y1 - grid.y0) / (ny - 1);
  const yTanMin = M.yBot, yTanMax = M.yMax - Math.max(P.tMin ?? 0, 0.02 * M.Hs);
  let best = null, count = 0;
  const map = [];
  const radii = (yc) => {
    const out = [];
    for (let k = 0; k < nr; k++) { const yt = yTanMin + (yTanMax - yTanMin) * k / (nr - 1); if (yc - yt > 0) out.push(yc - yt); }
    return out;
  };
  const near = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const xc = grid.x0 + i * dx, yc = grid.y0 + j * dy;
    let fmin = Infinity;
    for (const R of radii(yc)) {
      const r = evalCircle(M, xc, yc, R, P);
      count++;
      if (!r) continue;
      if (r.F < fmin) fmin = r.F;
      if (!best || r.F < best.F) best = r;
      near.push(r);
    }
    map.push({ i, j, xc, yc, F: fmin });
  }
  if (!best) return { best: null, map, nx, ny, dx, dy, count, ms: Date.now() - t0, near: [] };
  // Verfeinerung: Mustersuche (Kompass) in (x_c, y_c, R) ab dem besten Rasterpunkt;
  // zusätzlich Start von den zwei nächstbesten Mittelpunkten (lokale Minima).
  const starts = [best];
  const others = map.filter((m) => Number.isFinite(m.F)).sort((a, b) => a.F - b.F);
  for (const m of others.slice(1, 6)) {
    if (starts.length >= 3) break;
    if (starts.every((s) => Math.hypot(s.xc - m.xc, s.yc - m.yc) > 1.5 * Math.hypot(dx, dy))) {
      let bm = null;
      for (const R of radii(m.yc)) { const r = evalCircle(M, m.xc, m.yc, R, P); count++; if (r && (!bm || r.F < bm.F)) bm = r; }
      if (bm) starts.push(bm);
    }
  }
  const hr0 = (yTanMax - yTanMin) / (nr - 1);
  const tol = 2e-4 * Math.max(M.Hs, 1);
  for (const s0 of starts) {
    let cur = s0, hx = dx / 2, hy = dy / 2, hr = hr0 / 2;
    for (let it = 0; it < 400 && (hx > tol || hy > tol || hr > tol); it++) {
      const cand = [[hx, 0, 0], [-hx, 0, 0], [0, hy, hy], [0, -hy, -hy], [0, 0, hr], [0, 0, -hr], [0, hy, 0], [0, -hy, 0]];
      let moved = false;
      for (const [ax, ay, ar] of cand) {
        const r = evalCircle(M, cur.xc + ax, cur.yc + ay, cur.R + ar, P);
        count++;
        if (r && r.F < cur.F - 1e-9) { cur = r; moved = true; break; }
      }
      if (!moved) { hx /= 2; hy /= 2; hr /= 2; }
    }
    if (cur.F < best.F) best = cur;
  }
  near.sort((a, b) => a.F - b.F);
  const crit = evalCircle(M, best.xc, best.yc, best.R, { ...P, keepSlices: true }) || best;
  return { best: crit, map, nx, ny, dx, dy, count, ms: Date.now() - t0, near: near.slice(0, 12) };
}

/**
 * Böschungsanalyse: charakteristisch und mit Bemessungswerten (γ_M, γ_Q).
 * sl: Projektdaten; norm: Partialfaktoren.
 */
export function slopeAnalysis(soil, sl, norm) {
  const M = buildSlopeModel(soil, sl);
  const n = Math.min(80, Math.max(8, Math.round(Number(sl.nSlices) || 30)));
  const undrained = sl.drainage === 'undrained';
  const tMin = Math.max(0, Number(sl.tMin) || 0);
  let grid;
  if (sl.grid?.auto === false) {
    const g = sl.grid;
    const xa = M.tx(Number(g.x0)), xb = M.tx(Number(g.x1));
    grid = { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: Math.min(g.y0, g.y1), y1: Math.max(g.y0, g.y1), nx: g.nx || 12, ny: g.ny || 12, nr: g.nr || 12 };
    if (!(grid.x1 > grid.x0) || !(grid.y1 > grid.y0)) throw new Error('Suchraster: x₁ > x₀ und y₁ > y₀ wählen (Register «Böschung», Suchraster).');
  } else grid = autoGrid(M);
  const total = grid.nx * grid.ny * grid.nr;
  if (total > 20000) throw new Error(`Das Suchraster ist mit ${total} Kreisen zu fein (max. 20 000). Anzahl Mittelpunkte oder Radien reduzieren.`);
  const Pk = { n, undrained, tMin, f: { tanPhi: 1, c: 1, cu: 1, gamma: 1 }, qFac: 1, qFavZero: false };
  const Pd = { n, undrained, tMin, f: { tanPhi: norm.gPhi, c: norm.gC, cu: norm.gCu, gamma: norm.gGamma || 1 }, qFac: norm.gQslope ?? 1.3, qFavZero: true };
  const k = searchCritical(M, Pk, grid);
  if (!k.best) throw new Error('Kein gültiger Gleitkreis gefunden. Suchraster vergrössern, Geländelinie seitlich verlängern oder Mindesttiefe verkleinern.');
  const d = searchCritical(M, Pd, grid);
  // Design auf dem charakteristischen Kreis zum Vergleich
  const dOnK = evalCircle(M, k.best.xc, k.best.yc, k.best.R, Pd);
  const Fd = d.best ? Math.min(d.best.F, dOnK?.F ?? Infinity) : dOnK?.F ?? NaN;
  const gR = norm.gRs || 1;
  return {
    M, grid, n, undrained,
    char: k, design: d,
    F: k.best.F, FF: k.best.FF, Fd, FdF: d.best?.FF,
    eta: Fd > 0 ? gR / Fd : Infinity,
    ms: k.ms + d.ms, circles: k.count + d.count,
  };
}

/**
 * Iterationsverlauf nach Bishop für gegebene Lamellen (Startwert z.B. Fellenius), für die Herleitung.
 * Rückgabe {hist: [F_0, F_1, …], drive: Σ(W+Q)·sin α, res: Σ T (letzte Iteration)}
 */
export function bishopHistory(S, F0) {
  let drive = 0;
  for (const s of S) drive += (s.W + s.Q) * Math.sin(s.alpha);
  const hist = [F0];
  let F = Math.max(0.2, F0), res = 0;
  for (let it = 0; it < 60; it++) {
    res = 0;
    for (const s of S) {
      let m = Math.cos(s.alpha) + Math.sin(s.alpha) * s.tanPhi / F;
      if (m < 0.2) m = 0.2;
      res += (s.c * s.b + Math.max(0, s.W + s.Q - s.u * s.b) * s.tanPhi) / m;
    }
    const Fn = res / drive;
    hist.push(Fn);
    if (Math.abs(Fn - F) < 1e-5 * Math.max(1, Fn)) break;
    F = Fn;
  }
  return { hist, drive, res };
}

// Dreiecksnetzgenerator für Platten (DOM-frei)
//
// Vorgehen:
//   1. Planar Straight Line Graph (PSLG) aus Rand, Öffnungen und inneren Zwangslinien
//      (Linienlager, Linienlasten, Lastflächenränder); gegenseitige Schnitte und
//      Zwangspunkte (Stützen, Punktlasten) teilen die Strecken.
//   2. Unterteilung aller Strecken in Stücke ≤ Netzweite, innere Punkte auf versetztem
//      (hexagonalem) Raster mit Mindestabstand zu den Zwangslinien.
//   3. Delaunay-Triangulierung nach Bowyer–Watson (Hilbert-sortiert, Laufsuche).
//   4. Konformität: fehlende Zwangskanten werden halbiert, bis sie im Netz enthalten sind.
//   5. Entfernen der Dreiecke ausserhalb des Gebietes bzw. in Öffnungen.
//   6. Glättung (Laplace mit Qualitätskontrolle) und Delaunay-Kantentausch.
import {
  inUnion, onAnyRing, distPointSeg, segIntersect, cleanPolygon, signedArea, polygonSelfIntersects,
  bboxOf, pointInPolygon, triQuality, triMinAngle,
} from './geom.js';

export class MeshError extends Error {}

const SQ3_2 = Math.sqrt(3) / 2;

// ------------------------------------------------------------------ Hilbert-Kurve

function hilbertIndex(x, y) {
  const n = 65536;
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = n - 1 - x; y = n - 1 - y; }
      const t = x; x = y; y = t;
    }
  }
  return d;
}

// ------------------------------------------------------------------ Bowyer–Watson

class Delaunay {
  constructor(X, Y, scale) {
    this.X = X; this.Y = Y;
    this.cap = 1024;
    this.V = new Int32Array(3 * this.cap);
    this.N = new Int32Array(3 * this.cap);
    this.alive = new Uint8Array(this.cap);
    this.mark = new Int32Array(this.cap);
    this.nt = 0;
    this.free = [];
    this.stamp = 0;
    this.last = 0;
    this.eps = 1e-13 * scale * scale;
    this.dupTol = 1e-9 * scale;
  }

  grow() {
    const cap = this.cap * 2;
    const V = new Int32Array(3 * cap); V.set(this.V); this.V = V;
    const N = new Int32Array(3 * cap); N.set(this.N); this.N = N;
    const A = new Uint8Array(cap); A.set(this.alive); this.alive = A;
    const M = new Int32Array(cap); M.set(this.mark); this.mark = M;
    this.cap = cap;
  }

  newTri() {
    if (this.free.length) return this.free.pop();
    if (this.nt >= this.cap) this.grow();
    return this.nt++;
  }

  orient(a, b, px, py) {
    const X = this.X, Y = this.Y;
    return (X[b] - X[a]) * (py - Y[a]) - (Y[b] - Y[a]) * (px - X[a]);
  }

  inCircle(t, px, py) {
    const X = this.X, Y = this.Y, V = this.V;
    const a = V[3 * t], b = V[3 * t + 1], c = V[3 * t + 2];
    const adx = X[a] - px, ady = Y[a] - py;
    const bdx = X[b] - px, bdy = Y[b] - py;
    const cdx = X[c] - px, cdy = Y[c] - py;
    const det = (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy)
      + (bdx * bdx + bdy * bdy) * (cdx * ady - adx * cdy)
      + (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady);
    return det > 0;
  }

  init(s0, s1, s2) {
    const t = this.newTri();
    this.V[3 * t] = s0; this.V[3 * t + 1] = s1; this.V[3 * t + 2] = s2;
    this.N[3 * t] = -1; this.N[3 * t + 1] = -1; this.N[3 * t + 2] = -1;
    this.alive[t] = 1;
    this.last = t;
  }

  locate(px, py) {
    const V = this.V, N = this.N;
    let t = this.last;
    if (!this.alive[t]) { t = 0; while (t < this.nt && !this.alive[t]) t++; }
    const maxSteps = 4 * this.nt + 100;
    for (let step = 0; step < maxSteps; step++) {
      let next = -1;
      const r = step % 3;
      for (let k = 0; k < 3; k++) {
        const e = (k + r) % 3;
        const a = V[3 * t + (e + 1) % 3], b = V[3 * t + (e + 2) % 3];
        if (this.orient(a, b, px, py) < 0) { next = N[3 * t + e]; break; }
      }
      if (next < 0) return t;
      t = next;
    }
    // Rückfallebene: vollständige Suche
    for (let s = 0; s < this.nt; s++) {
      if (!this.alive[s]) continue;
      let ok = true;
      for (let e = 0; e < 3 && ok; e++) if (this.orient(V[3 * s + (e + 1) % 3], V[3 * s + (e + 2) % 3], px, py) < -this.eps) ok = false;
      if (ok) return s;
    }
    throw new MeshError('Triangulierung fehlgeschlagen (Punktsuche).');
  }

  /** Fügt Punkt pi ein. Gibt pi zurück oder den Index eines bereits vorhandenen, identischen Punktes. */
  insert(pi) {
    const X = this.X, Y = this.Y, V = this.V, N = this.N, mark = this.mark;
    const px = X[pi], py = Y[pi];
    const t0 = this.locate(px, py);
    for (let k = 0; k < 3; k++) {
      const v = V[3 * t0 + k];
      if (Math.abs(X[v] - px) <= this.dupTol && Math.abs(Y[v] - py) <= this.dupTol) return v;
    }
    const id = ++this.stamp;
    let cav = [t0];
    mark[t0] = id;
    for (let i = 0; i < cav.length; i++) {
      const c = cav[i];
      for (let e = 0; e < 3; e++) {
        const n = N[3 * c + e];
        if (n >= 0 && mark[n] !== id && this.inCircle(n, px, py)) { mark[n] = id; cav.push(n); }
      }
    }
    // Sternförmigkeit der Kavität sicherstellen (Rundungsfehler bei kozirkulären Punkten)
    let bnd = [];
    for (let guard = 0; ; guard++) {
      if (guard > 200) throw new MeshError('Triangulierung fehlgeschlagen (Kavität).');
      bnd = [];
      let bad = -1, badN = -1;
      for (let i = 0; i < cav.length && bad < 0; i++) {
        const c = cav[i];
        for (let e = 0; e < 3; e++) {
          const n = N[3 * c + e];
          if (n >= 0 && mark[n] === id) continue;
          const a = V[3 * c + (e + 1) % 3], b = V[3 * c + (e + 2) % 3];
          if (this.orient(a, b, px, py) <= this.eps) { bad = c; badN = n; break; }
          bnd.push(c, e, n, a, b);
        }
      }
      if (bad < 0) break;
      if (bad !== t0) {
        mark[bad] = 0;
        // Zusammenhang ab t0 wiederherstellen
        const keep = [t0];
        const seen = new Set(keep);
        for (let i = 0; i < keep.length; i++) {
          const c = keep[i];
          for (let e = 0; e < 3; e++) {
            const n = N[3 * c + e];
            if (n >= 0 && mark[n] === id && !seen.has(n)) { seen.add(n); keep.push(n); }
          }
        }
        for (const c of cav) if (!seen.has(c)) mark[c] = 0;
        cav = keep;
      } else if (badN >= 0) {
        mark[badN] = id;
        cav.push(badN);
      } else {
        throw new MeshError('Triangulierung fehlgeschlagen (Punkt ausserhalb).');
      }
    }
    const nb = bnd.length / 5;
    const outerE = new Int32Array(nb);
    for (let i = 0; i < nb; i++) {
      const c = bnd[5 * i], n = bnd[5 * i + 2];
      outerE[i] = -1;
      if (n >= 0) for (let e = 0; e < 3; e++) if (N[3 * n + e] === c) { outerE[i] = e; break; }
    }
    const slots = cav.slice();
    while (slots.length < nb) slots.push(this.newTri());
    const V2 = this.V, N2 = this.N; // nach evtl. Vergrösserung
    const start = new Map(), end = new Map();
    for (let i = 0; i < nb; i++) {
      const T = slots[i];
      const n = bnd[5 * i + 2], a = bnd[5 * i + 3], b = bnd[5 * i + 4];
      V2[3 * T] = a; V2[3 * T + 1] = b; V2[3 * T + 2] = pi;
      N2[3 * T + 2] = n;
      if (n >= 0 && outerE[i] >= 0) N2[3 * n + outerE[i]] = T;
      this.alive[T] = 1;
      start.set(a, T); end.set(b, T);
    }
    for (let i = 0; i < nb; i++) {
      const T = slots[i];
      const a = V2[3 * T], b = V2[3 * T + 1];
      N2[3 * T] = start.get(b) ?? -1;
      N2[3 * T + 1] = end.get(a) ?? -1;
    }
    for (let i = nb; i < slots.length; i++) { this.alive[slots[i]] = 0; this.free.push(slots[i]); }
    this.last = slots[0];
    return pi;
  }

  edgeSet() {
    const s = new Set();
    const V = this.V;
    for (let t = 0; t < this.nt; t++) {
      if (!this.alive[t]) continue;
      for (let e = 0; e < 3; e++) {
        const a = V[3 * t + e], b = V[3 * t + (e + 1) % 3];
        s.add(a < b ? a * 4194304 + b : b * 4194304 + a);
      }
    }
    return s;
  }
}

const ekey = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);

// ------------------------------------------------------------------ PSLG

function buildPSLG(outlines, holes, segments, points, tol) {
  const raw = [];
  const ringKind = [];
  const addRing = (ring, kind) => {
    for (let i = 0, n = ring.length; i < n; i++) raw.push({ a: ring[i], b: ring[(i + 1) % n], kind });
  };
  outlines.forEach((o) => addRing(o, 0));
  holes.forEach((h) => addRing(h, 1));
  ringKind.push(raw.length);
  for (const s of segments) {
    if (Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > tol) raw.push({ a: s[0], b: s[1], kind: 2 });
  }
  const splits = raw.map(() => [0, 1]);
  const projT = (p, s) => {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    return ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / (dx * dx + dy * dy);
  };
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      const si = raw[i], sj = raw[j];
      const r = segIntersect(si.a, si.b, sj.a, sj.b, tol);
      if (!r) continue;
      if (r.collinear) {
        for (const p of [sj.a, sj.b]) { const t = projT(p, si); if (t > 0 && t < 1) splits[i].push(t); }
        for (const p of [si.a, si.b]) { const t = projT(p, sj); if (t > 0 && t < 1) splits[j].push(t); }
      } else {
        splits[i].push(r.t);
        splits[j].push(r.u);
      }
    }
  }
  for (const p of points) {
    for (let i = 0; i < raw.length; i++) {
      const s = raw[i];
      const d = distPointSeg(p[0], p[1], s.a[0], s.a[1], s.b[0], s.b[1]);
      if (d.d < tol && d.t > 0 && d.t < 1) splits[i].push(d.t);
    }
  }
  // Knoten (mit Toleranz zusammengefasst)
  const V = [];
  const findOrAdd = (x, y) => {
    for (let k = 0; k < V.length; k++) if (Math.abs(V[k][0] - x) < tol && Math.abs(V[k][1] - y) < tol) return k;
    V.push([x, y]);
    return V.length - 1;
  };
  const sub = new Map();
  raw.forEach((s, i) => {
    const ts = splits[i].sort((p, q) => p - q);
    let prev = -1;
    for (const t of ts) {
      const x = s.a[0] + (s.b[0] - s.a[0]) * t, y = s.a[1] + (s.b[1] - s.a[1]) * t;
      const k = findOrAdd(t === 0 ? s.a[0] : t === 1 ? s.b[0] : x, t === 0 ? s.a[1] : t === 1 ? s.b[1] : y);
      if (prev >= 0 && k !== prev) {
        const key = ekey(prev, k);
        const old = sub.get(key);
        if (!old) sub.set(key, { a: prev, b: k, kind: s.kind });
        else if (s.kind < old.kind) old.kind = s.kind;
      }
      prev = k;
    }
  });
  const pointIdx = [];
  for (const p of points) pointIdx.push(findOrAdd(p[0], p[1]));
  return { V, sub: [...sub.values()], pointIdx };
}

// ------------------------------------------------------------------ Hauptfunktion

/**
 * Erzeugt ein Dreiecksnetz.
 * opts: {outline:[[x,y],…] bzw. outlines:[Ring,…] (Vereinigung mehrerer Platten), holes:[[[x,y],…],…], segments:[[[x1,y1],[x2,y2]],…], points:[[x,y],…],
 *        size, smooth=4, maxNodes=20000, refine:[{x, y, r0, s0}] (Verfeinerung: Netzweite s0 bis Radius r0, dann linear wachsend)}
 * Rückgabe: {x, y (Float64Array), tri (Int32Array, 3 je Dreieck, Gegenuhrzeigersinn), nNodes, nTri,
 *            fixed (Uint8Array: Knoten auf Rand/Zwangslinie/Zwangspunkt), quality, dropped}
 */
export function generateMesh(opts) {
  const size = Number(opts.size);
  if (!(size > 0)) throw new MeshError('Netzweite muss grösser als 0 sein.');
  // Gebiet: Vereinigung aller Plattenpolygone (opts.outlines) bzw. ein einzelner Rand (opts.outline)
  const raw = (opts.outlines || [opts.outline]).map((o) => cleanPolygon(o)).filter((o) => o.length > 0);
  if (!raw.length || raw.every((o) => o.length < 3)) throw new MeshError('Der Plattenrand benötigt mindestens 3 Punkte.');
  const bb = bboxOf(raw.flat());
  const L = Math.max(bb.w, bb.h);
  const tol = Math.max(1e-9, 1e-7 * L);
  const outlines = [];
  for (let o of raw) {
    if (o.length < 3) throw new MeshError('Jede Platte benötigt mindestens 3 Eckpunkte.');
    const a = signedArea(o);
    if (!(Math.abs(a) > 1e-8 * L * L)) throw new MeshError('Ein Plattenrand umschliesst keine Fläche.');
    if (a < 0) o = o.slice().reverse();
    if (polygonSelfIntersects(o, tol)) throw new MeshError('Ein Plattenrand überschneidet sich selbst – Eckpunkte der Reihe nach entlang des Randes setzen.');
    outlines.push(o);
  }
  const inDom = (x, y) => inUnion(x, y, outlines, holes);
  const holes = [];
  for (const h0 of opts.holes || []) {
    let h = cleanPolygon(h0);
    if (h.length < 3 || Math.abs(signedArea(h)) < 1e-10 * L * L) continue;
    if (signedArea(h) > 0) h = h.slice().reverse();
    if (polygonSelfIntersects(h, tol)) throw new MeshError('Eine Öffnung überschneidet sich selbst.');
    for (const p of h) {
      if (!inUnion(p[0], p[1], outlines, []) && !onAnyRing(p[0], p[1], outlines, tol)) throw new MeshError('Eine Öffnung liegt (teilweise) ausserhalb der Platte.');
    }
    holes.push(h);
  }
  // Nettofläche (Platten innerhalb anderer Platten zählen nicht doppelt)
  let netArea = 0;
  outlines.forEach((o, i) => {
    const c = o.reduce((s, q) => [s[0] + q[0] / o.length, s[1] + q[1] / o.length], [0, 0]);
    const A = Math.abs(signedArea(o));
    const nested = outlines.some((q, j) => j !== i && Math.abs(signedArea(q)) > A && pointInPolygon(c[0], c[1], q));
    if (!nested) netArea += A;
  });
  for (const h of holes) netArea -= Math.abs(signedArea(h));
  if (netArea <= 0) throw new MeshError('Die Öffnungen überdecken die ganze Platte.');
  const maxNodes = opts.maxNodes || 20000;
  const est = netArea / (SQ3_2 * size * size);
  if (est > maxNodes) throw new MeshError(`Netz zu fein: ca. ${Math.round(est)} Knoten (max. ${maxNodes}). Bitte die Netzweite vergrössern.`);

  // Zwangspunkte im Gebiet
  const dropped = [];
  const points = [];
  for (const p of opts.points || []) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (inDom(p[0], p[1]) || onAnyRing(p[0], p[1], outlines, tol) || holes.some((h) => onRing(p, h, tol))) points.push([p[0], p[1]]);
    else dropped.push(p);
  }
  const segments = (opts.segments || []).filter((s) => s && s.length === 2 && s.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));

  // 1. PSLG
  const { V, sub } = buildPSLG(outlines, holes, segments, points, tol);
  // Zwangsstrecken ausserhalb des Gebietes entfernen
  const subs = sub.filter((s) => {
    if (s.kind < 2) return true;
    const a = V[s.a], b = V[s.b];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    return inDom(mx, my);
  });

  // 2. Unterteilung
  const X = [], Y = [], fixed = [];
  // Superdreieck (Indizes 0..2)
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, M = Math.max(L, size) * 1.0;
  X.push(cx - 20 * M, cx + 20 * M, cx); Y.push(cy - M, cy - M, cy + 20 * M); fixed.push(1, 1, 1);
  const OFF = 3;
  const used = new Uint8Array(V.length);
  for (const s of subs) { used[s.a] = 1; used[s.b] = 1; }
  const pslgMap = new Int32Array(V.length).fill(-1);
  for (let k = 0; k < V.length; k++) {
    // nur Knoten, die auf Strecken liegen oder Zwangspunkte im Gebiet sind
    const isPoint = points.some((p) => Math.abs(p[0] - V[k][0]) < tol && Math.abs(p[1] - V[k][1]) < tol);
    if (!used[k] && !isPoint) continue;
    pslgMap[k] = X.length;
    X.push(V[k][0]); Y.push(V[k][1]); fixed.push(1);
  }
  // Lokale Netzweite: Verfeinerungszonen (z.B. um Stützen) mit linearem Übergang zur Grundnetzweite
  const GRAD = 0.4;
  const zones = (opts.refine || []).filter((z) => Number.isFinite(z.x) && Number.isFinite(z.y) && z.s0 > 0 && z.s0 < size * 0.95)
    .map((z) => ({ x: z.x, y: z.y, r0: Math.max(0, z.r0 || 0), s0: Math.max(z.s0, size / 12) }));
  const hAt = (px, py) => {
    let hh = size;
    for (const z of zones) {
      const d = Math.hypot(px - z.x, py - z.y);
      const v = z.s0 + GRAD * Math.max(0, d - z.r0);
      if (v < hh) hh = v;
    }
    return hh;
  };

  let req = [];
  for (const s of subs) {
    const a = V[s.a], b = V[s.b];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Teilung nach lokaler Netzweite: gleiche Schritte im Integral ∫ ds / h(s)
    let ts;
    if (!zones.length) {
      const n = Math.max(1, Math.ceil(len / size - 1e-6));
      ts = Array.from({ length: n - 1 }, (_, k) => (k + 1) / n);
    } else {
      const M = Math.max(16, Math.min(4000, Math.ceil(len / (size / 12) * 2)));
      const cum = new Float64Array(M + 1);
      for (let k = 1; k <= M; k++) {
        const tm = (k - 0.5) / M;
        cum[k] = cum[k - 1] + (len / M) / hAt(a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm);
      }
      const total = cum[M];
      const n = Math.max(1, Math.ceil(total - 1e-6));
      ts = [];
      let j = 1;
      for (let k = 1; k < n; k++) {
        const target = total * k / n;
        while (j < M && cum[j] < target) j++;
        const f = (target - cum[j - 1]) / Math.max(1e-300, cum[j] - cum[j - 1]);
        ts.push((j - 1 + f) / M);
      }
    }
    let prev = pslgMap[s.a];
    for (const t of ts) {
      X.push(a[0] + (b[0] - a[0]) * t); Y.push(a[1] + (b[1] - a[1]) * t); fixed.push(1);
      req.push([prev, X.length - 1]);
      prev = X.length - 1;
    }
    req.push([prev, pslgMap[s.b]]);
  }

  // Innere Punkte auf versetztem Raster
  const dmin = 0.6 * size;
  const segList = subs.map((s) => [V[s.a][0], V[s.a][1], V[s.b][0], V[s.b][1]]);
  // Raster für schnelle Abstandsabfrage der Strecken
  const cell = Math.max(size, L / 200);
  const gx0 = bb.x0 - cell, gy0 = bb.y0 - cell;
  const gnx = Math.ceil((bb.w + 2 * cell) / cell) + 1, gny = Math.ceil((bb.h + 2 * cell) / cell) + 1;
  const grid = new Map();
  const gkey = (i, j) => i * 100003 + j;
  segList.forEach((s, idx) => {
    const i0 = Math.floor((Math.min(s[0], s[2]) - dmin - gx0) / cell), i1 = Math.floor((Math.max(s[0], s[2]) + dmin - gx0) / cell);
    const j0 = Math.floor((Math.min(s[1], s[3]) - dmin - gy0) / cell), j1 = Math.floor((Math.max(s[1], s[3]) + dmin - gy0) / cell);
    for (let i = Math.max(0, i0); i <= Math.min(gnx, i1); i++) {
      for (let j = Math.max(0, j0); j <= Math.min(gny, j1); j++) {
        const k = gkey(i, j);
        let arr = grid.get(k);
        if (!arr) grid.set(k, arr = []);
        arr.push(idx);
      }
    }
  });
  const nearConstraint = (x, y, dm = dmin) => {
    const arr = grid.get(gkey(Math.floor((x - gx0) / cell), Math.floor((y - gy0) / cell)));
    if (arr) {
      for (const idx of arr) {
        const s = segList[idx];
        if (distPointSeg(x, y, s[0], s[1], s[2], s[3]).d < dm) return true;
      }
    }
    for (const p of points) if (Math.hypot(p[0] - x, p[1] - y) < dm) return true;
    return false;
  };

  // Ringe in den Verfeinerungszonen
  const extra = [];
  for (const z of zones) {
    let sk = z.s0, r = z.r0 + 0.9 * z.s0, ring = 0;
    while (sk < 0.9 * size && ring < 60) {
      const nk = Math.max(6, Math.round(2 * Math.PI * r / sk));
      const phase = (ring & 1) ? Math.PI / nk : 0;
      for (let k = 0; k < nk; k++) {
        const a = phase + 2 * Math.PI * k / nk;
        const px = z.x + r * Math.cos(a), py = z.y + r * Math.sin(a);
        if (!inDom(px, py)) continue;
        const hl = hAt(px, py);
        if (nearConstraint(px, py, 0.6 * hl)) continue;
        let close = false;
        for (const e of extra) if (Math.hypot(e[0] - px, e[1] - py) < 0.6 * Math.min(hl, e[2])) { close = true; break; }
        if (close) continue;
        extra.push([px, py, hl]);
      }
      r += SQ3_2 * sk;
      sk = z.s0 + GRAD * Math.max(0, r - z.r0);
      ring++;
    }
    z.rEnd = r;
  }
  for (const e of extra) { X.push(e[0]); Y.push(e[1]); fixed.push(0); }

  const dy = size * SQ3_2;
  const ny = Math.ceil(bb.h / dy) + 2;
  const nx = Math.ceil(bb.w / size) + 2;
  const yStart = bb.y0 + (bb.h - Math.floor(bb.h / dy) * dy) / 2;
  const xStart = bb.x0 + (bb.w - Math.floor(bb.w / size) * size) / 2;
  for (let j = -1; j < ny; j++) {
    const y = yStart + j * dy;
    if (y <= bb.y0 || y >= bb.y1) continue;
    const off = (j & 1) ? size / 2 : 0;
    for (let i = -1; i < nx; i++) {
      const x = xStart + off + i * size;
      if (x <= bb.x0 || x >= bb.x1) continue;
      if (!inDom(x, y)) continue;
      if (nearConstraint(x, y)) continue;
      let inZone = false;
      for (const z of zones) if (Math.hypot(x - z.x, y - z.y) < z.rEnd + 0.25 * size) { inZone = true; break; }
      if (inZone) continue;
      X.push(x); Y.push(y); fixed.push(0);
    }
  }

  // 3. Triangulierung
  const scale = Math.max(L, size);
  const dt = new Delaunay(X, Y, scale);
  dt.init(0, 1, 2);
  const order = [];
  for (let k = OFF; k < X.length; k++) order.push(k);
  const keyOf = new Float64Array(X.length);
  const sx = 65535 / Math.max(bb.w, 1e-9), sy = 65535 / Math.max(bb.h, 1e-9);
  for (const k of order) {
    const ix = Math.max(0, Math.min(65535, Math.round((X[k] - bb.x0) * sx)));
    const iy = Math.max(0, Math.min(65535, Math.round((Y[k] - bb.y0) * sy)));
    keyOf[k] = hilbertIndex(ix, iy);
  }
  order.sort((a, b) => keyOf[a] - keyOf[b]);
  const alias = new Int32Array(X.length).map((_, i) => i);
  for (const k of order) {
    const r = dt.insert(k);
    if (r !== k) alias[k] = r;
  }
  req = req.map(([a, b]) => [alias[a], alias[b]]).filter(([a, b]) => a !== b);

  // 4. Konformität: fehlende Zwangskanten durch Halbierung erzwingen
  for (let iter = 0; ; iter++) {
    const es = dt.edgeSet();
    const missing = [];
    const keep = [];
    for (const e of req) (es.has(ekey(e[0], e[1])) ? keep : missing).push(e);
    if (!missing.length) break;
    if (iter > 40) throw new MeshError('Netzerzeugung: Zwangslinien konnten nicht eingehalten werden (sehr spitze Winkel oder sehr nahe Linien?).');
    req = keep;
    for (const [a, b] of missing) {
      const m = X.length;
      X.push((X[a] + X[b]) / 2); Y.push((Y[a] + Y[b]) / 2); fixed.push(1);
      const r = dt.insert(m);
      if (r !== m) { req.push([a, r], [r, b]); continue; }
      req.push([a, m], [m, b]);
    }
  }

  // 5. Dreiecke im Gebiet
  const triList = [];
  const V3 = dt.V;
  for (let t = 0; t < dt.nt; t++) {
    if (!dt.alive[t]) continue;
    const a = V3[3 * t], b = V3[3 * t + 1], c = V3[3 * t + 2];
    if (a < OFF || b < OFF || c < OFF) continue;
    const gx = (X[a] + X[b] + X[c]) / 3, gy = (Y[a] + Y[b] + Y[c]) / 3;
    if (!inDom(gx, gy)) continue;
    const ar = (X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a]);
    if (ar <= 0) continue; // entartet
    triList.push(a, b, c);
  }
  if (!triList.length) throw new MeshError('Netzerzeugung ergab keine Elemente. Geometrie und Netzweite prüfen.');
  const newIdx = new Int32Array(X.length).fill(-1);
  let nn = 0;
  for (const v of triList) if (newIdx[v] < 0) newIdx[v] = nn++;
  const x = new Float64Array(nn), y = new Float64Array(nn), fx = new Uint8Array(nn);
  for (let k = 0; k < X.length; k++) {
    const j = newIdx[k];
    if (j < 0) continue;
    x[j] = X[k]; y[j] = Y[k]; fx[j] = fixed[k];
  }
  const tri = Int32Array.from(triList, (v) => newIdx[v]);
  const reqSet = new Set();
  for (const [a, b] of req) if (newIdx[a] >= 0 && newIdx[b] >= 0) reqSet.add(ekey(newIdx[a], newIdx[b]));

  const mesh = { x, y, tri, nNodes: nn, nTri: tri.length / 3, fixed: fx, size, dropped };

  // 6. Glättung und Kantentausch
  const iters = opts.smooth ?? 4;
  if (iters > 0) {
    smooth(mesh, iters);
    for (let p = 0; p < 8; p++) if (!flipPass(mesh, reqSet)) break;
    smooth(mesh, Math.max(1, iters >> 1));
  }
  mesh.quality = meshQuality(mesh);
  return mesh;
}

function onRing(p, ring, tol) {
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (distPointSeg(p[0], p[1], a[0], a[1], b[0], b[1]).d < tol) return true;
  }
  return false;
}

/** Knotennachbarn und anliegende Dreiecke. */
export function adjacency(mesh) {
  const { nNodes, tri } = mesh;
  const nbr = Array.from({ length: nNodes }, () => []);
  const inc = Array.from({ length: nNodes }, () => []);
  for (let t = 0, nt = tri.length / 3; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tri[3 * t + e], b = tri[3 * t + (e + 1) % 3];
      if (!nbr[a].includes(b)) nbr[a].push(b);
      if (!nbr[b].includes(a)) nbr[b].push(a);
      inc[a].push(t);
    }
  }
  return { nbr, inc };
}

function smooth(mesh, iters) {
  const { x, y, tri, fixed } = mesh;
  const { nbr, inc } = adjacency(mesh);
  const q = (t) => triQuality(x[tri[3 * t]], y[tri[3 * t]], x[tri[3 * t + 1]], y[tri[3 * t + 1]], x[tri[3 * t + 2]], y[tri[3 * t + 2]]);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < mesh.nNodes; i++) {
      if (fixed[i] || !nbr[i].length) continue;
      let sx = 0, sy = 0;
      for (const j of nbr[i]) { sx += x[j]; sy += y[j]; }
      const nx = sx / nbr[i].length, ny = sy / nbr[i].length;
      let qOld = Infinity;
      for (const t of inc[i]) qOld = Math.min(qOld, q(t));
      const ox = x[i], oy = y[i];
      x[i] = nx; y[i] = ny;
      let qNew = Infinity;
      for (const t of inc[i]) qNew = Math.min(qNew, q(t));
      if (!(qNew > 0.02) || qNew < qOld - 0.02) { x[i] = ox; y[i] = oy; }
    }
  }
}

/** Ein Durchgang Delaunay-Kantentausch (ohne Zwangskanten). Gibt true zurück, wenn getauscht wurde. */
function flipPass(mesh, reqSet) {
  const { x, y, tri } = mesh;
  const nt = tri.length / 3;
  const map = new Map();
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const p = tri[3 * t + (e + 1) % 3], q = tri[3 * t + (e + 2) % 3];
      const k = ekey(p, q);
      const v = map.get(k);
      if (v === undefined) map.set(k, [t, e]);
      else v.push(t, e);
    }
  }
  const touched = new Uint8Array(nt);
  let flipped = false;
  for (const [k, v] of map) {
    if (v.length < 4 || reqSet.has(k)) continue;
    const [t1, e1, t2, e2] = v;
    if (touched[t1] || touched[t2]) continue;
    const c = tri[3 * t1 + e1], p = tri[3 * t1 + (e1 + 1) % 3], qv = tri[3 * t1 + (e1 + 2) % 3];
    const d = tri[3 * t2 + e2];
    // inCircle(c, p, q; d)
    const adx = x[c] - x[d], ady = y[c] - y[d];
    const bdx = x[p] - x[d], bdy = y[p] - y[d];
    const cdx = x[qv] - x[d], cdy = y[qv] - y[d];
    const det = (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy)
      + (bdx * bdx + bdy * bdy) * (cdx * ady - adx * cdy)
      + (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady);
    const scale = (adx * adx + ady * ady + bdx * bdx + bdy * bdy + cdx * cdx + cdy * cdy) ** 2;
    if (!(det > 1e-10 * scale)) continue;
    const o1 = (x[p] - x[c]) * (y[d] - y[c]) - (x[d] - x[c]) * (y[p] - y[c]);
    const o2 = (x[qv] - x[d]) * (y[c] - y[d]) - (x[c] - x[d]) * (y[qv] - y[d]);
    if (!(o1 > 0 && o2 > 0)) continue;
    const qOld = Math.min(triQuality(x[c], y[c], x[p], y[p], x[qv], y[qv]), triQuality(x[d], y[d], x[qv], y[qv], x[p], y[p]));
    const qNew = Math.min(triQuality(x[c], y[c], x[p], y[p], x[d], y[d]), triQuality(x[d], y[d], x[qv], y[qv], x[c], y[c]));
    if (qNew <= qOld) continue;
    tri[3 * t1] = c; tri[3 * t1 + 1] = p; tri[3 * t1 + 2] = d;
    tri[3 * t2] = d; tri[3 * t2 + 1] = qv; tri[3 * t2 + 2] = c;
    touched[t1] = 1; touched[t2] = 1;
    flipped = true;
  }
  return flipped;
}

/** Netzqualität: minimaler Winkel, minimale/mittlere Formqualität, Anzahl invertierter Elemente. */
export function meshQuality(mesh) {
  const { x, y, tri } = mesh;
  let minAngle = 180, minQ = 1, sumQ = 0, inverted = 0, poor = 0, area = 0;
  const nt = tri.length / 3;
  for (let t = 0; t < nt; t++) {
    const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
    const ar = ((x[b] - x[a]) * (y[c] - y[a]) - (x[c] - x[a]) * (y[b] - y[a])) / 2;
    if (ar <= 0) inverted++;
    area += ar;
    const q = triQuality(x[a], y[a], x[b], y[b], x[c], y[c]);
    const ang = triMinAngle(x[a], y[a], x[b], y[b], x[c], y[c]);
    minQ = Math.min(minQ, q); sumQ += q;
    minAngle = Math.min(minAngle, ang);
    if (ang < 20) poor++;
  }
  return { minAngle, minQ, meanQ: sumQ / Math.max(1, nt), inverted, poor, area };
}

/** Randkanten (nur einem Dreieck zugehörig) als Liste [a,b,…]. */
export function boundaryEdges(mesh) {
  const { tri } = mesh;
  const cnt = new Map();
  for (let t = 0, nt = tri.length / 3; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tri[3 * t + e], b = tri[3 * t + (e + 1) % 3];
      const k = ekey(a, b);
      const v = cnt.get(k);
      if (v) v[2]++; else cnt.set(k, [a, b, 1]);
    }
  }
  const out = [];
  for (const v of cnt.values()) if (v[2] === 1) out.push(v[0], v[1]);
  return out;
}

/** Alle Netzkanten als Liste [a,b,…]. */
export function allEdges(mesh) {
  const { tri } = mesh;
  const s = new Set();
  const out = [];
  for (let t = 0, nt = tri.length / 3; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tri[3 * t + e], b = tri[3 * t + (e + 1) % 3];
      const k = ekey(a, b);
      if (s.has(k)) continue;
      s.add(k);
      out.push(a, b);
    }
  }
  return out;
}

/** Prüft, ob die Kante a–b im Netz enthalten ist. */
export function hasEdge(mesh, a, b) {
  const { tri } = mesh;
  for (let t = 0, nt = tri.length / 3; t < nt; t++) {
    let fa = false, fb = false;
    for (let e = 0; e < 3; e++) { const v = tri[3 * t + e]; if (v === a) fa = true; if (v === b) fb = true; }
    if (fa && fb) return true;
  }
  return false;
}

/** Knoten auf einer Strecke (Abstand < tol), sortiert nach Parameter t. → [{node, t, s}] */
export function nodesOnSegment(mesh, ax, ay, bx, by, tol) {
  const { x, y, nNodes } = mesh;
  const L = Math.hypot(bx - ax, by - ay);
  const out = [];
  if (L < 1e-12) return out;
  const x0 = Math.min(ax, bx) - tol, x1 = Math.max(ax, bx) + tol, y0 = Math.min(ay, by) - tol, y1 = Math.max(ay, by) + tol;
  for (let i = 0; i < nNodes; i++) {
    if (x[i] < x0 || x[i] > x1 || y[i] < y0 || y[i] > y1) continue;
    const r = distPointSeg(x[i], y[i], ax, ay, bx, by);
    if (r.d <= tol) out.push({ node: i, t: r.t, s: r.t * L });
  }
  out.sort((p, q) => p.t - q.t);
  return out;
}

/** Nächster Knoten zu (px,py). */
export function nearestNode(mesh, px, py) {
  const { x, y, nNodes } = mesh;
  let best = -1, bd = Infinity;
  for (let i = 0; i < nNodes; i++) {
    const d = (x[i] - px) ** 2 + (y[i] - py) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { node: best, dist: Math.sqrt(bd) };
}

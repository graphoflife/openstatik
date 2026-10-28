// Querschnittsanalyse für beliebige polygonale Querschnitte mit Bewehrung (Fasermodell, DOM-frei)
//
// Koordinaten:  y nach rechts, z nach oben, Einheit m (bezogen auf frei wählbaren Bezugspunkt).
// Dehnungsebene: ε(y,z) = e0 + ky·y + kz·z   (Druck negativ)
// Schnittgrössen (Rechtsschraubenregel, x zeigt aus der Querschnittsebene):
//   N  = ∫σ dA            [kN]  (Zug positiv)
//   My = ∫σ·z dA          [kNm] (positiv → Zug oben)
//   Mz = −∫σ·y dA         [kNm] (positiv → Zug links, d.h. bei y < 0)
// Für einachsige Biegung "Zug unten positiv" gilt M = −My (siehe uniaxial-Hilfen).
// Spannungen der Werkstoffgesetze in MPa; MPa·m² = MN → Faktor 1000 für kN.

import { solve } from './linalg.js';

const K = 1000; // MN → kN

// ------------------------------------------------------------------ Polygon-Geometrie

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [y1, z1] = pts[i], [y2, z2] = pts[(i + 1) % n];
    a += y1 * z2 - y2 * z1;
  }
  return a / 2;
}

/**
 * Querschnittswerte eines Polygons: A, Schwerpunkt (cy, cz), Trägheitsmomente um Schwerachsen
 * Iy = ∫z² dA, Iz = ∫y² dA, Iyz = ∫y·z dA. Orientierung beliebig.
 */
export function polygonProps(pts) {
  let A = 0, Qy = 0, Qz = 0, Iyy = 0, Izz = 0, Iyz = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [y1, z1] = pts[i], [y2, z2] = pts[(i + 1) % n];
    const c = y1 * z2 - y2 * z1;
    A += c;
    Qz += (y1 + y2) * c;
    Qy += (z1 + z2) * c;
    Izz += (y1 * y1 + y1 * y2 + y2 * y2) * c;
    Iyy += (z1 * z1 + z1 * z2 + z2 * z2) * c;
    Iyz += (y1 * z2 + 2 * y1 * z1 + 2 * y2 * z2 + y2 * z1) * c;
  }
  const sg = A < 0 ? -1 : 1;
  A = sg * A / 2; Qz = sg * Qz / 6; Qy = sg * Qy / 6; Izz = sg * Izz / 12; Iyy = sg * Iyy / 12; Iyz = sg * Iyz / 24;
  if (A === 0) return { A: 0, cy: 0, cz: 0, Iy: 0, Iz: 0, Iyz: 0, Iy0: 0, Iz0: 0, Iyz0: 0 };
  const cy = Qz / A, cz = Qy / A;
  return { A, cy, cz, Iy: Iyy - A * cz * cz, Iz: Izz - A * cy * cy, Iyz: Iyz - A * cy * cz, Iy0: Iyy, Iz0: Izz, Iyz0: Iyz, Qy, Qz };
}

export function pointInPolygon([y, z], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, zi] = pts[i], [yj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && y < (yj - yi) * (z - zi) / (zj - zi) + yi) inside = !inside;
  }
  return inside;
}

/** Ear-Clipping-Triangulierung eines einfachen Polygons. Liefert Dreiecke als Punkt-Tripel. */
export function triangulate(pts) {
  let P = pts.map((p) => [p[0], p[1]]);
  // doppelte Endpunkte entfernen
  if (P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P.pop();
  if (signedArea(P) < 0) P.reverse();
  const idx = P.map((_, i) => i);
  const tris = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => cross(a, b, p) >= -1e-14 && cross(b, c, p) >= -1e-14 && cross(c, a, p) >= -1e-14;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
      const a = P[ia], b = P[ib], c = P[ic];
      if (cross(a, b, c) <= 1e-14) continue; // konkav oder entartet
      let ear = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inTri(P[j], a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) { // entartetes Polygon: kleinsten Rest abbrechen
      idx.splice(0, 1);
    }
  }
  if (idx.length === 3) tris.push([P[idx[0]], P[idx[1]], P[idx[2]]]);
  return tris.filter((t) => Math.abs(cross(t[0], t[1], t[2])) > 1e-16);
}

function subdivide(tri, h, out) {
  const [a, b, c] = tri;
  const lab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const lbc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const lca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  if (Math.max(lab, lbc, lca) <= h) { out.push(tri); return; }
  const m = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const ab = m(a, b), bc = m(b, c), ca = m(c, a);
  subdivide([a, ab, ca], h, out);
  subdivide([ab, b, bc], h, out);
  subdivide([ca, bc, c], h, out);
  subdivide([ab, bc, ca], h, out);
}

/** Kreis- oder Ringpolygon. */
export function circlePolygon(cy, cz, r, n = 48) {
  return Array.from({ length: n }, (_, i) => [cy + r * Math.cos(2 * Math.PI * i / n), cz + r * Math.sin(2 * Math.PI * i / n)]);
}

export function rectPolygon(b, hgt, cy = 0, cz = 0) {
  return [[cy - b / 2, cz - hgt / 2], [cy + b / 2, cz - hgt / 2], [cy + b / 2, cz + hgt / 2], [cy - b / 2, cz + hgt / 2]];
}

// ------------------------------------------------------------------ Querschnittsmodell

/**
 * Baut das Fasermodell.
 * def: {
 *   regions: [{pts:[[y,z],…], law, hole:false}],   – Betonflächen (law aus concreteLaw), hole:true → Aussparung
 *   bars:    [{y, z, A [m²], law}],                 – Bewehrungsstäbe (law aus rebarLaw)
 *   mesh:    Fasergrösse [m] (Standard: max. Abmessung / 40),
 *   ref:     [y0, z0] Bezugspunkt (Standard: Schwerpunkt Bruttoquerschnitt),
 *   deductBars: true – Betonfläche an Stabstellen abziehen
 * }
 */
export function buildSection(def) {
  const regions = (def.regions || []).filter((r) => r.pts && r.pts.length >= 3);
  const solids = regions.filter((r) => !r.hole);
  if (!solids.length) throw new Error('Querschnitt ohne Fläche');
  // Bruttowerte
  let A = 0, Qy = 0, Qz = 0, Iy0 = 0, Iz0 = 0, Iyz0 = 0;
  let ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const r of regions) {
    const p = polygonProps(r.pts);
    const s = r.hole ? -1 : 1;
    A += s * p.A; Qy += s * p.Qy; Qz += s * p.Qz; Iy0 += s * p.Iy0; Iz0 += s * p.Iz0; Iyz0 += s * p.Iyz0;
    if (!r.hole) for (const [y, z] of r.pts) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
  }
  if (A <= 0) throw new Error('Querschnittsfläche ≤ 0');
  const cy = Qz / A, cz = Qy / A;
  const gross = { A, cy, cz, Iy: Iy0 - A * cz * cz, Iz: Iz0 - A * cy * cy, Iyz: Iyz0 - A * cy * cz, ymin, ymax, zmin, zmax, h: zmax - zmin, b: ymax - ymin };
  const ref = def.ref || [cy, cz];
  const mesh = def.mesh || Math.max(ymax - ymin, zmax - zmin) / 40;

  const laws = [];
  const lawIndex = (law) => { let i = laws.indexOf(law); if (i < 0) { laws.push(law); i = laws.length - 1; } return i; };
  const fy = [], fz = [], fA = [], fL = [], fBar = [];
  const defaultLaw = solids[0].law;
  for (const r of regions) {
    const law = r.law || defaultLaw;
    const li = lawIndex(law);
    const tris = [];
    for (const t of triangulate(r.pts)) subdivide(t, mesh, tris);
    for (const [a, b, c] of tris) {
      const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      fy.push((a[0] + b[0] + c[0]) / 3 - ref[0]);
      fz.push((a[1] + b[1] + c[1]) / 3 - ref[1]);
      fA.push(r.hole ? -ar : ar);
      fL.push(li);
      fBar.push(0);
    }
  }
  const bars = (def.bars || []).filter((b) => b.A > 0);
  for (const b of bars) {
    fy.push(b.y - ref[0]); fz.push(b.z - ref[1]); fA.push(b.A); fL.push(lawIndex(b.law)); fBar.push(1);
    if (def.deductBars !== false) {
      const host = solids.find((r) => pointInPolygon([b.y, b.z], r.pts)) && !regions.some((r) => r.hole && pointInPolygon([b.y, b.z], r.pts));
      if (host) {
        const reg = solids.find((r) => pointInPolygon([b.y, b.z], r.pts));
        fy.push(b.y - ref[0]); fz.push(b.z - ref[1]); fA.push(-b.A); fL.push(lawIndex(reg.law || defaultLaw)); fBar.push(0);
      }
    }
  }
  // Randpunkte des Betons (für Dehnungsgrenzen)
  const cVerts = [];
  for (const r of solids) for (const [y, z] of r.pts) cVerts.push([y - ref[0], z - ref[1]]);
  const concreteLaw = defaultLaw;
  const barLaw = bars[0]?.law || null;
  return {
    gross, ref, mesh,
    y: Float64Array.from(fy), z: Float64Array.from(fz), A: Float64Array.from(fA), law: Int32Array.from(fL), isBar: Uint8Array.from(fBar),
    laws, bars: bars.map((b) => ({ ...b, yr: b.y - ref[0], zr: b.z - ref[1] })), cVerts, concreteLaw, barLaw,
    nFibers: fy.length,
  };
}

/** Bewehrungsfläche gesamt [m²]. */
export function barArea(sec) { return sec.bars.reduce((s, b) => s + b.A, 0); }

// ------------------------------------------------------------------ Integration

/** Schnittgrössen für eine Dehnungsebene. */
export function resultants(sec, e0, ky, kz) {
  let N = 0, My = 0, Mz = 0;
  const { y, z, A, law, laws } = sec;
  for (let i = 0, n = sec.nFibers; i < n; i++) {
    const e = e0 + ky * y[i] + kz * z[i];
    const s = laws[law[i]].sigma(e) * A[i];
    N += s; My += s * z[i]; Mz -= s * y[i];
  }
  return { N: N * K, My: My * K, Mz: Mz * K };
}

function tangentMatrix(sec, e0, ky, kz, reg) {
  const T = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const { y, z, A, law, laws } = sec;
  for (let i = 0, n = sec.nFibers; i < n; i++) {
    const e = e0 + ky * y[i] + kz * z[i];
    let Et = laws[law[i]].tangent(e);
    if (reg) { const s = laws[law[i]].sigma(e); const Es = Math.abs(e) > 1e-12 ? s / e : Et; Et = Math.max(Et, Es, 0); }
    const k = Et * A[i] * K;
    if (k === 0) continue;
    const yy = y[i], zz = z[i];
    // d(N, My, Mz) / d(e0, ky, kz)
    T[0][0] += k; T[0][1] += k * yy; T[0][2] += k * zz;
    T[1][0] += k * zz; T[1][1] += k * yy * zz; T[1][2] += k * zz * zz;
    T[2][0] -= k * yy; T[2][1] -= k * yy * yy; T[2][2] -= k * yy * zz;
  }
  return T;
}

/** Dehnungen an massgebenden Stellen: minimale Betondehnung, extreme Stahldehnungen. */
export function strainExtremes(sec, e0, ky, kz) {
  let ecMin = Infinity, ecMax = -Infinity;
  for (const [y, z] of sec.cVerts) { const e = e0 + ky * y + kz * z; ecMin = Math.min(ecMin, e); ecMax = Math.max(ecMax, e); }
  let esMin = Infinity, esMax = -Infinity;
  for (const b of sec.bars) { const e = e0 + ky * b.yr + kz * b.zr; esMin = Math.min(esMin, e); esMax = Math.max(esMax, e); }
  return { ecMin, ecMax, esMin: sec.bars.length ? esMin : NaN, esMax: sec.bars.length ? esMax : NaN };
}

/**
 * Dehnungszustand für gegebene Schnittgrössen (Newton-Raphson mit Sekanten-Rückfall).
 * Rückgabe: {ok, e0, ky, kz, iter, ext (Dehnungsextreme), fail (Grenzdehnung überschritten), N, My, Mz}
 */
export function solveStrain(sec, N, My, Mz, opts = {}) {
  const target = [N, My, Mz];
  const scale = Math.max(1, Math.abs(N), Math.abs(My) / Math.max(sec.gross.h, 0.05), Math.abs(Mz) / Math.max(sec.gross.b, 0.05));
  let x = opts.start ? [...opts.start] : [-1e-5, 0, 0];
  // Startwert aus Anfangssteifigkeit
  if (!opts.start) {
    try {
      const T0 = tangentMatrix(sec, -1e-5, 0, 0, true);
      const r0 = resultants(sec, -1e-5, 0, 0);
      const dx = solve(T0, [target[0] - r0.N, target[1] - r0.My, target[2] - r0.Mz]);
      x = [-1e-5 + dx[0], dx[1], dx[2]];
    } catch { /* Startwert bleibt */ }
  }
  const resid = (v) => { const r = resultants(sec, v[0], v[1], v[2]); return [r.N - target[0], r.My - target[1], r.Mz - target[2]]; };
  const nrm = (r) => Math.hypot(r[0] / scale, r[1] / scale / Math.max(sec.gross.h, 0.05), r[2] / scale / Math.max(sec.gross.b, 0.05));
  let r = resid(x), rn = nrm(r);
  const tol = opts.tol ?? 1e-7;
  let iter = 0, ok = false;
  for (; iter < (opts.maxIter ?? 80); iter++) {
    if (rn < tol) { ok = true; break; }
    let dx;
    for (const reg of [false, true]) {
      try { dx = solve(tangentMatrix(sec, x[0], x[1], x[2], reg), r.map((v) => -v)); break; } catch { dx = null; }
    }
    if (!dx) break;
    // Liniensuche
    let a = 1, improved = false;
    for (let k = 0; k < 25; k++) {
      const xn = [x[0] + a * dx[0], x[1] + a * dx[1], x[2] + a * dx[2]];
      const rnw = resid(xn), rnn = nrm(rnw);
      if (rnn < rn * (1 - 1e-4 * a) || rnn < tol) { x = xn; r = rnw; rn = rnn; improved = true; break; }
      a *= 0.5;
    }
    if (!improved) break;
  }
  const ext = strainExtremes(sec, x[0], x[1], x[2]);
  const cl = sec.concreteLaw, bl = sec.barLaw;
  const fail = !ok || ext.ecMin < cl.epsMin * (1 + 1e-6) || (bl && (ext.esMax > bl.epsMax * (1 + 1e-6) || ext.esMin < bl.epsMin * (1 + 1e-6)));
  const res = resultants(sec, x[0], x[1], x[2]);
  return { ok, fail, e0: x[0], ky: x[1], kz: x[2], iter, ext, ...res };
}

/** Spannungen in allen Stäben und an den Betoneckpunkten für eine Dehnungsebene. */
export function stressesAt(sec, st) {
  const bars = sec.bars.map((b) => { const e = st.e0 + st.ky * b.yr + st.kz * b.zr; return { y: b.y, z: b.z, eps: e, sigma: b.law.sigma(e) }; });
  const verts = sec.cVerts.map(([y, z]) => { const e = st.e0 + st.ky * y + st.kz * z; return { y: y + sec.ref[0], z: z + sec.ref[1], eps: e, sigma: sec.concreteLaw.sigma(e) }; });
  return { bars, verts };
}

/** Nulllinie der Dehnungsebene als Punktepaar (in Querschnittskoordinaten) oder null. */
export function neutralAxis(sec, st) {
  const { e0, ky, kz } = st;
  if (Math.hypot(ky, kz) < 1e-14) return null;
  const g = sec.gross;
  const L = 2 * Math.hypot(g.b, g.h);
  // Punkt auf Linie: ky·y + kz·z = −e0
  const k2 = ky * ky + kz * kz;
  const p0 = [-e0 * ky / k2, -e0 * kz / k2];
  const d = [-kz / Math.sqrt(k2), ky / Math.sqrt(k2)];
  return [[p0[0] - d[0] * L + sec.ref[0], p0[1] - d[1] * L + sec.ref[1]], [p0[0] + d[0] * L + sec.ref[0], p0[1] + d[1] * L + sec.ref[1]]];
}

// ------------------------------------------------------------------ Tragwiderstand (Bruchzustand)

/**
 * Dehnungsebene im Bruchzustand für Richtung θ (Druckseite in Richtung n = (cosθ, sinθ)) und
 * Parameter t ∈ [0, 3]: 0 = reiner Zug … 3 = zentrischer Druck (Dehnungsbereiche nach Pivot-Methode).
 */
export function ultimatePlane(sec, theta, t) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const u = (y, z) => y * c + z * s;
  let uc = -Infinity, ub = Infinity;
  for (const [y, z] of sec.cVerts) { const v = u(y, z); uc = Math.max(uc, v); ub = Math.min(ub, v); }
  let us = Infinity;
  for (const b of sec.bars) us = Math.min(us, u(b.yr, b.zr));
  const cl = sec.concreteLaw;
  const ecu = -cl.epsMin, ec2 = cl.ec2;
  const eud = sec.barLaw ? sec.barLaw.epsMax : 0.01;
  if (!Number.isFinite(us) || us >= uc) us = ub;
  const hs = uc - us, h = uc - ub;
  let ea, ua, eb, ub2; // zwei Punkte (u, ε) der Ebene
  if (t <= 1) {
    ea = eud + t * (-ecu - eud); ua = uc; eb = eud; ub2 = us;
  } else if (t <= 2) {
    const esEnd = -ecu + ecu * hs / h; // Stahldehnung, wenn Betonunterkante ε = 0
    ea = -ecu; ua = uc; eb = eud + (t - 1) * (esEnd - eud); ub2 = us;
  } else {
    const uC = uc - (ecu - ec2) / ecu * h;
    const ebot = (t - 2) * -ec2;
    ea = -ec2; ua = uC; eb = ebot; ub2 = ub;
    if (Math.abs(ua - ub2) < 1e-12) { ua = uc; }
  }
  // ε(u) = e0 + k·u
  const k = (ea - eb) / (ua - ub2 || 1e-12);
  const e0 = ea - k * ua;
  return { e0, ky: k * c, kz: k * s };
}

/** Bruchschnittgrössen für Richtung θ und Parameter t. */
export function ultimateResultants(sec, theta, t) {
  const p = ultimatePlane(sec, theta, t);
  return { ...resultants(sec, p.e0, p.ky, p.kz), ...p, t };
}

/** Grenzwerte der Normalkraft: {Nt (Zug, >0), Nc (Druck, <0)}. */
export function axialCapacity(sec) {
  const Nt = ultimateResultants(sec, Math.PI / 2, 0).N;
  const Nc = ultimateResultants(sec, Math.PI / 2, 3).N;
  return { Nt, Nc };
}

/** Bruchmoment für Richtung θ bei gegebener Normalkraft N (Bisektion über t). null wenn N ausserhalb. */
export function capacityAtN(sec, theta, N) {
  let a = 0, b = 3;
  let fa = ultimateResultants(sec, theta, a).N - N, fb = ultimateResultants(sec, theta, b).N - N;
  if (fa < 0 || fb > 0) return null; // N(t) fällt mit t
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    const fm = ultimateResultants(sec, theta, m).N - N;
    if (fm > 0) { a = m; fa = fm; } else { b = m; fb = fm; }
    if (b - a < 1e-7) break;
  }
  return ultimateResultants(sec, theta, (a + b) / 2);
}

/**
 * N-M-Interaktion in der Ebene der Richtung θ (beide Biegerichtungen).
 * Liefert geschlossenes Polygon [{N, M, My, Mz}], M = Moment um die zu n senkrechte Achse,
 * positiv wenn Druck auf der Seite +n (für θ = 90°: M = −My, Zug unten positiv).
 */
export function interactionNM(sec, theta = Math.PI / 2, n = 60) {
  const out = [];
  const comp = (r, th) => -(Math.sin(th) * r.My) + Math.cos(th) * r.Mz;
  for (let i = 0; i <= n; i++) {
    const t = 3 * i / n;
    const r = ultimateResultants(sec, theta, t);
    out.push({ N: r.N, M: comp(r, theta), My: r.My, Mz: r.Mz, t });
  }
  for (let i = n; i >= 0; i--) {
    const t = 3 * i / n;
    const r = ultimateResultants(sec, theta + Math.PI, t);
    out.push({ N: r.N, M: comp(r, theta), My: r.My, Mz: r.Mz, t });
  }
  return out;
}

/** My-Mz-Interaktion bei Normalkraft N. Liefert [{My, Mz, theta}] (geschlossener Umlauf) oder [] wenn N ausserhalb. */
export function interactionMyMz(sec, N, nAngles = 72) {
  const out = [];
  for (let i = 0; i < nAngles; i++) {
    const th = 2 * Math.PI * i / nAngles;
    const r = capacityAtN(sec, th, N);
    if (r) out.push({ My: r.My, Mz: r.Mz, theta: th });
  }
  return out;
}

/**
 * Ausnutzung für Schnittgrössen (N, My, Mz) im Bruchzustand.
 * Bei konstantem N wird das Moment radial bis zum Interaktionsrand skaliert.
 * Rückgabe {eta, MyR, MzR, NR, curve}
 */
export function utilization(sec, N, My, Mz, nAngles = 96) {
  const { Nt, Nc } = axialCapacity(sec);
  // Ausnutzung aus Normalkraft allein (stetig für M → 0)
  const etaN = N >= 0 ? (Nt > 0 ? N / Nt : Infinity) : (Nc < 0 ? N / Nc : Infinity);
  if (N > Nt || N < Nc) {
    return { eta: etaN, etaN, etaM: Infinity, NR: N > 0 ? Nt : Nc, MyR: 0, MzR: 0, curve: [], outside: true, Nt, Nc };
  }
  const curve = interactionMyMz(sec, N, nAngles);
  if (curve.length < 3) return { eta: etaN, etaN, etaM: 0, NR: N >= 0 ? Nt : Nc, MyR: 0, MzR: 0, curve, Nt, Nc };
  // Strahl vom Ursprung – liegt (0,0) bei exzentrischem Bezugspunkt nicht im Interaktionsbereich,
  // wird stattdessen vom Flächenschwerpunkt des Bereichs aus skaliert.
  const poly = curve.map((p) => [p.My, p.Mz]);
  let c0 = [0, 0];
  if (!pointInPolygon([0, 0], poly)) {
    const pp = polygonProps(poly);
    c0 = [pp.cy, pp.cz];
  }
  const vx = My - c0[0], vy = Mz - c0[1];
  const len = Math.hypot(vx, vy);
  if (len < 1e-9) return { eta: etaN, etaN, etaM: 0, NR: N >= 0 ? Nt : Nc, MyR: c0[0], MzR: c0[1], curve, Nt, Nc };
  const dx = vx / len, dy = vy / len;
  let best = Infinity;
  for (let i = 0; i < curve.length; i++) {
    const p = curve[i], q = curve[(i + 1) % curve.length];
    const px = p.My - c0[0], py = p.Mz - c0[1];
    const ex = q.My - p.My, ey = q.Mz - p.Mz;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-14) continue;
    const t = (px * ey - py * ex) / den;
    const u = (px * dy - py * dx) / den;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  if (!Number.isFinite(best)) return { eta: Infinity, etaN, etaM: Infinity, MyR: 0, MzR: 0, curve, Nt, Nc };
  const etaM = len / best;
  return { eta: Math.max(etaM, etaN), etaM, etaN, MyR: c0[0] + dx * best, MzR: c0[1] + dy * best, NR: N, curve, Nt, Nc, origin: c0 };
}

// ------------------------------------------------------------------ Momenten-Krümmungs-Beziehung

/**
 * Momenten-Krümmungs-Linie bei konstanter Normalkraft N für Richtung θ (Druck auf Seite +n).
 * Dehnungsebene ε(u) = e0 − κ·u. Liefert Punkte {kappa [1/m], M [kNm], e0, ext, state}
 * sowie markante Punkte: Riss (cr), Fliessen (y), Bruch (u).
 */
export function momentCurvature(sec, N, theta = Math.PI / 2, opts = {}) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const cl = sec.concreteLaw, bl = sec.barLaw;
  const h = Math.max(sec.gross.h * Math.abs(s) + sec.gross.b * Math.abs(c), 0.01);
  const kMax = opts.kMax ?? 3 * ((-cl.epsMin) + (bl ? bl.epsMax : 0.01)) / h;
  const steps = opts.steps ?? 120;
  const comp = (r) => -(s * r.My) + c * r.Mz;
  const pts = [];
  let e0prev = 0, yieldPt = null, crackPt = null, ult = null;
  for (let i = 0; i <= steps; i++) {
    // nichtlinear verteilte Stützstellen (fein am Anfang)
    const kap = kMax * Math.pow(i / steps, 1.6);
    const ky = -kap * c, kz = -kap * s;
    const f = (e0) => resultants(sec, e0, ky, kz).N - N;
    let lo = Math.min(e0prev, 0) - 0.01, hi = Math.max(e0prev, 0) + 0.06;
    let flo = f(lo), fhi = f(hi);
    let k = 0;
    while (flo > 0 && k++ < 20) { lo -= 0.01; flo = f(lo); }
    k = 0;
    while (fhi < 0 && k++ < 20) { hi += 0.05; fhi = f(hi); }
    if (flo > 0 || fhi < 0) break;
    for (let it = 0; it < 80; it++) {
      const m = (lo + hi) / 2, fm = f(m);
      if (fm > 0) hi = m; else lo = m;
      if (hi - lo < 1e-11) break;
    }
    const e0 = (lo + hi) / 2;
    e0prev = e0;
    const r = resultants(sec, e0, ky, kz);
    const ext = strainExtremes(sec, e0, ky, kz);
    const M = comp(r);
    const failed = ext.ecMin < cl.epsMin || (bl && (ext.esMax > bl.epsMax || ext.esMin < bl.epsMin));
    const p = { kappa: kap, M, e0, ext };
    if (!crackPt && i > 0 && opts.crackStrain && ext.ecMax >= opts.crackStrain) crackPt = p;
    if (!yieldPt && bl && Math.max(Math.abs(ext.esMax || 0), Math.abs(ext.esMin || 0)) >= bl.ey) yieldPt = p;
    if (failed) { ult = pts[pts.length - 1] || p; break; }
    pts.push(p);
  }
  if (!ult) ult = pts[pts.length - 1];
  return { points: pts, yield: yieldPt, crack: crackPt, ultimate: ult };
}

// ------------------------------------------------------------------ Elastische Werte

/** Ideelle Querschnittswerte (ungerissen) mit Wertigkeit n = Es/Ec. */
export function idealProps(sec, n) {
  const g = sec.gross;
  let A = g.A, Sy = 0, Sz = 0;
  const ref = sec.ref;
  // Stäbe mit (n − 1)·As addieren (Beton bereits enthalten)
  for (const b of sec.bars) { const a = (n - 1) * b.A; A += a; Sy += a * (b.z - g.cz); Sz += a * (b.y - g.cy); }
  const dz = Sy / A, dy = Sz / A;
  let Iy = g.Iy + g.A * dz * dz, Iz = g.Iz + g.A * dy * dy, Iyz = g.Iyz + g.A * dy * dz;
  for (const b of sec.bars) {
    const a = (n - 1) * b.A, zz = b.z - g.cz - dz, yy = b.y - g.cy - dy;
    Iy += a * zz * zz; Iz += a * yy * yy; Iyz += a * yy * zz;
  }
  void ref;
  return { A, cy: g.cy + dy, cz: g.cz + dz, Iy, Iz, Iyz };
}

/** Hauptachsen: Winkel α [rad] und Hauptträgheitsmomente I1 ≥ I2. */
export function principalAxes(Iy, Iz, Iyz) {
  const m = (Iy + Iz) / 2, d = Math.hypot((Iy - Iz) / 2, Iyz);
  return { I1: m + d, I2: m - d, alpha: 0.5 * Math.atan2(-2 * Iyz, Iy - Iz) };
}

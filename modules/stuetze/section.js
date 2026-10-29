// Stütze – Querschnitt, Baustoffgesetze und Momenten-Krümmungs-Beziehungen (DOM-frei)
//
// Koordinaten des Querschnitts wie im Kern (rcsection.js): y nach rechts, z nach oben, Ursprung im
// Schwerpunkt, Einheit m. Rechteck: Breite b in y-Richtung, Höhe h in z-Richtung.
//
// Biegeachsen der Stütze:
//   Achse «y»: Biegung um die y-Achse, Ausbiegung in z-Richtung, massgebende Abmessung h (θ = 90°)
//   Achse «z»: Biegung um die z-Achse, Ausbiegung in y-Richtung, massgebende Abmessung b (θ = 0°)
//
// Für die Stützenberechnung wird das Fasermodell in Schichten senkrecht zur Biegeebene
// zusammengefasst (gleiche Koordinate u = y·cosθ + z·sinθ). Dehnungsebene ε(u) = e0 − κ·u,
// d.h. κ > 0 erzeugt Druck auf der Seite +u; Moment M = −∫σ·u dA (positiv bei Druck auf +u).

import { concrete, concreteLaw, rebar, rebarLaw, barArea } from '../../js/core/materials.js';
import { buildSection, rectPolygon, circlePolygon } from '../../js/core/rcsection.js';

export const GAMMA_CE = 1.2;
export const AXES = {
  y: { theta: Math.PI / 2, label: 'y', defl: 'z' },
  z: { theta: 0, label: 'z', defl: 'y' },
};

// ------------------------------------------------------------------ Baustoffe

/** Baustoffkennwerte nach Norm ('SIA' | 'EC'). */
export function materials(norm, cName, sName) {
  const c = concrete(cName, { norm });
  const s = rebar(sName, { norm });
  return { norm, c, s, Ecd: c.Ecm / GAMMA_CE, fcd: c.fcd, fsd: s.fsd, Es: s.Es, esd: s.fsd / s.Es };
}

/** Name des Betongesetzes für die Stützenberechnung (Standard je Norm). */
export function columnLawKind(norm, mode) {
  if (mode && mode !== 'auto') return mode;
  return norm === 'EC' ? 'sargin' : 'linplast';
}

export const LAW_LABELS = {
  linplast: 'linear-elastisch – ideal-plastisch (E_cd, f_cd)',
  parabola: 'Parabel-Rechteck (f_cd)',
  sargin: 'nichtlinear nach EN 1992 3.1.5 (E_cd, f_cd)',
};

/**
 * Betongesetz für die Verformungsberechnung der Stütze (Druck negativ, kein Zug).
 * kind: 'linplast' – linear mit Ecd bis fcd, dann plastisch bis εcu (SIA 262 4.3.7)
 *       'parabola' – Parabel-Rechteck mit fcd
 *       'sargin'   – EN 1992-1-1 Gl. (3.14) mit fcd und Ecd = Ecm/γcE (5.8.6(3))
 * Kriechen: alle Dehnungen werden mit (1 + φef) gestreckt (SIA 262 4.3.7.3, EN 1992 5.8.6(4)).
 */
export function columnConcreteLaw(c, kind, Ecd, phiEf = 0) {
  const f = 1 + Math.max(0, phiEf);
  const fc = c.fcd;
  let ecu = c.ecu * f;
  let sigma, tangent, ec2 = c.ec2 * f, E0;
  if (kind === 'parabola') {
    const n = c.n;
    E0 = fc * n / ec2;
    sigma = (e) => (e >= 0 || e < -ecu ? 0 : e <= -ec2 ? -fc : -fc * (1 - Math.pow(1 + e / ec2, n)));
    tangent = (e) => (e >= 0 || e <= -ec2 ? 0 : fc * n / ec2 * Math.pow(1 + e / ec2, n - 1));
  } else if (kind === 'sargin') {
    const ec1 = Math.min(0.7 * Math.pow(c.fcm, 0.31), 2.8) / 1000;
    const ecu1 = (c.fck < 50 ? 3.5 : 2.8 + 27 * Math.pow((98 - c.fcm) / 100, 4)) / 1000;
    const k = 1.05 * Ecd * ec1 / fc;
    const e1 = ec1 * f;
    ecu = ecu1 * f;
    ec2 = e1;
    E0 = k * fc / e1;
    sigma = (e) => {
      if (e >= 0 || e < -ecu) return 0;
      const eta = -e / e1;
      return -fc * (k * eta - eta * eta) / (1 + (k - 2) * eta);
    };
    tangent = (e) => {
      if (e >= 0 || e < -ecu) return 0;
      const eta = -e / e1, den = 1 + (k - 2) * eta;
      return fc / e1 * ((k - 2 * eta) * den - (k * eta - eta * eta) * (k - 2)) / (den * den);
    };
  } else {
    const E = Ecd / f;
    const ey = fc / E;
    E0 = E;
    sigma = (e) => (e >= 0 || e < -ecu ? 0 : e > -ey ? E * e : -fc);
    tangent = (e) => (e < 0 && e > -ey ? E : 0);
  }
  return { type: 'concrete', sigma, tangent, epsMin: -ecu, epsMax: Infinity, ec2, ecu, fc, Ec: E0, kind, name: c.name };
}

/** Bemessungsgesetze für den Querschnittswiderstand (Parabel-Rechteck, bilinearer Stahl ohne Verfestigung). */
export function designLaws(m) {
  return { c: concreteLaw(m.c, { kind: 'design' }), s: rebarLaw(m.s, { kind: 'design' }) };
}

/** Gesetze für die Stützenberechnung (Verformungen nach Theorie 2. Ordnung). */
export function columnLaws(m, kind, phiEf) {
  return { c: columnConcreteLaw(m.c, kind, m.Ecd, phiEf), s: rebarLaw(m.s, { kind: 'design' }) };
}

// ------------------------------------------------------------------ Geometrie

/** Achsabstand der Längsbewehrung vom Rand [m]. */
export function axisDistance(sp) {
  return sp.coverMode === 'axis' ? sp.axis / 1000 : (sp.cover + sp.stirrup + sp.dia / 2) / 1000;
}

/**
 * Querschnittsgeometrie mit Bewehrung (Masse in m, Flächen in m²).
 * sp: {shape:'rect'|'circle', b, h, D [mm], nb, nh (Stäbe je Seite inkl. Ecken), n (Kreis, total),
 *      dia [mm], coverMode:'nominal'|'axis', cover, stirrup, axis [mm]}
 */
export function sectionGeometry(sp) {
  const a = axisDistance(sp);
  const dia = sp.dia;
  if (!(dia > 0)) throw new Error('Stabdurchmesser Ø muss grösser als 0 sein (Register «Querschnitt»).');
  const Ab = barArea(dia) * 1e-6;
  const bars = [];
  if (sp.shape === 'circle') {
    const D = sp.D / 1000, R = D / 2, rs = R - a;
    if (!(D > 0)) throw new Error('Der Durchmesser D muss grösser als 0 sein.');
    if (!(rs > 0.2 * R)) throw new Error(`Die Überdeckung ist zu gross für D = ${sp.D} mm (Achsabstand ${Math.round(a * 1000)} mm). Überdeckung oder Bügeldurchmesser verkleinern.`);
    const n = Math.max(4, Math.round(sp.n));
    for (let k = 0; k < n; k++) {
      const t = Math.PI / 2 + 2 * Math.PI * k / n;
      bars.push({ y: rs * Math.cos(t), z: rs * Math.sin(t), A: Ab, dia });
    }
    const Ac = Math.PI * R * R, Ic = Math.PI * R ** 4 / 4;
    const Is = bars.reduce((s, b) => s + b.A * b.z * b.z, 0);
    return {
      shape: 'circle', D, R, b: D, h: D, a, rs, bars, Ab, n, As: n * Ab, Ac, Icy: Ic, Icz: Ic, Isy: Is, Isz: Is,
      iy: R / 2, iz: R / 2, poly: circlePolygon(0, 0, R, 64), symmetric: n % 2 === 0,
    };
  }
  const b = sp.b / 1000, h = sp.h / 1000;
  if (!(b > 0 && h > 0)) throw new Error('Breite b und Höhe h müssen grösser als 0 sein.');
  const ys = b / 2 - a, zs = h / 2 - a;
  if (!(ys > 0.1 * b && zs > 0.1 * h)) throw new Error(`Die Überdeckung ist zu gross für ${sp.b} × ${sp.h} mm (Achsabstand ${Math.round(a * 1000)} mm). Überdeckung verkleinern oder Querschnitt vergrössern.`);
  const nb = Math.max(2, Math.round(sp.nb)), nh = Math.max(2, Math.round(sp.nh));
  for (let i = 0; i < nb; i++) {
    const y = -ys + 2 * ys * i / (nb - 1);
    bars.push({ y, z: zs, A: Ab, dia }, { y, z: -zs, A: Ab, dia });
  }
  for (let j = 1; j < nh - 1; j++) {
    const z = -zs + 2 * zs * j / (nh - 1);
    bars.push({ y: -ys, z, A: Ab, dia }, { y: ys, z, A: Ab, dia });
  }
  const Isy = bars.reduce((s, x) => s + x.A * x.z * x.z, 0);
  const Isz = bars.reduce((s, x) => s + x.A * x.y * x.y, 0);
  return {
    shape: 'rect', b, h, a, ys, zs, bars, Ab, nb, nh, n: bars.length, As: bars.length * Ab, Ac: b * h,
    Icy: b * h ** 3 / 12, Icz: h * b ** 3 / 12, Isy, Isz, iy: h / Math.sqrt(12), iz: b / Math.sqrt(12),
    poly: rectPolygon(b, h), symmetric: true,
  };
}

/** Querschnittsabmessung und Trägheitswerte in Richtung der Biegeachse. */
export function axisProps(geo, axis) {
  const isY = axis === 'y';
  const hh = isY ? geo.h : geo.b;
  const Ic = isY ? geo.Icy : geo.Icz, Is = isY ? geo.Isy : geo.Isz;
  const is = Math.sqrt(Is / geo.As);
  return { h: hh, Ic, Is, i: Math.sqrt(Ic / geo.Ac), is, d: hh / 2 + is };
}

// ------------------------------------------------------------------ Fasermodell

/**
 * Fasermodell des Kerns mit ~1000–1300 Fasern: Rechteck als Raster aus Rechteckzellen,
 * Kreis als Polarnetz (64 Sektoren × 10 Ringe). Die Betonfläche an den Stabstellen wird abgezogen.
 */
export function fiberSection(geo, laws) {
  const regions = [];
  if (geo.shape === 'circle') {
    const nt = 64, nr = 10, R = geo.R;
    for (let j = 0; j < nt; j++) {
      const t0 = 2 * Math.PI * (j - 0.5) / nt, t1 = 2 * Math.PI * (j + 0.5) / nt;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      for (let i = 0; i < nr; i++) {
        const r0 = R * i / nr, r1 = R * (i + 1) / nr;
        if (i === 0) regions.push({ pts: [[0, 0], [r1 * c0, r1 * s0], [r1 * c1, r1 * s1]], law: laws.c });
        else regions.push({ pts: [[r0 * c0, r0 * s0], [r1 * c0, r1 * s0], [r1 * c1, r1 * s1], [r0 * c1, r0 * s1]], law: laws.c });
      }
    }
  } else {
    const target = 600;
    const ny = Math.max(12, Math.round(Math.sqrt(target * geo.b / geo.h)));
    const nz = Math.max(12, Math.round(target / ny));
    const dy = geo.b / ny, dz = geo.h / nz;
    for (let i = 0; i < ny; i++) {
      for (let j = 0; j < nz; j++) {
        const y0 = -geo.b / 2 + i * dy, z0 = -geo.h / 2 + j * dz;
        regions.push({ pts: [[y0, z0], [y0 + dy, z0], [y0 + dy, z0 + dz], [y0, z0 + dz]], law: laws.c });
      }
    }
  }
  const sec = buildSection({
    regions,
    bars: geo.bars.map((b) => ({ y: b.y, z: b.z, A: b.A, law: laws.s })),
    mesh: 10 * Math.max(geo.b, geo.h),
    ref: [0, 0],
    deductBars: false,
  });
  // Betonabzug an den Stabstellen und Randpunkte nur des Umrisses (schneller)
  const ci = sec.law[0];
  const nb = geo.bars.length, n0 = sec.nFibers, n = n0 + nb;
  const y = new Float64Array(n), z = new Float64Array(n), A = new Float64Array(n), law = new Int32Array(n), isBar = new Uint8Array(n);
  y.set(sec.y); z.set(sec.z); A.set(sec.A); law.set(sec.law); isBar.set(sec.isBar);
  geo.bars.forEach((b, k) => { y[n0 + k] = b.y; z[n0 + k] = b.z; A[n0 + k] = -b.A; law[n0 + k] = ci; });
  Object.assign(sec, { y, z, A, law, isBar, nFibers: n, cVerts: geo.poly.map((p) => [p[0], p[1]]) });
  return sec;
}

/** Fasermodell mit anderen Werkstoffgesetzen (gleiche Geometrie). */
export function withLaws(sec, laws) {
  const map = sec.laws.map((l) => (l.type === 'rebar' ? laws.s : laws.c));
  return { ...sec, laws: map, concreteLaw: laws.c, barLaw: laws.s };
}

// ------------------------------------------------------------------ Schichtenmodell und M-κ

/**
 * Fasst die Fasern für die Biegerichtung θ zu Schichten zusammen. Beton wird in höchstens
 * `bins` Schichten gleicher Dicke gesammelt (flächengewichteter Schwerpunkt je Schicht, damit
 * Fläche und statisches Moment exakt bleiben); jeder Stab bildet eine eigene Schicht.
 */
export function layerize(sec, theta, bins = 120) {
  const c = Math.cos(theta), s = Math.sin(theta);
  let ucMax = -Infinity, ucMin = Infinity;
  for (const [y, z] of sec.cVerts) { const u = y * c + z * s; ucMax = Math.max(ucMax, u); ucMin = Math.min(ucMin, u); }
  const hh = ucMax - ucMin || 1;
  const bA = new Float64Array(bins), bS = new Float64Array(bins);
  const sm = new Map();
  for (let i = 0; i < sec.nFibers; i++) {
    const u = sec.y[i] * c + sec.z[i] * s;
    if (sec.laws[sec.law[i]].type === 'rebar') {
      const key = Math.round(u * 1e7);
      sm.set(key, (sm.get(key) || 0) + sec.A[i]);
    } else {
      const k = Math.min(bins - 1, Math.max(0, Math.floor((u - ucMin) / hh * bins)));
      bA[k] += sec.A[i]; bS[k] += sec.A[i] * u;
    }
  }
  const cuL = [], cAL = [];
  for (let k = 0; k < bins; k++) {
    if (Math.abs(bA[k]) < 1e-14) continue;
    let u = bS[k] / bA[k];
    const lo = ucMin + hh * k / bins, hi = ucMin + hh * (k + 1) / bins;
    if (!(u >= lo - 1e-9 && u <= hi + 1e-9)) u = (lo + hi) / 2; // nur Abzugsflächen in der Schicht
    cuL.push(u); cAL.push(bA[k]);
  }
  const keys = [...sm.keys()].sort((a, b) => a - b);
  const su = Float64Array.from(keys, (k) => k / 1e7), sA = Float64Array.from(keys, (k) => sm.get(k));
  let usMin = Infinity, usMax = -Infinity;
  for (const u of su) { usMin = Math.min(usMin, u); usMax = Math.max(usMax, u); }
  return { theta, cu: Float64Array.from(cuL), cA: Float64Array.from(cAL), su, sA, ucMax, ucMin, usMin, usMax, h: hh };
}

/**
 * Momenten-Krümmungs-Beziehung bei konstanter Normalkraft N [kN] (Zug positiv) für ein Schichtenmodell.
 * laws: {c, s}. Die Kurve endet beim Erreichen einer Grenzdehnung (Beton εcu, Stahl εud).
 * Rückgabe {N, kap:Float64Array [1/m], M:Float64Array [kNm], e0, kU, MU, Mmax, kMmax, EI0, reason}
 * oder null, wenn N vom Querschnitt nicht aufgenommen werden kann.
 */
export function mkTable(lay, laws, N, opts = {}) {
  const { cu, cA, su, sA } = lay;
  const nc = cu.length, ns = su.length;
  const lc = laws.c, ls = laws.s;
  const Nt = N / 1000; // MN
  const axial = (e0, k) => {
    let n = 0;
    for (let i = 0; i < nc; i++) n += lc.sigma(e0 - k * cu[i]) * cA[i];
    for (let i = 0; i < ns; i++) n += ls.sigma(e0 - k * su[i]) * sA[i];
    return n - Nt;
  };
  const moment = (e0, k) => {
    let m = 0;
    for (let i = 0; i < nc; i++) m -= lc.sigma(e0 - k * cu[i]) * cA[i] * cu[i];
    for (let i = 0; i < ns; i++) m -= ls.sigma(e0 - k * su[i]) * sA[i] * su[i];
    return m * 1000;
  };
  const ecu = -lc.epsMin, eud = ls.epsMax;
  // Dehnungsnulllage e0 für Krümmung k (Klammerung von der Zugseite her, dann Illinois-Verfahren)
  const solveE0 = (k, guess) => {
    let hi = guess + 1e-4, fhi = axial(hi, k), it = 0, step = 2e-4;
    while (fhi < 0 && it++ < 80) { hi += step; step *= 1.6; fhi = axial(hi, k); }
    if (fhi < 0) return null;
    let lo = hi - 2e-4, flo = axial(lo, k);
    step = 2e-4; it = 0;
    while (flo > 0 && it++ < 400) { hi = lo; fhi = flo; lo -= step; step = Math.min(step * 1.4, 5e-4); flo = axial(lo, k); if (lo < -0.1) return null; }
    if (flo > 0) return null;
    if (fhi === 0) return hi;
    for (let i = 0; i < 80; i++) {
      let m = hi - fhi * (hi - lo) / (fhi - flo);
      if (!(m > lo && m < hi)) m = (lo + hi) / 2;
      const fm = axial(m, k);
      if (fm === 0 || hi - lo < 1e-14) return m;
      if (fm > 0) { hi = m; fhi = fm; if (i % 2) flo /= 2; } else { lo = m; flo = fm; if (i % 2) fhi /= 2; }
      if (hi - lo < 1e-13) break;
    }
    return (lo + hi) / 2;
  };
  const strainOk = (e0, k) => {
    const ec = e0 - k * lay.ucMax;
    if (ec < -ecu * (1 + 1e-9)) return false;
    if (ns && (e0 - k * lay.usMin > eud * (1 + 1e-9) || e0 - k * lay.usMax < -eud * (1 + 1e-9))) return false;
    return true;
  };
  const e00 = solveE0(0, 0);
  if (e00 === null || !strainOk(e00, 0)) return null;
  const dEff = Math.max(1e-3, lay.ucMax - Math.min(lay.usMin, lay.ucMin));
  const kEnd = 1.05 * (ecu + (ns ? eud : 0.01)) / dEff;
  const nPts = opts.points ?? 64;
  const kap = [0], M = [0], E0 = [e00];
  let prevE = e00, prevK = 0, reason = 'limit';
  for (let i = 1; i <= nPts; i++) {
    // logarithmische Stützstellen: gleichmässige relative Auflösung über vier Dekaden
    const k = kEnd * Math.pow(10, -4 * (1 - i / nPts));
    const e0 = solveE0(k, prevE);
    if (e0 === null || !strainOk(e0, k)) {
      // Grenzkrümmung genauer bestimmen
      let a = prevK, b = k, ea = prevE;
      for (let j = 0; j < 14; j++) {
        const m = (a + b) / 2;
        const em = solveE0(m, ea);
        if (em !== null && strainOk(em, m)) { a = m; ea = em; } else b = m;
      }
      if (a > prevK) { kap.push(a); M.push(moment(ea, a)); E0.push(ea); }
      reason = e0 === null ? 'axial' : 'strain';
      break;
    }
    kap.push(k); M.push(moment(e0, k)); E0.push(e0);
    prevE = e0; prevK = k;
  }
  let Mmax = 0, kMmax = 0;
  for (let i = 0; i < M.length; i++) if (M[i] > Mmax) { Mmax = M[i]; kMmax = kap[i]; }
  const last = kap.length - 1;
  const K = Float64Array.from(kap), MM = Float64Array.from(M);
  return {
    N, kap: K, M: MM, d: pchipSlopes(K, MM), e0: Float64Array.from(E0),
    kU: kap[last], MU: M[last], Mmax, kMmax, EI0: kap.length > 1 ? M[1] / kap[1] : 0, reason,
  };
}

/** Steigungen der monotonen kubischen Hermite-Interpolation (Fritsch-Carlson). Am Ursprung: Sekante (ungerade Funktion). */
export function pchipSlopes(x, y) {
  const n = x.length, d = new Float64Array(n);
  if (n < 2) return d;
  const del = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) del[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]);
  d[0] = del[0];
  d[n - 1] = del[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (del[i - 1] * del[i] <= 0) { d[i] = 0; continue; }
    const h0 = x[i] - x[i - 1], h1 = x[i + 1] - x[i];
    const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]);
  }
  return d;
}

/** Moment und Tangentensteifigkeit für Krümmung κ (punktsymmetrische Kurve, flach über κu hinaus). */
export function evalMK(tab, kappa) {
  const a = Math.abs(kappa), sg = kappa < 0 ? -1 : 1;
  const K = tab.kap, M = tab.M, n = K.length;
  if (n < 2) return { M: 0, Et: 0 };
  if (a >= tab.kU) return { M: sg * tab.MU, Et: 0 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (K[mid] <= a) lo = mid; else hi = mid; }
  const hk = K[hi] - K[lo];
  if (!tab.d) {
    const slope = (M[hi] - M[lo]) / hk;
    return { M: sg * (M[lo] + slope * (a - K[lo])), Et: slope };
  }
  // kubische Hermite-Interpolation (stetige Tangentensteifigkeit)
  const t = (a - K[lo]) / hk, d0 = tab.d[lo] * hk, d1 = tab.d[hi] * hk;
  const t2 = t * t, t3 = t2 * t;
  const m = (2 * t3 - 3 * t2 + 1) * M[lo] + (t3 - 2 * t2 + t) * d0 + (-2 * t3 + 3 * t2) * M[hi] + (t3 - t2) * d1;
  const dm = ((6 * t2 - 6 * t) * M[lo] + (3 * t2 - 4 * t + 1) * d0 + (-6 * t2 + 6 * t) * M[hi] + (3 * t2 - 2 * t) * d1) / hk;
  return { M: sg * m, Et: dm };
}

/** Lineares M-κ (für Tests und elastische Vergleichsrechnungen). */
export function linearTable(EI, kU = 1e3) {
  return { N: 0, kap: Float64Array.from([0, kU]), M: Float64Array.from([0, EI * kU]), kU, MU: EI * kU, Mmax: EI * kU, kMmax: kU, EI0: EI, reason: 'linear' };
}

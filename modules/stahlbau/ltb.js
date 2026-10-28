// Ideales Kippmoment Mcr (DOM-frei)
//
// 1) 3-Faktoren-Formel (ENV 1993-1-1 Anhang F, NCCI SN003) für doppelt symmetrische Querschnitte:
//    Mcr = C1·π²·E·Iz/(k·L)² · { √[ (k/kw)²·Iw/Iz + (k·L)²·G·It/(π²·E·Iz) + (C2·zg)² ] − C2·zg }
// 2) Eigenwertanalyse (FE) eines Biegedrillstabs mit beliebigem Momentenverlauf, Lastangriffshöhe,
//    seitlichen Halterungen (Gabellager) und Endeinspannungen (v', φ'). Elemente mit kubischen
//    Hermite-Ansätzen für die seitliche Verschiebung v und die Verdrehung φ.
// Einheiten: N, mm.

// ------------------------------------------------------------------ C1/C2-Tabellen

/** C1 für linearen Momentenverlauf (Endmomentenverhältnis ψ), k = 1 – NCCI SN003 Tab. 3.1. */
const PSI_TAB = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
const C1_PSI = [2.55, 2.57, 2.33, 2.05, 1.77, 1.52, 1.31, 1.14, 1.0];

function lin(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1;
  while (xs[i] < x) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}

export function c1Linear(psi) { return lin(PSI_TAB, C1_PSI, Math.max(-1, Math.min(1, psi))); }

/** Querlastfälle (Gabellager) – NCCI SN003 Tab. 3.2; [C1, C2] für k = 1 bzw. k = 0.5. */
export const C_TRANSVERSE = {
  q: { 1: [1.127, 0.454], 0.5: [0.970, 0.360], label: 'Gleichlast, gelenkig' },
  P: { 1: [1.348, 0.630], 0.5: [1.050, 0.480], label: 'Einzellast in Feldmitte' },
  qe: { 1: [2.578, 1.554], 0.5: [2.578, 1.554], label: 'Gleichlast, beidseitig eingespannt' },
};

/**
 * Bestimmt C1/C2 aus einem Momentenverlauf (Werte M[i] an äquidistanten Stellen, mind. 9).
 * Rückgabe {C1, C2, shape, psi, source, needsFE}.
 * Erkennung: linear → SN003 Tab. 3.1; Parabel bzw. Dreieck ohne Endmomente, Parabel mit gleichen
 * Einspannmomenten → SN003 Tab. 3.2. Andere Verläufe sind nicht tabelliert (needsFE = true):
 * dann wird Mcr mit der Eigenwertanalyse bestimmt.
 */
export function cFactors(Ms, k = 1) {
  const n = Ms.length - 1;
  const Mmax = Math.max(...Ms.map(Math.abs));
  if (!(Mmax > 0)) return { C1: 1, C2: 0, shape: 'none', psi: 1, source: 'kein Moment' };
  const tol = 0.01 * Mmax;
  const MA = Ms[0], MB = Ms[n];
  let devLin = 0;
  for (let i = 0; i <= n; i++) devLin = Math.max(devLin, Math.abs(Ms[i] - (MA + (MB - MA) * i / n)));
  const kk = k <= 0.75 ? 0.5 : 1;
  if (devLin <= tol) {
    const big = Math.abs(MA) >= Math.abs(MB) ? MA : MB, small = big === MA ? MB : MA;
    const psi = big !== 0 ? small / big : 1;
    return { C1: c1Linear(psi), C2: 0, shape: 'linear', psi, source: 'SN003 Tab. 3.1 (linearer Verlauf, k = 1)' };
  }
  const Mm = Ms[Math.round(n / 2)];
  const fit = (f) => { let d = 0; for (let i = 0; i <= n; i++) d = Math.max(d, Math.abs(Ms[i] - f(i / n))); return d <= 0.02 * Mmax; };
  if (Math.abs(MA) <= tol && Math.abs(MB) <= tol) {
    if (fit((x) => Mm * 4 * x * (1 - x))) { const [C1, C2] = C_TRANSVERSE.q[kk]; return { C1, C2, shape: 'q', psi: 0, source: 'SN003 Tab. 3.2 (Gleichlast)' }; }
    if (fit((x) => Mm * 2 * Math.min(x, 1 - x))) { const [C1, C2] = C_TRANSVERSE.P[kk]; return { C1, C2, shape: 'P', psi: 0, source: 'SN003 Tab. 3.2 (Einzellast in Feldmitte)' }; }
  }
  if (Math.abs(MA - MB) <= tol && fit((x) => MA * (1 - 6 * x + 6 * x * x))) {
    const [C1, C2] = C_TRANSVERSE.qe[1];
    return { C1, C2, shape: 'qe', psi: 1, source: 'SN003 Tab. 3.2 (Gleichlast, eingespannt)' };
  }
  return { C1: NaN, C2: NaN, shape: 'general', psi: NaN, source: 'nicht tabellierter Momentenverlauf', needsFE: true };
}

// ------------------------------------------------------------------ 3-Faktoren-Formel

/**
 * Mcr nach der 3-Faktoren-Formel (doppelt symmetrisch, zj = 0). Einheiten N, mm.
 * p: {E, G, Iz, It, Iw, L, k, kw, C1, C2, zg}
 */
export function mcrFormula(p) {
  const { E, G, Iz, It, Iw, L } = p;
  const k = p.k ?? 1, kw = p.kw ?? 1, C1 = p.C1 ?? 1, C2 = p.C2 ?? 0, zg = p.zg ?? 0;
  const kL = k * L;
  const Ncrz = Math.PI ** 2 * E * Iz / (kL * kL);
  const t1 = (k / kw) ** 2 * Iw / Iz;
  const t2 = kL * kL * G * It / (Math.PI ** 2 * E * Iz);
  const t3 = (C2 * zg) ** 2;
  const root = Math.sqrt(t1 + t2 + t3);
  return { Mcr: C1 * Ncrz * (root - C2 * zg), Ncrz, t1, t2, t3, root };
}

/** Mcr für konstanten Momentenverlauf, Gabellagerung (Kontrollwert). */
export function mcrUniform(E, G, Iz, It, Iw, L) {
  return Math.PI / L * Math.sqrt(E * Iz * G * It * (1 + Math.PI ** 2 * E * Iw / (L * L * G * It)));
}

// ------------------------------------------------------------------ FE-Eigenwertanalyse

/**
 * Kritischer Lastfaktor für Biegedrillknicken.
 * p: {
 *   L, E, G, Iz, It, Iw,
 *   M(x) → My [Nmm] (Lastfaktor 1),
 *   q(x) → Querlast [N/mm], positiv nach unten (für Lastangriffshöhe), zq: Höhe des Lastangriffs über dem Schubmittelpunkt [mm],
 *   points: [{x, P, z}] Einzellasten (P positiv nach unten, z Höhe über SMP),
 *   restraints: [{x, v:true, phi:true, dv:false, dphi:false}]  (Gabellager v = φ = 0, optional v' = 0, φ' = 0),
 *   nodesAt: [x…] zusätzliche Knoten, nel (Richtwert Elementanzahl)
 * }
 * Rückgabe {lambda, mode:{x[], v[], phi[]}} oder {lambda: Infinity}.
 */
export function ltbEigen(p) {
  const L = p.L;
  const nel = p.nel || 32;
  // Knoten
  const xs = new Set([0, L]);
  for (let i = 1; i < nel; i++) xs.add(L * i / nel);
  for (const x of p.nodesAt || []) if (x > 1e-6 && x < L - 1e-6) xs.add(x);
  for (const r of p.restraints || []) xs.add(Math.max(0, Math.min(L, r.x)));
  for (const pt of p.points || []) if (pt.x >= 0 && pt.x <= L) xs.add(pt.x);
  let X = [...xs].sort((a, b) => a - b);
  X = X.filter((x, i) => i === 0 || x - X[i - 1] > L * 1e-6);
  const nn = X.length, ndof = 4 * nn; // je Knoten: v, v', φ, φ'
  const K = Array.from({ length: ndof }, () => new Float64Array(ndof));
  const G = Array.from({ length: ndof }, () => new Float64Array(ndof));
  const EIz = p.E * p.Iz, GIt = p.G * p.It, EIw = p.E * p.Iw;
  const gp = [[-0.9061798459386640, 0.2369268850561891], [-0.5384693101056831, 0.4786286704993665], [0, 0.5688888888888889], [0.5384693101056831, 0.4786286704993665], [0.9061798459386640, 0.2369268850561891]];
  for (let e = 0; e < nn - 1; e++) {
    const x0 = X[e], l = X[e + 1] - x0;
    const v = [4 * e, 4 * e + 1, 4 * e + 4, 4 * e + 5];
    const f = [4 * e + 2, 4 * e + 3, 4 * e + 6, 4 * e + 7];
    // Biegung um z
    const kb = bendK(EIz, l);
    // Torsion: St. Venant (∫N'N') + Wölbkraft (∫N''N'')
    const kt = torsK(GIt, l), kw = bendK(EIw, l);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      K[v[i]][v[j]] += kb[i][j];
      K[f[i]][f[j]] += kt[i][j] + kw[i][j];
    }
    // Geometrische Matrix: Kopplung ∫ M·v''·φ und Lastangriffshöhe ∫ q·zq·φ²
    for (const [g, w] of gp) {
      const s = (g + 1) / 2, x = x0 + s * l, wl = w * l / 2;
      const N = herm(s, l), N2 = herm2(s, l);
      const M = p.M(x);
      const qz = p.q ? p.q(x) * (p.zq || 0) : 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const c = -M * N2[i] * N[j] * wl;
        G[v[i]][f[j]] += c;
        G[f[j]][v[i]] += c;
        if (qz) G[f[i]][f[j]] += qz * N[i] * N[j] * wl;
      }
    }
  }
  for (const pt of p.points || []) {
    const i = X.findIndex((x) => Math.abs(x - pt.x) <= L * 1e-6);
    if (i >= 0 && pt.z) G[4 * i + 2][4 * i + 2] += pt.P * pt.z;
  }
  // Randbedingungen
  const fixed = new Set();
  for (const r of p.restraints || []) {
    const i = X.findIndex((x) => Math.abs(x - r.x) <= L * 1e-6);
    if (i < 0) continue;
    if (r.v) fixed.add(4 * i);
    if (r.dv) fixed.add(4 * i + 1);
    if (r.phi) fixed.add(4 * i + 2);
    if (r.dphi) fixed.add(4 * i + 3);
  }
  const free = [];
  for (let i = 0; i < ndof; i++) if (!fixed.has(i)) free.push(i);
  const n = free.length;
  const Kr = free.map((i) => Float64Array.from(free, (j) => K[i][j]));
  const Gr = free.map((i) => Float64Array.from(free, (j) => G[i][j]));
  const res = criticalFactor(Kr, Gr);
  if (!res) return { lambda: Infinity, X };
  const full = new Float64Array(ndof);
  free.forEach((i, k) => { full[i] = res.x[k]; });
  return {
    lambda: res.lambda, X,
    mode: { x: X, v: X.map((_, i) => full[4 * i]), phi: X.map((_, i) => full[4 * i + 2]) },
    n,
  };
}

function bendK(EI, l) {
  const a = EI / l ** 3;
  return [
    [12 * a, 6 * l * a, -12 * a, 6 * l * a],
    [6 * l * a, 4 * l * l * a, -6 * l * a, 2 * l * l * a],
    [-12 * a, -6 * l * a, 12 * a, -6 * l * a],
    [6 * l * a, 2 * l * l * a, -6 * l * a, 4 * l * l * a],
  ];
}
function torsK(GIt, l) {
  const a = GIt / (30 * l);
  return [
    [36 * a, 3 * l * a, -36 * a, 3 * l * a],
    [3 * l * a, 4 * l * l * a, -3 * l * a, -l * l * a],
    [-36 * a, -3 * l * a, 36 * a, -3 * l * a],
    [3 * l * a, -l * l * a, -3 * l * a, 4 * l * l * a],
  ];
}
function herm(s, l) {
  return [1 - 3 * s * s + 2 * s ** 3, l * (s - 2 * s * s + s ** 3), 3 * s * s - 2 * s ** 3, l * (-s * s + s ** 3)];
}
function herm2(s, l) {
  return [(-6 + 12 * s) / (l * l), (-4 + 6 * s) / l, (6 - 12 * s) / (l * l), (-2 + 6 * s) / l];
}

/**
 * Kleinster positiver Eigenwert λ von K·x = λ·G·x (K symmetrisch positiv definit, G symmetrisch, beide schmalbandig).
 * Sturmsche Kette: Die Anzahl negativer Pivots der LDLᵀ-Zerlegung von (K − λ·G) ist gleich der Anzahl
 * Eigenwerte in (0, λ). Bisektion auf λ, anschliessend inverse Iteration für die Eigenform.
 */
function criticalFactor(K, G) {
  const n = K.length;
  if (!n) return null;
  let bw = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (K[i][j] !== 0 || G[i][j] !== 0) { bw = Math.max(bw, i - j); break; }
  const L = Array.from({ length: n }, () => new Float64Array(n));
  const d = new Float64Array(n);
  const factor = (lam) => {
    let neg = 0;
    for (let j = 0; j < n; j++) {
      const j0 = Math.max(0, j - bw);
      let s = K[j][j] - lam * G[j][j];
      const Lj = L[j];
      for (let k = j0; k < j; k++) s -= Lj[k] * Lj[k] * d[k];
      if (s === 0) s = 1e-300;
      d[j] = s;
      if (s < 0) neg++;
      const iMax = Math.min(n - 1, j + bw);
      for (let i = j + 1; i <= iMax; i++) {
        const Li = L[i];
        const i0 = Math.max(0, i - bw);
        let t = K[i][j] - lam * G[i][j];
        for (let k = Math.max(i0, j0); k < j; k++) t -= Li[k] * Lj[k] * d[k];
        Li[j] = t / s;
      }
    }
    return neg;
  };
  // Prüfen, dass K positiv definit ist (seitlich ausreichend gehalten)
  if (factor(0) > 0 || d.some((v) => !(v > 0))) throw new Error('Kippuntersuchung: Das System ist seitlich nicht ausreichend gehalten (kinematisch). Bitte seitliche Halterungen bzw. Einspannung prüfen.');
  let hi = 1, lo;
  if (factor(hi) === 0) {
    let it = 0;
    while (factor(hi) === 0) { hi *= 4; if (++it > 40) return null; }
    lo = hi / 4;
  } else {
    lo = hi / 4;
    let it = 0;
    while (factor(lo) > 0) { lo /= 4; if (++it > 60) return null; }
  }
  for (let it = 0; it < 80 && hi / lo - 1 > 1e-10; it++) {
    const mid = Math.sqrt(lo * hi);
    if (factor(mid) > 0) hi = mid; else lo = mid;
  }
  const lambda = Math.sqrt(lo * hi);
  // Eigenform: inverse Iteration mit Verschiebung knapp unterhalb λ
  factor(lambda * (1 - 1e-6));
  const solveLDL = (b) => {
    const y = Float64Array.from(b);
    for (let i = 0; i < n; i++) { const i0 = Math.max(0, i - bw); let s = y[i]; for (let k = i0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s; }
    for (let i = 0; i < n; i++) y[i] /= d[i];
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; const iMax = Math.min(n - 1, i + bw); for (let k = i + 1; k <= iMax; k++) s -= L[k][i] * y[k]; y[i] = s; }
    return y;
  };
  let x = Float64Array.from({ length: n }, (_, i) => 1 + 0.3 * Math.sin(1.7 * i));
  for (let it = 0; it < 4; it++) {
    const gx = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; const j0 = Math.max(0, i - bw), j1 = Math.min(n - 1, i + bw); for (let j = j0; j <= j1; j++) s += G[i][j] * x[j]; gx[i] = s; }
    x = solveLDL(gx);
    const nx = Math.sqrt(x.reduce((s, v) => s + v * v, 0)) || 1;
    x = x.map((v) => v / nx);
  }
  return { lambda, x };
}

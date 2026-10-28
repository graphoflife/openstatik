// Stütze – Stabmodell nach Theorie 2. Ordnung (DOM-frei)
//
// Balkenelemente (kubische Hermite-Ansätze) mit Freiheitsgraden (w, θ = w') je Knoten,
// x von unten (0) nach oben (L). Krümmung κ = w''; Biegemoment M = M(κ) aus der
// Momenten-Krümmungs-Tabelle (bzw. EI·κ linear). Der P-Δ-Effekt der Druckkraft P (> 0 = Druck)
// wird über die konsistente geometrische Steifigkeitsmatrix erfasst; eine Vorverformung w0
// wirkt als Ersatzlast P·KG·w0.
//
// Vorzeichen (Benutzersicht): Moment positiv bei Druck auf der Seite +w («Zug links»),
// H und q positiv in Richtung +w. Gleiches Vorzeichen von M_oben und M_unten → einfach gekrümmt.

import { evalMK } from './section.js';

const GP = [[0.5 - 0.5 / Math.sqrt(3), 0.5], [0.5 + 0.5 / Math.sqrt(3), 0.5]];
const HB = 3; // halbe Bandbreite

// ------------------------------------------------------------------ Lagerung

export const SUPPORT_PRESETS = {
  pinned: { label: 'Pendelstütze (gelenkig – gelenkig)', short: 'gelenkig – gelenkig', bot: 'pinned', top: 'pinned', sway: false, beta: 1 },
  cantilever: { label: 'Kragstütze (eingespannt – frei)', short: 'Kragstütze', bot: 'fixed', top: 'pinned', sway: true, beta: 2 },
  fixedPinned: { label: 'eingespannt – gelenkig (unverschieblich)', short: 'eingespannt – gelenkig', bot: 'fixed', top: 'pinned', sway: false, beta: 0.699 },
  fixedFixed: { label: 'eingespannt – eingespannt (unverschieblich)', short: 'beidseitig eingespannt', bot: 'fixed', top: 'fixed', sway: false, beta: 0.5 },
  fixedFixedSway: { label: 'eingespannt – eingespannt, Kopf verschieblich', short: 'eingespannt, verschieblich', bot: 'fixed', top: 'fixed', sway: true, beta: 1 },
  custom: { label: 'Benutzerdefiniert (Federn)', short: 'benutzerdefiniert', beta: null },
};

/** Randbedingungen aus Preset bzw. Benutzerangaben. k in kNm/rad. */
export function boundary(preset, custom = {}) {
  const p = SUPPORT_PRESETS[preset] || SUPPORT_PRESETS.pinned;
  if (preset !== 'custom') return { preset, bot: p.bot, top: p.top, sway: p.sway, kBot: 0, kTop: 0 };
  return {
    preset, bot: custom.bot || 'fixed', top: custom.top || 'pinned', sway: !!custom.sway,
    kBot: Math.max(0, (custom.kBot || 0) * 1000), kTop: Math.max(0, (custom.kTop || 0) * 1000),
  };
}

// ------------------------------------------------------------------ Modell

export function createModel(L, nEl, bc) {
  if (!(L > 0)) throw new Error('Die Stützenlänge L muss grösser als 0 sein.');
  nEl = Math.max(8, Math.min(200, Math.round(nEl || 40)));
  const nN = nEl + 1, n = 2 * nN, le = L / nEl;
  const fixed = new Uint8Array(n);
  fixed[0] = 1;
  if (bc.bot === 'fixed') fixed[1] = 1;
  if (!bc.sway) fixed[n - 2] = 1;
  if (bc.top === 'fixed') fixed[n - 1] = 1;
  const kBot = bc.bot === 'spring' ? bc.kBot : 0;
  const kTop = bc.top === 'spring' ? bc.kTop : 0;
  const x = Float64Array.from({ length: nN }, (_, i) => i * le);
  // Elementmatrizen
  const kg = geoElement(le);
  return { L, nEl, nN, n, le, fixed, kBot, kTop, sway: !!bc.sway, bc, x, kg };
}

function geoElement(le) {
  const c = 1 / (30 * le);
  return [
    [36 * c, 3 * le * c, -36 * c, 3 * le * c],
    [3 * le * c, 4 * le * le * c, -3 * le * c, -le * le * c],
    [-36 * c, -3 * le * c, 36 * c, -3 * le * c],
    [3 * le * c, -le * le * c, -3 * le * c, 4 * le * le * c],
  ];
}

function bmat(xi, le) {
  return [(-6 + 12 * xi) / (le * le), (-4 + 6 * xi) / le, (6 - 12 * xi) / (le * le), (-2 + 6 * xi) / le];
}

// ------------------------------------------------------------------ Bandlöser (ohne Pivotsuche)

/** Faktorisiert die symmetrische Bandmatrix A (dicht gespeichert) in-place. Liefert Anzahl negativer Pivots oder -1 bei Singularität. */
function bandFactor(A, n) {
  let neg = 0;
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i * n + i]));
  const tiny = 1e-14 * (scale || 1);
  for (let k = 0; k < n; k++) {
    const piv = A[k * n + k];
    if (Math.abs(piv) < tiny) return -1;
    if (piv < 0) neg++;
    const jm = Math.min(n - 1, k + HB);
    for (let i = k + 1; i <= jm; i++) {
      const f = A[i * n + k] / piv;
      if (f === 0) continue;
      A[i * n + k] = f;
      for (let j = k + 1; j <= jm; j++) A[i * n + j] -= f * A[k * n + j];
    }
  }
  return neg;
}

function bandSolve(A, n, b) {
  const x = Float64Array.from(b);
  for (let k = 0; k < n; k++) {
    const jm = Math.min(n - 1, k + HB);
    for (let i = k + 1; i <= jm; i++) x[i] -= A[i * n + k] * x[k];
  }
  for (let k = n - 1; k >= 0; k--) {
    let s = x[k];
    const jm = Math.min(n - 1, k + HB);
    for (let j = k + 1; j <= jm; j++) s -= A[k * n + j] * x[j];
    x[k] = s / A[k * n + k];
  }
  return x;
}

function constrain(model, K, R) {
  const { n, fixed } = model;
  for (let i = 0; i < n; i++) {
    if (!fixed[i]) continue;
    for (let j = Math.max(0, i - HB); j <= Math.min(n - 1, i + HB); j++) { K[i * n + j] = 0; K[j * n + i] = 0; }
    K[i * n + i] = 1;
    if (R) R[i] = 0;
  }
}

// ------------------------------------------------------------------ Lineare Matrizen

/** Lineare Steifigkeitsmatrix (konstantes EI) inkl. Drehfedern. */
export function linearStiffness(model, EI) {
  const { n, nEl, le } = model;
  const K = new Float64Array(n * n);
  const c = EI / le ** 3;
  const ke = [
    [12, 6 * le, -12, 6 * le], [6 * le, 4 * le * le, -6 * le, 2 * le * le],
    [-12, -6 * le, 12, -6 * le], [6 * le, 2 * le * le, -6 * le, 4 * le * le],
  ];
  for (let e = 0; e < nEl; e++) {
    const d0 = 2 * e;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) K[(d0 + a) * n + d0 + b] += c * ke[a][b];
  }
  K[1 * n + 1] += model.kBot;
  K[(n - 1) * n + n - 1] += model.kTop;
  return K;
}

/** Geometrische Steifigkeitsmatrix für P = 1 (Druck). */
export function geometricMatrix(model) {
  const { n, nEl, kg } = model;
  const G = new Float64Array(n * n);
  for (let e = 0; e < nEl; e++) {
    const d0 = 2 * e;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) G[(d0 + a) * n + d0 + b] += kg[a][b];
  }
  return G;
}

export function matVec(model, A, v) {
  const n = model.n, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = Math.max(0, i - HB); j <= Math.min(n - 1, i + HB); j++) s += A[i * n + j] * v[j];
    out[i] = s;
  }
  return out;
}

/**
 * Lastvektor für Bemessungslasten {H, q, Mt, Mb} (H am Kopf, q gleichmässig, Momente an den Enden).
 * Auf festgehaltene Freiheitsgrade wirkende Lasten gehen direkt ins Auflager.
 */
export function loadVector(model, ld) {
  const { n, nEl, le } = model;
  const F = new Float64Array(n);
  const q = ld.q || 0;
  if (q) {
    for (let e = 0; e < nEl; e++) {
      const d0 = 2 * e;
      F[d0] += q * le / 2; F[d0 + 1] += q * le * le / 12; F[d0 + 2] += q * le / 2; F[d0 + 3] -= q * le * le / 12;
    }
  }
  F[n - 2] += ld.H || 0;
  F[n - 1] += ld.Mt || 0;
  F[1] -= ld.Mb || 0;
  for (let i = 0; i < n; i++) if (model.fixed[i]) F[i] = 0;
  return F;
}

/** Löst das lineare System (K_EI − P·KG)·u = F. Liefert {u, neg} oder null bei Singularität. */
export function linearSolve(model, EI, P, F) {
  const K = linearStiffness(model, EI);
  if (P) { const G = geometricMatrix(model); for (let i = 0; i < K.length; i++) K[i] -= P * G[i]; }
  const R = Float64Array.from(F);
  constrain(model, K, R);
  const neg = bandFactor(K, model.n);
  if (neg < 0) return null;
  return { u: bandSolve(K, model.n, R), neg };
}

/** Prüft, ob das System stabil gelagert (nicht kinematisch) ist. */
export function isStable(model) {
  const K = linearStiffness(model, 1);
  constrain(model, K, null);
  return bandFactor(K, model.n) === 0;
}

/**
 * Kleinste Knicklast P_cr für konstantes EI (inverse Vektoriteration).
 * Liefert {Pcr, mode (Freiheitsgradvektor, max |w| = 1, positiv)}.
 */
export function bucklingLoad(model, EI) {
  const { n } = model;
  const K = linearStiffness(model, EI);
  constrain(model, K, null);
  if (bandFactor(K, n) !== 0) return null;
  const G = geometricMatrix(model);
  // Startvektor: Halbwelle bzw. Schiefstellung
  let y = new Float64Array(n);
  for (let i = 0; i < model.nN; i++) {
    const t = model.x[i] / model.L;
    y[2 * i] = model.sway ? t : Math.sin(Math.PI * t) + 0.1 * t;
    y[2 * i + 1] = model.sway ? 1 / model.L : Math.PI / model.L * Math.cos(Math.PI * t);
  }
  for (let i = 0; i < n; i++) if (model.fixed[i]) y[i] = 0;
  let P = Infinity;
  for (let it = 0; it < 200; it++) {
    const gy = matVec(model, G, y);
    for (let i = 0; i < n; i++) if (model.fixed[i]) gy[i] = 0;
    const x = bandSolve(K, n, gy);
    // Rayleigh-Quotient P = xᵀ·K·x / xᵀ·G·x = xᵀ·G·y / xᵀ·G·x
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += x[i] * gy[i]; den += x[i] * matRow(G, n, i, x); }
    const Pn = den > 0 ? num / den : Infinity;
    let mx = 0;
    for (let i = 0; i < n; i += 2) if (Math.abs(x[i]) > Math.abs(mx)) mx = x[i];
    if (!mx) break;
    for (let i = 0; i < n; i++) y[i] = x[i] / mx;
    const done = Math.abs(Pn - P) < 1e-11 * Math.abs(Pn);
    P = Pn;
    if (done && it > 3) break;
  }
  return Number.isFinite(P) && P > 0 ? { Pcr: P, mode: y } : null;
}

function matRow(A, n, i, v) {
  let s = 0;
  for (let j = Math.max(0, i - HB); j <= Math.min(n - 1, i + HB); j++) s += A[i * n + j] * v[j];
  return s;
}

// ------------------------------------------------------------------ Imperfektion

/** Vorverformung als Freiheitsgradvektor: Schiefstellung (verschieblich) bzw. Knickfigur (unverschieblich). */
export function imperfectionShape(model, EIref, amplitude) {
  const { n, nN, x, L } = model;
  const w0 = new Float64Array(n);
  if (!amplitude) return w0;
  if (model.sway) {
    const th = amplitude / L;
    for (let i = 0; i < nN; i++) { w0[2 * i] = th * x[i]; w0[2 * i + 1] = th; }
  } else {
    const b = bucklingLoad(model, EIref);
    if (b) {
      for (let i = 0; i < n; i++) w0[i] = amplitude * b.mode[i];
    } else {
      for (let i = 0; i < nN; i++) { const t = x[i] / L; w0[2 * i] = amplitude * Math.sin(Math.PI * t); w0[2 * i + 1] = amplitude * Math.PI / L * Math.cos(Math.PI * t); }
    }
  }
  return w0;
}

// ------------------------------------------------------------------ Nichtlineare Berechnung

function assemble(model, tab, P, u, K, fint) {
  const { n, nEl, le, kg } = model;
  fint.fill(0);
  if (K) K.fill(0);
  for (let e = 0; e < nEl; e++) {
    const d0 = 2 * e;
    const ue0 = u[d0], ue1 = u[d0 + 1], ue2 = u[d0 + 2], ue3 = u[d0 + 3];
    for (const [xi, wg] of GP) {
      const B = bmat(xi, le);
      const kap = B[0] * ue0 + B[1] * ue1 + B[2] * ue2 + B[3] * ue3;
      const r = tab.EI !== undefined ? { M: tab.EI * kap, Et: tab.EI } : evalMK(tab, kap);
      const f = le * wg;
      for (let a = 0; a < 4; a++) {
        fint[d0 + a] += f * B[a] * r.M;
        if (K) for (let b = 0; b < 4; b++) K[(d0 + a) * n + d0 + b] += f * r.Et * B[a] * B[b];
      }
    }
    if (P) {
      const ue = [ue0, ue1, ue2, ue3];
      for (let a = 0; a < 4; a++) {
        let s = 0;
        for (let b = 0; b < 4; b++) { s += kg[a][b] * ue[b]; if (K) K[(d0 + a) * n + d0 + b] -= P * kg[a][b]; }
        fint[d0 + a] -= P * s;
      }
    }
  }
  fint[1] += model.kBot * u[1];
  fint[n - 1] += model.kTop * u[n - 1];
  if (K) { K[n + 1] += model.kBot; K[(n - 1) * n + n - 1] += model.kTop; }
}

/** Krümmungen an Gausspunkten und Elementenden: grösster Betrag. */
export function maxCurvature(model, u) {
  const { nEl, le } = model;
  let km = 0;
  for (let e = 0; e < nEl; e++) {
    const d0 = 2 * e;
    for (const xi of [0, GP[0][0], GP[1][0], 1]) {
      const B = bmat(xi, le);
      const k = B[0] * u[d0] + B[1] * u[d0 + 1] + B[2] * u[d0 + 2] + B[3] * u[d0 + 3];
      if (Math.abs(k) > Math.abs(km)) km = k;
    }
  }
  return km;
}

/**
 * Gleichgewicht nach Theorie 2. Ordnung (Newton-Raphson mit Liniensuche).
 * tab: M-κ-Tabelle (oder {EI} für linear), P: Druckkraft [kN], F: Lastvektor, g0 = KG·w0 (Vorverformung),
 * u0: Startvektor. Liefert {ok, reason, u, iter, kapMax}.
 * reason: 'stability' (kein stabiles Gleichgewicht), 'section' (Grenzkrümmung κu überschritten).
 */
export function solveNonlinear(model, tab, P, F, g0, u0, opts = {}) {
  const { n } = model;
  const rhs = new Float64Array(n);
  for (let i = 0; i < n; i++) rhs[i] = F[i] + P * (g0 ? g0[i] : 0);
  for (let i = 0; i < n; i++) if (model.fixed[i]) rhs[i] = 0;
  let ref = 0;
  for (let i = 0; i < n; i++) ref = Math.max(ref, Math.abs(rhs[i]));
  const tol = (opts.tol ?? 1e-9) * Math.max(ref, 1);
  let u = u0 ? Float64Array.from(u0) : new Float64Array(n);
  for (let i = 0; i < n; i++) if (model.fixed[i]) u[i] = 0;
  const K = new Float64Array(n * n), fint = new Float64Array(n), R = new Float64Array(n);
  const resid = (uu, KK) => {
    assemble(model, tab, P, uu, KK, fint);
    let m = 0;
    for (let i = 0; i < n; i++) { R[i] = model.fixed[i] ? 0 : rhs[i] - fint[i]; m = Math.max(m, Math.abs(R[i])); }
    return m;
  };
  const umax = (v) => { let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(v[i])); return m; };
  const maxIt = opts.maxIter ?? 40;
  const uLimit = opts.uLimit ?? model.L * 0.5;
  let rn = resid(u, K), it = 0, neg = 0, conv = false, small = false;
  const ut = new Float64Array(n);
  let rnCheck = rn;
  for (; it < maxIt; it++) {
    constrain(model, K, R);
    neg = bandFactor(K, n);
    if (rn <= tol || small) { conv = true; break; }
    // Stagnation (typisch jenseits des Grenzpunktes): Residuum sinkt nicht mehr deutlich
    if (it > 0 && it % 8 === 0) {
      if (rn > 0.3 * rnCheck) return { ok: false, reason: 'stability', u, iter: it };
      rnCheck = rn;
    }
    if (neg < 0) return { ok: false, reason: 'stability', u, iter: it };
    const du = bandSolve(K, n, R);
    const duRel = umax(du) / Math.max(umax(u), 1e-12);
    let alpha = 1, accepted = false;
    for (let ls = 0; ls < 10; ls++) {
      for (let i = 0; i < n; i++) ut[i] = u[i] + alpha * du[i];
      const rt = resid(ut, null);
      if (rt < rn * (1 - 1e-4 * alpha) || rt <= tol) { u = Float64Array.from(ut); rn = rt; accepted = true; break; }
      alpha *= 0.5;
    }
    if (!accepted) {
      // Rundungsgrenze erreicht: Korrektur verschwindend klein → konvergiert
      if (duRel < 1e-8) { small = true; rn = resid(u, K); continue; }
      return { ok: false, reason: 'stability', u, iter: it };
    }
    if (alpha === 1 && duRel < 1e-11) small = true;
    let um = 0;
    for (let i = 0; i < n; i += 2) um = Math.max(um, Math.abs(u[i]));
    if (um > uLimit) return { ok: false, reason: 'stability', u, iter: it };
    rn = resid(u, K);
  }
  if (!conv) {
    if (rn > tol * 1e3) return { ok: false, reason: 'stability', u, iter: it };
    constrain(model, K, R);
    neg = bandFactor(K, n);
  }
  if (neg !== 0) return { ok: false, reason: 'stability', u, iter: it };
  const kapMax = maxCurvature(model, u);
  if (tab.kU !== undefined && Math.abs(kapMax) > tab.kU * (1 + 1e-9)) return { ok: false, reason: 'section', u, iter: it, kapMax };
  return { ok: true, u, iter: it, kapMax };
}

/**
 * Knotenmomente aus den Elementendkräften (Gleichgewicht am verformten System bei P ≠ 0).
 * w0: Vorverformung (Freiheitsgradvektor), q: Streckenlast [kN/m].
 * secondOrder = false: Theorie 1. Ordnung (nur Ersatzlasten P·KG·w0 der Vorverformung).
 * M positiv bei Druck auf der Seite +w. Liefert Float64Array (nN).
 */
export function nodalMoments(model, tab, P, u, w0, q = 0, secondOrder = true) {
  const { nEl, nN, le, kg } = model;
  const Mn = new Float64Array(nN), cnt = new Float64Array(nN);
  const fq = [q * le / 2, q * le * le / 12, q * le / 2, -q * le * le / 12];
  for (let e = 0; e < nEl; e++) {
    const d0 = 2 * e;
    const ue = [u[d0], u[d0 + 1], u[d0 + 2], u[d0 + 3]];
    const fe = [0, 0, 0, 0];
    for (const [xi, wg] of GP) {
      const B = bmat(xi, le);
      const kap = B[0] * ue[0] + B[1] * ue[1] + B[2] * ue[2] + B[3] * ue[3];
      const M = tab.EI !== undefined ? tab.EI * kap : evalMK(tab, kap).M;
      for (let a = 0; a < 4; a++) fe[a] += le * wg * B[a] * M;
    }
    for (let a = 0; a < 4; a++) {
      let s = 0;
      for (let b = 0; b < 4; b++) s += kg[a][b] * ((secondOrder ? ue[b] : 0) + (w0 ? w0[d0 + b] : 0));
      fe[a] -= P * s + fq[a];
    }
    Mn[e] += -fe[1]; cnt[e]++;
    Mn[e + 1] += fe[3]; cnt[e + 1]++;
  }
  for (let i = 0; i < nN; i++) Mn[i] /= cnt[i];
  return Mn;
}

/** Knotenkrümmungen (Mittel der angrenzenden Elementenden). */
export function nodalCurvatures(model, u) {
  const { nEl, nN, le } = model;
  const k = new Float64Array(nN), c = new Float64Array(nN);
  const B0 = bmat(0, le), B1 = bmat(1, le);
  for (let e = 0; e < nEl; e++) {
    const d0 = 2 * e;
    const ue = [u[d0], u[d0 + 1], u[d0 + 2], u[d0 + 3]];
    k[e] += B0[0] * ue[0] + B0[1] * ue[1] + B0[2] * ue[2] + B0[3] * ue[3]; c[e]++;
    k[e + 1] += B1[0] * ue[0] + B1[1] * ue[1] + B1[2] * ue[2] + B1[3] * ue[3]; c[e + 1]++;
  }
  for (let i = 0; i < nN; i++) k[i] /= c[i];
  return k;
}

/** Standard-Laststufen für die Traglastsuche. */
export const LAMBDA_GRID = (() => {
  const g = [];
  for (let i = 1; i <= 20; i++) g.push(+(i * 0.1).toFixed(2));
  for (let v = 2.25; v <= 4.001; v += 0.25) g.push(+v.toFixed(2));
  for (let v = 4.5; v <= 8.001; v += 0.5) g.push(+v.toFixed(2));
  g.push(9, 10, 12, 14, 17, 20);
  return g;
})();

/**
 * Traglastsuche durch proportionale Laststeigerung: alle Lasten (N, H, q, M) werden mit λ
 * multipliziert, die Vorverformung bleibt geometrisch fest. Für jede Laststufe wird die
 * M-κ-Beziehung bei N = λ·Nd neu ermittelt (tableAt(λ)).
 * Liefert {lambdaU, reason, capped, states:[{lambda, u}], at1 (Zustand bei λ = 1 oder null),
 * stats: {solves (Gleichgewichtslösungen), iters (Newton-Iterationen gesamt)}}.
 */
export function ultimateScan(model, tableAt, Nd, Fd, g0, opts = {}) {
  const grid = opts.grid || LAMBDA_GRID;
  const states = [];
  let uOk = new Float64Array(model.n), lamOk = 0, lamFail = null, reason = null, at1 = null;
  const F = (lam) => Fd.map((v) => v * lam);
  const stats = { solves: 0, iters: 0 };
  const trial = (lam, u0) => {
    const tab = tableAt(lam);
    if (!tab) return { ok: false, reason: 'axial' };
    const r = solveNonlinear(model, tab, lam * Nd, F(lam), g0, u0);
    stats.solves++; stats.iters += r.iter || 0;
    return r;
  };
  for (const lam of grid) {
    if (opts.stopAt !== undefined && lam > opts.stopAt + 1e-12) break;
    const r = trial(lam, uOk);
    if (r.ok) {
      states.push({ lambda: lam, u: r.u, kapMax: r.kapMax });
      uOk = r.u; lamOk = lam;
      if (Math.abs(lam - 1) < 1e-12) at1 = { lambda: 1, u: r.u, kapMax: r.kapMax, iter: r.iter };
    } else { lamFail = lam; reason = r.reason; break; }
  }
  if (opts.stopAt !== undefined) return { lambdaU: lamOk, states, at1, reason, capped: lamFail === null, stats };
  if (lamFail === null) return { lambdaU: lamOk, reason: 'capped', capped: true, states, at1, stats };
  const bis = opts.bisections ?? 10;
  for (let i = 0; i < bis; i++) {
    const lam = (lamOk + lamFail) / 2;
    const r = trial(lam, uOk);
    if (r.ok) { states.push({ lambda: lam, u: r.u, kapMax: r.kapMax }); uOk = r.u; lamOk = lam; } else { lamFail = lam; reason = r.reason; }
  }
  states.sort((a, b) => a.lambda - b.lambda);
  return { lambdaU: lamOk, reason, capped: false, states, at1, stats };
}

// Rechenkern Mauerwerk – unbewehrtes Mauerwerk nach SIA 266 (2015), DOM-frei.
//
// Einheiten intern: Längen m, Kräfte kN, Spannungen kN/m² (= kPa), Linienlasten kN/m.
// Vorzeichen (Schnitt): Exzentrizität e und Querlast positiv in Richtung «Raumseite» (+x),
// die Querlast (Wind, Erddruck) wirkt von der Aussen-/Erdseite (−x) nach +x.
//
// Verfahren (Übersicht):
//  • Normalkraft mit Knicken: Wandstreifen b = 1 m, gelenkig oben/unten, Knicklänge hef,
//    Werkstoff ohne Zugfestigkeit, linear-elastisch – ideal-plastisch (fxd, Exd), Theorie 2. Ordnung
//    numerisch (Fixpunktiteration der Biegelinie). Tragwiderstand als Laststeigerungsfaktor auf die
//    Vertikallasten. Querschnittswiderstand mit Spannungsblock nRd = fxd·(t − 2e) (SIA 266, 4.3).
//    Alternativ EN 1996-1-1, 6.1.2.2 und Anhang G (Φi, Φm).
//  • Querkraft in Wandebene: Spannungsfeld mit geneigtem Druckfeld über der Druckzone am Wandfuss,
//    Fliessbedingungen nach Ganz/Thürlimann (Grundlage SIA 266) ohne Kohäsion, oder EN 1996-1-1, 6.2.
//  • Teilflächenbelastung: EN 1996-1-1, 6.1.3 (Erhöhungsfaktor β, Lastausbreitung 60°).
//  • Querbelastung: Stützlinie mit Th. 2. O. (Laststeigerungsfaktor auf die Querlast),
//    optional EN 1996-3, 4.5 (Kelleraussenwände).

import { designValues } from './materials.js';

const SQRT3 = Math.sqrt(3);

// ====================================================================== Querschnitt

/**
 * Krümmung eines Wandstreifens (Breite 1 m) aus Mauerwerk ohne Zugfestigkeit,
 * linear-elastisch – ideal-plastisch.
 * @param {number} N Normalkraft (Druck positiv) [kN/m]
 * @param {number} e Exzentrizität der Resultierenden [m] (Vorzeichen → Vorzeichen der Krümmung)
 * @param {number} t Wanddicke [m]
 * @param {number} f Druckfestigkeit (Bemessungswert) [kN/m²]
 * @param {number} E Elastizitätsmodul [kN/m²]
 * @returns {number} Krümmung [1/m]; ±Infinity, wenn kein Gleichgewicht möglich ist (N > f·(t − 2|e|)).
 */
export function sectionCurvature(N, e, t, f, E) {
  const s = e < 0 ? -1 : 1;
  const ae = Math.abs(e);
  if (!(N > 0)) return ae * Math.abs(N) < 1e-12 ? 0 : s * Infinity;
  const xR = t / 2 - ae; // Abstand der Resultierenden vom gedrückten Rand
  if (xR <= 0 || N >= 2 * f * xR) return s * Infinity;
  if (ae <= t / 6) {
    // ungerissen, elastisch
    const s1 = N / t * (1 + 6 * ae / t);
    if (s1 <= f) return s * 12 * N * ae / (E * t * t * t);
  } else {
    // gerissen, elastisch: Druckzone c = 3·xR, Randspannung 2N/c
    const c = 3 * xR;
    if (2 * N / c <= f) return s * 2 * N / (E * c * c);
  }
  // plastisch, gerissen: plastischer Bereich p (σ = f), elastischer Bereich d (dreieckförmig)
  const sp = 2 * N / f; // = c + p
  const d2 = 3 * sp * (4 * xR - sp);
  if (d2 > 0) {
    const d = Math.sqrt(d2);
    const p = (sp - d) / 2;
    if (p >= -1e-12 && p + d <= t * (1 + 1e-9)) return s * f / (E * d);
  }
  // plastisch, ungerissen (nur bei kleiner Exzentrizität und hoher Normalkraft)
  const k = curvatureUncrackedPlastic(N, xR, t, f, E);
  return s * k;
}

// Ganz gedrückter Querschnitt mit plastischem Randbereich p: σ = f auf [0, p], linear von f auf σ2 über L = t − p.
function curvatureUncrackedPlastic(N, xR, t, f, E) {
  const res = (p) => {
    const L = t - p, A = N - f * p;
    return f * p * p / 2 + A * p + 2 * A * L / 3 - f * L * L / 6 - N * xR;
  };
  let a = 0, b = Math.min(t * (1 - 1e-9), 2 * N / f - t);
  if (b <= 0) b = t * 1e-6;
  let ra = res(a), rb = res(b);
  if (ra * rb > 0) {
    // numerisch an der Grenze – nächstgelegenen Rand verwenden
    const p = Math.abs(ra) < Math.abs(rb) ? a : b;
    return kappaD(p);
  }
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2, rm = res(m);
    if (ra * rm <= 0) { b = m; rb = rm; } else { a = m; ra = rm; }
  }
  return kappaD((a + b) / 2);
  function kappaD(p) {
    const L = t - p, A = N - f * p;
    const s2 = 2 * A / L - f;
    return Math.max(0, (f - s2) / (E * L));
  }
}

/** Querschnittswiderstand (Spannungsblock) nRd = fxd·(t − 2|e|) ≥ 0 [kN/m]. */
export function sectionResistance(e, t, f) {
  return Math.max(0, f * (t - 2 * Math.abs(e)));
}

// ====================================================================== Knicklänge

/**
 * Knicklänge hef = ρn·h (EN 1996-1-1, 5.5.1.2; sinngemäss SIA 266).
 * o: {h, t, mode: 'slab'|'hinged'|'manual', rhoManual, sides: 0|1|2, ls, eTop}
 */
export function effectiveHeight(o) {
  const notes = [];
  const { h, t } = o;
  if (o.mode === 'manual') {
    const rho = o.rhoManual > 0 ? o.rhoManual : 1;
    return { rho, rho2: rho, hef: rho * h, notes, formula: `h_ef = ρ·h = ${f3(rho)}·${f3(h)} = ${f3(rho * h)} m (ρ manuell)` };
  }
  let rho2 = o.mode === 'slab' ? 0.75 : 1.0;
  if (o.mode === 'slab' && Math.abs(o.eTop || 0) > 0.25 * t) {
    rho2 = 1.0;
    notes.push('ρ_2 = 1.0 statt 0.75, da die Exzentrizität am Wandkopf grösser als 0.25·t ist (EN 1996-1-1, 5.5.1.2).');
  }
  let rho = rho2, formula = `ρ_2 = ${f3(rho2)}`;
  const ls = o.ls > 0 ? o.ls : Infinity;
  if (o.sides === 1) {
    if (ls >= 15 * t) {
      notes.push('Seitliche Halterung mit Abstand ≥ 15·t wird nicht angerechnet (EN 1996-1-1, 5.5.1.2 (12)).');
    } else if (h <= 3.5 * ls) {
      rho = Math.max(0.3, rho2 / (1 + (rho2 * h / (3 * ls)) ** 2));
      formula = `ρ_3 = ρ_2/(1 + (ρ_2·h/(3·l))²) = ${f3(rho)}`;
    } else {
      rho = Math.max(0.3, 1.5 * ls / h);
      formula = `ρ_3 = 1.5·l/h = ${f3(rho)}`;
    }
  } else if (o.sides === 2) {
    if (ls >= 30 * t) {
      notes.push('Seitliche Halterungen mit Abstand ≥ 30·t werden nicht angerechnet (EN 1996-1-1, 5.5.1.2 (12)).');
    } else if (h <= 1.15 * ls) {
      rho = rho2 / (1 + (rho2 * h / ls) ** 2);
      formula = `ρ_4 = ρ_2/(1 + (ρ_2·h/l)²) = ${f3(rho)}`;
    } else {
      rho = 0.5 * ls / h;
      formula = `ρ_4 = 0.5·l/h = ${f3(rho)}`;
    }
  }
  return { rho, rho2, hef: rho * h, notes, formula: `${formula}; h_ef = ρ·h = ${f3(rho)}·${f3(h)} = ${f3(rho * h)} m` };
}

const f3 = (x) => (Number.isFinite(x) ? (Math.round(x * 1000) / 1000).toFixed(3) : '–');

// ====================================================================== Querlast-Momente

/**
 * Biegemomente eines einfachen Balkens (Spannweite h) unter einer Flächenlast p(z) [kN/m² → kN/m je m],
 * ausgewertet an den Stellen zs. Numerische Integration (Simpson, 400 Abschnitte).
 */
export function lateralMoments(pFn, h, zs) {
  const n = 400, dz = h / n;
  const zz = [], pp = [];
  for (let i = 0; i <= n; i++) { zz.push(i * dz); pp.push(pFn(i * dz)); }
  // Resultierende und Moment um z = 0
  let P = 0, Pz = 0;
  for (let i = 0; i < n; i++) {
    const za = zz[i], zb = zz[i + 1], zm = (za + zb) / 2, pm = pFn(zm);
    const w = dz / 6;
    P += w * (pp[i] + 4 * pm + pp[i + 1]);
    Pz += w * (pp[i] * za + 4 * pm * zm + pp[i + 1] * zb);
  }
  const Rtop = Pz / h, Rbot = P - Rtop;
  // M(z) = Rbot·z − ∫0^z p(s)(z − s) ds
  return zs.map((z) => {
    if (z <= 0 || z >= h) return 0;
    const m = Math.max(4, Math.ceil(z / dz));
    const d = z / m;
    let I = 0;
    for (let i = 0; i < m; i++) {
      const a = i * d, b = a + d, c = (a + b) / 2;
      I += d / 6 * (pFn(a) * (z - a) + 4 * pFn(c) * (z - c) + pFn(b) * (z - b));
    }
    return Rbot * z - I;
  });
}

// ====================================================================== Wandstreifen Th. 2. O.

/**
 * Bereitet das Modell eines Wandstreifens vor.
 * cfg: {h, hef, t, f, E, nTop, gw (Eigengewicht je m Höhe), eTop, eBot, pFn (Querlast [kN/m²], z ab Wandfuss),
 *       eImp (Amplitude der Vorverformung, ohne Vorzeichen), nseg}
 */
export function buildStrip(cfg) {
  const nseg = cfg.nseg || 32;
  const m = nseg + 1;
  const { h, hef, t } = cfg;
  const z = new Float64Array(m), N = new Float64Array(m), M1 = new Float64Array(m), Imp = new Float64Array(m);
  const nBot = cfg.nTop + cfg.gw * h;
  const Mtop = cfg.nTop * cfg.eTop, Mbot = nBot * cfg.eBot;
  for (let i = 0; i < m; i++) {
    z[i] = h * i / nseg;
    N[i] = cfg.nTop + cfg.gw * (h - z[i]);
    M1[i] = Mbot + (Mtop - Mbot) * z[i] / h;
    Imp[i] = Math.sin(Math.PI * z[i] / h);
  }
  const Mq = cfg.pFn ? Float64Array.from(lateralMoments(cfg.pFn, h, Array.from(z))) : new Float64Array(m);
  // Greensche Funktion des einfachen Balkens der Länge hef (Trapezregel)
  const L = hef, ds = L / nseg;
  const G = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    const x = ds * i;
    for (let j = 0; j < m; j++) {
      const s = ds * j;
      const g = x <= s ? x * (L - s) / L : s * (L - x) / L;
      const wgt = j === 0 || j === m - 1 ? ds / 2 : ds;
      G[i * m + j] = g * wgt;
    }
  }
  // Vorzeichen der Vorverformung: in Richtung der Biegelinie Th. 1. O. (ungerissen)
  let sign = 1;
  if (cfg.impSign) sign = cfg.impSign;
  else {
    const EI = cfg.E * t ** 3 / 12;
    let best = 0;
    for (let i = 0; i < m; i++) {
      let w = 0;
      for (let j = 0; j < m; j++) w += G[i * m + j] * (M1[j] + Mq[j]) / EI;
      if (Math.abs(w) > Math.abs(best)) best = w;
    }
    if (best < -1e-12) sign = -1;
  }
  for (let i = 0; i < m; i++) Imp[i] *= sign * (cfg.eImp || 0);
  return { ...cfg, m, nseg, z, N, M1, Mq, Imp, G, impSign: sign };
}

/**
 * Löst die Biegelinie für den Laststeigerungsfaktor lam (Vertikallasten) und mu (Querlast).
 * Rückgabe {ok, w, e, n, kappa, it, failIndex, reason}
 */
export function solveStrip(S, lam = 1, mu = 1, w0 = null, maxIter = 500) {
  const { m, t, f, E, G } = S;
  const w = w0 ? Float64Array.from(w0) : new Float64Array(m);
  const kap = new Float64Array(m), e = new Float64Array(m), n = new Float64Array(m), M = new Float64Array(m);
  for (let i = 0; i < m; i++) { n[i] = lam * S.N[i]; M[i] = lam * S.M1[i] + mu * S.Mq[i]; }
  const tol = 1e-9 * Math.max(t, 0.05);
  let prev = Infinity, grow = 0;
  for (let it = 1; it <= maxIter; it++) {
    for (let i = 0; i < m; i++) {
      if (n[i] <= 1e-9) {
        if (Math.abs(M[i]) > 1e-9) return { ok: false, w, e, n, kappa: kap, it, failIndex: i, reason: 'tension' };
        e[i] = 0; kap[i] = 0; continue;
      }
      e[i] = M[i] / n[i] + S.Imp[i] + w[i];
      const k = sectionCurvature(n[i], e[i], t, f, E);
      if (!Number.isFinite(k)) return { ok: false, w, e, n, kappa: kap, it, failIndex: i, reason: 'section' };
      kap[i] = k;
    }
    let delta = 0, wmax = 0;
    for (let i = 0; i < m; i++) {
      let s = 0;
      const row = i * m;
      for (let j = 0; j < m; j++) s += G[row + j] * kap[j];
      delta = Math.max(delta, Math.abs(s - w[i]));
      w[i] = s;
      wmax = Math.max(wmax, Math.abs(s));
    }
    if (wmax > 2 * t) return { ok: false, w, e, n, kappa: kap, it, failIndex: argmaxAbs(w), reason: 'stability' };
    if (delta < tol) {
      for (let i = 0; i < m; i++) if (n[i] > 1e-9) e[i] = M[i] / n[i] + S.Imp[i] + w[i];
      return { ok: true, w, e, n, kappa: kap, it, failIndex: -1 };
    }
    if (delta > prev * 1.0000001) { if (++grow > 15) return { ok: false, w, e, n, kappa: kap, it, failIndex: argmaxAbs(w), reason: 'stability' }; }
    else grow = 0;
    prev = delta;
  }
  return { ok: false, w, e, n, kappa: kap, it: maxIter, failIndex: argmaxAbs(w), reason: 'stability' };
}

function argmaxAbs(a) {
  let k = 0;
  for (let i = 1; i < a.length; i++) if (Math.abs(a[i]) > Math.abs(a[k])) k = i;
  return k;
}

/**
 * Grenzfaktor eines Parameters x (Vertikallasten bzw. Querlast) mit Bisektion.
 * solve(x, w0) → Lösung; Rückgabe {xMax, xMin?, last (Lösung bei xMax), fail (erste Lösung oberhalb)}.
 */
function limitFactor(solve, opts = {}) {
  const rtol = opts.rtol ?? 2e-4;
  const xmaxCap = opts.cap ?? 1e3;
  let lo = null, hi = null, loSol = null, hiSol = null;
  const s1 = solve(1, null);
  if (s1.ok) { lo = 1; loSol = s1; }
  else {
    hi = 1; hiSol = s1;
    // nach unten suchen
    for (let x = 0.5; x >= 1 / 4096; x /= 2) {
      const s = solve(x, null);
      if (s.ok) { lo = x; loSol = s; break; }
      hi = x; hiSol = s;
    }
    if (lo === null) {
      // nach oben suchen (z.B. Querlast, die eine grössere Normalkraft erfordert)
      for (let x = 2; x <= 64; x *= 2) {
        const s = solve(x, null);
        if (s.ok) { lo = x; loSol = s; hi = null; break; }
      }
      if (lo === null) return { xMax: 0, last: null, fail: s1, none: true };
    }
  }
  if (hi === null) {
    let x = lo * 2;
    for (;;) {
      if (x > xmaxCap) return { xMax: Infinity, last: loSol, fail: null };
      const s = solve(x, loSol.w);
      if (s.ok) { lo = x; loSol = s; x *= 2; } else { hi = x; hiSol = s; break; }
    }
  }
  while ((hi - lo) / hi > rtol) {
    const mid = (lo + hi) / 2;
    const s = solve(mid, loSol.w);
    if (s.ok) { lo = mid; loSol = s; } else { hi = mid; hiSol = s; }
  }
  return { xMax: lo, last: loSol, fail: hiSol };
}

/** Grösster Laststeigerungsfaktor auf die Vertikallasten (Querlast mit Faktor mu fest). */
export function bucklingFactor(S, mu = 1) {
  return limitFactor((x, w0) => solveStrip(S, x, mu, w0));
}

/** Modell mit anderer Exzentrizität der Resultierenden am Wandfuss (gleiche Querlast und Vorverformung). */
export function withBottomEccentricity(S, eBot) {
  const M1 = new Float64Array(S.m);
  const h = S.h, nBot = S.N[0];
  const Mtop = S.nTop * S.eTop, Mbot = nBot * eBot;
  for (let i = 0; i < S.m; i++) M1[i] = Mbot + (Mtop - Mbot) * S.z[i] / h;
  return { ...S, M1, eBot };
}

/**
 * Bogenwirkung bei Querlast: Lage der Resultierenden am Wandfuss innerhalb des zulässigen Bereichs
 * so wählen, dass der Laststeigerungsfaktor auf die Querlast maximal wird (statische Methode).
 * Gesucht wird auf der Seite entgegen der Durchbiegung (Goldener Schnitt).
 */
export function archingSearch(model, nBot, eBotUser, t, f) {
  const eLim = Math.max(0, t / 2 - nBot / (2 * f) - 0.002 * t);
  const mid = Math.floor(model.m / 2);
  const dir = model.Mq[mid] >= 0 ? -1 : 1; // Resultierende zur Gegenseite der Querlast
  const evalAt = (e) => {
    const S = withBottomEccentricity(model, e);
    const lf = lateralFactor(S, 1);
    return { e, S, lf, mu: lf.none ? -1 : lf.xMax };
  };
  let best = evalAt(eBotUser);
  const consider = (c) => { if (c.mu > best.mu + 1e-9) best = c; };
  const gr = (Math.sqrt(5) - 1) / 2;
  let a = 0, b = dir * eLim;
  let c = b - gr * (b - a), d = a + gr * (b - a);
  let fc = evalAt(c), fd = evalAt(d);
  consider(fc); consider(fd); consider(evalAt(b));
  for (let i = 0; i < 9; i++) {
    if (fc.mu > fd.mu) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = evalAt(c); consider(fc); }
    else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = evalAt(d); consider(fd); }
  }
  return { model: best.S, lf: best.lf, eBot: best.e };
}

/** Grösster Laststeigerungsfaktor auf die Querlast (Vertikallasten mit Faktor lam fest). */
export function lateralFactor(S, lam = 1) {
  return limitFactor((x, w0) => solveStrip(S, lam, x, w0));
}

// ====================================================================== EN 1996-1-1 Anhang G

/**
 * Abminderungsfaktor in Wandmitte nach EN 1996-1-1, Anhang G (G.1–G.3).
 * o: {hef, t, emk, fk, E}
 */
export function phiMidEN(o) {
  const lam = o.hef / o.t * Math.sqrt(o.fk / o.E);
  const A1 = 1 - 2 * o.emk / o.t;
  const u = (lam - 0.063) / (0.73 - 1.17 * o.emk / o.t);
  const phi = A1 > 0 ? A1 * Math.exp(-u * u / 2) : 0;
  return { lam, A1, u, phi: Math.max(0, phi) };
}

/** Abminderungsfaktor am Wandkopf/-fuss Φi = 1 − 2·ei/t (EN 1996-1-1 (6.4)), ei ≥ 0.05·t. */
export function phiEndEN(ei, t) {
  const e = Math.max(Math.abs(ei), 0.05 * t);
  return { e, phi: Math.max(0, 1 - 2 * e / t) };
}

// ====================================================================== Schub in Wandebene

/**
 * Querkraftwiderstand einer Wandscheibe mit Spannungsfeld (geneigtes Druckfeld über der
 * Druckzone am Wandfuss, Fliessbedingungen nach Ganz/Thürlimann ohne Kohäsion):
 *   Druckzone   lc = l − 2·V·h0/N
 *   Druckfeld   σx/fxd + σy/fyd ≤ 1 mit σx = N/(t·lc), σy = τ²/σx = V²/(N·t·lc)
 *   → VRd,c = −t·h0·fyd + √((t·h0·fyd)² + fyd·N·(t·l − N/fxd))
 *   Gleiten     V ≤ μ·N
 * Einheiten: N, V [kN]; t, l, h0 [m]; fxd, fyd [kN/m²].
 */
export function shearSIA({ N, V = 0, t, l, h0, fxd, fyd, mu }) {
  if (!(N > 0)) return { VRd: 0, Vstrut: 0, Vfric: 0, mode: 'Zug', lc: 0 };
  const a = t * h0 * fyd;
  const disc = a * a + fyd * N * (t * l - N / fxd);
  const Vstrut = t * l * fxd > N && disc > 0 ? Math.max(0, -a + Math.sqrt(disc)) : 0;
  const Vfric = mu * N;
  const VRd = Math.min(Vstrut, Vfric);
  const st = shearStateSIA({ N, V, t, l, h0 });
  return { VRd, Vstrut, Vfric, mode: Vstrut <= Vfric ? 'Druckfeld' : 'Gleiten', ...st };
}

/** Spannungszustand des Druckfelds für gegebene Einwirkungen. */
export function shearStateSIA({ N, V, t, l, h0 }) {
  const e = N > 0 ? V * h0 / N : Infinity;
  const lc = Math.max(0, l - 2 * e);
  const sx = lc > 0 ? N / (t * lc) : Infinity;
  const tau = lc > 0 ? V / (t * lc) : Infinity;
  const sy = lc > 0 ? tau * tau / sx : Infinity;
  return { e, lc, sx, tau, sy, alpha: Math.atan2(V, N) };
}

/**
 * Querkraftwiderstand nach EN 1996-1-1, 6.2 und 3.6.2:
 *   fvk = fvk0 + 0.4·σd ≤ fvlt,  fvd = fvk/γM,  VRd = fvd·t·lc
 *   lc überdrückte Länge bei linearer Spannungsverteilung (gerissen: lc = 3·(l/2 − e)).
 * Zusätzlich Normalkraft in Wandebene NRd = fxd·t·(l − 2e).
 */
export function shearEN({ N, V, t, l, h0, fvk0, fvlt, gammaM, fxd }) {
  if (!(N > 0)) return { VRd: 0, NRd: 0, lc: 0, sd: 0, fvk: 0, fvd: 0, e: Infinity };
  const e = V * h0 / N;
  let lc = e <= l / 6 ? l : 3 * (l / 2 - e);
  lc = Math.max(0, Math.min(l, lc));
  const sd = lc > 0 ? N / (t * lc) : Infinity;
  const fvk = Math.min(fvk0 + 0.4 * sd, fvlt);
  const fvd = fvk / gammaM;
  return { VRd: fvd * t * lc, NRd: fxd * t * Math.max(0, l - 2 * e), lc, sd, fvk, fvd, e };
}

// ====================================================================== Teilflächenbelastung

/**
 * Teilflächenbelastung nach EN 1996-1-1, 6.1.3 (Gl. 6.9, 6.10).
 * o: {a (Länge längs Wand), b (Tiefe), x (Abstand linker Rand Lastfläche vom Wandende), l, t, hc, fd, solid}
 */
export function concentratedEN(o) {
  const { a, b, x, l, t, hc, fd } = o;
  const Ab = a * b;
  const a1 = Math.max(0, Math.min(x, l - x - a));
  const spread = hc / 2 / SQRT3; // Lastausbreitung unter 60° bis Wandmitte
  const left = Math.max(0, Math.min(x, spread)), right = Math.max(0, Math.min(l - x - a, spread));
  const lefm = a + left + right;
  const Aef = lefm * t;
  const ratio = Math.min(Ab / Aef, 0.45);
  let beta = (1 + 0.3 * a1 / hc) * (1.5 - 1.1 * ratio);
  const betaMax = Math.min(1.25 + a1 / (2 * hc), 1.5);
  beta = Math.max(1, Math.min(beta, betaMax));
  if (!o.solid) beta = 1;
  return { Ab, a1, lefm, Aef, ratio, beta, betaMax, NRdc: beta * Ab * fd, spread };
}

// ====================================================================== Kelleraussenwand

/**
 * Vereinfachter Nachweis von Kelleraussenwänden nach EN 1996-3, 4.5 (Gl. 4.15–4.17).
 * o: {t, h, he, rhoE, bc, fd} → NmaxRd = t·fd/3, NminReq = ρe·h·he²/(β·t) [kN/m]
 */
export function basementEN(o) {
  const { t, h, he, rhoE, fd } = o;
  const bc = o.bc > 0 ? o.bc : Infinity;
  let beta;
  if (bc >= 2 * h) beta = 20;
  else if (bc <= h) beta = 40;
  else beta = 60 - 20 * bc / h;
  return { beta, NmaxRd: t * fd / 3, NminReq: rhoE * h * he * he / (beta * t) };
}

// ====================================================================== Gesamtberechnung

export const CHECK_INFO = {
  top: { label: 'Normalkraft Wandkopf', ref: 'SIA 266, 4.3 · Spannungsblock' },
  bot: { label: 'Normalkraft Wandfuss', ref: 'SIA 266, 4.3 · Spannungsblock' },
  buck: { label: 'Normalkraft mit Knicken', ref: 'SIA 266, 4.3 · Th. 2. Ordnung' },
  buckEN: { label: 'Normalkraft Wandmitte (Φ_m)', ref: 'EN 1996-1-1, 6.1.2, Anh. G' },
  shear: { label: 'Querkraft in Wandebene', ref: 'SIA 266, 4.4 · Spannungsfeld' },
  shearEN: { label: 'Querkraft in Wandebene', ref: 'EN 1996-1-1, 6.2' },
  shearN: { label: 'Normalkraft in Wandebene', ref: 'EN 1996-1-1, 6.1.2' },
  conc: { label: 'Teilflächenpressung', ref: 'EN 1996-1-1, 6.1.3' },
  concMid: { label: 'Lastausbreitung bis Wandmitte', ref: 'EN 1996-1-1, 6.1.3 (4)' },
  lat: { label: 'Querbelastung (Stützlinie)', ref: 'SIA 266, 4.3 · Th. 2. Ordnung' },
  basMax: { label: 'Kellerwand: Normalkraft max.', ref: 'EN 1996-3, 4.5 (4.15)' },
  basMin: { label: 'Kellerwand: Normalkraft min.', ref: 'EN 1996-3, 4.5 (4.16)' },
  slender: { label: 'Schlankheit h_ef/t', ref: 'EN 1996-1-1, 5.5.1.4' },
  crack: { label: 'Klaffende Fuge (Gebrauch)', ref: 'Empfehlung e ≤ t/3' },
};

/** Seitliche Halterungen {L, R} (ältere Projekte: Anzahl «sides», eine Querwand liegt links). */
export function sideFlags(W) {
  if (W.sideL !== undefined || W.sideR !== undefined) return { L: !!W.sideL, R: !!W.sideR };
  const n = +W.sides || 0;
  return { L: n >= 1, R: n >= 2 };
}

/** Setzt die seitlichen Halterungen und hält die Anzahl «sides» synchron. */
export function setSides(W, L, R) {
  W.sideL = !!L; W.sideR = !!R;
  W.sides = (L ? 1 : 0) + (R ? 1 : 0);
}

/** Ist mindestens eine Einwirkung erfasst? (sonst ist das Projekt noch unvollständig) */
export function hasLoads(p) {
  const L = p.loads || {};
  const conc = L.conc?.on && ((+L.conc.G || 0) + (+L.conc.Q || 0) > 0);
  return !!(+L.gW || +L.qW || +L.gD || +L.qD || +L.wind || (L.earth?.on && L.earth.he > 0) || +L.Vw || +L.Ve || conc);
}

/** Flags für die Standardkombinationen aus den erfassten Lasten. */
export function loadFlags(p) {
  const L = p.loads || {};
  return { wind: !!(+L.wind || +L.Vw), earth: !!(L.earth?.on && L.earth.he > 0), quake: !!+L.Ve };
}

/** Normiert eine Kombinationszeile. */
function comboFactors(c) {
  const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
  return { g: num(c.g), q: num(c.q), w: num(c.w), e: num(c.e), ae: num(c.ae) };
}

/** Prüft die Eingaben und wirft verständliche Fehlermeldungen. */
export function validate(p) {
  const W = p.wall, M = p.material, L = p.loads;
  const err = (msg) => { throw new Error(msg); };
  if (!(W.h > 0)) err('Die Wandhöhe h muss grösser als 0 sein – bitte im Register «Wand» eine Höhe eingeben (z.B. 2.60 m).');
  if (!(W.t > 0)) err('Die Wanddicke t muss grösser als 0 sein – bitte im Register «Wand» eingeben (z.B. 150 mm).');
  if (!(W.l > 0)) err('Die Wandlänge l muss grösser als 0 sein – bitte im Register «Wand» eingeben (z.B. 4.00 m).');
  if (W.t / 1000 > W.h) err('Die Wanddicke ist grösser als die Wandhöhe – bitte t in mm eingeben (z.B. 150 statt 0.15).');
  if (!(M.fxk > 0)) err('Die Druckfestigkeit fxk muss grösser als 0 sein – bitte im Register «Material» prüfen.');
  if (!(M.fyk > 0)) err('Die Druckfestigkeit parallel zu den Lagerfugen fyk muss grösser als 0 sein – bitte im Register «Material» prüfen.');
  if (!(M.gammaM > 0)) err('Der Widerstandsbeiwert γM muss grösser als 0 sein (SIA 266: γM = 2.0).');
  if (!M.exkAuto && !(M.Exk > 0)) err('Der Elastizitätsmodul Exk muss grösser als 0 sein – oder «Exk automatisch» aktivieren.');
  if (L.eMode === 'slab' && !(L.aD > 0 && L.aD <= W.t)) err(`Die Auflagertiefe der Decke a muss zwischen 0 und t = ${W.t} mm liegen – bitte im Register «Lasten» korrigieren.`);
  if (L.conc?.on) {
    const c = L.conc;
    if (!(c.a > 0) || !(c.b > 0)) err('Die Lastfläche der Einzellast (Länge a und Tiefe b) muss grösser als 0 sein – bitte im Register «Lasten» ergänzen.');
    if (c.b > W.t) err(`Die Tiefe der Lastfläche b = ${c.b} mm ist grösser als die Wanddicke t = ${W.t} mm – bitte b verkleinern.`);
    if (c.x < 0 || c.x + c.a / 1000 > W.l + 1e-9) err('Die Lastfläche der Einzellast liegt nicht vollständig auf der Wand – bitte die Lage x bzw. die Länge a anpassen.');
  }
  for (const [i, o] of (W.openings || []).entries()) {
    if (!(o.b > 0) || !(o.hgt > 0)) err(`Öffnung ${i + 1}: Breite und Höhe müssen grösser als 0 sein.`);
    if (o.x < 0 || o.x + o.b > W.l + 1e-9) err(`Öffnung ${i + 1} liegt nicht innerhalb der Wandlänge – bitte x oder die Breite anpassen.`);
    if (o.y < 0 || o.y + o.hgt > W.h + 1e-9) err(`Öffnung ${i + 1} ragt über die Wandhöhe hinaus – bitte Brüstung oder Höhe anpassen.`);
  }
  const open = (W.openings || []).reduce((s, o) => s + (o.b > 0 ? o.b : 0), 0);
  if (open >= W.l * 0.95) err('Die Öffnungen sind zusammen fast so breit wie die Wand – bitte die Öffnungen prüfen.');
  if (!(p.combos || []).some((c) => c.on !== false)) err('Es ist keine Lastkombination aktiv – bitte im Register «Lasten» mindestens eine Kombination aktivieren.');
}

/**
 * Hauptberechnung. p: Projekt (siehe main.js defaultProject)
 */
export function computeWall(p) {
  validate(p);
  const W = p.wall, L = p.loads, S = p.settings || {};
  const md = designValues(p.material);
  const t = W.t / 1000, h = W.h, l = W.l;
  const fxd = md.fxd * 1000, fyd = md.fyd * 1000, Exd = md.Exd * 1000; // kN/m²
  const notes = [];

  // Öffnungen: Lastkonzentration auf die Pfeiler
  const openW = (W.openings || []).reduce((s, o) => s + (o.b > 0 ? o.b : 0), 0);
  const kOpen = S.openingConc !== false && openW > 0 ? l / (l - openW) : 1;

  // Exzentrizität der Deckenauflagerkraft
  const eD = L.eMode === 'slab' ? t / 2 - (L.aD / 1000) / 3 : L.eMode === 'centric' ? 0 : (L.eD || 0) / 1000;
  const eBot = (L.eU || 0) / 1000;

  // Knicklänge (mit massgebender Kopfexzentrizität bei Volllast)
  const nWk = (L.gW || 0) + (L.qW || 0), nDk = (L.gD || 0) + (L.qD || 0);
  const eTopChar = nWk + nDk > 0 ? nDk * eD / (nWk + nDk) : 0;
  const sf = sideFlags(W);
  const eff = effectiveHeight({ h, t, mode: W.support, rhoManual: W.rhoManual, sides: (sf.L ? 1 : 0) + (sf.R ? 1 : 0), ls: W.ls > 0 ? W.ls : l, eTop: eTopChar });
  const hef = eff.hef;
  const slender = hef / t;
  notes.push(...eff.notes);
  const nImp = S.impN > 0 ? S.impN : 450;
  const eImp = hef / nImp;

  // Querlast
  const earth = L.earth || {};
  const earthOn = !!earth.on && earth.he > 0;
  const pWind = (z, c) => c.w * (L.wind || 0);
  const pEarth = (z, c) => (earthOn && z < earth.he ? c.e * (earth.K ?? 0.5) * ((earth.gs ?? 19) * (earth.he - z) + (earth.qs || 0)) : 0);

  const combos = (p.combos || []).map((c, idx) => ({ ...c, idx })).filter((c) => c.on !== false);
  const out = [];
  for (const c of combos) {
    const F = comboFactors(c);
    const uls = c.type !== 'SLS';
    const nW = (F.g * (L.gW || 0) + F.q * (L.qW || 0)) * kOpen;
    const nD = (F.g * (L.gD || 0) + F.q * (L.qD || 0)) * kOpen;
    const nTop = nW + nD;
    const eTop = nTop > 0 ? nD * eD / nTop : 0;
    const gw = F.g * md.gamma * t; // kN/m je m Höhe
    const nMid = nTop + gw * h / 2, nBot = nTop + gw * h;
    const pFn = (z) => pWind(z, F) + pEarth(z, F);
    const pTop = pFn(h), pBot = pFn(0);
    const pMax = maxAbsP(pFn, h, earthOn ? earth.he : null);
    const hasLat = pMax > 1e-9;
    // Kriechen über effektiven E-Modul (Anteil ständiger Last in Wandmitte)
    const nPermMid = (F.g * ((L.gW || 0) + (L.gD || 0)) * kOpen + gw * h / 2);
    const rPerm = nMid > 0 ? Math.min(1, Math.max(0, nPermMid / nMid)) : 1;
    const creepOn = S.creep !== false && md.phi > 0;
    const phiEff = creepOn ? md.phi * rPerm : 0;
    const Eeff = Exd / (1 + phiEff);
    const model = buildStrip({ h, hef, t, f: fxd, E: Eeff, nTop, gw, eTop, eBot, pFn: hasLat ? pFn : null, eImp, nseg: S.nseg || 32 });
    const atDesign = solveStrip(model, 1, 1);
    const r = {
      idx: c.idx, name: c.name || `LK ${c.idx + 1}`, type: uls ? 'ULS' : 'SLS', F,
      nW, nD, nTop, nMid, nBot, eTop, eBot, eD, gw, kOpen, hasLat, pTop, pBot, pMax,
      phiEff, Eeff, rPerm, model, profile: makeProfile(model, atDesign), designOk: atDesign.ok, designReason: atDesign.reason,
      checks: {},
    };
    if (uls) {
      // ---------------------------------------------------- 1 Normalkraft
      r.top = { n: nTop, e: eTop, nRd: sectionResistance(eTop, t, fxd), phi: Math.max(0, 1 - 2 * Math.abs(eTop) / t) };
      r.bot = { n: nBot, e: eBot, nRd: sectionResistance(eBot, t, fxd), phi: Math.max(0, 1 - 2 * Math.abs(eBot) / t) };
      r.checks.top = { Ed: r.top.n, Rd: r.top.nRd, eta: etaOf(r.top.n, r.top.nRd), unit: 'kN/m' };
      r.checks.bot = { Ed: r.bot.n, Rd: r.bot.nRd, eta: etaOf(r.bot.n, r.bot.nRd), unit: 'kN/m' };
      if (S.method === 'EN') {
        // EN 1996-3, 4.5 deckt den Erddruck ab → Φm ohne Erddruckmoment (nur Wind)
        const earthByEN3 = earthOn && S.basementEN !== false && F.e > 0;
        const MqMid = earthByEN3 ? F.w * (L.wind || 0) * h * h / 8 : undefined;
        if (earthByEN3) r.enNoEarth = true;
        r.en = bucklingEN({ model, t, hef, eImp, fxd, fk: md.fxk, Ek: md.Exk, phiInf: creepOn ? md.phi : 0, nTop, nBot, nMid, eTop, eBot, h, MqMid });
        r.checks.top = { Ed: nTop, Rd: r.en.top.nRd, eta: etaOf(nTop, r.en.top.nRd), unit: 'kN/m' };
        r.checks.bot = { Ed: nBot, Rd: r.en.bot.nRd, eta: etaOf(nBot, r.en.bot.nRd), unit: 'kN/m' };
        r.checks.buckEN = { Ed: nMid, Rd: r.en.mid.nRd, eta: etaOf(nMid, r.en.mid.nRd), unit: 'kN/m' };
        r.phiMid = r.en.mid.phi;
      } else {
        const bf = bucklingFactor(model, 1);
        r.buck = summarizeLimit(bf, model, fxd, t);
        r.checks.buck = {
          Ed: r.buck.nEd, Rd: r.buck.nRd, eta: r.buck.eta, unit: 'kN/m',
          detail: bf.none ? (hasLat ? 'kein Gleichgewicht – Querlast zu gross für die vorhandene Normalkraft' : 'kein Gleichgewicht – Exzentrizität zu gross') : `Versagen: ${r.buck.mode}`,
        };
        r.phiMid = Number.isFinite(bf.xMax) ? Math.min(1, bf.xMax * nMid / (t * fxd)) : 1;
      }
      // ---------------------------------------------------- 2 Querkraft in Wandebene
      const V = F.w * (L.Vw || 0) + F.ae * (L.Ve || 0);
      if (Math.abs(V) > 1e-9) {
        const hV = L.hV > 0 ? L.hV : h;
        const h0 = L.topFixed ? hV / 2 : hV;
        const Nsh = nTop / kOpen * l + gw * h * l;
        const Va = Math.abs(V);
        if (S.shearMethod === 'EN') {
          const s = shearEN({ N: Nsh, V: Va, t, l, h0, fvk0: md.fvk0 * 1000, fvlt: md.fvlt * 1000, gammaM: md.gammaM, fxd });
          r.shear = { method: 'EN', N: Nsh, V: Va, h0, hV, ...s };
          r.checks.shearEN = { Ed: Va, Rd: s.VRd, eta: etaOf(Va, s.VRd), unit: 'kN' };
          r.checks.shearN = { Ed: Nsh, Rd: s.NRd, eta: etaOf(Nsh, s.NRd), unit: 'kN' };
        } else {
          const s = shearSIA({ N: Nsh, V: Va, t, l, h0, fxd, fyd, mu: md.mu });
          r.shear = { method: 'SIA', N: Nsh, V: Va, h0, hV, ...s };
          r.checks.shear = { Ed: Va, Rd: s.VRd, eta: etaOf(Va, s.VRd), unit: 'kN', detail: s.mode === 'Gleiten' ? 'massgebend: Gleiten in der Lagerfuge' : 'massgebend: Druckfeld' };
        }
      }
      // ---------------------------------------------------- 3 Teilflächenbelastung
      const C = L.conc || {};
      if (C.on) {
        const Nc = F.g * (C.G || 0) + F.q * (C.Q || 0);
        if (Nc > 0) {
          const ce = concentratedEN({ a: C.a / 1000, b: C.b / 1000, x: C.x || 0, l, t, hc: h, fd: fxd, solid: md.solid });
          const nRdMid = r.phiMid * t * fxd;
          const nEdMid = Nc / ce.lefm + nMid;
          r.conc = { Nc, ...ce, nEdMid, nRdMid, ec: (C.ec || 0) / 1000 };
          r.checks.conc = { Ed: Nc, Rd: ce.NRdc, eta: etaOf(Nc, ce.NRdc), unit: 'kN' };
          r.checks.concMid = { Ed: nEdMid, Rd: nRdMid, eta: etaOf(nEdMid, nRdMid), unit: 'kN/m' };
        }
      }
      // ---------------------------------------------------- 4 Querbelastung
      if (hasLat) {
        const arch = S.arching !== false ? archingSearch(model, nBot, eBot, t, fxd) : null;
        const latModel = arch ? arch.model : model;
        const lf = arch ? arch.lf : lateralFactor(model, 1);
        r.lat = { ...summarizeLimit(lf, latModel, fxd, t), pMax, eU: latModel.eBot, arching: !!arch && Math.abs(latModel.eBot - eBot) > 1e-6 };
        r.lat.profile = makeProfile(latModel, solveStrip(latModel, 1, 1));
        r.lat.eta = lf.none || !(lf.xMax > 0) ? Infinity : Number.isFinite(lf.xMax) ? 1 / lf.xMax : 0;
        r.lat.blocked = lf.none && !solveStrip(model, 1, 0).ok;
        r.checks.lat = {
          Ed: pMax, Rd: Number.isFinite(lf.xMax) ? lf.xMax * pMax : Infinity, eta: r.lat.eta, unit: 'kN/m²',
          detail: r.lat.blocked ? 'Normalkraftnachweis ohne Querlast nicht erfüllt' : null,
        };
      }
      if (earthOn && S.basementEN !== false && F.e > 0) {
        const b = basementEN({ t, h, he: earth.he, rhoE: earth.gs ?? 19, bc: S.bc, fd: fxd });
        r.basement = { ...b, N: nMid };
        r.checks.basMax = { Ed: nMid, Rd: b.NmaxRd, eta: etaOf(nMid, b.NmaxRd), unit: 'kN/m' };
        r.checks.basMin = { Ed: b.NminReq, Rd: nMid, eta: nMid > 0 ? b.NminReq / nMid : Infinity, unit: 'kN/m', edLabel: 'erf.', rdLabel: 'vorh.' };
      }
    } else if (S.sls !== false) {
      // ---------------------------------------------------- 5 Gebrauchstauglichkeit (Th. 1. O.)
      const mid = Math.floor(model.m / 2);
      const eMid1 = model.N[mid] > 0 ? (model.M1[mid] + model.Mq[mid]) / model.N[mid] : 0;
      const eMax = Math.max(Math.abs(eTop), Math.abs(eBot), Math.abs(eMid1));
      r.sls = { eTop, eBot, eMid: eMid1, eMax, lim: t / 3 };
      r.checks.crack = { Ed: eMax * 1000, Rd: t / 3 * 1000, eta: eMax / (t / 3), unit: 'mm' };
    }
    out.push(r);
  }

  // Massgebende Werte je Nachweis
  const checks = [];
  for (const key of Object.keys(CHECK_INFO)) {
    let best = null;
    for (const r of out) {
      const ck = r.checks[key];
      if (!ck) continue;
      if (!best || ck.eta > best.eta || (!Number.isFinite(ck.eta) && Number.isFinite(best.eta))) best = { ...ck, lc: r.name, lcIdx: r.idx };
    }
    if (!best) continue;
    const info = { ...CHECK_INFO[key] };
    if (S.method === 'EN' && (key === 'top' || key === 'bot')) info.ref = 'EN 1996-1-1, 6.1.2.2 (6.4)';
    checks.push({ id: key, ...info, ...best });
  }
  const lambdaLim = S.lambdaLim > 0 ? S.lambdaLim : 27;
  checks.push({ id: 'slender', ...CHECK_INFO.slender, Ed: slender, Rd: lambdaLim, eta: slender / lambdaLim, unit: '', digits: 1, lc: 'alle' });
  if (openW > 0) notes.push(`Öffnungen: Vertikallasten aus dem Wandkopf werden für den Nachweis aus der Ebene mit dem Faktor ${kOpen.toFixed(2)} auf die Pfeiler konzentriert${S.openingConc === false ? ' (deaktiviert)' : ''}. Im Scheibennachweis sind Öffnungen nicht berücksichtigt – Pfeiler bei Bedarf separat nachweisen.`);
  if (earthOn && S.basementEN !== false) {
    const he = earth.he;
    if (h > 2.6) notes.push('EN 1996-3, 4.5: Lichte Wandhöhe h ≤ 2.6 m ist nicht eingehalten – vereinfachter Kellerwandnachweis nicht anwendbar.');
    if (t < 0.2) notes.push('EN 1996-3, 4.5: Wanddicke t ≥ 200 mm ist nicht eingehalten – vereinfachter Kellerwandnachweis nicht anwendbar.');
    if ((earth.qs || 0) > 5) notes.push('EN 1996-3, 4.5: Auflast auf der Geländeoberfläche > 5 kN/m² – vereinfachter Kellerwandnachweis nicht anwendbar.');
    if (he > h) notes.push('EN 1996-3, 4.5: Anschütthöhe h_e grösser als die Wandhöhe – vereinfachter Kellerwandnachweis nicht anwendbar.');
  }
  if (Math.abs(eD) >= t / 2) notes.push(`Die Exzentrizität der Deckenauflagerkraft e_D = ${(eD * 1000).toFixed(1)} mm liegt ausserhalb der Wanddicke (|e_D| ≥ t/2) – Eingabe prüfen.`);
  if (Math.abs(eBot) >= t / 2) notes.push(`Die Exzentrizität am Wandfuss e_u = ${(eBot * 1000).toFixed(1)} mm liegt ausserhalb der Wanddicke (|e_u| ≥ t/2) – kein Tragwiderstand am Wandfuss.`);
  if (S.method === 'EN' && earthOn && S.basementEN !== false) notes.push('EN-Verfahren: Φ_m wird in Kombinationen mit Erddruck ohne Erddruckmoment ermittelt; die Querbelastung aus Erddruck ist durch EN 1996-3, 4.5 und den Stützliniennachweis abgedeckt.');
  if (S.method === 'EN' && earthOn && S.basementEN === false) notes.push('EN-Verfahren: Φ_m nach Anhang G berücksichtigt keine Bogenwirkung. Für Kelleraussenwände den vereinfachten Nachweis nach EN 1996-3, 4.5 aktivieren oder das SIA-Verfahren verwenden.');
  const conc = L.conc || {};
  if (conc.on && Math.abs((conc.ec || 0) / 1000) > t / 4) notes.push('Teilflächenbelastung: Die Exzentrizität der Einzellast ist grösser als t/4 – EN 1996-1-1, 6.1.3 (4) nicht erfüllt, Nachweis gesondert führen.');
  if (conc.on && !md.solid) notes.push('Teilflächenbelastung: Keine Vollsteine (Steingruppe 1) – Erhöhungsfaktor β = 1.0 (EN 1996-1-1, 6.1.3 (1)).');

  let etaMax = 0, gov = null;
  for (const c of checks) if (!gov || c.eta > etaMax || (!Number.isFinite(c.eta) && Number.isFinite(etaMax))) { etaMax = c.eta; gov = c; }

  return {
    t, h, l, md, fxd, fyd, Exd, eff, hef, slender, lambdaLim, eImp, nImp, kOpen, openW, eD, eBot,
    earthOn, combos: out, checks, etaMax, gov, notes, method: S.method === 'EN' ? 'EN' : 'SIA', shearMethod: S.shearMethod === 'EN' ? 'EN' : 'SIA',
  };
}

function etaOf(Ed, Rd) {
  if (!(Ed > 0)) return 0;
  return Rd > 0 ? Ed / Rd : Infinity;
}

function maxAbsP(pFn, h, he) {
  let m = 0;
  for (let i = 0; i <= 50; i++) m = Math.max(m, Math.abs(pFn(h * i / 50)));
  if (he) m = Math.max(m, Math.abs(pFn(0)), Math.abs(pFn(Math.min(h, he) * 0.999)));
  return m;
}

/** Wertet einen Grenzfaktor aus (massgebender Schnitt, Widerstand). */
function summarizeLimit(lf, model, f, t) {
  const fail = lf.fail;
  let idx = fail ? fail.failIndex : -1;
  const last = lf.last;
  if (idx < 0 && last) {
    // keine Versagensstelle bekannt → Schnitt mit grösster Querschnittsausnutzung
    let best = -1;
    for (let i = 0; i < model.m; i++) {
      const u = last.n[i] / Math.max(1e-12, sectionResistance(last.e[i], t, f));
      if (u > best) { best = u; idx = i; }
    }
  }
  if (idx < 0) idx = Math.floor(model.m / 2);
  const x = lf.xMax;
  const nEd = model.N[idx];
  const eta = lf.none ? Infinity : x > 0 ? (Number.isFinite(x) ? 1 / x : 0) : Infinity;
  const eAtLimit = last ? last.e[idx] : NaN;
  const utilLimit = last ? last.n[idx] / Math.max(1e-12, sectionResistance(last.e[idx], t, f)) : NaN;
  const mode = !fail ? 'keine Grenze' : fail.reason === 'tension' ? 'Zug (keine Normalkraft)'
    : fail.reason === 'section' || utilLimit >= 0.95 ? 'Querschnittswiderstand (Spannungsblock)' : 'Stabilität (Knicken)';
  return {
    xMax: x, eta, idx, z: model.z[idx], nEd, nRd: Number.isFinite(x) ? x * nEd : Infinity,
    phi: Number.isFinite(x) ? Math.min(1, x * nEd / (t * f)) : 1, mode, eAtLimit, utilLimit, none: !!lf.none,
    limitProfile: last ? makeProfile(model, last) : null,
  };
}

/** Verlauf über die Höhe für Darstellung und Bericht (e1: Th. 1. O. aus Endmomenten, eq: aus Querlast). */
function makeProfile(model, sol) {
  const pts = [];
  for (let i = 0; i < model.m; i++) {
    const n = sol.n[i];
    const ok = n > 1e-9 && model.N[i] > 1e-9;
    const e1 = ok ? model.M1[i] / model.N[i] : 0;
    const eq = ok ? sol.e[i] - e1 - model.Imp[i] - sol.w[i] : 0;
    pts.push({ z: model.z[i], n, e1, eq, imp: model.Imp[i], w: sol.w[i], e: sol.e[i], util: ok ? n / Math.max(1e-12, sectionResistance(sol.e[i], model.t, model.f)) : 0 });
  }
  return { ok: sol.ok, reason: sol.reason, pts };
}

/** Nachweis nach EN 1996-1-1, 6.1.2.2 und Anhang G. */
function bucklingEN({ model, t, hef, eImp, fxd, fk, Ek, phiInf, nTop, nBot, nMid, eTop, eBot, h, MqMid }) {
  const mid = Math.floor(model.m / 2);
  const ti = phiEndEN(Math.abs(eTop) + eImp, t);
  const bi = phiEndEN(Math.abs(eBot) + eImp, t);
  const Mmd = model.M1[mid];
  const Mq = MqMid !== undefined ? MqMid : model.Mq[mid];
  const e0 = nMid > 0 ? Mmd / nMid : 0;
  const ehm = nMid > 0 ? Mq / nMid : 0;
  const em = Math.abs(e0 + ehm) + eImp;
  const ratio = hef / t;
  const ek = ratio > 15 ? 0.002 * phiInf * ratio * Math.sqrt(t * em) : 0;
  const emk = Math.max(em + ek, 0.05 * t);
  const g = phiMidEN({ hef, t, emk, fk, E: Ek });
  return {
    top: { e: ti.e, phi: ti.phi, nRd: ti.phi * t * fxd, n: nTop },
    bot: { e: bi.e, phi: bi.phi, nRd: bi.phi * t * fxd, n: nBot },
    mid: { e0, ehm, em, ek, emk, ...g, nRd: g.phi * t * fxd, n: nMid },
  };
}

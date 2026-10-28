// Grundbruch, Gleiten und Ausmittigkeit von Flachfundationen (DOM-frei)
//
// Tragwiderstand nach EN 1997-1, Anhang D (entspricht der Grundbruchformel in SIA 267):
//  drainiert:    R/A' = c'·N_c·b_c·s_c·i_c + q'·N_q·b_q·s_q·i_q + 0.5·γ'·B'·N_γ·b_γ·s_γ·i_γ
//  undrainiert:  R/A' = (π+2)·c_u·b_c·s_c·i_c + q
//  N_q = e^{π tan φ}·tan²(45°+φ/2),  N_c = (N_q−1)·cot φ,  N_γ = 2·(N_q−1)·tan φ
// Wirksame Fläche nach Meyerhof: B' = B − 2|e_B|, L' = L − 2|e_L| (B' ≤ L').
import { rad, deg, verticalStress, averageParams, layerAt, designParams } from './soil.js';

const PI = Math.PI;

/** Tragfähigkeitsbeiwerte N_q, N_c, N_γ (EN 1997-1, D.4; N_γ für rauhe Sohle δ ≥ φ/2). */
export function bearingFactors(phi) {
  if (phi < 1e-6) return { Nq: 1, Nc: PI + 2, Ng: 0 };
  const t = Math.tan(rad(phi));
  const Nq = Math.exp(PI * t) * Math.tan(rad(45 + phi / 2)) ** 2;
  return { Nq, Nc: (Nq - 1) / t, Ng: 2 * (Nq - 1) * t };
}

/**
 * Wirksame Fundamentfläche.
 * shape 'strip' (je m, L' = 1), 'rect', 'circle' (B = Durchmesser; Ersatzrechteck nach API RP 2GEO).
 * Rückgabe {Bp, Lp, A, swapped, ratio (B'/L', 0 für Streifen), e (Kreis)}
 */
export function effectiveArea({ shape, B, L, eB = 0, eL = 0 }) {
  if (shape === 'strip') {
    const Bp = B - 2 * Math.abs(eB);
    if (Bp <= 0) throw new Error(`Die Lastausmitte e = ${Math.abs(eB).toFixed(2)} m ist grösser als B/2: Die Resultierende liegt ausserhalb des Fundaments. Fundament verbreitern oder Momente verkleinern.`);
    return { Bp, Lp: 1, A: Bp, swapped: false, ratio: 0 };
  }
  if (shape === 'circle') {
    const R = B / 2, e = Math.hypot(eB, eL);
    if (e >= R) throw new Error(`Die Lastausmitte e = ${e.toFixed(2)} m ist grösser als der Radius: Fundament vergrössern oder Momente verkleinern.`);
    if (e < 1e-9) { const A = PI * R * R; const s = Math.sqrt(A); return { Bp: s, Lp: s, A, swapped: false, ratio: 1, e: 0 }; }
    const A = 2 * (R * R * Math.acos(e / R) - e * Math.sqrt(R * R - e * e));
    const be = 2 * (R - e), le = 2 * R * Math.sqrt(1 - (1 - be / (2 * R)) ** 2);
    const Lp = Math.sqrt(A * le / be), Bp = A / Lp;
    return { Bp, Lp, A, swapped: false, ratio: Bp / Lp, e };
  }
  let Bp = B - 2 * Math.abs(eB), Lp = L - 2 * Math.abs(eL);
  if (Bp <= 0 || Lp <= 0) throw new Error('Die Resultierende liegt ausserhalb des Fundaments (B\' ≤ 0 bzw. L\' ≤ 0). Fundament vergrössern oder Momente verkleinern.');
  let swapped = false;
  if (Bp > Lp) { [Bp, Lp] = [Lp, Bp]; swapped = true; }
  return { Bp, Lp, A: Bp * Lp, swapped, ratio: Bp / Lp };
}

/**
 * Grundbruchwiderstand R [kN bzw. kN/m] für gegebene Lasten und (gemittelte) Bodenkennwerte.
 * p: {Bp, Lp, A, ratio, strip, V, H, thetaH (Winkel H zu L' in °, 90 = H parallel B'), alphaBase [°],
 *     drained, phi, c, cu, gammaEff, qEff, qTot}
 */
export function bearingResistance(p) {
  const { Bp, A, V } = p;
  const H = Math.abs(p.H || 0);
  const r = p.strip ? 0 : p.ratio;
  const a = rad(p.alphaBase || 0);
  if (!p.drained || (p.phi < 1e-6)) {
    // undrainiert (bzw. φ = 0): R/A' = (π+2)·c_u·b_c·s_c·i_c + q
    const cu = p.drained ? p.c : p.cu;
    const q = p.drained ? p.qEff : p.qTot;
    const bc = 1 - 2 * a / (PI + 2);
    const sc = 1 + 0.2 * r;
    const lim = A * cu;
    const ic = H <= 0 ? 1 : lim > 0 && H < lim ? 0.5 * (1 + Math.sqrt(1 - H / lim)) : 0;
    const Nc = PI + 2;
    const terms = { c: cu * Nc * bc * sc * ic, q, g: 0 };
    const rr = ic > 0 ? terms.c + terms.q : 0;
    return {
      drained: false, R: rr * A, r: rr, terms,
      N: { Nq: 1, Nc, Ng: 0 }, b: { c: bc, q: 1, g: 1 }, s: { c: sc, q: 1, g: 1 }, i: { c: ic, q: 1, g: 1 },
      m: null, hFail: H > 0 && ic === 0, cu, q,
    };
  }
  const { Nq, Nc, Ng } = bearingFactors(p.phi);
  const tp = Math.tan(rad(p.phi)), sp = Math.sin(rad(p.phi));
  const bq = (1 - a * tp) ** 2, bg = bq, bc = bq - (1 - bq) / (Nc * tp);
  const sq = 1 + r * sp, sg = 1 - 0.3 * r, sc = (sq * Nq - 1) / (Nq - 1);
  const mB = (2 + r) / (1 + r);
  const mL = r > 0 ? (2 + 1 / r) / (1 + 1 / r) : 1;
  const th = rad(p.thetaH ?? 90);
  const m = p.strip ? 2 : mL * Math.cos(th) ** 2 + mB * Math.sin(th) ** 2;
  const den = V + A * p.c / tp;
  const ratio = den > 0 ? H / den : 1;
  const base = Math.max(0, 1 - ratio);
  const iq = H > 0 ? base ** m : 1, ig = H > 0 ? base ** (m + 1) : 1;
  const ic = iq - (1 - iq) / (Nc * tp);
  const terms = {
    c: p.c * Nc * bc * sc * Math.max(0, ic),
    q: p.qEff * Nq * bq * sq * iq,
    g: 0.5 * p.gammaEff * Bp * Ng * bg * sg * ig,
  };
  const rr = terms.c + terms.q + terms.g;
  return {
    drained: true, R: rr * A, r: rr, terms,
    N: { Nq, Nc, Ng }, b: { c: bc, q: bq, g: bg }, s: { c: sc, q: sq, g: sg }, i: { c: Math.max(0, ic), q: iq, g: ig },
    m, hFail: H > 0 && base <= 0,
  };
}

/** Ausnutzungen der Ausmittigkeit: Kern (1. Kernweite) und klaffende Fuge bis zum Schwerpunkt. */
export function eccentricityRatios({ shape, B, L, eB, eL }) {
  if (shape === 'circle') {
    const e = Math.hypot(eB, eL), R = B / 2;
    return { kern: e / (R / 4), gap: e / (0.59 * R), e, limKern: R / 4, limGap: 0.59 * R };
  }
  if (shape === 'strip') return { kern: Math.abs(eB) / (B / 6), gap: Math.abs(eB) / (B / 3), e: Math.abs(eB), limKern: B / 6, limGap: B / 3 };
  const xb = Math.abs(eB) / B, xl = Math.abs(eL) / L;
  return { kern: (xb + xl) * 6, gap: Math.sqrt(xb * xb + xl * xl) * 3, e: Math.hypot(eB, eL), limKern: B / 6, limGap: B / 3 };
}

/**
 * Bodenkennwerte unter der Fundamentsohle in der Tiefe D (gemittelt bis D + 2B').
 * applyM: Bemessungswerte mit γ_M. zFront: Geländeoberfläche (Tiefe) für die Überlagerung.
 */
export function foundationSoil(soil, norm, D, Bp, applyM, zFront = 0) {
  const avg = averageParams(soil, D, D + 2 * Bp, norm, applyM);
  const g = averageParams(soil, D, D + Bp, norm, applyM);
  const st = verticalStress(soil, D, Math.min(zFront, D), 0);
  return { phi: avg.phi, c: avg.c, cu: avg.cu, gammaEff: g.gammaEff, qEff: st.svp, qTot: st.sv, layers: avg.layers, phiSpread: avg.phiSpread, depth: 2 * Bp };
}

/** Sohlreibungswinkel δ_b: Ortbeton δ = φ, Fertigteil δ = 2/3·φ (EN 1997-1, 6.5.3 (10)). */
export function baseFrictionAngle(soil, norm, D, interfaceType, applyM) {
  const L = layerAt(soil.layers, D + 1e-6);
  const p = designParams(L, norm, applyM);
  const k = interfaceType === 'precast' ? 2 / 3 : 1;
  return { delta: deg(Math.atan(k * Math.tan(rad(p.phi)))), cu: p.cu, layer: L, phi: p.phi };
}

const ZERO = { V: 0, HB: 0, HL: 0, MB: 0, ML: 0 };

/**
 * Grundbruchwiderstand für eine Lastkombination ld = {V, HB, HL, MB, ML} (Sohle).
 * Rückgabe {ld, eB, eL, eff, H, soil, res[], gov, R, Rd, eta, sigma}
 */
export function evalFooting(soil, norm, { shape, B, L, D, alphaBase = 0, drainage = 'drained', zFront = 0 }, ld, applyM) {
  if (ld.V <= 0) throw new Error('Die Vertikallast in der Sohle ist ≤ 0 (abhebende Kombination).');
  const eB = ld.MB / ld.V, eL = ld.ML / ld.V;
  const eff = effectiveArea({ shape, B, L, eB, eL });
  let HB = ld.HB, HL = ld.HL;
  if (eff.swapped) [HB, HL] = [HL, HB];
  const H = Math.hypot(HB, HL);
  const thetaH = H > 0 ? deg(Math.atan2(Math.abs(HB), Math.abs(HL))) : 90;
  const soilF = foundationSoil(soil, norm, D, eff.Bp, applyM, zFront);
  const base = { Bp: eff.Bp, Lp: eff.Lp, A: eff.A, ratio: eff.ratio, strip: shape === 'strip', V: ld.V, H, thetaH, alphaBase, phi: soilF.phi, c: soilF.c, cu: soilF.cu, gammaEff: soilF.gammaEff, qEff: soilF.qEff, qTot: soilF.qTot };
  const res = [];
  if (drainage !== 'undrained') res.push(bearingResistance({ ...base, drained: true }));
  if (drainage !== 'drained') {
    if (soilF.cu > 0) res.push(bearingResistance({ ...base, drained: false }));
    else if (drainage === 'undrained') throw new Error('Undrainierter Nachweis gewählt, aber der Boden unter der Sohle hat c_u = 0. Im Register «Baugrund» c_u,k eingeben oder «drainiert» wählen.');
  }
  let gov = res[0];
  for (const r of res) if (r.R < gov.R) gov = r;
  const Rd = gov.R / norm.gRv;
  return { ld, eB, eL, eff, H, thetaH, soil: soilF, res, gov, R: gov.R, Rd, eta: Rd > 0 ? ld.V / Rd : Infinity, sigma: ld.V / eff.A };
}

/**
 * Vollständige Fundamentanalyse (Grundbruch, Gleiten, Ausmittigkeit).
 * f: {shape, B, L, D, t, selfWeight, gammaC, alphaBase, loads:{G,Q}, drainage:'drained'|'undrained'|'both',
 *     interface:'cast'|'precast'}
 * Lasten an Fundamentoberkante (charakteristisch); Moment positiv, wenn die Resultierende in +x bzw. +y wandert.
 * Alternativ (opts.baseLoads) direkt Sohllasten {G, Q} je {V, HB, HL, MB, ML}.
 */
export function footingAnalysis(soil, norm, f, opts = {}) {
  const shape = f.shape || 'rect';
  const B = Number(f.B), L = shape === 'strip' ? 1 : shape === 'circle' ? Number(f.B) : Number(f.L);
  const D = Math.max(0, Number(f.D) || 0);
  const t = Math.min(Math.max(0, Number(f.t) || 0), D || Infinity);
  if (!(B > 0) || !(L > 0)) throw new Error('Fundamentbreite B und -länge L müssen grösser als 0 sein.');
  const area = shape === 'strip' ? B : shape === 'circle' ? PI * B * B / 4 : B * L;

  let Gb, Qb, Wf = 0, Ws = 0;
  if (opts.baseLoads) {
    Gb = { ...ZERO, ...opts.baseLoads.G }; Qb = { ...ZERO, ...opts.baseLoads.Q };
  } else {
    const G = { ...ZERO, ...(f.loads?.G || {}) }, Q = { ...ZERO, ...(f.loads?.Q || {}) };
    if (shape === 'strip') { G.HL = 0; G.ML = 0; Q.HL = 0; Q.ML = 0; }
    // Eigengewicht Fundament + Hinterfüllung über dem Fundament
    if (f.selfWeight) {
      Wf = area * (Number(f.gammaC) || 25) * t;
      if (D - t > 0) Ws = area * verticalStress(soil, D - t, 0, 0).sv;
    }
    const comp = (P, V) => ({ V, HB: Number(P.HB) || 0, HL: Number(P.HL) || 0, MB: (Number(P.MB) || 0) + (Number(P.HB) || 0) * t, ML: (Number(P.ML) || 0) + (Number(P.HL) || 0) * t });
    Gb = comp(G, (Number(G.V) || 0) + Wf + Ws);
    Qb = comp(Q, Number(Q.V) || 0);
  }
  if (Gb.V + Qb.V <= 0) throw new Error('Die Vertikallast muss grösser als 0 sein (V_G + V_Q > 0). Lasten im Register «Fundament» prüfen.');

  const applyM = norm.geoMode === 'M';
  const drainage = f.drainage || 'drained';
  const geo = { shape, B, L, D, alphaBase: Number(f.alphaBase) || 0, drainage };

  const combine = (gG, gQ) => ({
    gG, gQ,
    V: gG * Gb.V + gQ * Qb.V, HB: gG * Gb.HB + gQ * Qb.HB, HL: gG * Gb.HL + gQ * Qb.HL,
    MB: gG * Gb.MB + gQ * Qb.MB, ML: gG * Gb.ML + gQ * Qb.ML,
  });

  // Kombinationen: ständig ungünstig/günstig × veränderlich mit/ohne
  const combos = [];
  for (const gG of [norm.gG, norm.gGinf]) for (const gQ of [norm.gQ, 0]) {
    const key = `${gG}|${gQ}`;
    if (combos.some((c) => c.key === key)) continue;
    combos.push({ key, ...combine(gG, gQ) });
  }
  const bearing = combos.map((c) => {
    try { return { combo: c, ...evalFooting(soil, norm, geo, c, applyM) }; } catch (e) { return { combo: c, ld: c, eta: Infinity, error: e.message }; }
  });
  if (bearing.every((b) => b.error)) throw new Error(bearing[0].error);
  // massgebend: grösste Ausnutzung; Kombinationen mit Fehler (z.B. Resultierende ausserhalb) zählen als η = ∞
  let govB = bearing[0];
  for (const b of bearing) if (b.eta > govB.eta) govB = b;

  // charakteristischer Widerstand (Information): Lasten G+Q, charakteristische Bodenkennwerte
  let charRes = null;
  try {
    const ck = combine(1, 1);
    const r = evalFooting(soil, { ...norm, gRv: 1 }, geo, ck, false);
    charRes = { Rk: r.R, rk: r.R / r.eff.A, Vk: ck.V, F: r.R / ck.V };
  } catch { charRes = null; }

  // Gleiten: H_d (ständig ungünstig) gegen R_h,d aus günstiger ständiger Vertikallast
  const sl = baseFrictionAngle(soil, norm, D, f.interface || 'cast', applyM);
  const sliding = [];
  for (const gQ of [norm.gQ, 0]) {
    const ld = combine(norm.gG, gQ);
    const Hd = Math.hypot(ld.HB, ld.HL);
    const Vfav = norm.gGinf * Gb.V;
    const items = [];
    if (drainage !== 'undrained') items.push({ type: 'drainiert', Rk: Math.max(0, Vfav) * Math.tan(rad(sl.delta)) });
    if (drainage !== 'drained' && sl.cu > 0) {
      let Ap = area;
      try { Ap = effectiveArea({ shape, B, L, eB: ld.MB / ld.V, eL: ld.ML / ld.V }).A; } catch { /* Ausmitte zu gross */ }
      items.push({ type: 'undrainiert', Rk: Ap * sl.cu });
    }
    let gov = items[0];
    for (const it of items) if (it.Rk < gov.Rk) gov = it;
    const Rd = (gov?.Rk ?? 0) / norm.gRh;
    sliding.push({ gQ, Hd, Vfav, type: gov?.type ?? '–', Rk: gov?.Rk ?? 0, Rd, eta: Hd <= 1e-9 ? 0 : Rd > 0 ? Hd / Rd : Infinity });
  }
  let govS = sliding[0];
  for (const s of sliding) if (s.eta > govS.eta) govS = s;

  // Ausmittigkeit
  const eG = { eB: Gb.V > 0 ? Gb.MB / Gb.V : 0, eL: Gb.V > 0 ? Gb.ML / Gb.V : 0 };
  const eccPerm = eccentricityRatios({ shape, B, L, ...eG });
  let eccDesign = null;
  for (const c of combos) {
    if (c.V <= 0) continue;
    const r = eccentricityRatios({ shape, B, L, eB: c.MB / c.V, eL: c.ML / c.V });
    if (!eccDesign || r.gap > eccDesign.gap) eccDesign = { ...r, combo: c };
  }

  // Grundbruchwiderstand in Abhängigkeit der Breite (Grundriss affin skaliert)
  const curve = [];
  if (!opts.noCurve && !govB.error) {
    const ld = govB.ld;
    const gG = ld.gG ?? norm.gG;
    for (let k = 0; k <= 24; k++) {
      const s = 0.4 + 1.6 * k / 24;
      const aScale = shape === 'strip' ? s : s * s;
      const dV = gG * (Wf + Ws) * (aScale - 1);
      try {
        const r = evalFooting(soil, norm, { ...geo, B: B * s, L: shape === 'rect' ? L * s : shape === 'circle' ? B * s : 1 }, { ...ld, V: ld.V + dV }, applyM);
        curve.push([B * s, r.Rd, ld.V + dV]);
      } catch { /* zu schmal */ }
    }
  }

  return {
    shape, B, L, D, t, area, Wf, Ws, G: Gb, Q: Qb, combos, bearing, gov: govB,
    sliding, govS, slDelta: sl.delta, slLayer: sl.layer.name,
    eccPerm, eccDesign, eG, curve, charRes,
    drainage, applyM,
    etaMax: Math.max(govB.eta, govS.eta, eccPerm.kern, eccDesign?.gap ?? 0),
  };
}

/**
 * Prandtl-Bruchmechanismus (Skizze) unter der wirksamen Breite B' mit Mittelpunkt xc, Sohle bei y0.
 * Liefert {wedge:[[x,y]…], right:[[x,y]…], left:[[x,y]…], depth}
 */
export function prandtlMechanism(xc, y0, Bp, phi) {
  const ka = rad(45 + phi / 2), tp = Math.tan(rad(phi));
  const half = Bp / 2;
  const apex = [xc, y0 - half * Math.tan(ka)];
  const r0 = half / Math.cos(ka);
  const side = (sgn) => {
    const E = [xc + sgn * half, y0];
    const pts = [apex];
    const a0 = Math.atan2(apex[1] - E[1], apex[0] - E[0]);
    const n = 24;
    for (let k = 1; k <= n; k++) {
      const th = (PI / 2) * k / n;
      const ang = a0 + sgn * th;
      const r = r0 * Math.exp(th * tp);
      pts.push([E[0] + r * Math.cos(ang), E[1] + r * Math.sin(ang)]);
    }
    const P = pts[pts.length - 1];
    const dir = rad(45 - phi / 2);
    const s = (y0 - P[1]) / Math.sin(dir);
    pts.push([P[0] + sgn * s * Math.cos(dir), y0]);
    return pts;
  };
  const right = side(1), left = side(-1);
  let ymin = y0;
  for (const p of [...right, ...left]) ymin = Math.min(ymin, p[1]);
  return { wedge: [[xc - half, y0], [xc + half, y0], apex], right, left, depth: y0 - ymin };
}

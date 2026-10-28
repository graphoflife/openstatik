// Stütze – Rechenkern: Stahlbetonstützen nach Theorie 2. Ordnung (DOM-frei, in Node testbar)
//
// Verfahren
//  1. Allgemeines Verfahren (nichtlinear): Stabmodell mit M-κ-Beziehungen bei der jeweiligen
//     Normalkraft (Bemessungswerte fcd, Ecd = Ecm/γcE, fsd; Kriechen durch Streckung der
//     Betondehnungen mit 1 + φef), Gleichgewicht am verformten System, proportionale Laststeigerung
//     bis zum Versagen → Traglastfaktor λu. SIA 262 4.3.7, EN 1992-1-1 5.8.6.
//  2. Vereinfachtes Verfahren: SIA 262 «Modellstütze» mit Bemessungskrümmung χd bzw.
//     EN 1992-1-1 5.8.8 (Nennkrümmung mit Kr, Kφ).
//
// Einheiten: m, kN, kNm, MPa. Normalkraft Nd als Druckkraft positiv.

import {
  materials, columnLawKind, columnLaws, designLaws, sectionGeometry, fiberSection, withLaws,
  layerize, mkTable, axisProps, AXES, LAW_LABELS,
} from './section.js';
import {
  createModel, boundary, SUPPORT_PRESETS, bucklingLoad, imperfectionShape, geometricMatrix, matVec,
  loadVector, linearSolve, ultimateScan, nodalMoments, nodalCurvatures, isStable, solveNonlinear,
} from './column.js';
import { capacityAtN, interactionNM, interactionMyMz, axialCapacity } from '../../js/core/rcsection.js';

export { SUPPORT_PRESETS, LAW_LABELS };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ------------------------------------------------------------------ Projekt

export function newLoadCase(i = 1) {
  return { name: `LF ${i}`, N: 1000, Myt: 0, Myb: 0, Hz: 0, qz: 0, Mzt: 0, Mzb: 0, Hy: 0, qy: 0 };
}

export function defaultProject() {
  return {
    norm: 'SIA',
    L: 3.2,
    support: 'pinned',
    supportZ: 'same',
    custom: { bot: 'fixed', top: 'pinned', sway: false, kBot: 20, kTop: 20 },
    customZ: { bot: 'fixed', top: 'pinned', sway: false, kBot: 20, kTop: 20 },
    betaMode: 'auto',
    betaY: 1,
    betaZ: 1,
    section: { shape: 'rect', b: 300, h: 300, D: 400, nb: 3, nh: 3, n: 8, dia: 18, coverMode: 'nominal', cover: 30, stirrup: 8, axis: 50 },
    concrete: 'C30/37',
    steel: 'B500B',
    lawMode: 'auto',
    imperfection: { mode: 'norm', denom: 300 },
    creep: { phi: 2.0, ratio: 0.7 },
    biaxial: false,
    nEl: 40,
    loadCases: [{ ...newLoadCase(1), N: 1500, Myt: 15, Myb: 10 }],
  };
}

/** Ergänzt fehlende Felder (ältere Dateien, Teileingaben). */
export function normalize(p) {
  const d = defaultProject();
  const out = { ...d, ...p };
  out.section = { ...d.section, ...(p.section || {}) };
  out.custom = { ...d.custom, ...(p.custom || {}) };
  out.customZ = { ...d.customZ, ...(p.customZ || {}) };
  out.imperfection = { ...d.imperfection, ...(p.imperfection || {}) };
  out.creep = { ...d.creep, ...(p.creep || {}) };
  out.loadCases = (Array.isArray(p.loadCases) ? p.loadCases : d.loadCases).map((lc, i) => ({ ...newLoadCase(i + 1), ...lc }));
  return out;
}

// ------------------------------------------------------------------ Normwerte

/**
 * Schiefstellung θi [rad].
 * SIA 262 4.3.7.2: αi = 0.01/√l, 1/300 ≤ αi ≤ 1/100 (l in m).
 * EN 1992-1-1 5.2(5): θi = θ0·αh·αm, θ0 = 1/200, αh = 2/√l mit 2/3 ≤ αh ≤ 1, αm = 1 (Einzelstütze).
 */
export function inclination(norm, L, imp = {}) {
  if (imp.mode === 'user') return imp.denom > 0 ? 1 / imp.denom : 0;
  if (imp.mode === 'none') return 0;
  if (norm === 'EC') {
    const ah = Math.min(1, Math.max(2 / 3, 2 / Math.sqrt(L)));
    return ah / 200;
  }
  return Math.min(1 / 100, Math.max(1 / 300, 0.01 / Math.sqrt(L)));
}

/** Wirksame Kriechzahl φef = φ(∞,t0)·M0Eqp/M0Ed (EN 1992-1-1 5.8.4). */
export function effectiveCreep(creep) {
  return Math.max(0, creep.phi || 0) * Math.min(1, Math.max(0, creep.ratio ?? 1));
}

/**
 * Nennsteifigkeit EI = Kc·Ecd·Ic + Ks·Es·Is (EN 1992-1-1 5.8.7.2, Ks = 1, Kc = k1·k2/(1 + φef)).
 * Rückgabe in kNm².
 */
export function nominalStiffness({ fck, Ecd, Es, Ic, Is, nRel, lam, phiEf }) {
  const k1 = Math.sqrt(fck / 20);
  const k2 = Math.min(0.2, Math.max(0, nRel) * lam / 170);
  const Kc = k1 * k2 / (1 + phiEf);
  return { EI: (Kc * Ecd * Ic + Es * Is) * 1000, k1, k2, Kc };
}

/**
 * Grenzschlankheit nach EN 1992-1-1 5.8.3.1: λlim = 20·A·B·C/√n.
 * rm = M01/M02 (gleiches Vorzeichen = einfache Krümmung, positiv); rm = null → C = 0.7.
 */
export function lambdaLimEC({ phiEf, omega, nRel, rm }) {
  const A = 1 / (1 + 0.2 * phiEf);
  const B = Math.sqrt(1 + 2 * omega);
  const C = rm === null || rm === undefined ? 0.7 : 1.7 - rm;
  return { value: nRel > 0 ? 20 * A * B * C / Math.sqrt(nRel) : Infinity, A, B, C };
}

/**
 * Vereinfachtes Verfahren für eine Biegeachse.
 * EC (EN 1992-1-1 5.8.8): 1/r = Kr·Kφ·εyd/(0.45·d), e2 = (1/r)·l0²/c, c = 10.
 * SIA (SIA 262 4.3.7, Modellstütze): χd = 2·εsd/(0.9·d), e2 = χd·l0²/π².
 * Erstes-Ordnung-Moment: unverschieblich ohne Querlast M0e = 0.6·M02 + 0.4·M01 ≥ 0.4·M02 (EN 1992 5.8.8.2),
 * sonst Maximalmoment 1. Ordnung; jeweils zuzüglich N·ei.
 * inp: {norm, N, l0, ei, d, h, Ac, fcd, fck, fsd, Es, omega, lam, phiEf, M0max, Mend: [Mbot, Mtop] | null, MRd}
 */
export function simplifiedMethod(inp) {
  const { norm, N, l0, ei, d, Ac, fcd, fck, fsd, Es, omega, lam, phiEf } = inp;
  const eyd = fsd / Es;
  const r = { norm, eyd, d, l0, ei, c: norm === 'EC' ? 10 : Math.PI * Math.PI };
  const Nc = Math.max(0, N);
  if (norm === 'EC') {
    const nRel = Nc / (Ac * fcd * 1000);
    const nu = 1 + omega, nbal = 0.4;
    r.nRel = nRel; r.nu = nu;
    r.Kr = Math.min(1, Math.max(0, (nu - nRel) / (nu - nbal)));
    r.betaPhi = 0.35 + fck / 200 - lam / 150;
    r.Kphi = Math.max(1, 1 + r.betaPhi * phiEf);
    r.r0inv = eyd / (0.45 * d);
    r.curv = r.Kr * r.Kphi * r.r0inv;
  } else {
    r.curv = 2 * eyd / (0.9 * d);
  }
  r.e2 = r.curv * l0 * l0 / r.c;
  r.M2 = Nc * r.e2;
  r.Mi = Nc * ei;
  if (inp.Mend) {
    const [m1, m2] = inp.Mend;
    const big = Math.abs(m2) >= Math.abs(m1) ? m2 : m1, small = big === m2 ? m1 : m2;
    const M02 = Math.abs(big) + r.Mi;
    const M01 = (Math.sign(small) === Math.sign(big) || small === 0 ? Math.abs(small) : -Math.abs(small)) + r.Mi;
    r.M02 = M02; r.M01 = M01;
    r.M0e = Math.max(0.6 * M02 + 0.4 * M01, 0.4 * M02);
    r.M0Ed = r.M0e;
    r.MEd = Math.max(M02, r.M0e + r.M2, M01 + 0.5 * r.M2);
  } else {
    r.M0Ed = Math.abs(inp.M0max) + r.Mi;
    r.MEd = r.M0Ed + r.M2;
  }
  if (norm === 'EC') {
    r.e0min = Math.max(inp.h / 30, 0.02);
    r.MEd = Math.max(r.MEd, Nc * r.e0min);
  }
  r.MRd = inp.MRd;
  r.eta = r.MRd > 0 ? r.MEd / r.MRd : Infinity;
  return r;
}

/** Exponent a der Interaktion (M_Edz/M_Rdz)^a + (M_Edy/M_Rdy)^a ≤ 1 (EN 1992-1-1 5.8.9(4)). */
export function biaxialExponent(shape, NEd, NRd) {
  if (shape === 'circle') return 2;
  const r = NRd > 0 ? NEd / NRd : 0;
  if (r <= 0.1) return 1;
  if (r >= 1) return 2;
  if (r <= 0.7) return 1 + (r - 0.1) / 0.6 * 0.5;
  return 1.5 + (r - 0.7) / 0.3 * 0.5;
}

/** Radiale Ausnutzung eines Punktes (My, Mz) bezüglich eines geschlossenen My-Mz-Polygons. */
export function radialUtilization(curve, My, Mz) {
  const MEd = Math.hypot(My, Mz);
  if (MEd < 1e-9) return 0;
  if (!curve || curve.length < 3) return Infinity;
  const dx = My / MEd, dy = Mz / MEd;
  let best = Infinity;
  for (let i = 0; i < curve.length; i++) {
    const p = curve[i], q = curve[(i + 1) % curve.length];
    const ex = q.My - p.My, ey = q.Mz - p.Mz;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-14) continue;
    const s = (p.My * ey - p.Mz * ex) / den;
    const u = (p.My * dy - p.Mz * dx) / den;
    if (s > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, s);
  }
  return Number.isFinite(best) ? MEd / best : Infinity;
}

// ------------------------------------------------------------------ Berechnung

/** Lastgrössen einer Biegeachse aus einem Lastfall. */
export function axisLoads(lc, ax, biaxial) {
  if (ax === 'y') return { H: +lc.Hz || 0, q: +lc.qz || 0, Mt: +lc.Myt || 0, Mb: +lc.Myb || 0 };
  if (!biaxial) return { H: 0, q: 0, Mt: 0, Mb: 0 };
  return { H: +lc.Hy || 0, q: +lc.qy || 0, Mt: +lc.Mzt || 0, Mb: +lc.Mzb || 0 };
}

/** Bereitet alle lastfallunabhängigen Grössen vor (Querschnitt, Baustoffe, Systeme, Interaktion). */
export function prepare(project) {
  const p = normalize(project);
  if (!(p.L > 0)) throw new Error('Die Stützenlänge L muss grösser als 0 sein (Register «System»).');
  if (!p.loadCases.length) throw new Error('Es ist kein Lastfall definiert. Im Register «Lasten» mit «+ Zeile» einen Lastfall hinzufügen.');
  const mat = materials(p.norm, p.concrete, p.steel);
  const geo = sectionGeometry(p.section);
  const kind = columnLawKind(p.norm, p.lawMode);
  const phiEf = effectiveCreep(p.creep);
  const dl = designLaws(mat);
  const cl = columnLaws(mat, kind, phiEf);
  const secRd = fiberSection(geo, dl);
  const secCol = withLaws(secRd, cl);
  const cap = axialCapacity(secRd);
  const NRd = -cap.Nc;
  const NRdSimple = (geo.Ac * mat.fcd + geo.As * mat.fsd) * 1000;
  const omega = geo.As * mat.fsd / (geo.Ac * mat.fcd);
  const thetaI = inclination(p.norm, p.L, p.imperfection);
  const axes = {};
  for (const ax of ['y', 'z']) {
    const th = AXES[ax].theta;
    const preset = ax === 'z' && p.supportZ && p.supportZ !== 'same' ? p.supportZ : p.support;
    const custom = ax === 'z' && p.supportZ && p.supportZ !== 'same' ? p.customZ : p.custom;
    const bc = boundary(preset, custom);
    const model = createModel(p.L, p.nEl, bc);
    if (!isStable(model)) {
      throw new Error(`Die Lagerung ${ax === 'z' && p.supportZ !== 'same' ? 'für Biegung um z ' : ''}ist kinematisch (z.B. Fuss gelenkig und Kopf frei). Bitte im Register «System» eine Einspannung oder Drehfeder vorsehen.`);
    }
    const nm = interactionNM(secRd, th, 160).map((q) => ({ N: q.N, M: q.M }));
    axes[ax] = { ax, theta: th, preset, bc, model, lay: layerize(secCol, th), layRd: layerize(secRd, th), props: axisProps(geo, ax), nm, cache: new Map() };
  }
  return { p, mat, geo, kind, phiEf, dl, cl, secRd, secCol, NRd, NtRd: cap.Nt, NRdSimple, omega, thetaI, axes };
}

function tableFor(ctx, axc, Ncomp) {
  const key = Ncomp.toFixed(6);
  if (!axc.cache.has(key)) axc.cache.set(key, mkTable(axc.lay, ctx.cl, -Ncomp));
  return axc.cache.get(key);
}

function capacityM(ctx, axc, Ncomp) {
  const r = capacityAtN(ctx.secRd, axc.theta, -Ncomp);
  if (!r) return 0;
  return Math.abs(axc.ax === 'y' ? -r.My : r.Mz);
}

const wOf = (u, nN) => Float64Array.from({ length: nN }, (_, i) => u[2 * i]);
const absMax = (arr) => { let m = 0, k = 0; arr.forEach((v, i) => { if (Math.abs(v) > Math.abs(m)) { m = v; k = i; } }); return { v: m, i: k }; };

/** Analyse einer Biegeachse für einen Lastfall. */
export function analyzeAxis(ctx, ax, lc) {
  const { p, mat, geo, phiEf } = ctx;
  const axc = ctx.axes[ax];
  const { model, props } = axc;
  const N = +lc.N || 0;
  const loads = axisLoads(lc, ax, p.biaxial);
  const nRel = Math.max(0, N) / (geo.Ac * mat.fcd * 1000);
  const presetBeta = SUPPORT_PRESETS[axc.preset]?.beta;
  const userBeta = p.betaMode === 'user' ? (ax === 'y' ? p.betaY : p.betaZ) : null;
  if (userBeta !== null && !(userBeta > 0)) throw new Error('Der Knicklängenbeiwert β muss grösser als 0 sein (Register «System»).');

  // Knicklänge und Nennsteifigkeit (für Federn iterativ, da β von EI abhängt)
  let beta = presetBeta || 1, nom = null;
  for (let it = 0; it < 4; it++) {
    const lam0 = beta * p.L / props.i;
    nom = nominalStiffness({ fck: mat.c.fck, Ecd: mat.Ecd, Es: mat.Es, Ic: props.Ic, Is: props.Is, nRel, lam: lam0, phiEf });
    if (presetBeta) break;
    const b = bucklingLoad(model, nom.EI);
    if (!b) break;
    beta = Math.PI / p.L * Math.sqrt(nom.EI / b.Pcr);
  }
  const betaModel = beta;
  if (userBeta !== null) {
    beta = userBeta;
    nom = nominalStiffness({ fck: mat.c.fck, Ecd: mat.Ecd, Es: mat.Es, Ic: props.Ic, Is: props.Is, nRel, lam: beta * p.L / props.i, phiEf });
  }
  const l0 = beta * p.L;
  const lam = l0 / props.i;
  const EInom = nom.EI;
  const NB = Math.PI ** 2 * EInom / (l0 * l0);
  const bk = bucklingLoad(model, EInom);
  const NBmodel = bk ? bk.Pcr : Infinity;

  // Imperfektion: Schiefstellung (verschieblich) bzw. Bogen in Form der Knickfigur (unverschieblich)
  const thetaI = ctx.thetaI;
  const ei = thetaI * l0 / 2;
  const impAmp = model.sway ? thetaI * p.L : ei;
  let w0 = imperfectionShape(model, EInom, impAmp);
  const F = loadVector(model, loads);
  const G = geometricMatrix(model);
  // ungünstige Richtung: gleichsinnig mit der elastischen Verformung aus den Lasten
  const ref = linearSolve(model, EInom, N > 0 && N < 0.95 * NBmodel ? N : 0, F);
  let s = 0;
  if (ref) for (let i = 0; i < model.n; i += 2) s += ref.u[i] * w0[i];
  if (s < 0) w0 = w0.map((v) => -v);
  const g0 = matVec(model, G, w0);

  // Theorie 1. Ordnung (linear-elastisch mit EI_nom), mit und ohne Imperfektion
  const F1 = F.map((v, i) => v + N * g0[i]);
  const lin1 = linearSolve(model, EInom, 0, F1);
  const lin0 = linearSolve(model, EInom, 0, F);
  const M1 = nodalMoments(model, { EI: EInom }, N, lin1.u, w0, loads.q, false);
  const M1n = nodalMoments(model, { EI: EInom }, 0, lin0.u, null, loads.q, false);

  // Allgemeines Verfahren: M-κ-Tabellen je Laststufe (Normalkraft λ·Nd)
  const tableAt = (lmb) => tableFor(ctx, axc, lmb * N);
  // Verformung 1. Ordnung mit nichtlinearer Biegesteifigkeit (ohne P-Δ) für den Vergleich in der Grafik
  let w1 = null;
  const tab1 = tableAt(1);
  if (tab1) {
    const r1 = solveNonlinear(model, tab1, 0, F1, null, lin1.u);
    if (r1.ok) w1 = wOf(r1.u, model.nN).map((v, i) => v + w0[2 * i]);
  }
  if (!w1) w1 = wOf(lin1.u, model.nN).map((v, i) => v + w0[2 * i]);

  // Allgemeines Verfahren: Traglastsuche
  const scan = ultimateScan(model, tableAt, N, F, g0);
  const lambdaU = scan.lambdaU;
  const charW = (u) => {
    if (model.sway) return u[model.n - 2];
    return absMax(wOf(u, model.nN)).v;
  };
  const momentsAt = (st) => nodalMoments(model, tableAt(st.lambda), st.lambda * N, st.u, w0, st.lambda * loads.q);
  const curve = [[0, 0], ...scan.states.map((st) => [charW(st.u), st.lambda])];
  const path = [[0, 0]];
  for (const st of scan.states) path.push([absMax(momentsAt(st)).v, st.lambda * N]);
  const last = scan.states[scan.states.length - 1] || null;
  const mk = (st) => {
    if (!st) return null;
    const tab = tableAt(st.lambda);
    const M = momentsAt(st);
    const kap = nodalCurvatures(model, st.u);
    const u = wOf(st.u, model.nN);
    const w = u.map((v, i) => v + w0[2 * i]);
    const m = absMax(M);
    return { lambda: st.lambda, M, kap, u, w, Mmax: Math.abs(m.v), Msign: Math.sign(m.v) || 1, iM: m.i, kapCrit: kap[m.i], tab };
  };
  const at1 = mk(scan.at1);
  const atU = mk(last);

  // ohne Imperfektion (für die Kombination bei zweiachsiger Biegung)
  let M2n = null;
  const hasLoad = F.some((v) => v !== 0);
  if (!hasLoad) M2n = new Float64Array(model.nN);
  else {
    const sc0 = ultimateScan(model, tableAt, N, F, null, { stopAt: 1 });
    if (sc0.at1) M2n = nodalMoments(model, tableAt(1), N, sc0.at1.u, null, loads.q);
  }

  // Querschnittswiderstand
  const MRd = capacityM(ctx, axc, N);
  const M1max = Math.abs(absMax(M1).v);
  const M1nMax = Math.abs(absMax(M1n).v);
  const M2max = at1 ? at1.Mmax : null;

  // Grenzschlankheit
  const isEnd = !model.sway && !loads.q;
  let rm = null;
  if (isEnd) {
    const ma = M1n[0], mb = M1n[model.nN - 1];
    const big = Math.abs(ma) >= Math.abs(mb) ? ma : mb, small = big === ma ? mb : ma;
    if (Math.abs(big) > 1e-9) rm = (Math.sign(small) === Math.sign(big) ? 1 : -1) * Math.abs(small) / Math.abs(big);
  }
  const limEC = lambdaLimEC({ phiEf, omega: ctx.omega, nRel, rm });
  const lamLimSIA = N > 0 ? lam * Math.sqrt(NB / (11 * N)) : Infinity;
  const lamLim = p.norm === 'EC' ? limEC.value : lamLimSIA;

  // Vereinfachtes Verfahren
  const simp = simplifiedMethod({
    norm: p.norm, N, l0, ei, d: props.d, h: props.h, Ac: geo.Ac, fcd: mat.fcd, fck: mat.c.fck, fsd: mat.fsd, Es: mat.Es,
    omega: ctx.omega, lam, phiEf, M0max: M1nMax, Mend: isEnd ? [M1n[0], M1n[model.nN - 1]] : null, MRd,
  });

  // M-κ-Kurven bei Nd für die Darstellung
  const tabN = tableAt(1);
  const tabRd = mkTable(axc.layRd, ctx.dl, -N);

  return {
    ax, N, loads, preset: axc.preset, sway: model.sway, x: model.x, L: p.L,
    beta, betaModel, userBeta: userBeta !== null, l0, i: props.i, lam, lamLim, limEC, lamLimSIA, rm,
    EInom, nom, NB, NBmodel, thetaI, ei, impAmp, w0: wOf(w0, model.nN),
    M1, M1n, w1, M1max, M1nMax, lambdaU, reason: scan.reason, capped: scan.capped, curve, path,
    at1, atU, M2n, M2max, MRd, simp, tabN, tabRd, nm: axc.nm, props,
    amplification: M2max !== null && M1max > 1e-9 ? M2max / M1max : null,
    etaU: lambdaU > 0 ? 1 / lambdaU : Infinity,
    // ohne Gleichgewicht bei λ = 1 ist der Querschnittsnachweis nicht möglich → Ausnutzung 1/λu (> 1)
    etaSec: M2max !== null ? (MRd > 0 ? M2max / MRd : Infinity) : (lambdaU > 0 ? Math.max(1.0001, 1 / lambdaU) : Infinity),
  };
}

/** Analyse eines Lastfalls (beide Achsen, zweiachsige Interaktion, Nachweise). */
export function analyzeLoadCase(ctx, lc, index = 0) {
  const t0 = now();
  const { p, geo, mat } = ctx;
  const N = +lc.N || 0;
  const Y = analyzeAxis(ctx, 'y', lc);
  const Z = analyzeAxis(ctx, 'z', lc);
  const etaN = N > 0 ? N / ctx.NRd : N < 0 ? -N / ctx.NtRd : 0;

  // Zweiachsige Interaktion bei λ = 1: Imperfektion jeweils nur in einer Richtung (EN 1992 5.8.9(2))
  const a = biaxialExponent(geo.shape, N, ctx.NRdSimple);
  let curve = null;
  if (geo.shape === 'rect' && N < ctx.NRd) curve = interactionMyMz(ctx.secRd, -N, 48);
  const combos = [];
  const combo = (label, My, Mz) => {
    if (!My || !Mz) {
      const e = Math.max(!My ? Y.etaSec : 0, !Mz ? Z.etaSec : 0);
      combos.push({ label, eta: e, eta539: e, i: 0, My: NaN, Mz: NaN, x: NaN, missing: true });
      return;
    }
    let best = { eta: -1 };
    for (let i = 0; i < My.length; i++) {
      // Kernkonvention: My_k = −M_y (Druck oben), Mz_k = M_z
      const myk = -My[i], mzk = Mz[i];
      const eta = geo.shape === 'circle'
        ? (Y.MRd > 0 ? Math.hypot(myk, mzk) / Y.MRd : Infinity)
        : radialUtilization(curve, myk, mzk);
      const eta539 = (Y.MRd > 0 ? Math.pow(Math.abs(My[i]) / Y.MRd, a) : Infinity) + (Z.MRd > 0 ? Math.pow(Math.abs(Mz[i]) / Z.MRd, a) : Infinity);
      if (eta > best.eta) best = { label, eta, eta539, i, My: My[i], Mz: Mz[i], x: Y.x[i] };
    }
    combos.push(best);
  };
  combo('Imperfektion in z (Biegung um y)', Y.at1?.M, Z.M2n);
  combo('Imperfektion in y (Biegung um z)', Y.M2n, Z.at1?.M);
  const gov = combos.reduce((m, c) => (c.eta > m.eta ? c : m), combos[0]);
  const eta539 = Math.max(...combos.map((c) => c.eta539));

  // Nachweise
  const checks = [];
  const ref = p.norm === 'EC' ? 'EN 1992-1-1 5.8.6' : 'SIA 262 4.3.7';
  for (const A of [Y, Z]) {
    const axl = A.ax === 'y' ? 'Biegung um y' : 'Biegung um z';
    checks.push({
      key: `lu${A.ax}`, label: `Traglast ${axl} (allgemeines Verfahren)`, ref: `${ref}: λu ≥ 1`,
      Ed: 1, Rd: A.lambdaU, unit: '', digits: 2, eta: A.etaU,
      detail: A.capped ? 'λu ≥ 20 (Suche begrenzt)' : A.reason === 'section' ? 'Versagen durch Erreichen einer Grenzdehnung im Querschnitt' : A.reason === 'axial' ? 'Normalkraft übersteigt den Querschnittswiderstand' : 'Stabilitätsversagen (kein stabiles Gleichgewicht mehr)',
    });
  }
  for (const A of [Y, Z]) {
    const axl = A.ax === 'y' ? 'M_y' : 'M_z';
    if (A.M2max === null) {
      checks.push({ key: `sec${A.ax}`, label: `Querschnitt ${axl},Ed,II ≤ ${axl},Rd`, ref: p.norm === 'EC' ? 'EN 1992-1-1 6.1' : 'SIA 262 4.3.2', Ed: undefined, Rd: A.MRd, unit: 'kNm', eta: A.etaSec, detail: 'Kein Gleichgewicht unter Bemessungslast (Ausnutzung als 1/λu angegeben)' });
    } else {
      checks.push({ key: `sec${A.ax}`, label: `Querschnitt ${axl},Ed,II ≤ ${axl},Rd`, ref: p.norm === 'EC' ? 'EN 1992-1-1 6.1' : 'SIA 262 4.3.2', Ed: A.M2max, Rd: A.MRd, unit: 'kNm', eta: A.etaSec, detail: `bei x = ${A.x[A.at1.iM].toFixed(2)} m, inkl. Imperfektion` });
    }
  }
  {
    checks.push({
      key: 'biax', label: geo.shape === 'circle' ? 'Resultierendes Moment √(My² + Mz²) ≤ M_Rd' : 'Zweiachsige Biegung (Interaktion My–Mz)', ref: p.norm === 'EC' ? 'EN 1992-1-1 5.8.9' : 'SIA 262 4.3.7',
      Ed: Number.isFinite(gov.eta) ? Math.hypot(gov.My, gov.Mz) : undefined, Rd: Number.isFinite(gov.eta) && gov.eta > 0 ? Math.hypot(gov.My, gov.Mz) / gov.eta : undefined,
      unit: 'kNm', eta: gov.eta, detail: gov.missing ? 'Kein Gleichgewicht unter Bemessungslast' : `${gov.label}; massgebend bei x = ${gov.x.toFixed(2)} m`,
    });
  }
  checks.push(N >= 0
    ? { key: 'N', label: 'Normalkraft N_Ed ≤ N_Rd (Druck)', ref: p.norm === 'EC' ? 'EN 1992-1-1 6.1' : 'SIA 262 4.3.2', Ed: N, Rd: ctx.NRd, unit: 'kN', digits: 0, eta: etaN }
    : { key: 'N', label: 'Normalkraft N_Ed ≤ N_Rd (Zug)', ref: p.norm === 'EC' ? 'EN 1992-1-1 6.1' : 'SIA 262 4.3.2', Ed: -N, Rd: ctx.NtRd, unit: 'kN', digits: 0, eta: etaN });
  const eta = Math.max(...checks.map((c) => c.eta));

  // vereinfachtes Verfahren (Vergleich)
  const simpChecks = [Y, Z].filter((A) => A.ax === 'y' || p.biaxial || geo.shape === 'rect').map((A) => ({
    key: `simp${A.ax}`, label: `${p.norm === 'EC' ? 'Nennkrümmung' : 'Modellstütze'} – Biegung um ${A.ax}`,
    ref: p.norm === 'EC' ? 'EN 1992-1-1 5.8.8' : 'SIA 262 4.3.7', Ed: A.simp.MEd, Rd: A.simp.MRd, unit: 'kNm', eta: A.simp.eta,
    detail: `e2 = ${(A.simp.e2 * 1000).toFixed(1)} mm, M2 = ${A.simp.M2.toFixed(1)} kNm`,
  }));
  let etaSimp = Math.max(...simpChecks.map((c) => c.eta));
  if (p.biaxial && Number.isFinite(etaSimp)) {
    // Interaktion mit den Momenten des vereinfachten Verfahrens, Imperfektion jeweils nur in einer Richtung
    const mY = Y.simp, mZ = Z.simp;
    const pts = [[mY.MEd, Math.max(0, mZ.MEd - mZ.Mi)], [Math.max(0, mY.MEd - mY.Mi), mZ.MEd]];
    let e = 0, e539 = 0, gp = pts[0];
    for (const [my, mz] of pts) {
      const v = geo.shape === 'circle' ? (Y.MRd > 0 ? Math.hypot(my, mz) / Y.MRd : Infinity) : radialUtilization(curve, -my, mz);
      if (v > e) { e = v; gp = [my, mz]; }
      e539 = Math.max(e539, Math.pow(my / mY.MRd, a) + Math.pow(mz / mZ.MRd, a));
    }
    const MEdR = Math.hypot(gp[0], gp[1]);
    simpChecks.push({
      key: 'simpbiax', label: geo.shape === 'circle' ? 'Resultierendes Moment (vereinfachtes Verfahren)' : 'Interaktion My–Mz (vereinfachtes Verfahren)',
      ref: p.norm === 'EC' ? 'EN 1992-1-1 5.8.9' : 'SIA 262 4.3.7', Ed: MEdR, Rd: e > 0 ? MEdR / e : undefined, unit: 'kNm', eta: e,
      detail: p.norm === 'EC' ? `Formel (5.39) mit a = ${a.toFixed(2)}: ${e539.toFixed(2)} ≤ 1` : 'Imperfektion jeweils nur in einer Richtung',
    });
    etaSimp = Math.max(etaSimp, e);
  }

  const notes = [];
  for (const A of [Y, Z]) {
    if (A.ax === 'z' && !p.biaxial && geo.shape === 'circle') continue;
    if (A.lam > A.lamLim) notes.push({ kind: 'info', ax: A.ax, text: `Biegung um ${A.ax}: λ = ${A.lam.toFixed(1)} > λ_lim = ${A.lamLim.toFixed(1)} – Einflüsse 2. Ordnung sind zu berücksichtigen (hier berechnet).` });
  }
  if (N > ctx.NRd) notes.push({ kind: 'fail', text: `Die Normalkraft N_d = ${N.toFixed(0)} kN übersteigt den Querschnittswiderstand N_Rd = ${ctx.NRd.toFixed(0)} kN. Querschnitt vergrössern, Bewehrung erhöhen oder höhere Betonfestigkeit wählen.` });
  return {
    index, name: lc.name || `LF ${index + 1}`, N, Y, Z, combos, gov, eta539, a, curve, checks, eta, simpChecks, etaSimp, etaN, notes,
    governingAxis: Math.max(Y.etaU, Y.etaSec) >= Math.max(Z.etaU, Z.etaSec) ? 'y' : 'z',
    time: now() - t0,
  };
}

/** Vollständige Berechnung aller Lastfälle. */
export function compute(project) {
  const t0 = now();
  const ctx = prepare(project);
  const lcs = ctx.p.loadCases.map((lc, i) => analyzeLoadCase(ctx, lc, i));
  let gov = 0;
  lcs.forEach((r, i) => { if (r.eta > lcs[gov].eta) gov = i; });
  const warnings = [];
  if (!ctx.geo.symmetric) warnings.push('Ungerade Stabanzahl: Der Querschnitt ist nicht doppelt symmetrisch. Die Berechnung setzt eine symmetrische M-κ-Beziehung voraus – eine gerade Stabanzahl wählen.');
  const rho = ctx.geo.As / ctx.geo.Ac;
  if (rho < 0.002) warnings.push(`Bewehrungsgehalt ρ = ${(rho * 100).toFixed(2)} % ist sehr klein (Mindestbewehrung prüfen).`);
  if (rho > 0.04) warnings.push(`Bewehrungsgehalt ρ = ${(rho * 100).toFixed(2)} % ist sehr gross (Höchstbewehrung und Betonierbarkeit prüfen).`);
  return {
    p: ctx.p, norm: ctx.p.norm, mat: ctx.mat, geo: ctx.geo, kind: ctx.kind, phiEf: ctx.phiEf, thetaI: ctx.thetaI,
    NRd: ctx.NRd, NRdSimple: ctx.NRdSimple, omega: ctx.omega, rho, cl: ctx.cl, dl: ctx.dl, nFibers: ctx.secRd.nFibers,
    lcs, gov, eta: lcs[gov].eta, warnings, time: now() - t0,
  };
}

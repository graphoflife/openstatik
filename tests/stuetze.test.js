// Tests Modul «Stütze» – Stahlbetonstützen nach Theorie 2. Ordnung
// Ausführen: node --test tests/stuetze.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createModel, boundary, bucklingLoad, imperfectionShape, geometricMatrix, matVec, loadVector,
  solveNonlinear, nodalMoments, ultimateScan,
} from '../modules/stuetze/column.js';
import { linearTable, materials, sectionGeometry, fiberSection, designLaws, layerize, mkTable, evalMK, axisProps } from '../modules/stuetze/section.js';
import {
  compute, prepare, analyzeAxis, defaultProject, simplifiedMethod, inclination, lambdaLimEC,
  biaxialExponent, nominalStiffness, missingInput, suggestN, supportState, presetFor, setSupportState, SUPPORT_PRESETS, normalize,
} from '../modules/stuetze/calc.js';
import { editorSpec } from '../modules/stuetze/editing.js';
import { derivation } from '../modules/stuetze/derivation.js';
import { EXAMPLES } from '../modules/stuetze/examples.js';
import { capacityAtN } from '../js/core/rcsection.js';

const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const near = (a, b, tol, msg) => assert.ok(rel(a, b) <= tol, `${msg}: ${a} ≠ ${b} (rel. ${(rel(a, b) * 100).toFixed(3)} %)`);

// Projekt mit Rechteck 300×300, 4 Eckstäben Ø20, Achsabstand 50 mm (d = h − a = 250 mm)
function handProject(o = {}) {
  const p = defaultProject();
  return {
    ...p, norm: 'EC', L: 4, support: 'pinned', concrete: 'C30/37', steel: 'B500B',
    section: { ...p.section, shape: 'rect', b: 300, h: 300, nb: 2, nh: 2, dia: 20, coverMode: 'axis', axis: 50 },
    creep: { phi: 0, ratio: 0 },
    loadCases: [{ name: 'LF', N: 1000, Myt: 30, Myb: 30, Hz: 0, qz: 0, Mzt: 0, Mzb: 0, Hy: 0, qy: 0 }],
    ...o,
  };
}

// ------------------------------------------------------------------ Stabmodell, elastisch

test('Knicklast (Euler) für alle Lagerungsfälle: P_cr = π²EI/(βL)²', () => {
  const EI = 25000, L = 5;
  const cases = { pinned: 1, cantilever: 2, fixedPinned: 0.69915, fixedFixed: 0.5, fixedFixedSway: 1 };
  for (const [key, beta] of Object.entries(cases)) {
    const m = createModel(L, 40, boundary(key));
    const b = bucklingLoad(m, EI);
    const exact = Math.PI ** 2 * EI / (beta * L) ** 2;
    near(b.Pcr, exact, 2e-4, `P_cr ${key}`);
  }
});

test('Knicklast mit Drehfedern liegt zwischen gelenkig und eingespannt', () => {
  const EI = 25000, L = 5;
  const pin = bucklingLoad(createModel(L, 40, boundary('pinned')), EI).Pcr;
  const fix = bucklingLoad(createModel(L, 40, boundary('fixedFixed')), EI).Pcr;
  let prev = pin;
  for (const k of [1, 10, 100, 1000]) { // MNm/rad
    const P = bucklingLoad(createModel(L, 40, boundary('custom', { bot: 'spring', top: 'spring', sway: false, kBot: k, kTop: k })), EI).Pcr;
    assert.ok(P > prev && P < fix, `Feder ${k}: ${P}`);
    prev = P;
  }
});

test('Nichtlinearer Löser mit linearer M-κ-Beziehung findet die Eulerlast (λu ≈ N_cr/N_d)', () => {
  const EI = 10000, L = 5;
  for (const [key, beta] of [['pinned', 1], ['cantilever', 2]]) {
    const m = createModel(L, 40, boundary(key));
    const Ncr = Math.PI ** 2 * EI / (beta * L) ** 2;
    const Nd = Ncr / 2;
    const w0 = imperfectionShape(m, EI, 0.002);
    const g0 = matVec(m, geometricMatrix(m), w0);
    const r = ultimateScan(m, () => linearTable(EI), Nd, new Float64Array(m.n), g0);
    near(r.lambdaU, 2, 0.01, `λu ${key}`);
  }
});

test('Theorie 2. Ordnung elastisch: M_max = M0·sec(kL/2) bei gleichen Endmomenten (Pendelstütze)', () => {
  // Handrechnung: N = 0.5·N_cr → kL/2 = π/2·√0.5 = 1.1107, sec = 2.2519 → M_max = 112.6 kNm für M0 = 50 kNm
  const EI = 20000, L = 4, M0 = 50;
  const m = createModel(L, 40, boundary('pinned'));
  const N = 0.5 * Math.PI ** 2 * EI / L ** 2;
  const F = loadVector(m, { Mt: M0, Mb: M0 });
  const r = solveNonlinear(m, { EI }, N, F, null, null);
  assert.ok(r.ok);
  const M = nodalMoments(m, { EI }, N, r.u, null, 0);
  const Mmax = Math.max(...M.map(Math.abs));
  near(Mmax, M0 / Math.cos(Math.PI / 2 * Math.sqrt(0.5)), 2e-3, 'M_max');
  near(Mmax, 112.6, 1e-3, 'M_max Handrechnung');
});

// ------------------------------------------------------------------ Querschnitt

test('M-κ-Beziehung: Höchstwert entspricht dem Querschnittswiderstand M_Rd(N)', () => {
  const mat = materials('SIA', 'C30/37', 'B500B');
  const geo = sectionGeometry({ shape: 'rect', b: 300, h: 500, nb: 3, nh: 2, dia: 20, coverMode: 'axis', axis: 50 });
  const dl = designLaws(mat);
  const sec = fiberSection(geo, dl);
  assert.ok(sec.nFibers >= 800 && sec.nFibers <= 2000, `Fasern ${sec.nFibers}`);
  const lay = layerize(sec, Math.PI / 2);
  for (const N of [0, -500, -1500]) {
    const MRd = -capacityAtN(sec, Math.PI / 2, N).My;
    const t = mkTable(lay, dl, N);
    near(t.Mmax, MRd, 0.01, `N = ${N}`);
  }
  // Handrechnung N = 0: 3Ø20 (942 mm²), fsd = 434.8 MPa, fcd = 20 MPa, d = 450 mm
  // x = As·fsd/(0.85·b·fcd·0.8)… Rechteckblock: Fs = 409.8 kN, x·0.85 = 409.8/(0.3·20000) = 68.3 mm
  // MRd ≈ Fs·(d − 0.0683/2) + Druckbewehrung ≈ 409.8·0.4158 ≈ 170 kNm (Kern verifiziert 169.8 kNm)
  const M0 = mkTable(lay, dl, 0).Mmax;
  near(M0, 170, 0.015, 'M_Rd Handrechnung');
});

test('Rundquerschnitt: Fasermodell mit Polarnetz und doppelt symmetrischer Bewehrung', () => {
  const geo = sectionGeometry({ shape: 'circle', D: 400, n: 8, dia: 20, coverMode: 'nominal', cover: 30, stirrup: 8 });
  assert.equal(geo.bars.length, 8);
  near(geo.a, 0.048, 1e-9, 'Achsabstand a = 30 + 8 + 10 mm');
  const sec = fiberSection(geo, designLaws(materials('SIA', 'C30/37', 'B500B')));
  assert.ok(sec.nFibers >= 800 && sec.nFibers <= 2000, `Fasern ${sec.nFibers}`);
  let A = 0;
  for (let i = 0; i < sec.nFibers; i++) if (!sec.isBar[i]) A += sec.A[i];
  near(A + geo.As, Math.PI * 0.2 ** 2, 0.003, 'Betonfläche (Polygon mit 64 Ecken)');
  const ly = layerize(sec, Math.PI / 2), lz = layerize(sec, 0);
  const ty = mkTable(ly, designLaws(materials('SIA', 'C30/37', 'B500B')), -1000);
  const tz = mkTable(lz, designLaws(materials('SIA', 'C30/37', 'B500B')), -1000);
  near(ty.Mmax, tz.Mmax, 0.01, 'gleicher Widerstand um y und z');
});

test('N-M-Interaktion eines doppelt symmetrischen Querschnitts ist punktsymmetrisch (keine Rundungssprünge bei εud)', () => {
  for (const sp of [{ shape: 'rect', b: 300, h: 300, nb: 3, nh: 3, dia: 18 }, { shape: 'circle', D: 400, n: 8, dia: 20 }]) {
    const ctx = prepare(handProject({ section: { ...handProject().section, ...sp } }));
    for (const ax of ['y', 'z']) {
      const nm = ctx.axes[ax].nm;
      for (let i = 0; i < nm.length / 2; i++) {
        const a = nm[i], b = nm[nm.length - 1 - i];
        assert.ok(Math.abs(a.M + b.M) < 1e-6 && Math.abs(a.N - b.N) < 1e-6, `${sp.shape} ${ax} Punkt ${i}: ${a.M}/${a.N} vs ${b.M}/${b.N}`);
      }
    }
  }
});

test('Interpolation der M-κ-Tabelle ist stetig und punktsymmetrisch', () => {
  const mat = materials('EC', 'C30/37', 'B500B');
  const geo = sectionGeometry({ shape: 'rect', b: 300, h: 300, nb: 3, nh: 3, dia: 18, coverMode: 'axis', axis: 45 });
  const dl = designLaws(mat);
  const t = mkTable(layerize(fiberSection(geo, dl), Math.PI / 2), dl, -800);
  for (const k of [1e-4, 2e-3, 0.01, 0.5 * t.kU]) {
    const a = evalMK(t, k), b = evalMK(t, -k);
    assert.ok(Math.abs(a.M + b.M) < 1e-9 && Math.abs(a.Et - b.Et) < 1e-9);
    const h = 1e-7 * Math.max(k, 1e-3);
    const fd = (evalMK(t, k + h).M - evalMK(t, k - h).M) / (2 * h);
    assert.ok(Math.abs(fd - a.Et) <= 1e-3 * Math.abs(a.Et) + 1, `Tangente bei κ = ${k}`);
  }
});

// ------------------------------------------------------------------ Normwerte

test('Imperfektion nach SIA 262 4.3.7.2 und EN 1992-1-1 5.2', () => {
  near(inclination('SIA', 4), 1 / 200, 1e-12, 'SIA L = 4 m: 0.01/√4');
  near(inclination('SIA', 16), 1 / 300, 1e-12, 'SIA L = 16 m: 0.01/4 = 1/400 < Mindestwert 1/300');
  near(inclination('SIA', 0.5), 1 / 100, 1e-12, 'SIA kurze Stütze: Höchstwert 1/100');
  near(inclination('EC', 4), 1 / 200, 1e-12, 'EC L = 4 m: αh = 1');
  near(inclination('EC', 9), 1 / 300, 1e-12, 'EC L = 9 m: αh = 2/3');
  near(inclination('EC', 6.25), 0.8 / 200, 1e-12, 'EC L = 6.25 m: αh = 0.8');
  near(inclination('SIA', 4, { mode: 'user', denom: 150 }), 1 / 150, 1e-12, 'Benutzerwert');
  assert.equal(inclination('SIA', 4, { mode: 'none' }), 0);
});

test('Grenzschlankheit EN 1992-1-1 5.8.3.1 (Handrechnung)', () => {
  // φef = 0 → A = 1; ω = 0.30353 → B = √1.60706 = 1.26770; rm = 1 → C = 0.7; n = 0.55556
  // λ_lim = 20·1·1.2677·0.7/√0.55556 = 23.81
  const r = lambdaLimEC({ phiEf: 0, omega: 0.30353, nRel: 0.55556, rm: 1 });
  near(r.value, 23.81, 1e-3, 'λ_lim');
  near(lambdaLimEC({ phiEf: 0, omega: 0.30353, nRel: 0.55556, rm: -1 }).value, 23.81 / 0.7 * 2.7, 1e-3, 'doppelte Krümmung C = 2.7');
  near(lambdaLimEC({ phiEf: 2, omega: 0, nRel: 0.25, rm: null }).value, 20 / 1.4 * 0.7 / 0.5, 1e-9, 'Standardwerte');
});

test('Nennsteifigkeit EN 1992-1-1 5.8.7.2 (Handrechnung)', () => {
  // C30/37: k1 = √(30/20) = 1.2247; n = 0.5, λ = 40 → k2 = 0.5·40/170 = 0.11765; φef = 1 → Kc = 0.07204
  // EI = 0.07204·30000·6.75e-4 + 200000·1.0e-5 = 1.4588 + 2.0 = 3.4588 MNm²
  const r = nominalStiffness({ fck: 30, Ecd: 30000, Es: 200000, Ic: 6.75e-4, Is: 1e-5, nRel: 0.5, lam: 40, phiEf: 1 });
  near(r.EI, 3458.8, 1e-3, 'EI [kNm²]');
  assert.equal(nominalStiffness({ fck: 30, Ecd: 30000, Es: 200000, Ic: 1, Is: 0, nRel: 1, lam: 100, phiEf: 0 }).k2, 0.2);
});

test('Exponent a der zweiachsigen Interaktion (EN 1992-1-1 5.8.9(4))', () => {
  assert.equal(biaxialExponent('rect', 50, 1000), 1);
  near(biaxialExponent('rect', 400, 1000), 1.25, 1e-12, 'N/NRd = 0.4');
  near(biaxialExponent('rect', 700, 1000), 1.5, 1e-12, 'N/NRd = 0.7');
  near(biaxialExponent('rect', 850, 1000), 1.75, 1e-12, 'N/NRd = 0.85');
  assert.equal(biaxialExponent('circle', 400, 1000), 2);
});

// ------------------------------------------------------------------ Vereinfachte Verfahren

test('Nennkrümmungsverfahren EN 1992-1-1 5.8.8 – Handbeispiel (Abweichung < 2 %)', () => {
  // Rechteck 300×300, 4Ø20 (As = 1256.6 mm²), a = 50 mm → d = h/2 + i_s = 150 + 100 = 250 mm
  // C30/37: fcd = 20 MPa; B500B: fyd = 434.78 MPa, Es = 200 GPa, εyd = 2.1739 ‰
  // N_Ed = 1000 kN, L = l0 = 4.0 m (Pendelstütze), M_oben = M_unten = 30 kNm (einfach gekrümmt), φef = 0
  // ω = 1256.6·434.78/(90000·20) = 0.30353; n = 1e6/(90000·20) = 0.55556; n_u = 1.30353
  // K_r = (1.30353 − 0.55556)/(1.30353 − 0.4) = 0.82784; K_φ = 1
  // 1/r0 = 0.0021739/(0.45·0.25) = 0.019324 1/m; 1/r = 0.015997 1/m
  // e2 = 0.015997·4²/10 = 0.025595 m → M2 = 25.60 kNm
  // θi = 1/200 (αh = 2/√4 = 1) → ei = θi·l0/2 = 10 mm → N·ei = 10 kNm
  // M02 = M01 = 30 + 10 = 40 kNm → M0e = 40 kNm → M_Ed = max(40; 40 + 25.60; 40 + 12.80) = 65.60 kNm
  const ctx = prepare(handProject());
  const A = analyzeAxis(ctx, 'y', ctx.p.loadCases[0]);
  const s = A.simp;
  near(A.props.d, 0.25, 1e-9, 'd');
  near(ctx.omega, 0.30353, 2e-4, 'ω');
  near(s.Kr, 0.82784, 2e-3, 'K_r');
  assert.equal(s.Kphi, 1);
  near(s.curv, 0.015997, 2e-3, '1/r');
  near(s.e2, 0.025595, 0.02, 'e2');
  near(s.M2, 25.60, 0.02, 'M2');
  near(A.ei, 0.010, 1e-9, 'ei');
  near(s.M0e, 40, 0.02, 'M0e');
  near(s.MEd, 65.60, 0.02, 'M_Ed');
  // Kriechen: φef = 1.0 → β = 0.35 + 30/200 − 46.19/150 = 0.1921 → K_φ = 1.1921
  const ctx2 = prepare(handProject({ creep: { phi: 2, ratio: 0.5 } }));
  const s2 = analyzeAxis(ctx2, 'y', ctx2.p.loadCases[0]).simp;
  near(s2.Kphi, 1.1921, 2e-3, 'K_φ');
});

test('Modellstütze SIA 262 4.3.7 – Handbeispiel: e2 = χd·l0²/π², χd = 2·εsd/(0.9·d)', () => {
  // SIA: Es = 205 GPa → εsd = 434.78/205000 = 2.1209 ‰; d = 250 mm
  // χd = 2·0.0021209/(0.9·0.25) = 0.018852 1/m; e2 = 0.018852·16/π² = 0.030562 m; M2 = 30.56 kNm
  // ei = (0.01/√4)·4/2 = 10 mm → M_Ed = 40 + 30.56 = 70.56 kNm
  const ctx = prepare(handProject({ norm: 'SIA' }));
  const s = analyzeAxis(ctx, 'y', ctx.p.loadCases[0]).simp;
  near(s.curv, 0.018852, 1e-3, 'χd');
  near(s.e2, 0.030562, 1e-3, 'e2');
  near(s.MEd, 70.56, 0.01, 'M_Ed');
  // direkter Aufruf ohne Endmomentregel: M_Ed = M0 + N·ei + N·e2
  const d = simplifiedMethod({ norm: 'SIA', N: 1000, l0: 4, ei: 0.01, d: 0.25, h: 0.3, Ac: 0.09, fcd: 20, fck: 30, fsd: 434.78, Es: 205000, omega: 0.3, lam: 46, phiEf: 0, M0max: 30, Mend: null, MRd: 100 });
  near(d.MEd, 30 + 10 + 30.562, 1e-3, 'M_Ed direkt');
});

// ------------------------------------------------------------------ Allgemeines Verfahren

test('Theorie 1. Ordnung reproduziert: N ≈ 0 ergibt M_II = M_I (Pendelstütze und Kragstütze)', () => {
  const p = handProject({ norm: 'SIA', imperfection: { mode: 'none', denom: 300 }, loadCases: [{ name: 'LF', N: 1, Myt: 50, Myb: 50 }] });
  const ctx = prepare(p);
  const A = analyzeAxis(ctx, 'y', ctx.p.loadCases[0]);
  assert.ok(A.at1, 'Gleichgewicht bei λ = 1');
  for (const M of A.at1.M) near(M, 50, 2e-3, 'M_II konstant 50 kNm');
  near(A.M1max, 50, 1e-6, 'M_I');
  // Kragstütze: H = 10 kN, L = 4 m → Einspannmoment H·L = 40 kNm, linear bis 0 am Kopf
  const q = handProject({ norm: 'SIA', support: 'cantilever', imperfection: { mode: 'none', denom: 300 }, loadCases: [{ name: 'LF', N: 0.5, Hz: 10 }] });
  const cq = prepare(q);
  const B = analyzeAxis(cq, 'y', cq.p.loadCases[0]);
  near(B.at1.M[0], 40, 3e-3, 'Einspannmoment');
  assert.ok(Math.abs(B.at1.M[B.at1.M.length - 1]) < 0.05, 'Kopfmoment 0');
  near(B.at1.M[20], 20, 3e-3, 'Moment in halber Höhe');
});

test('Allgemeines Verfahren konvergiert: λu > 1 bei geringer, < 1 bei zu hoher Last', () => {
  const light = compute(handProject({ norm: 'SIA', loadCases: [{ name: 'LF', N: 500, Myt: 10, Myb: 10 }] }));
  const lc = light.lcs[0];
  assert.ok(lc.Y.lambdaU > 1.5, `λu = ${lc.Y.lambdaU}`);
  assert.ok(lc.Y.at1 && lc.Y.M2max > lc.Y.M1max, 'Momente 2. Ordnung grösser als 1. Ordnung');
  assert.ok(light.eta < 1);
  const heavy = compute(handProject({ norm: 'SIA', L: 6, loadCases: [{ name: 'LF', N: 1600, Myt: 30, Myb: 30 }] }));
  assert.ok(heavy.lcs[0].Y.lambdaU < 1, `λu = ${heavy.lcs[0].Y.lambdaU}`);
  assert.ok(heavy.eta > 1);
  // Kragstütze 40×40, 8Ø20, H = 25 kN: nicht ausreichend; mit 12Ø22 ausreichend
  const p = defaultProject();
  const cant = (nb, dia) => compute({ ...p, L: 6, support: 'cantilever', section: { ...p.section, b: 400, h: 400, nb, nh: nb, dia }, creep: { phi: 2, ratio: 0.3 }, loadCases: [{ name: 'W', N: 800, Hz: 25 }] });
  assert.ok(cant(3, 20).eta > 1);
  assert.ok(cant(4, 22).eta < 1);
});

test('Allgemeines und vereinfachtes Verfahren stimmen für eine schlanke Kragstütze überein (±15 %)', () => {
  const p = defaultProject();
  const r = compute({ ...p, L: 6, support: 'cantilever', section: { ...p.section, b: 400, h: 400, nb: 3, nh: 3, dia: 20 }, creep: { phi: 2, ratio: 0.7 }, loadCases: [{ name: 'W', N: 800, Hz: 25 }] });
  const Y = r.lcs[0].Y;
  near(1 / Y.lambdaU, Y.simp.eta, 0.15, 'η allgemein vs. vereinfacht');
});

test('Monotonie: λu sinkt mit L und φef, steigt mit der Bewehrung; M_II steigt mit N', () => {
  const lam = (o) => compute(handProject({ norm: 'SIA', ...o })).lcs[0].Y.lambdaU;
  const lc = (N) => [{ name: 'LF', N, Myt: 20, Myb: 20 }];
  let prev = Infinity;
  for (const L of [3, 4, 5, 6]) { const v = lam({ L, loadCases: lc(800) }); assert.ok(v < prev, `L = ${L}: ${v}`); prev = v; }
  prev = Infinity;
  for (const phi of [0, 1, 2, 3]) { const v = lam({ creep: { phi, ratio: 1 }, loadCases: lc(800) }); assert.ok(v < prev, `φ = ${phi}: ${v}`); prev = v; }
  prev = 0;
  for (const dia of [16, 20, 26]) { const v = lam({ section: { ...handProject().section, dia }, loadCases: lc(800) }); assert.ok(v > prev, `Ø${dia}: ${v}`); prev = v; }
  prev = 0;
  for (const N of [200, 600, 1000, 1400]) {
    const r = compute(handProject({ norm: 'SIA', loadCases: lc(N) })).lcs[0].Y;
    assert.ok(r.M2max > prev, `N = ${N}: M_II = ${r.M2max}`);
    prev = r.M2max;
  }
});

test('Zweiachsige Biegung: Kreisquerschnitt symmetrisch, Interaktion ungünstiger als einachsig', () => {
  const ex = EXAMPLES.find((e) => /Rund/.test(e.name)).project();
  const r = compute(ex).lcs[0];
  near(r.Y.MRd, r.Z.MRd, 0.01, 'M_Rd gleich in beiden Achsen');
  const biax = r.checks.find((c) => c.key === 'biax');
  assert.ok(biax.eta > r.Y.etaSec && biax.eta > r.Z.etaSec, 'Interaktion massgebend gegenüber einachsigen Nachweisen');
  near(biax.eta, Math.hypot(r.combos[0].My, r.combos[0].Mz) / r.Y.MRd, 0.2, 'resultierendes Moment');
});

test('Beispiele rechnen fehlerfrei, sind nachgewiesen und schnell genug', () => {
  for (const ex of EXAMPLES) {
    const t0 = performance.now();
    const r = compute(ex.project());
    const dt = performance.now() - t0;
    assert.ok(Number.isFinite(r.eta) && r.eta > 0.3 && r.eta < 1, `${ex.name}: η = ${r.eta}`);
    assert.ok(dt < 3000, `${ex.name}: ${dt} ms`);
    for (const lc of r.lcs) for (const A of [lc.Y, lc.Z]) {
      assert.ok(A.curve.length > 3, 'Last-Verformungs-Kurve');
      assert.ok(A.nm.length > 20, 'Interaktionsdiagramm');
    }
  }
});

test('Zugkraft: Nachweis gegen den Zugwiderstand As·fsd', () => {
  // 4Ø20: As = 1256.6 mm², fsd = 434.78 MPa → N_Rd,Zug = 546.4 kN; N = −300 kN → η = 0.549
  const r = compute(handProject({ loadCases: [{ name: 'Zug', N: -300, Myt: 0, Myb: 0 }] })).lcs[0];
  const c = r.checks.find((x) => x.key === 'N');
  near(c.Rd, 546.4, 2e-3, 'N_Rd Zug');
  near(c.eta, 300 / 546.4, 2e-3, 'η Zug');
});

test('Verständliche Fehlermeldungen bei ungültiger Eingabe', () => {
  assert.throws(() => compute(handProject({ section: { ...handProject().section, axis: 200 } })), /Überdeckung ist zu gross/);
  assert.throws(() => compute(handProject({ support: 'custom', custom: { bot: 'pinned', top: 'pinned', sway: true, kBot: 0, kTop: 0 } })), /kinematisch/);
  assert.throws(() => compute(handProject({ L: 0 })), /Stützenlänge/);
  assert.throws(() => compute(handProject({ loadCases: [] })), /kein Lastfall/);
});

test('Achswerte: Trägheitsradius und Nutzhöhe', () => {
  const geo = sectionGeometry({ shape: 'rect', b: 300, h: 500, nb: 2, nh: 2, dia: 20, coverMode: 'axis', axis: 50 });
  const py = axisProps(geo, 'y'), pz = axisProps(geo, 'z');
  near(py.i, 0.5 / Math.sqrt(12), 1e-12, 'i_y');
  near(pz.i, 0.3 / Math.sqrt(12), 1e-12, 'i_z');
  near(py.d, 0.45, 1e-9, 'd_y = h − a');
  near(pz.d, 0.25, 1e-9, 'd_z = b − a');
});

// ------------------------------------------------------------------ Leeres Projekt, grafische Bearbeitung, Herleitung

test('Startprojekt ist neutral: Stütze ohne Lasten, Berechnung meldet fehlende Eingabe', () => {
  const p = defaultProject();
  assert.equal(p.loadCases.length, 0);
  assert.equal(p.L, 3);
  assert.equal(p.support, 'pinned');
  assert.deepEqual([p.section.b, p.section.h, p.section.nb, p.section.nh, p.section.dia], [300, 300, 2, 2, 16]);
  assert.match(missingInput(p).hint, /Werkzeug «Last»/);
  assert.match(missingInput({ ...p, loadCases: [{ name: 'LF 1', N: 0 }] }).msg, /enthält noch keine Lasten/);
  assert.equal(missingInput({ ...p, loadCases: [{ name: 'LF 1', N: 0, Hz: 5 }] }), null);
  for (const ex of EXAMPLES) assert.equal(missingInput(ex.project()), null, ex.name);
  // Vorschlag N ≈ 0.3·A_c·f_cd = 0.3·0.09·20·1000 = 540 kN → 550 kN
  assert.equal(suggestN(p), 550);
});

test('Lagerung je Stützenende: Standardfälle werden erkannt, sonst benutzerdefiniert', () => {
  for (const key of Object.keys(SUPPORT_PRESETS).filter((k) => k !== 'custom')) {
    assert.equal(presetFor(supportState({ ...defaultProject(), support: key }, 'y')), key, key);
  }
  const p = defaultProject();
  setSupportState(p, 'y', { ...supportState(p, 'y'), bot: 'fixed', top: 'pinned', sway: true });
  assert.equal(p.support, 'cantilever');
  setSupportState(p, 'y', { ...supportState(p, 'y'), top: 'spring', kTop: 15 });
  assert.equal(p.support, 'custom');
  assert.deepEqual([p.custom.bot, p.custom.top, p.custom.sway, p.custom.kTop], ['fixed', 'spring', true, 15]);
  // Änderung für Biegung um z trennt die Lagerung der Richtungen, y bleibt
  setSupportState(p, 'z', { ...supportState(p, 'z'), top: 'fixed', sway: false });
  assert.equal(p.supportZ, 'fixedFixed');
  assert.equal(p.support, 'custom');
});

function fakeApp(project, mode = 'system') {
  const log = [];
  return { project: normalize(project), viewMode: mode, viewOpts: { lc: 0 }, results: null, view: { px: (n) => n / 100 }, status: (t) => log.push(t), log };
}

test('Grafische Bearbeitung: Kopf ziehen ändert L, Werkzeuge legen Lasten an', () => {
  const app = fakeApp(defaultProject());
  const g = editorSpec.geometry(app);
  const top = g.points.find((q) => q.id === 'top:y');
  assert.deepEqual(top.p, [0, 3]);
  assert.ok(top.movable && !g.points.find((q) => q.id === 'bot:y').movable);
  assert.ok(g.regions.some((r) => r.id === 'col:y') && g.regions.some((r) => r.id === 'sec'));
  // Last auf den Kopf: Lastfall mit vorgeschlagener Normalkraft
  assert.deepEqual(editorSpec.pick(app, 'load', { type: 'point', id: 'top:y', item: top }), ['top:y']);
  assert.equal(app.project.loadCases.length, 1);
  assert.equal(app.project.loadCases[0].N, 550);
  // Streckenlast auf die Stütze
  assert.deepEqual(editorSpec.pick(app, 'dist', { type: 'region', id: 'col:y' }), ['q:y']);
  assert.equal(app.project.loadCases[0].qz, 5);
  const g2 = editorSpec.geometry(app);
  assert.ok(g2.regions.some((r) => r.id === 'q:y') && g2.points.some((q) => q.id === 'N:y'));
  // Kopf ziehen
  editorSpec.move(app, ['top:y'], [0.3, 1.5]);
  assert.equal(app.project.L, 4.5);
  editorSpec.move(app, ['top:y'], [0, -10]);
  assert.equal(app.project.L, 4.5, 'zu kurze Stütze wird abgelehnt');
  editorSpec.move(app, ['col:y'], [0, 1]);
  assert.equal(app.project.L, 4.5, 'nur der Kopf ist verschiebbar');
  // Querschnittsansicht: Stäbe und Querschnitt sind anklickbar
  const gs = editorSpec.geometry({ ...app, viewMode: 'section' });
  assert.equal(gs.points.filter((q) => q.id.startsWith('bar:')).length, 4);
  assert.equal(gs.regions[0].id, 'qs');
  // Zwei Biegeebenen: Elemente je Achse
  const two = fakeApp({ ...EXAMPLES[1].project(), supportZ: 'pinned' });
  const ids = editorSpec.geometry(two).points.map((q) => q.id);
  assert.ok(ids.includes('top:y') && ids.includes('top:z'));
});

test('Herleitung: alle Nachweise verlinkt, Werte stimmen mit der Berechnung überein', () => {
  const R = compute(handProject({ norm: 'SIA', creep: { phi: 2, ratio: 0.7 } }));
  const app = { results: R, project: R.p, viewOpts: { lc: 0 }, editor: null, derivTarget: null };
  const secs = derivation(app);
  const ids = new Set(secs.map((x) => x.id));
  for (const c of [...R.lcs[0].checks, ...R.lcs[0].simpChecks]) {
    if (c.deriv.endsWith('-z')) continue;
    assert.ok(ids.has(c.deriv), `Abschnitt ${c.deriv}`);
  }
  const txt = JSON.stringify(secs);
  assert.ok(!/NaN|undefined|Infinity/.test(txt), 'keine ungültigen Zahlen');
  // f_cd = (30/30)^(1/3)·30/1.5 = 20.00 MPa, E_cd = 10 000·38^(1/3)/1.2 = 33 619.8/1.2 = 28 016 MPa
  const bs = secs.find((x) => x.id === 'baustoffe').steps.filter(Boolean);
  assert.ok(bs.some((st) => /20[.,]00 MPa/.test(st.r)), 'f_cd');
  assert.ok(bs.some((st) => /28.?016 MPa/.test(st.r)), 'E_cd');
  const A = R.lcs[0].Y;
  assert.equal(secs.find((x) => x.id === 'allg-y').result.eta, A.etaU);
  assert.equal(secs.find((x) => x.id === 'vereinf-y').result.eta, A.simp.eta);
  // Link auf die z-Achse zeigt die Herleitung für Biegung um z
  const secZ = derivation({ ...app, derivTarget: 'allg-z' });
  assert.ok(secZ.some((x) => x.id === 'allg-z') && !secZ.some((x) => x.id === 'allg-y'));
  // EC: Nennkrümmungsverfahren mit K_r und K_φ
  const RE = compute(handProject());
  const se = derivation({ ...app, results: RE, project: RE.p });
  assert.ok(se.find((x) => x.id === 'vereinf-y').steps.some((st) => /K_r/.test(st.f || '')));
});

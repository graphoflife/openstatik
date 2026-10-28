// Tests Geotechnik – Vergleich mit Handrechnungen und Literaturwerten
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeSoil, verticalStress, normPreset, averageParams } from '../modules/geotechnik/soil.js';
import {
  kaRankine, kpRankine, k0, coulombActive, coulombPassive, lancellottaKp, passiveCurved,
  coulombWedge, activeSlipAngle, wedgeLoadFactor, earthPressureProfile,
} from '../modules/geotechnik/earthpressure.js';
import { bearingFactors, bearingResistance, effectiveArea, footingAnalysis, eccentricityRatios } from '../modules/geotechnik/bearing.js';
import { cornerFactor, rectFactor, stripFactor, circleFactor, pointLoadStress, settlementAnalysis } from '../modules/geotechnik/settlement.js';
import { buildSlopeModel, evalCircle, slopeAnalysis } from '../modules/geotechnik/slope.js';
import { wallAnalysis } from '../modules/geotechnik/wall.js';
import { compute, IncompleteInput } from '../modules/geotechnik/calc.js';
import { derivation } from '../modules/geotechnik/derivation.js';
import { EXAMPLES, defaultProject } from '../modules/geotechnik/examples.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} erwartet ${b}, erhalten ${a} (Toleranz ${tol})`);
const rel = (a, b, r, msg) => near(a, b, Math.abs(b) * r, msg);
const layer = (o) => ({ name: 'Boden', z: 0, gamma: 20, gammaP: 10, phi: 30, c: 0, cu: 0, ME: 10, dr: 2 / 3, col: 1, ...o });
const EC = normPreset('EC');

// ------------------------------------------------------------------ Erddruckbeiwerte

test('Rankine: K_a(30°) = 1/3, K_p(30°) = 3', () => {
  near(kaRankine(30), 1 / 3, 1e-12);
  near(kpRankine(30), 3, 1e-12);
});

test('Coulomb aktiv, φ=30°, δ=2/3·φ, α=β=0: K_a = 0.297 (Das, Tab. Coulomb), K_agh = K_a·cos δ = 0.279', () => {
  const r = coulombActive({ phi: 30, delta: 20 });
  near(r.Ka, 0.2973, 5e-4, 'K_a (geneigte Resultierende)');
  near(r.Kagh, 0.2973 * Math.cos(20 * Math.PI / 180), 5e-4, 'K_agh (Horizontalkomponente)');
  // δ = 0 → Rankine; Kohäsionsbeiwert 2√K_a
  const r0 = coulombActive({ phi: 30, delta: 0 });
  near(r0.Kagh, 1 / 3, 1e-12);
  near(r0.Kach, 2 * Math.sqrt(1 / 3), 1e-12);
  near(r0.theta, 60, 0.01, 'Gleitfuge 45° + φ/2');
});

test('Coulomb-Formel (DIN 4085) = numerischer Gleitkeil für geneigte Wand und Gelände', () => {
  for (const [phi, delta, alpha, beta] of [[30, 20, 10, 0], [30, 20, -10, 0], [30, 20, 10, 15], [35, 10, -5, 20], [28, 0, 0, 10]]) {
    let Emax = -Infinity;
    for (let t = 0.05; t < 179.9; t += 0.02) { const E = coulombWedge({ phi, delta, alpha, beta }, t); if (Number.isFinite(E) && E > Emax) Emax = E; }
    const Kah = 2 * Emax * Math.cos((alpha + delta) * Math.PI / 180);
    near(coulombActive({ phi, delta, alpha, beta }).Kagh, Kah, 2e-4, `aktiv φ=${phi} δ=${delta} α=${alpha} β=${beta}`);
    let Emin = Infinity;
    for (let t = 0.05; t < 179.9; t += 0.02) { const E = coulombWedge({ phi, delta, alpha, beta, passive: true }, t); if (Number.isFinite(E) && E > 0 && E < Emin) Emin = E; }
    near(coulombPassive({ phi, delta, alpha, beta }).Kpgh, 2 * Emin * Math.cos((alpha - delta) * Math.PI / 180), 2e-3 * coulombPassive({ phi, delta, alpha, beta }).Kpgh, `passiv φ=${phi}`);
  }
});

test('Rankine bei geneigtem Gelände = Coulomb mit δ = β', () => {
  for (const [phi, beta] of [[30, 10], [30, 20], [35, 15]]) {
    const p = phi * Math.PI / 180, b = beta * Math.PI / 180;
    const cb = Math.cos(b), cp = Math.cos(p);
    const KaR = cb * (cb - Math.sqrt(cb * cb - cp * cp)) / (cb + Math.sqrt(cb * cb - cp * cp)); // Rankine (parallel zum Gelände)
    near(coulombActive({ phi, delta: beta, beta }).Kagh, KaR * cb, 1e-10);
  }
});

test('Erdruhedruck K_0 = 1 − sin φ (EN 1997-1, 9.5.2), Überkonsolidation und Geländeneigung', () => {
  near(k0(30), 0.5, 1e-12);
  near(k0(30, 4), 1.0, 1e-12);
  near(k0(30, 1, 30), 0.75, 1e-12);
});

test('Erdwiderstand: Coulomb und Lancellotta (2002) für δ=0 = Rankine; gekrümmt < eben', () => {
  near(coulombPassive({ phi: 30 }).Kpgh, 3, 1e-12);
  near(coulombPassive({ phi: 30 }).Kpch, 2 * Math.sqrt(3), 1e-12);
  near(lancellottaKp(30, 0), 3, 1e-12);
  // Handrechnung Lancellotta φ=30°, δ=20°: 2θ = asin(sin20/sin30)+20° = 63.16°; K_p = 4.633
  near(lancellottaKp(30, 20), 4.633, 2e-3);
  assert.ok(lancellottaKp(30, 20) < coulombPassive({ phi: 30, delta: 20 }).Kpgh);
  near(passiveCurved({ phi: 30, delta: 20 }).Kpgh, lancellottaKp(30, 20), 1e-12);
});

test('Linienlast im Gleitkeil: Faktor aus Krafteck = numerischer Keil', () => {
  const o = { phi: 30, delta: 20, alpha: 0, beta: 0 };
  const th = activeSlipAngle(o);
  const dE = (coulombWedge({ ...o, P: 1 }, th) - coulombWedge(o, th)) * Math.cos(20 * Math.PI / 180);
  near(wedgeLoadFactor(o, th), dE, 1e-9);
});

// ------------------------------------------------------------------ Erddruckverteilung

test('Verteilung homogen, trocken: E_ah = ½·γ·H²·K_a, Angriff H/3; Auflast K_a·q; Wasser ½·γ_w·h²', () => {
  const soil = makeSoil({ layers: [layer({ phi: 30, dr: 0 })], gw: { on: true, z: 2 } });
  const r = earthPressureProfile({ soil, zBot: 4, kind: 'active', deltaMode: 'zero', q: 10, water: true });
  // σ'_v(4) = 20·2 + 10·2 = 60 → e_G(4) = 20; Fläche: 0..2: ½·(40/3)·2, 2..4: (40/3+20)/2·2
  const EG = 0.5 * 40 / 3 * 2 + (40 / 3 + 20) / 2 * 2;
  near(r.EhG, EG, 1e-6, 'E_ah,G');
  near(r.EhQ, 10 / 3 * 4, 1e-6, 'E_ah,Q');
  near(r.U, 0.5 * 10 * 4, 1e-6, 'Wasserdruck');
  near(r.hU, 2 / 3, 1e-6, 'Angriff Wasser');
  const dry = earthPressureProfile({ soil: makeSoil({ layers: [layer({ phi: 30 })] }), zBot: 6, kind: 'active', deltaMode: 'zero' });
  near(dry.Eh, 0.5 * 20 * 36 / 3, 1e-6);
  near(dry.hE, 2, 1e-6);
});

test('Kohäsion: Zugzone z_c = 2c/(γ√K_a) (Rankine), Erddruck ≥ 0', () => {
  const soil = makeSoil({ layers: [layer({ phi: 20, c: 10, gamma: 18 })] });
  const r = earthPressureProfile({ soil, zBot: 5, kind: 'active', deltaMode: 'zero' });
  const Ka = kaRankine(20);
  near(r.zCrack, 2 * 10 / (18 * Math.sqrt(Ka)), 0.05);
  assert.ok(r.pts.every((p) => p.eh >= 0));
  const zc = 2 * 10 / (18 * Math.sqrt(Ka));
  near(r.Eh, 0.5 * (18 * 5 * Ka - 2 * 10 * Math.sqrt(Ka)) * (5 - zc), 0.05, 'Dreieck unterhalb der Zugzone');
});

test('Erhöhter aktiver Erddruck (μ = 0.5) = Mittelwert aus E_a und E_0', () => {
  const soil = makeSoil({ layers: [layer({ phi: 32, dr: 0 })] });
  const a = earthPressureProfile({ soil, zBot: 4, kind: 'active', deltaMode: 'zero' });
  const o = earthPressureProfile({ soil, zBot: 4, kind: 'atrest', deltaMode: 'zero' });
  const m = earthPressureProfile({ soil, zBot: 4, kind: 'increased', deltaMode: 'zero', mu: 0.5 });
  near(m.Eh, (a.Eh + o.Eh) / 2, 1e-9);
});

// ------------------------------------------------------------------ Grundbruch

test('Tragfähigkeitsbeiwerte φ=30° (EN 1997-1, Anhang D): N_q = 18.40, N_c = 30.14, N_γ = 20.09; φ=0: N_c = π+2', () => {
  const N = bearingFactors(30);
  near(N.Nq, 18.40, 0.005);
  near(N.Nc, 30.14, 0.005);
  near(N.Ng, 20.09, 0.005);
  near(bearingFactors(0).Nc, 5.14, 0.005);
});

test('Undrainiert, Streifen, zentrisch: R/A\' = 5.14·c_u + q', () => {
  const r = bearingResistance({ Bp: 2, Lp: 1, A: 2, ratio: 0, strip: true, V: 100, H: 0, drained: false, phi: 0, c: 0, cu: 50, gammaEff: 18, qEff: 0, qTot: 0 });
  near(r.r, 5.1416 * 50, 0.01);
  // Neigung: i_c = ½(1 + √(1 − H/(A'c_u)))
  const ri = bearingResistance({ Bp: 2, Lp: 1, A: 2, ratio: 0, strip: true, V: 100, H: 50, drained: false, phi: 0, c: 0, cu: 50, gammaEff: 18, qEff: 0, qTot: 0 });
  near(ri.i.c, 0.5 * (1 + Math.sqrt(0.5)), 1e-12);
});

test('Drainiert, Streifen B=2 m, D=1 m, φ=30°, γ=18: r = q·N_q + ½γB·N_γ (Handrechnung 692.8 kN/m²)', () => {
  const soil = makeSoil({ layers: [layer({ gamma: 18, phi: 30 })] });
  const res = footingAnalysis(soil, { ...EC, gRv: 1 }, { shape: 'strip', B: 2, D: 1, t: 0, selfWeight: false, loads: { G: { V: 500 }, Q: {} } }, { noCurve: true });
  const hand = 18 * 18.401 + 0.5 * 18 * 2 * 20.093;
  rel(res.charRes.rk, hand, 1e-3);
});

test('Form- und Neigungsbeiwerte (EN 1997-1, D.4)', () => {
  const sq = bearingResistance({ Bp: 2, Lp: 2, A: 4, ratio: 1, strip: false, V: 100, H: 0, drained: true, phi: 30, c: 0, cu: 0, gammaEff: 18, qEff: 18, qTot: 18 });
  near(sq.s.q, 1.5, 1e-12); near(sq.s.g, 0.7, 1e-12); near(sq.s.c, (1.5 * 18.401 - 1) / 17.401, 1e-3);
  const inc = bearingResistance({ Bp: 2, Lp: 1, A: 2, ratio: 0, strip: true, V: 100, H: 10, drained: true, phi: 30, c: 0, cu: 0, gammaEff: 18, qEff: 18, qTot: 18 });
  near(inc.m, 2, 1e-12); near(inc.i.q, 0.81, 1e-12); near(inc.i.g, 0.729, 1e-12);
});

test('Wirksame Fläche nach Meyerhof und Kernweiten', () => {
  const e = effectiveArea({ shape: 'rect', B: 3, L: 2, eB: 0.2, eL: 0.1 });
  near(e.Bp, 1.8, 1e-12); near(e.Lp, 2.6, 1e-12); assert.ok(e.swapped);
  const c = effectiveArea({ shape: 'circle', B: 2, eB: 0 });
  near(c.A, Math.PI, 1e-12);
  near(eccentricityRatios({ shape: 'strip', B: 3, eB: 0.5 }).kern, 1, 1e-12);
  near(eccentricityRatios({ shape: 'strip', B: 3, eB: 1 }).gap, 1, 1e-12);
});

test('Fundamentanalyse: Gleiten R_h = V·tan δ / γ_R,h (EN 1997-1, 6.5.3)', () => {
  const soil = makeSoil({ layers: [layer({ phi: 30 })] });
  const r = footingAnalysis(soil, EC, { shape: 'rect', B: 2, L: 2, D: 1, t: 0, selfWeight: false, loads: { G: { V: 400, HB: 50 }, Q: { V: 0 } }, interface: 'cast' }, { noCurve: true });
  near(r.govS.Rd, 400 * Math.tan(Math.PI / 6) / 1.1, 1e-6);
  near(r.govS.Hd, 1.35 * 50, 1e-9);
});

// ------------------------------------------------------------------ Spannungen und Setzung

test('Steinbrenner/Boussinesq: Eckwert m = n = 1 bei z = B → 0.1752 (Newmark/Fadum)', () => {
  near(cornerFactor(1, 1, 1), 0.1752, 2e-4);
  near(cornerFactor(0.5, 0.5, 1), 0.0840, 2e-4, 'm = n = 0.5');
  near(rectFactor(2, 2, 0, 0, 2), 4 * cornerFactor(1, 1, 2), 1e-12, 'Überlagerung Mitte');
  near(rectFactor(2, 2, 1, 1, 2), cornerFactor(2, 2, 2), 1e-12, 'Überlagerung Ecke');
  near(rectFactor(2, 2, 3, 0, 2), 2 * (cornerFactor(4, 1, 2) - cornerFactor(2, 1, 2)), 1e-12, 'Punkt ausserhalb');
});

test('Streifen- und Kreislast (exakt): Streifenmitte z=B → 0.550, Kreismitte z=R → 0.646', () => {
  near(stripFactor(2, 0, 2), (2 * Math.atan(0.5) + Math.sin(2 * Math.atan(0.5))) / Math.PI, 1e-12);
  near(stripFactor(2, 0, 2), 0.550, 1e-3);
  near(circleFactor(1, 0, 1), 1 - Math.pow(0.5, 1.5), 1e-12);
  near(circleFactor(1, 1e-4, 1), 0.6464, 2e-4, 'Sektorintegration');
  // sehr langes Rechteck = Streifen; kleine Fläche ≈ Punktlast
  near(rectFactor(2, 2000, 0.3, 0, 1.5), stripFactor(2, 0.3, 1.5), 1e-4);
  rel(rectFactor(0.01, 0.01, 0.5, 0, 1) * 1e4, pointLoadStress(1, 0.5, 1), 1e-3, 'kleine Fläche (p·A = 1 kN) ≈ Punktlast');
});

test('Setzung 1D (sehr grosse Lastfläche): s = p·z_gr/M_E mit z_gr aus Δσ = 0.2·σ\'_v0', () => {
  const soil = makeSoil({ layers: [layer({ gamma: 20, ME: 10 })] });
  const r = settlementAnalysis(soil, { shape: 'rect', B: 2000, L: 2000, D: 0, p0: 100, unload: false, limitFactor: 0.2, rigid: false });
  near(r.zLim, 25, 0.01);
  near(r.sCentre, 100 * 25 / 10000 * 1000, 0.5);
});

test('Setzung: Aushubentlastung und geschichteter Boden', () => {
  const soil = makeSoil({ layers: [layer({ gamma: 20, ME: 50 }), layer({ name: 'weich', z: 3, gamma: 19, ME: 5 })], gw: { on: false } });
  const r = settlementAnalysis(soil, { shape: 'rect', B: 2, L: 2, D: 1, p0: 150, unload: true });
  near(r.pNet, 150 - 20, 1e-9);
  assert.ok(r.sChar < r.sCentre && r.sEdge < r.sChar);
  const sum = r.layers.reduce((s, l) => s + l.ds.char, 0);
  near(sum, r.sChar, 1e-9);
});

// ------------------------------------------------------------------ Böschung

const ACADS = { surface: [{ x: 0, y: 10 }, { x: 20, y: 10 }, { x: 40, y: 0 }, { x: 70, y: 0 }], waterMode: 'none', nSlices: 30, tMin: 0.5, depthBelow: 5, grid: { auto: true } };

test('Böschung ACADS 1(a) (Giam & Donald 1989): H=10 m, 2:1, c\'=3 kPa, φ\'=19.6°, γ=20 → F ≈ 1.00 (±3 %)', () => {
  const soil = makeSoil({ layers: [layer({ gamma: 20, phi: 19.6, c: 3 })] });
  const r = slopeAnalysis(soil, ACADS, EC);
  rel(r.F, 1.0, 0.03, 'Bishop');
  assert.ok(r.FF <= r.F + 1e-9, 'Fellenius ≤ Bishop');
  assert.ok(r.ms < 1500, `Suche zu langsam: ${r.ms} ms`);
});

test('Böschung: Konvergenz mit Lamellenzahl, Fellenius = Bishop für φ = 0, Spiegelung', () => {
  const soil = makeSoil({ layers: [layer({ gamma: 20, phi: 19.6, c: 3 })] });
  const M = buildSlopeModel(soil, ACADS);
  const P = (n) => ({ n, f: { tanPhi: 1, c: 1, cu: 1, gamma: 1 } });
  const F30 = evalCircle(M, 33, 22, 22.5, P(30)).F, F200 = evalCircle(M, 33, 22, 22.5, P(200)).F;
  rel(F30, F200, 0.005);
  const soil0 = makeSoil({ layers: [layer({ gamma: 20, phi: 0, c: 25 })] });
  const r0 = evalCircle(buildSlopeModel(soil0, ACADS), 33, 22, 22.5, P(40));
  near(r0.F, r0.FF, 1e-9);
  // gespiegelte Böschung (fällt nach links ab) liefert denselben Faktor
  const mir = { ...ACADS, surface: ACADS.surface.map((p) => ({ x: -p.x, y: p.y })) };
  const Mm = buildSlopeModel(soil, mir);
  near(evalCircle(Mm, -33 * Mm.dir, 22, 22.5, P(30)).F, F30, 1e-9);
});

test('Böschung: Bemessungswerte (γ_M) verkleinern F; Grundwasser verkleinert F', () => {
  const soil = makeSoil({ layers: [layer({ gamma: 20, gammaP: 10, phi: 25, c: 5 })], gw: { on: true, z: 2 } });
  const dry = slopeAnalysis(makeSoil({ layers: [layer({ gamma: 20, phi: 25, c: 5 })] }), { ...ACADS, waterMode: 'none' }, normPreset('SIA'));
  const wet = slopeAnalysis(soil, { ...ACADS, waterMode: 'gw' }, normPreset('SIA'));
  assert.ok(wet.F < dry.F);
  assert.ok(dry.Fd < dry.F);
});

// ------------------------------------------------------------------ Stützmauer

test('Winkelstützmauer: Handrechnung Gleiten, Kippen, Ausmittigkeit, Wandmoment', () => {
  // h_s=3.0, Wand 0.3 konstant, Zehe 0.5, Ferse 1.5, d=0.5 → B=2.3, H=3.5; φ=30°, γ=20, Rankine, q=0
  const soilIn = { layers: [layer({ phi: 30, gamma: 20 })], gw: { on: false } };
  const rw = { hs: 3, tTop: 0.3, tBot: 0.3, toe: 0.5, heel: 1.5, d: 0.5, Df: 0.5, beta: 0, q: 0, method: 'rankine', water: false, gammaC: 25, key: { on: false }, drainage: 'drained' };
  const r = wallAnalysis(soilIn, rw, EC);
  const Eah = 0.5 * 20 * 3.5 ** 2 / 3;
  near(r.ep.Eh, Eah, 1e-6, 'E_ah');
  near(r.ep.hE, 3.5 / 3, 1e-6, 'Angriffshöhe');
  const W = [[22.5, 0.65], [28.75, 1.15], [90, 1.55]];
  const N = W.reduce((s, [w]) => s + w, 0);
  near(r.charG.N, N, 1e-6, 'ΣV');
  const Mstb = W.reduce((s, [w, x]) => s + w * x, 0), Mdst = Eah * 3.5 / 3;
  near(r.charG.e, 2.3 / 2 - (Mstb - Mdst) / N, 1e-6, 'Ausmitte e');
  near(r.Fkipp, Mstb / Mdst, 1e-6, 'Kippsicherheit');
  // Gleiten: H_d = 1.35·E_ah; R_d = V_k·tan φ / 1.1
  near(r.govS.Hd, 1.35 * Eah, 1e-6);
  near(r.govS.Rd, N * Math.tan(Math.PI / 6) / 1.1, 1e-6);
  near(r.govS.eta, 1.35 * Eah / (N * Math.tan(Math.PI / 6) / 1.1), 1e-6);
  // Wand: E = ½·20·3²/3 = 30 kN/m, M_k = 30·1.0 = 30 kNm/m
  near(r.sec.base.Vk, 30, 1e-3);
  near(r.sec.base.Mk, 30, 1e-3);
  near(r.sec.base.Md, 1.35 * 30, 1e-3);
  assert.ok(r.govB.eta > 0 && Number.isFinite(r.govB.eta));
});

// ------------------------------------------------------------------ Gesamtablauf

test('Alle Beispiele rechnen fehlerfrei und decken alle Analysearten ab', () => {
  assert.ok(EXAMPLES.length >= 5);
  const types = new Set();
  for (const ex of EXAMPLES) {
    const r = compute(ex.project());
    types.add(r.type);
    assert.ok(r && r.type, ex.name);
  }
  for (const t of ['erddruck', 'grundbruch', 'setzung', 'boeschung', 'stuetzmauer']) assert.ok(types.has(t), t);
});

test('Leeres Standardprojekt: freundlicher Hinweis (IncompleteInput) statt Fehler, für jede Analyseart', () => {
  for (const t of ['erddruck', 'grundbruch', 'setzung', 'boeschung', 'stuetzmauer']) {
    const p = defaultProject();
    p.analysis = t;
    assert.equal(p.soil.layers.length, 1);
    assert.throws(() => compute(p), (e) => e instanceof IncompleteInput && e.incomplete === true && typeof e.hint === 'string' && e.hint.length > 20, t);
  }
  // Grundbruch mit Fundament, aber ohne Lasten → Hinweis auf Lasten
  const p = defaultProject();
  p.analysis = 'grundbruch'; p.bc.B = 2; p.bc.L = 2;
  assert.throws(() => compute(p), (e) => e.incomplete && /Lasten/.test(e.message));
  p.bc.loads.G.V = 500;
  assert.ok(compute(p).bc.gov.eta > 0);
});

test('Herleitung: vollständige Abschnitte ohne fehlende Werte für alle Beispiele', () => {
  for (const ex of EXAMPLES) {
    const project = ex.project();
    const results = compute(project);
    const secs = derivation({ project, results, viewOpts: {}, editor: null });
    assert.ok(secs.length >= 3, ex.name);
    for (const sec of secs) {
      assert.ok(sec.id && sec.title, `${ex.name}: Abschnitt ohne id/Titel`);
      for (const stp of sec.steps || []) {
        if (!stp) continue;
        const txt = [stp.label, stp.f, stp.v, stp.r].join(' ');
        assert.ok(!/NaN|undefined|null/.test(txt), `${ex.name} / ${sec.title}: ${txt}`);
      }
    }
  }
  // Nachweise sind mit Abschnitten verknüpft
  const p = EXAMPLES[1].project();
  const secs = derivation({ project: p, results: compute(p), viewOpts: {} });
  for (const id of ['bc-R', 'bc-slide', 'bc-ecc']) assert.ok(secs.some((x) => x.id === id), id);
});

test('Spannungen und Mittelwerte im Schichtprofil', () => {
  const soil = makeSoil({ layers: [layer({ gamma: 18, gammaP: 9 }), layer({ z: 2, gamma: 20, gammaP: 11, phi: 20 })], gw: { on: true, z: 1 } });
  const s = verticalStress(soil, 4);
  near(s.sv, 18 + 19 + 2 * 21, 1e-12);
  near(s.u, 30, 1e-12);
  const a = averageParams(soil, 1, 3);
  near(a.phi, Math.atan((Math.tan(Math.PI / 6) + Math.tan(20 * Math.PI / 180)) / 2) * 180 / Math.PI, 1e-9);
});

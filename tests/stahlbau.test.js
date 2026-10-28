// Tests Stahlbau: Querschnittswerte, Klassifizierung, Knicken, Kippen, Interaktion, Stabstatik
// Referenzen: Profiltabellen (EN 10365 / DIN 1025, DIN 1026-1, EN 10210-2), EN 1993-1-1, NCCI SN003, Handrechnungen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionProps, outlineProps } from '../modules/stahlbau/profiles.js';
import { mcrFormula, mcrUniform, ltbEigen, cFactors } from '../modules/stahlbau/ltb.js';
import { analyzeBeam, combine, normLoad, autoCombos, defaultFactors, setBeamModel, systemGeometry } from '../modules/stahlbau/beam.js';
import {
  chiFlex, chiLT, classify, effectiveSection, interactionFactors, cmFactor, compute, suggestProfiles, bucklingCurves,
} from '../modules/stahlbau/calc.js';
import { EXAMPLES, defaultProject } from '../modules/stahlbau/examples.js';

const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} ≠ ${b} (±${(rel * 100).toFixed(2)} %)`);
const sec = (series, name) => sectionProps({ series, name });

// ------------------------------------------------------------------ Querschnittswerte

test('IPE 300: Tabellenwerte (EN 10365)', () => {
  const s = sec('IPE', 'IPE 300');
  near(s.A / 1e2, 53.8, 0.01, 'A [cm²]');
  near(s.Iy / 1e4, 8356, 0.01, 'Iy [cm⁴]');
  near(s.Iz / 1e4, 603.8, 0.01, 'Iz [cm⁴]');
  near(s.Wply / 1e3, 628, 0.01, 'Wpl,y [cm³]');
  near(s.Wely / 1e3, 557, 0.01, 'Wel,y [cm³]');
  near(s.It / 1e4, 20.1, 0.01, 'It [cm⁴]');
  near(s.Iw / 1e6, 125.9e3, 0.01, 'Iw [cm⁶]');
  near(s.Avz / 1e2, 25.7, 0.01, 'Avz [cm²]');
  near(s.mass, 42.2, 0.01, 'Masse [kg/m]');
});

test('HEB 200 und HEA 300: Tabellenwerte', () => {
  const b = sec('HEB', 'HEB 200');
  near(b.A / 1e2, 78.1, 0.01, 'HEB 200 A');
  near(b.Iy / 1e4, 5696, 0.01, 'HEB 200 Iy');
  near(b.Iz / 1e4, 2003, 0.01, 'HEB 200 Iz');
  near(b.Wply / 1e3, 642.5, 0.01, 'HEB 200 Wpl,y');
  near(b.It / 1e4, 59.3, 0.01, 'HEB 200 It');
  const a = sec('HEA', 'HEA 300');
  near(a.A / 1e2, 112.5, 0.01, 'HEA 300 A');
  near(a.Iy / 1e4, 18260, 0.01, 'HEA 300 Iy');
  near(a.Wply / 1e3, 1383, 0.01, 'HEA 300 Wpl,y');
});

test('UPN 200 (DIN 1026-1, geneigte Flansche): A, Iy, Iz, Wpl,y, Schwerpunkt', () => {
  const s = sec('UPN', 'UPN 200');
  near(s.A / 1e2, 32.2, 0.01, 'A');
  near(s.Iy / 1e4, 1910, 0.01, 'Iy');
  near(s.Iz / 1e4, 148, 0.01, 'Iz');
  near(s.Wply / 1e3, 228, 0.01, 'Wpl,y');
  near(s.ys / 10, 2.01, 0.01, 'ys [cm]');
  near(s.It / 1e4, 11.9, 0.03, 'It (Näherung)');
});

test('Hohlprofile EN 10210-2: RHS 200×100×8, CHS 168.3×8', () => {
  const r = sec('RHS', 'RHS 200×100×8');
  near(r.A / 1e2, 44.8, 0.01, 'RHS A');
  near(r.Iy / 1e4, 2234, 0.01, 'RHS Iy');
  near(r.Iz / 1e4, 739, 0.01, 'RHS Iz');
  near(r.Wply / 1e3, 282, 0.01, 'RHS Wpl,y');
  const c = sec('CHS', 'CHS 168.3×8');
  near(c.A / 1e2, 40.3, 0.01, 'CHS A');
  near(c.Iy / 1e4, 1297, 0.01, 'CHS I');
  near(c.Wply / 1e3, 205, 0.01, 'CHS Wpl');
});

test('Geschlossene Formeln = Integration über den gezeichneten Umriss', () => {
  for (const [s, n] of [['IPE', 'IPE 300'], ['HEM', 'HEM 300'], ['RHS', 'RHS 200×100×8']]) {
    const p = sec(s, n), o = outlineProps(p);
    near(o.A, p.A, 0.002, `${n} A`);
    near(o.Iy, p.Iy, 0.002, `${n} Iy`);
    near(o.Iz, p.Iz, 0.002, `${n} Iz`);
  }
});

test('Geschweisster I-Querschnitt ohne Ausrundung: A = 2·b·tf + hw·tw', () => {
  const s = sectionProps({ series: 'WI', welded: { h: 500, b: 250, tw: 10, tf: 20, a: 5 } });
  assert.equal(s.A, 2 * 250 * 20 + 460 * 10);
  near(s.Iy, (250 * 500 ** 3 - 240 * 460 ** 3) / 12, 1e-12, 'Iy');
  near(s.cw, 460 - 2 * Math.SQRT2 * 5, 1e-12, 'c Steg = hw − 2·√2·a');
});

// ------------------------------------------------------------------ Knicken

test('χ nach EN 1993-1-1 6.3.1.2 für λ̄ = 1.0 (Tabellenwerte)', () => {
  near(chiFlex(1.0, 'a0').chi, 0.7253, 0.0005, 'a0');
  near(chiFlex(1.0, 'a').chi, 0.6656, 0.0005, 'a');
  near(chiFlex(1.0, 'b').chi, 0.5970, 0.0005, 'b');
  near(chiFlex(1.0, 'c').chi, 0.5399, 0.0005, 'c');
  near(chiFlex(1.0, 'd').chi, 0.4671, 0.0005, 'd');
  assert.equal(chiFlex(0.15, 'c').chi, 1);
});

test('Knicklinien Tab. 6.2: IPE (h/b > 1.2) a/b, HEB 200 (h/b ≤ 1.2) b/c, S460 a0', () => {
  assert.deepEqual([bucklingCurves(sec('IPE', 'IPE 300'), 'S235').y, bucklingCurves(sec('IPE', 'IPE 300'), 'S235').z], ['a', 'b']);
  assert.deepEqual([bucklingCurves(sec('HEB', 'HEB 200'), 'S355').y, bucklingCurves(sec('HEB', 'HEB 200'), 'S355').z], ['b', 'c']);
  assert.equal(bucklingCurves(sec('IPE', 'IPE 300'), 'S460').z, 'a0');
});

test('Nb,Rd HEB 200, S355, Lcr = 4.5 m, EN (γM1 = 1.0) – Handrechnung', () => {
  // Handrechnung: A = 78.1 cm², iz = 5.07 cm, λ1 = 93.9·ε = 76.4, λ̄z = 4500/(50.7·76.4) = 1.163
  // Kurve c: Φ = 0.5·[1 + 0.49·(1.163 − 0.2) + 1.163²] = 1.412, χ = 0.452, Nb,z,Rd = 0.452·7808·355 = 1253 kN
  const p = EXAMPLES[1].project();
  p.norm = 'EC'; p.gamma = { auto: true };
  p.forces.cases = [{ name: 'N', N: 1000, My: 0, Mz: 0, Vz: 0, Vy: 0, shapeY: 'lin', psiY: 1, shapeZ: 'lin', psiZ: 1 }];
  const r = compute(p);
  const st = r.uls[0].st;
  near(st.lamZ, 1.163, 0.003, 'λ̄z');
  near(st.chiZ, 0.452, 0.003, 'χz');
  near(st.NbzRd / 1e3, 1253, 0.004, 'Nb,z,Rd [kN]');
  near(st.NbyRd / 1e3, chiFlex(st.lamY, 'b').chi * 7808 * 355 / 1e3, 0.002, 'Nb,y,Rd');
});

// ------------------------------------------------------------------ Klassifizierung

test('Klassifizierung Tab. 5.2', () => {
  const ipe = sec('IPE', 'IPE 300');
  // Steg c/t = (300 − 2·10.7 − 2·15)/7.1 = 35.0; S355: 42ε = 34.2 → Klasse 4; S235: 38ε = 38 → Klasse 2
  assert.equal(classify(ipe, 355, 500e3, 0, 0).cls, 4);
  assert.equal(classify(ipe, 235, 500e3, 0, 0).cls, 2);
  assert.equal(classify(ipe, 355, 0, 100e6, 0).cls, 1);
  // HEA 300 S355 Druck: Flansch c/t = 118.75/14 = 8.48 > 10ε = 8.14 → Klasse 3
  assert.equal(classify(sec('HEA', 'HEA 300'), 355, 500e3, 0, 0).cls, 3);
  assert.equal(classify(sec('HEB', 'HEB 200'), 355, 500e3, 0, 0).cls, 1);
  // Rohr d/t: CHS 168.3×8 → 21 < 50ε²
  assert.equal(classify(sec('CHS', 'CHS 168.3×8'), 355, 100e3, 0, 0).cls, 1);
});

test('Wirksame Fläche IPE 300, S355, zentrischer Druck (EN 1993-1-5 4.4)', () => {
  // λ̄p = 35.01/(28.4·0.8136·√4) = 0.7576, ρ = (0.7576 − 0.22)/0.7576² = 0.9366
  // ΔA = (1 − ρ)·248.6·7.1 = 112 mm² → Aeff = 5381 − 112 = 5269 mm²
  const e = effectiveSection(sec('IPE', 'IPE 300'), 355, 'N');
  near(e.A, 5269, 0.002, 'Aeff');
  assert.ok(Math.abs(e.eNz) < 1e-6, 'keine Schwerpunktverschiebung bei doppelter Symmetrie');
});

// ------------------------------------------------------------------ Kippen

test('Mcr IPE 300, L = 6 m, konstantes Moment, Gabellager: Formel und FE = geschlossene Lösung', () => {
  const s = sec('IPE', 'IPE 300');
  const E = 210000, G = 81000, L = 6000;
  const M0 = mcrUniform(E, G, s.Iz, s.It, s.Iw, L);
  // Handrechnung: π/L·√(E·Iz·G·It·(1 + π²·E·Iw/(L²·G·It))) = 90.5 kNm
  near(M0 / 1e6, 90.5, 0.002, 'geschlossene Lösung');
  near(mcrFormula({ E, G, Iz: s.Iz, It: s.It, Iw: s.Iw, L, C1: 1 }).Mcr, M0, 1e-9, '3-Faktoren-Formel');
  const fe = ltbEigen({ L, E, G, Iz: s.Iz, It: s.It, Iw: s.Iw, M: () => 1e6, restraints: [{ x: 0, v: true, phi: true }, { x: L, v: true, phi: true }] });
  near(fe.lambda * 1e6, M0, 0.001, 'FE-Eigenwert');
});

test('Mcr Gleichlast mit Lastangriff am Obergurt: FE ≈ Formel mit C1 = 1.127, C2 = 0.454 (SN003)', () => {
  const s = sec('IPE', 'IPE 300');
  const E = 210000, G = 81000, L = 6000, q = 1;
  const f = mcrFormula({ E, G, Iz: s.Iz, It: s.It, Iw: s.Iw, L, C1: 1.127, C2: 0.454, zg: 150 });
  const fe = ltbEigen({ L, E, G, Iz: s.Iz, It: s.It, Iw: s.Iw, M: (x) => q * x * (L - x) / 2, q: () => q, zq: 150, restraints: [{ x: 0, v: true, phi: true }, { x: L, v: true, phi: true }] });
  near(fe.lambda * q * L * L / 8, f.Mcr, 0.01, 'Mcr');
  near(f.Mcr / 1e6, 78.8, 0.005, 'Handrechnung 78.8 kNm');
});

test('C1-Erkennung aus dem Momentenverlauf', () => {
  const ms = (fn) => Array.from({ length: 17 }, (_, i) => fn(i / 16));
  near(cFactors(ms((x) => 4 * x * (1 - x))).C1, 1.127, 1e-9, 'Gleichlast');
  near(cFactors(ms((x) => 1 - x)).C1, 1.77, 1e-9, 'linear ψ = 0');
  near(cFactors(ms(() => 1)).C1, 1.0, 1e-9, 'konstant');
  assert.equal(cFactors(ms((x) => 1 - 6 * x + 6 * x * x)).shape, 'qe');
  assert.ok(cFactors(ms((x) => Math.sin(5 * x))).needsFE, 'beliebiger Verlauf → FE');
});

test('χLT: allgemeiner Fall, Walzprofil-Verfahren mit f, SIA 263', () => {
  // 6.3.2.2, Kurve a, λ̄LT = 1.0: Φ = 1.084, χ = 0.6656
  near(chiLT(1.0, 0.21, 'general').chiMod, 0.6656, 0.0005, 'allgemein');
  // 6.3.2.3, Kurve b, β = 0.75, λ̄0 = 0.4: Φ = 0.977, χ = 0.6997; kc = 0.94 → f = 0.9724, χmod = 0.7196
  const r = chiLT(1.0, 0.34, 'rolled', 0.94);
  near(r.chi, 0.6997, 0.0005, 'χLT');
  near(r.f, 0.9724, 0.0005, 'f');
  near(r.chiMod, 0.7196, 0.0005, 'χLT,mod');
  // SIA 263: Φ = 0.5·[1 + 0.21·(1.369 − 0.4) + 1.369²] = 1.539, χ = 0.446
  near(chiLT(1.369, 0.21, 'sia').chi, 0.446, 0.003, 'SIA');
});

// ------------------------------------------------------------------ Interaktion

test('Momentenbeiwerte Cm (Tab. B.3)', () => {
  const ms = (fn) => Array.from({ length: 17 }, (_, i) => fn(i / 16));
  near(cmFactor(ms((x) => 1 - x)).Cm, 0.6, 1e-9, 'linear ψ = 0');
  near(cmFactor(ms((x) => 1 - 2 * x)).Cm, 0.4, 1e-9, 'linear ψ = −1');
  near(cmFactor(ms((x) => 4 * x * (1 - x)), 'q').Cm, 0.95, 1e-9, 'Gleichlast gelenkig');
  near(cmFactor(ms((x) => 2 * Math.min(x, 1 - x)), 'P').Cm, 0.90, 1e-9, 'Einzellast gelenkig');
  near(cmFactor(ms((x) => 1 - 6 * x + 6 * x * x), 'q').Cm, 0.5, 1e-9, 'Gleichlast eingespannt');
});

test('Interaktionsbeiwerte Anhang B – Handrechnung', () => {
  // Klasse 1, I-Profil, kippgefährdet: λ̄y = 0.69, λ̄z = 1.163, nY = 0.3, nZ = 0.5, Cmy = 0.6, Cmz = 1.0, CmLT = 0.6
  // kyy = 0.6·min(1 + 0.49·0.3, 1 + 0.8·0.3) = 0.6882
  // kzz = 1.0·min(1 + (2·1.163 − 0.6)·0.5, 1 + 1.4·0.5) = 1.700, kyz = 0.6·kzz = 1.020
  // kzy = max(1 − 0.1·1.163·0.5/(0.6 − 0.25), 1 − 0.1·0.5/0.35) = 0.8571
  const k = interactionFactors({ plastic: true, susceptible: true, lamY: 0.69, lamZ: 1.163, nY: 0.3, nZ: 0.5, Cmy: 0.6, Cmz: 1.0, CmLT: 0.6 });
  near(k.kyy, 0.6882, 1e-4, 'kyy');
  near(k.kzz, 1.700, 1e-4, 'kzz');
  near(k.kyz, 1.020, 1e-4, 'kyz');
  near(k.kzy, 0.857143, 1e-5, 'kzy');
  // Klasse 3 (Tab. B.1/B.2): kyy = 0.6·min(1 + 0.6·0.69·0.3, 1.18) = 0.6745, kzy = max(1 − 0.05·1.163·0.5/0.35, 1 − 0.05·0.5/0.35) = 0.9286
  const e = interactionFactors({ plastic: false, susceptible: true, lamY: 0.69, lamZ: 1.163, nY: 0.3, nZ: 0.5, Cmy: 0.6, Cmz: 1.0, CmLT: 0.6 });
  near(e.kyy, 0.67452, 1e-4, 'kyy elastisch');
  near(e.kzy, 0.928571, 1e-5, 'kzy elastisch');
  assert.equal(e.kyz, e.kzz);
});

test('Stütze HEB 200: Interaktion 6.61/6.62 aus Zwischenwerten nachgerechnet', () => {
  const r = compute(EXAMPLES[1].project());
  const u = r.uls.find((x) => x.combo.name === 'Volllast');
  const s = u.st.segments[0];
  const g1 = r.mat.gammaM1, NRk = u.R.Aeff * r.mat.fy, MyRk = u.R.Wy * r.mat.fy;
  // ψ = 0 → Cmy = CmLT = 0.6
  near(s.Cmy.Cm, 0.6, 1e-9, 'Cmy');
  const N = 600e3, My = 30e6;
  const e61 = N / (u.st.chiY * NRk / g1) + s.kf.kyy * My / (s.chiLT * MyRk / g1);
  const e62 = N / (Math.min(u.st.chiZ, u.st.chiT) * NRk / g1) + s.kf.kzy * My / (s.chiLT * MyRk / g1);
  near(s.int61, e61, 1e-9, '6.61');
  near(s.int62, e62, 1e-9, '6.62');
  assert.ok(s.int62 > s.int61, 'Knicken aus der Ebene massgebend');
});

// ------------------------------------------------------------------ Stabstatik und Gesamtablauf

test('Stabstatik: Einfeldträger und Zweifeldträger unter Gleichlast', () => {
  const lcs = [{ id: 'G', name: 'G', cat: 'G' }];
  const EI = 17547.6; // kNm²
  const an = analyzeBeam({ system: 'ss', spans: [6] }, lcs, [normLoad({ lc: 'G', type: 'q', dir: 'z', v1: 10 }, 6)], EI, EI);
  const c = combine(an, { G: 1 });
  near(c.z.M(3), 45, 1e-9, 'qL²/8');
  near(c.z.V(0), 30, 1e-9, 'qL/2');
  near(Math.max(...c.z.w), 5 * 10 * 6 ** 4 / (384 * EI) * 1000, 1e-6, '5qL⁴/(384EI)');
  const an2 = analyzeBeam({ system: 'cont', spans: [5, 5] }, lcs, [normLoad({ lc: 'G', type: 'q', dir: 'z', v1: 10 }, 10)], EI, EI);
  near(combine(an2, { G: 1 }).z.M(5), -31.25, 1e-9, 'Stützmoment −qL²/8');
});

test('Kombinationen SIA 260: 1.35·G + 1.5·Q, quasi-ständig ψ2 = 0.3', () => {
  const cs = autoCombos([{ id: 'G', name: 'G', cat: 'G' }, { id: 'Q', name: 'Q', cat: 'Nutzlast' }], defaultFactors('SIA'));
  const u = cs.find((c) => c.type === 'ULS');
  assert.deepEqual([u.factors.G, u.factors.Q], [1.35, 1.5]);
  assert.equal(cs.find((c) => c.type === 'SLS-qp').factors.Q, 0.3);
});

test('Beispiel Deckenträger IPE 300 S235 (SIA): Kippen massgebend, Handrechnung', () => {
  // qd = 1.35·(4 + 0.415) + 1.5·4 = 11.96 kN/m → MEd = 53.8 kNm
  // Mcr (C1 = 1.127, C2 = 0.454, zg = +150 mm) = 78.8 kNm; λ̄LT = √(628·235/78.8e3) = 1.369; χLT = 0.446
  // Mb,Rd = 0.446·628e3·235/1.05 = 62.7 kNm → η = 0.86
  const r = compute(EXAMPLES[0].project());
  const lt = r.checks.find((c) => c.id === 'Mb');
  near(lt.Ed, 53.8, 0.003, 'MEd');
  near(lt.seg.Mcr / 1e6, 78.8, 0.003, 'Mcr');
  near(lt.seg.lamLT, 1.369, 0.003, 'λ̄LT');
  near(lt.Rd, 62.7, 0.005, 'Mb,Rd');
  assert.equal(r.gov.id, 'Mb');
  // Durchbiegung charakteristisch: 5·(4.415 + 4)·6⁴/(384·EI) = 8.1 mm < 20 mm
  const w = r.checks.find((c) => c.id === 'w-SLS-char');
  near(w.Ed, 8.1, 0.01, 'w');
});

test('Alle Beispiele rechnen fehlerfrei mit 0 < η ≤ 1', () => {
  for (const ex of EXAMPLES) {
    const r = compute(ex.project());
    assert.ok(r.etaMax > 0 && r.etaMax <= 1, `${ex.name}: η = ${r.etaMax}`);
  }
});

test('Neues Projekt ist leer: Träger ohne Lasten → unvollständige Eingabe mit Hinweis', () => {
  const p = defaultProject();
  assert.equal(p.beam.loads.length, 0);
  assert.throws(() => compute(p), (e) => e.incomplete === true && /Lasten/.test(e.message) && /Streckenlast/.test(e.hint));
  p.beam.loads.push({ lc: 'G', kind: 'qz', v1: 4 });
  assert.ok(compute(p).etaMax > 0);
});

test('Profil vorschlagen: leichtestes IPE mit η ≤ 1 für den Deckenträger', () => {
  const s = suggestProfiles(EXAMPLES[0].project(), 'IPE');
  assert.equal(s.best.name, 'IPE 300');
  const lighter = s.list.filter((x) => x.mass < s.best.mass);
  assert.ok(lighter.every((x) => !x.ok), 'alle leichteren Profile sind überbeansprucht');
});

test('Verständliche Fehlermeldungen', () => {
  const p = defaultProject();
  p.beam.spans = [0];
  assert.throws(() => compute(p), /Spannweite/);
  const q = defaultProject();
  q.mode = 'forces'; q.forces = { L: 3, cases: [] };
  assert.throws(() => compute(q), (e) => e.incomplete === true && /mindestens eine Zeile/.test(e.hint));
});

test('Freies System: Lager beliebig, Rückführung auf Vorlagen', () => {
  const b = { system: 'ss', spans: [6] };
  setBeamModel(b, 6, [{ x: 0, type: 'pin' }, { x: 4.5, type: 'pin' }]);
  assert.deepEqual([b.system, b.spans, b.overhang], ['ss-cant', [4.5], 1.5]);
  setBeamModel(b, 8, [{ x: 4, type: 'pin' }, { x: 0, type: 'pin' }, { x: 8, type: 'pin' }]);
  assert.deepEqual([b.system, b.spans], ['cont', [4, 4]]);
  setBeamModel(b, 6, [{ x: 0, type: 'fix' }, { x: 6, type: 'pin' }]);
  assert.equal(b.system, 'fix-pin');
  // Kragarm links und rechts: freies System
  setBeamModel(b, 8, [{ x: 1, type: 'pin' }, { x: 7, type: 'pin' }]);
  assert.equal(b.system, 'free');
  const g = systemGeometry(b);
  assert.deepEqual(g.fields.map((f) => [f.x0, f.x1, f.cant]), [[0, 1, true], [1, 7, false], [7, 8, true]]);
  assert.deepEqual(g.freeEnds, [0, 8]);
  // ein gelenkiges Lager allein: unvollständig
  setBeamModel(b, 3, [{ x: 1, type: 'pin' }]);
  assert.throws(() => systemGeometry(b), (e) => e.incomplete === true);
});

test('Freies System rechnet wie die entsprechende Vorlage', () => {
  const a = EXAMPLES[0].project();
  const b = EXAMPLES[0].project();
  b.beam.system = 'free'; b.beam.length = 6; b.beam.supports = [{ x: 6, type: 'pin' }, { x: 0, type: 'pin' }];
  const ra = compute(a), rb = compute(b);
  near(rb.etaMax, ra.etaMax, 1e-9, 'η');
  near(rb.checks.find((c) => c.id === 'Mb').seg.Mcr, ra.checks.find((c) => c.id === 'Mb').seg.Mcr, 1e-9, 'Mcr');
  // symmetrischer Träger mit zwei Kragarmen: Stützmoment = q·a²/2
  const c = defaultProject();
  c.beam.system = 'free'; c.beam.length = 8; c.beam.supports = [{ x: 1.5, type: 'pin' }, { x: 6.5, type: 'pin' }];
  c.beam.selfWeight = false;
  c.beam.loads = [{ lc: 'G', kind: 'qz', v1: 10 }];
  c.combos = { auto: false, manual: [{ name: 'M', type: 'ULS', f_G: 1 }] };
  const rc = compute(c);
  near(rc.uls[0].combo.My(1.5), -10 * 1.5 ** 2 / 2, 1e-6, 'Stützmoment');
  near(rc.uls[0].combo.My(4), 10 * 5 ** 2 / 8 - 10 * 1.5 ** 2 / 2, 1e-6, 'Feldmoment');
});

// ------------------------------------------------------------------ Grafische Bearbeitung und Herleitung

const { editorSpec, DERIV_OF } = await import('../modules/stahlbau/editing.js');
const { derivation } = await import('../modules/stahlbau/derivation.js');

/** Minimale App für den Editor-Adapter (ohne DOM). */
function fakeApp(project) {
  return { project, viewMode: 'system', view: { px: (n) => n * 0.01 }, editor: { grid: 0.25, snapOn: true, setTool() {} }, status() {}, viewOpts: {} };
}
const onBeam = (x) => ({ type: 'segment', id: 'beam', q: [x, 0], t: x / 6 });

test('Editor: Lasten, Lager und Halterungen per Klick, Ziehen und Löschen', () => {
  const app = fakeApp(defaultProject());
  const p = app.project;
  assert.deepEqual(editorSpec.pick(app, 'dist', onBeam(2.1)), ['q:0']);
  assert.deepEqual(editorSpec.pick(app, 'force', onBeam(2.1)), ['P:1']);
  assert.equal(p.beam.loads[1].x1, 2, 'am Raster 0.25 m gerundet');
  editorSpec.pick(app, 'restraint', onBeam(3));
  assert.deepEqual(p.stab.restraints, [{ x: 3 }]);
  // Lager bei 4.5 m: Durchlaufträger 4.5 + 1.5 m
  assert.deepEqual(editorSpec.pick(app, 'support', onBeam(4.5)), ['S:1']);
  assert.deepEqual([p.beam.system, p.beam.spans], ['cont', [4.5, 1.5]]);
  // Endlager entfernen → Einfeldträger mit Kragarm
  editorSpec.remove(app, ['S:2']);
  assert.deepEqual([p.beam.system, p.beam.spans, p.beam.overhang], ['ss-cant', [4.5], 1.5]);
  // Trägerende ziehen: Länge 8 m, Kragarm 3.5 m
  editorSpec.move(app, ['end'], [2, 0]);
  assert.deepEqual([p.beam.system, p.beam.overhang], ['ss-cant', 3.5]);
  // Einzellast ziehen, Ende der Streckenlast ziehen
  editorSpec.move(app, ['P:1'], [1.5, 0.3]);
  assert.equal(p.beam.loads[1].x1, 3.5);
  editorSpec.move(app, ['qb:0'], [-3, 0]);
  assert.deepEqual([p.beam.loads[0].x1, p.beam.loads[0].x2], [null, 5]);
  const r = compute(p);
  assert.ok(r.etaMax > 0 && r.member.fields.length === 2);
  const g = editorSpec.geometry(app);
  assert.ok(['beam', 'end', 'S:0', 'S:1', 'R:0', 'P:1', 'q:0', 'qa:0', 'qb:0', 'sw'].every((id) => [...g.points, ...g.segments, ...g.regions].some((x) => x.id === id)));
});

test('Herleitung: Abschnitte zu allen Nachweisen, Werte wie Handrechnung', () => {
  for (const ex of EXAMPLES) {
    const p = ex.project();
    const r = compute(p);
    const secs = derivation({ results: r, project: p });
    for (const c of r.checks) assert.ok(secs.some((s) => s.id === DERIV_OF(c.id)), `${ex.name}: Herleitung für ${c.id}`);
    assert.ok(!/NaN|undefined/.test(JSON.stringify(secs)), `${ex.name}: keine NaN`);
  }
  const p = EXAMPLES[0].project();
  const secs = derivation({ results: compute(p), project: p });
  const mb = secs.find((s) => s.id === 'Mb');
  near(mb.result.eta, 0.859, 0.005, 'η Kippen');
  assert.ok(mb.steps.some((s) => /78\.8 kNm/.test(s.r || '')), 'Mcr = 78.8 kNm');
  assert.ok(mb.steps.some((s) => /1\.369/.test(s.r || '')), 'λ̄LT = 1.369');
  const ein = secs.find((s) => s.id === 'einwirkung');
  assert.ok(ein.steps.some((s) => /q_d·L\^2\/8/.test(s.f) && /53\.8|53\.9/.test(s.r)), 'Kontrolle M = q·L²/8');
});

// Tests Mauerwerk (SIA 266) – Vergleich mit Handrechnungen
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionCurvature, sectionResistance, effectiveHeight, lateralMoments, buildStrip, solveStrip,
  bucklingFactor, lateralFactor, phiMidEN, phiEndEN, shearSIA, shearEN, concentratedEN, basementEN,
  computeWall, archingSearch,
} from '../modules/mauerwerk/calc.js';
import { designValues, defaultMaterial, applyTypeDefaults, MASONRY_TYPES } from '../modules/mauerwerk/materials.js';
import { defaultProject, EXAMPLES, defaultCombos } from '../modules/mauerwerk/examples.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} erwartet ${b}, erhalten ${a} (Toleranz ${tol})`);
const rel = (a, b, rtol, msg) => near(a, b, Math.abs(b) * rtol, msg);

// ------------------------------------------------------------------ Baustoff

test('Bemessungswerte: fxd = fxk/γM, Exd = Exk/γE', () => {
  // MB: fxk = 5.0, fyk = 1.5 MPa, γM = 2.0 → fxd = 2.5, fyd = 0.75 MPa; Exk = 1000·fxk = 5000 → Exd = 2500 MPa
  const d = designValues(defaultMaterial('MB'));
  near(d.fxd, 2.5, 1e-12);
  near(d.fyd, 0.75, 1e-12);
  near(d.Exd, 2500, 1e-9);
  near(d.fvlt, 0.065 * 20, 1e-12);
  const m = defaultMaterial('MB');
  m.gammaM = 2.5; m.exkAuto = false; m.Exk = 4000; m.gammaE = 1.0;
  const d2 = designValues(m);
  near(d2.fxd, 2.0, 1e-12);
  near(d2.Exd, 4000, 1e-9);
  // Typwechsel übernimmt Standardwerte, γM bleibt
  applyTypeDefaults(m, 'MK');
  assert.equal(m.fxk, MASONRY_TYPES.find((t) => t.id === 'MK').fxk);
  assert.equal(m.gammaM, 2.5);
});

// ------------------------------------------------------------------ Querschnitt

test('Krümmung ungerissen und gerissen (geschlossene Lösungen)', () => {
  const t = 0.15, f = 2500, E = 2.5e6;
  // ungerissen: κ = 12·N·e/(E·t³) = 12·100·0.01/(2.5e6·0.003375) = 1.42222e-3 1/m
  rel(sectionCurvature(100, 0.01, t, f, E), 1.422222e-3, 1e-5);
  // gerissen: c = 3(t/2 − e) = 0.105 m, κ = 2N/(E·c²) = 200/(2.5e6·0.011025) = 7.25624e-3 1/m
  rel(sectionCurvature(100, 0.04, t, f, E), 7.256236e-3, 1e-5);
  // Vorzeichen folgt e
  rel(sectionCurvature(100, -0.04, t, f, E), -7.256236e-3, 1e-5);
});

test('Krümmung plastisch: Gleichgewicht mit Fasermodell nachgerechnet', () => {
  const t = 0.15, f = 2500, E = 2.5e6;
  for (const [N, e] of [[340, 0.005], [360, 0.002], [60, 0.06], [200, 0.03], [250, 0.02]]) {
    const k = Math.abs(sectionCurvature(N, e, t, f, E));
    assert.ok(Number.isFinite(k) && k > 0);
    // Randdehnung so bestimmen, dass ∫σ = N, danach Lage der Resultierenden prüfen
    const sig = (eps) => Math.min(f, Math.max(0, E * eps));
    const nf = 4000;
    const force = (e1) => { let s = 0, sm = 0; for (let i = 0; i < nf; i++) { const y = (i + 0.5) * t / nf; const ss = sig(e1 - k * y) * t / nf; s += ss; sm += ss * y; } return [s, sm]; };
    let a = 0, b = 1;
    for (let i = 0; i < 100; i++) { const m = (a + b) / 2; if (force(m)[0] > N) b = m; else a = m; }
    const [s, sm] = force((a + b) / 2);
    near(s, N, N * 1e-4, 'Normalkraft');
    near(t / 2 - sm / s, e, 2e-5, 'Exzentrizität');
  }
});

test('Querschnittswiderstand Spannungsblock nRd = fxd·(t − 2e); e ≥ t/2 → kein Widerstand', () => {
  // t = 150 mm, e = 25 mm, fxd = 2.5 MPa: nRd = 2500·(0.15 − 0.05) = 250 kN/m
  near(sectionResistance(0.025, 0.15, 2500), 250, 1e-9);
  near(sectionResistance(0, 0.15, 2500), 375, 1e-9);
  assert.equal(sectionResistance(0.075, 0.15, 2500), 0);
  assert.equal(sectionResistance(0.09, 0.15, 2500), 0);
  assert.equal(Math.abs(sectionCurvature(10, 0.08, 0.15, 2500, 2.5e6)), Infinity);
  // Grenze N = f·(t − 2e): kein Gleichgewicht mehr
  assert.equal(Math.abs(sectionCurvature(250.001, 0.025, 0.15, 2500, 2.5e6)), Infinity);
});

// ------------------------------------------------------------------ Knicklänge

test('Knicklänge nach EN 1996-1-1, 5.5.1.2', () => {
  // zweiseitig, Stahlbetondecken: ρ2 = 0.75 → hef = 0.75·2.6 = 1.95 m
  near(effectiveHeight({ h: 2.6, t: 0.15, mode: 'slab', sides: 0 }).hef, 1.95, 1e-12);
  // e > 0.25·t → ρ2 = 1.0
  near(effectiveHeight({ h: 2.6, t: 0.15, mode: 'slab', sides: 0, eTop: 0.04 }).rho, 1.0, 1e-12);
  // vierseitig, l = 4 m: ρ4 = 0.75/(1 + (0.75·2.6/4)²) = 0.75/1.2376563 = 0.605984
  near(effectiveHeight({ h: 2.6, t: 0.15, mode: 'slab', sides: 2, ls: 4 }).rho, 0.605984, 1e-5);
  // dreiseitig, l = 2 m: ρ3 = 0.75/(1 + (0.75·2.6/6)²) = 0.75/1.105625 = 0.678347
  near(effectiveHeight({ h: 2.6, t: 0.15, mode: 'slab', sides: 1, ls: 2 }).rho, 0.678347, 1e-5);
  // vierseitig, h > 1.15·l: ρ4 = 0.5·l/h = 0.5·2/2.6 = 0.384615
  near(effectiveHeight({ h: 2.6, t: 0.15, mode: 'hinged', sides: 2, ls: 2 }).rho, 0.384615, 1e-5);
  // Halterung weiter als 30·t entfernt: nicht angerechnet
  near(effectiveHeight({ h: 2.6, t: 0.15, mode: 'hinged', sides: 2, ls: 5 }).rho, 1.0, 1e-12);
});

// ------------------------------------------------------------------ Querlast-Momente

test('Momente aus Querlast: Gleichlast und Dreieckslast', () => {
  // Gleichlast p = 1 kN/m², h = 2.6 m: M(h/2) = p·h²/8 = 0.845 kNm/m
  near(lateralMoments(() => 1, 2.6, [1.3])[0], 0.845, 1e-9);
  // Dreieck p(z) = 10·(1 − z/h): M(h/2) = p0·h²/16 = 4.225 kNm/m
  near(lateralMoments((z) => 10 * (1 - z / 2.6), 2.6, [1.3])[0], 4.225, 1e-6);
});

// ------------------------------------------------------------------ Normalkraft und Knicken

test('Zentrische Normalkraft ohne Schlankheitseinfluss: nRd = fxd·t', () => {
  // gedrungen (E sehr gross), e = 0, keine Vorverformung: λu·n = 2500·0.15 = 375 kN/m
  const S = buildStrip({ h: 2.6, hef: 2.6, t: 0.15, f: 2500, E: 1e12, nTop: 100, gw: 0, eTop: 0, eBot: 0, eImp: 0 });
  rel(bucklingFactor(S).xMax * 100, 375, 5e-4);
});

test('Exzentrische Normalkraft ohne Schlankheitseinfluss: nRd = fxd·(t − 2e)', () => {
  // e = 25 mm oben und unten: nRd = 2500·(0.15 − 0.05) = 250 kN/m
  const S = buildStrip({ h: 2.6, hef: 2.6, t: 0.15, f: 2500, E: 1e12, nTop: 100, gw: 0, eTop: 0.025, eBot: 0.025, eImp: 0 });
  rel(bucklingFactor(S).xMax * 100, 250, 5e-4);
  // e nur oben: massgebend ist der Wandkopf, nRd = 250 kN/m
  const S2 = buildStrip({ h: 2.6, hef: 2.6, t: 0.15, f: 2500, E: 1e12, nTop: 100, gw: 0, eTop: 0.025, eBot: 0, eImp: 0 });
  const bf = bucklingFactor(S2);
  rel(bf.xMax * 100, 250, 5e-4);
});

test('Th. 2. O.: gerissener Wandstreifen ohne Zugfestigkeit – geschlossene Lösung (Sahlin)', () => {
  // Konstante Exzentrizität e0 ≥ t/6 an beiden Enden, elastisch, ohne Zug: mit u = t/2 − e gilt u'' = 2N/(9E·u²).
  // Integration: L = 3·u0^1.5·F(Θ)·√(E/N), F(Θ) = (Θ + sinhΘ·coshΘ)/cosh³Θ, u0/um = cosh²Θ.
  // Stabilitätsgrenze: Ncr = 9·E·u0³·Fmax²/L², Fmax = 0.8366650 (Θ = 0.73018)
  const F = (th) => (th + Math.sinh(th) * Math.cosh(th)) / Math.cosh(th) ** 3;
  const Fmax = 0.8366649500740099;
  const t = 0.15, E = 2.5e6, L = 2.6, e0 = 0.03, u0 = t / 2 - e0;
  const Ncr = 9 * E * u0 ** 3 * Fmax ** 2 / L ** 2; // = 212.31 kN/m
  rel(Ncr, 212.313, 1e-4);
  const S = buildStrip({ h: L, hef: L, t, f: 1e9, E, nTop: 1, gw: 0, eTop: e0, eBot: e0, eImp: 0, nseg: 64 });
  rel(bucklingFactor(S).xMax, Ncr, 2e-3, 'kritische Last');
  // Durchbiegung in Wandmitte bei N = Ncr/2
  const N = Ncr / 2;
  const target = Math.sqrt(N * L * L / (9 * E * u0 ** 3));
  let a = 0, b = 0.73018;
  for (let i = 0; i < 200; i++) { const m = (a + b) / 2; if (F(m) < target) a = m; else b = m; }
  const wClosed = u0 - u0 / Math.cosh(a) ** 2; // = 4.734 mm
  const sol = solveStrip(S, N, 0);
  assert.ok(sol.ok);
  rel(sol.w[32], wClosed, 1e-3, 'Durchbiegung Wandmitte');
});

test('Numerisches Verfahren vs. EN 1996-1-1 Anhang G (Plausibilität ±15 %)', () => {
  // hef/t = 13, e = 30 mm an beiden Enden, Exd/fxd = 1000 → Annex G: emk = 0.03 + 1.95/450 → Φm ≈ 0.41
  const t = 0.15, hef = 1.95, f = 2500, E = 2.5e6, e = 0.03;
  const S = buildStrip({ h: hef, hef, t, f, E, nTop: 100, gw: 0, eTop: e, eBot: e, eImp: hef / 450 });
  const phiNum = bucklingFactor(S).xMax * 100 / (t * f);
  const phiEN = phiMidEN({ hef, t, emk: e + hef / 450, fk: 1, E: 1000 }).phi;
  rel(phiNum, phiEN, 0.15);
});

test('EN 1996-1-1 Anhang G: Φm (Handrechnung)', () => {
  // hef/t = 18, fk/E = 1/1000, emk/t = 0.1:
  // λ = 18·√(1/1000) = 0.569210; A1 = 1 − 0.2 = 0.8; u = (0.569210 − 0.063)/(0.73 − 0.117) = 0.825792
  // Φm = 0.8·exp(−0.825792²/2) = 0.8·exp(−0.340966) = 0.8·0.711083 = 0.568867
  const r = phiMidEN({ hef: 2.7, t: 0.15, emk: 0.015, fk: 5, E: 5000 });
  near(r.lam, 0.569210, 1e-6);
  near(r.u, 0.825792, 1e-6);
  near(r.phi, 0.568867, 1e-5);
  // Wandkopf: Φi = 1 − 2·ei/t, ei ≥ 0.05·t
  near(phiEndEN(0.0, 0.15).phi, 0.9, 1e-12);
  near(phiEndEN(0.03, 0.15).phi, 0.6, 1e-12);
});

// ------------------------------------------------------------------ Querbelastung

test('Querlast ohne Th. 2. O.: μu = 8·N·(t/2 − N/(2f))/(p·h²)', () => {
  // N = 100 kN/m, t = 0.15 m, f = 2500 kN/m²: MR = 100·(0.075 − 0.02) = 5.5 kNm/m
  // p = 1 kN/m², h = 2.6 m: μu = 8·5.5/6.76 = 6.50888
  const S = buildStrip({ h: 2.6, hef: 2.6, t: 0.15, f: 2500, E: 1e12, nTop: 100, gw: 0, eTop: 0, eBot: 0, pFn: () => 1, eImp: 0 });
  rel(lateralFactor(S).xMax, 6.50888, 1e-3);
});

test('Bogenwirkung: Resultierende am Wandfuss frei → höherer Querlastfaktor', () => {
  const S = buildStrip({ h: 2.6, hef: 2.6, t: 0.25, f: 3000, E: 3e6, nTop: 60, gw: 0, eTop: 0, eBot: 0, pFn: () => 5, eImp: 0 });
  const base = lateralFactor(S).xMax;
  const arch = archingSearch(S, 60, 0, 0.25, 3000);
  assert.ok(arch.lf.xMax > base * 1.2, `Bogenwirkung ${arch.lf.xMax} vs. ${base}`);
  assert.ok(arch.eBot < 0, 'Resultierende zur Erdseite');
});

test('Kelleraussenwand EN 1996-3, 4.5', () => {
  // t = 0.25, h = 2.5, he = 2.0, ρe = 19, bc = 5.0 ≥ 2h → β = 20
  // Nmin = 19·2.5·2.0²/(20·0.25) = 38.0 kN/m; NmaxRd = t·fd/3 = 0.25·3000/3 = 250 kN/m
  const r = basementEN({ t: 0.25, h: 2.5, he: 2.0, rhoE: 19, bc: 5.0, fd: 3000 });
  assert.equal(r.beta, 20);
  near(r.NminReq, 38.0, 1e-9);
  near(r.NmaxRd, 250, 1e-9);
  // h < bc < 2h: β = 60 − 20·bc/h = 60 − 20·1.5 = 30
  assert.equal(basementEN({ t: 0.25, h: 2.5, he: 2.0, rhoE: 19, bc: 3.75, fd: 3000 }).beta, 30);
  assert.equal(basementEN({ t: 0.25, h: 2.5, he: 2.0, rhoE: 19, bc: 2.0, fd: 3000 }).beta, 40);
});

// ------------------------------------------------------------------ Schub

test('Querkraft Spannungsfeld (Druckfeld massgebend)', () => {
  // t = 0.175, l = 4, h0 = 2.6 m, fxd = 3000, fyd = 900 kN/m², N = 300 kN
  // a = t·h0·fyd = 409.5; VRd = −409.5 + √(409.5² + 900·300·(0.7 − 0.1)) = −409.5 + √329690.25 = 164.68 kN
  const r = shearSIA({ N: 300, t: 0.175, l: 4, h0: 2.6, fxd: 3000, fyd: 900, mu: 0.6 });
  near(r.Vstrut, 164.68, 0.01);
  near(r.Vfric, 180, 1e-9);
  near(r.VRd, r.Vstrut, 1e-12);
  assert.equal(r.mode, 'Druckfeld');
  // Kontrolle der Fliessbedingung bei V = VRd: σx/fxd + σy/fyd = 1
  const s = r.VRd;
  const lc = 4 - 2 * s * 2.6 / 300;
  const sx = 300 / (0.175 * lc), sy = (s / (0.175 * lc)) ** 2 / sx;
  near(sx / 3000 + sy / 900, 1, 1e-9);
});

test('Querkraft Spannungsfeld (Gleiten massgebend) und Zug', () => {
  // N = 50 kN: Vstrut = −409.5 + √(409.5² + 900·50·(0.7 − 50/3000)) = 35.97 kN; μ·N = 30 kN → Gleiten
  const r = shearSIA({ N: 50, t: 0.175, l: 4, h0: 2.6, fxd: 3000, fyd: 900, mu: 0.6 });
  near(r.Vstrut, 35.97, 0.01);
  near(r.VRd, 30, 1e-9);
  assert.equal(r.mode, 'Gleiten');
  assert.equal(shearSIA({ N: 0, t: 0.175, l: 4, h0: 2.6, fxd: 3000, fyd: 900, mu: 0.6 }).VRd, 0);
  // N grösser als t·l·fxd → kein Widerstand
  assert.equal(shearSIA({ N: 2200, t: 0.175, l: 4, h0: 2.6, fxd: 3000, fyd: 900, mu: 0.6 }).Vstrut, 0);
});

test('Querkraft nach EN 1996-1-1, 6.2', () => {
  // ungerissen: e = 50·2.6/300 = 0.433 ≤ l/6 → lc = 4 m; σd = 300/(0.175·4) = 428.57 kN/m²
  // fvk = 200 + 0.4·428.57 = 371.43 kN/m²; fvd = 185.71; VRd = 185.71·0.175·4 = 130.0 kN
  const a = shearEN({ N: 300, V: 50, t: 0.175, l: 4, h0: 2.6, fvk0: 200, fvlt: 1300, gammaM: 2, fxd: 3000 });
  near(a.lc, 4, 1e-12);
  near(a.VRd, 130.0, 0.01);
  // gerissen: V = 100 → e = 0.8667 > 0.667 → lc = 3·(2 − 0.8667) = 3.4 m; σd = 504.20; fvk = 401.68; VRd = 119.50 kN
  const b = shearEN({ N: 300, V: 100, t: 0.175, l: 4, h0: 2.6, fvk0: 200, fvlt: 1300, gammaM: 2, fxd: 3000 });
  near(b.lc, 3.4, 1e-9);
  near(b.VRd, 119.50, 0.01);
  // Begrenzung fvk ≤ fvlt
  const c = shearEN({ N: 300, V: 50, t: 0.175, l: 4, h0: 2.6, fvk0: 200, fvlt: 300, gammaM: 2, fxd: 3000 });
  near(c.fvk, 300, 1e-12);
});

// ------------------------------------------------------------------ Teilflächenbelastung

test('Teilflächenbelastung EN 1996-1-1, 6.1.3', () => {
  // Ab = 0.2·0.15 = 0.03 m²; a1 = 1.2 m; hc = 2.6 m; Ausbreitung je Seite hc/(2√3) = 0.750555 m
  // lefm = 0.2 + 2·0.750555 = 1.701110 m; Aef = 0.255167 m²; Ab/Aef = 0.117570
  // β = (1 + 0.3·1.2/2.6)·(1.5 − 1.1·0.117570) = 1.138462·1.370673 = 1.560460 → βmax = 1.25 + 1.2/5.2 = 1.480769
  // NRdc = 1.480769·0.03·2500 = 111.06 kN
  const r = concentratedEN({ a: 0.2, b: 0.15, x: 1.2, l: 5, t: 0.15, hc: 2.6, fd: 2500, solid: true });
  near(r.lefm, 1.701110, 1e-5);
  near(r.ratio, 0.117570, 1e-5);
  near(r.betaMax, 1.480769, 1e-5);
  near(r.beta, 1.480769, 1e-5);
  near(r.NRdc, 111.058, 0.01);
  // am Wandende (a1 = 0): β = 1.5 − 1.1·Ab/Aef mit lefm = 0.2 + 0.750555 → Ab/Aef = 0.210400 → β = 1.268560 > βmax = 1.25
  const e = concentratedEN({ a: 0.2, b: 0.15, x: 0, l: 5, t: 0.15, hc: 2.6, fd: 2500, solid: true });
  near(e.beta, 1.25, 1e-9);
  // Lochsteine: β = 1.0 → NRdc = 0.03·2500 = 75 kN
  near(concentratedEN({ a: 0.2, b: 0.15, x: 1.2, l: 5, t: 0.15, hc: 2.6, fd: 2500, solid: false }).NRdc, 75, 1e-9);
});

// ------------------------------------------------------------------ Gesamtberechnung

function simpleProject() {
  const p = defaultProject();
  p.wall = { h: 2.6, t: 150, l: 4, support: 'hinged', sides: 0, ls: 4, openings: [] };
  Object.assign(p.loads, { gW: 0, qW: 0, gD: 100, qD: 0, eMode: 'manual', eD: 25, eU: 0 });
  p.combos = [{ on: true, name: 'ULS', type: 'ULS', g: 1.35, q: 1.5, w: 0, e: 0, ae: 0 }];
  return p;
}

test('Gesamtberechnung: Wandkopf mit e = 25 mm (Handrechnung)', () => {
  // nEd,o = 1.35·100 = 135 kN/m; nRd,o = 2500·(0.15 − 2·0.025) = 250 kN/m → η = 0.54
  const r = computeWall(simpleProject());
  const top = r.checks.find((c) => c.id === 'top');
  near(top.Ed, 135, 1e-9);
  near(top.Rd, 250, 1e-9);
  near(top.eta, 0.54, 1e-9);
  // Knicken ist mindestens so massgebend wie der Wandkopf
  const buck = r.checks.find((c) => c.id === 'buck');
  assert.ok(buck.eta >= top.eta - 1e-6);
  assert.ok(Number.isFinite(r.etaMax));
  // Wandfuss: nEd,u = 135 + 1.35·12·0.15·2.6 = 141.318 kN/m, e = 0 → nRd = 375 kN/m
  const bot = r.checks.find((c) => c.id === 'bot');
  near(bot.Ed, 141.318, 1e-6);
  near(bot.Rd, 375, 1e-9);
});

test('Gesamtberechnung: Exzentrizität grösser als t/2 → nicht erfüllt', () => {
  const p = simpleProject();
  p.loads.eD = 80; // > t/2 = 75 mm
  const r = computeWall(p);
  assert.equal(r.checks.find((c) => c.id === 'top').eta, Infinity);
  assert.equal(r.etaMax, Infinity);
});

test('Gesamtberechnung: Deckenverdrehung e = t/2 − a/3', () => {
  // a = t = 150 mm → eD = 75 − 50 = 25 mm
  const p = simpleProject();
  p.loads.eMode = 'slab'; p.loads.aD = 150;
  const r = computeWall(p);
  near(r.eD, 0.025, 1e-12);
  near(r.checks.find((c) => c.id === 'top').Rd, 250, 1e-9);
});

test('Gesamtberechnung: alle Beispiele rechnen ohne Fehler, beide Verfahren', () => {
  for (const ex of EXAMPLES) {
    for (const method of ['SIA', 'EN']) {
      const p = ex.project();
      p.settings.method = method; p.settings.shearMethod = method;
      const r = computeWall(p);
      assert.ok(r.checks.length >= 4, ex.name);
      for (const c of r.checks) assert.ok(c.eta >= 0, `${ex.name}: ${c.id}`);
    }
  }
  // Beispiel 3 enthält den Schubnachweis, Beispiel 2 den Querlastnachweis
  assert.ok(computeWall(EXAMPLES[2].project()).checks.some((c) => c.id === 'shear'));
  assert.ok(computeWall(EXAMPLES[1].project()).checks.some((c) => c.id === 'lat'));
  assert.ok(computeWall(EXAMPLES[0].project()).checks.some((c) => c.id === 'conc'));
});

test('Gesamtberechnung: Schub nach Spannungsfeld aus Projektdaten', () => {
  // Beispiel 3, Kombination Erdbeben: nTop = 1.0·(45 + 20) + 0.3·(10 + 8) = 70.4 kN/m
  // N = 70.4·4 + 1.0·12·0.175·2.7·4 = 304.28 kN; V = 95 kN; h0 = 2.7 m; fxd = 2500, fyd = 750 kN/m²
  const r = computeWall(EXAMPLES[2].project());
  const eq = r.combos.find((c) => c.name === 'Erdbeben');
  near(eq.shear.N, 304.28, 1e-6);
  const ref = shearSIA({ N: 304.28, t: 0.175, l: 4, h0: 2.7, fxd: 2500, fyd: 750, mu: 0.6 });
  near(eq.shear.VRd, ref.VRd, 1e-6);
  near(ref.VRd, 153.12, 0.05);
});

test('Gebrauchstauglichkeit: klaffende Fuge e ≤ t/3', () => {
  const p = simpleProject();
  p.combos.push({ on: true, name: 'SLS', type: 'SLS', g: 1, q: 1, w: 0, e: 0, ae: 0 });
  const r = computeWall(p);
  const c = r.checks.find((x) => x.id === 'crack');
  // e = 25 mm am Wandkopf, Grenze t/3 = 50 mm → η = 0.5
  near(c.eta, 0.5, 1e-9);
});

test('Eingabefehler liefern verständliche Meldungen', () => {
  const p = simpleProject();
  p.wall.t = 0;
  assert.throws(() => computeWall(p), /Wanddicke/);
  const q = simpleProject();
  q.combos = [];
  assert.throws(() => computeWall(q), /Lastkombination/);
  const s = simpleProject();
  s.wall.openings = [{ x: 3.5, b: 1.0, y: 0, hgt: 2 }];
  assert.throws(() => computeWall(s), /Öffnung 1/);
});

test('Standardkombinationen SIA 260', () => {
  const c = defaultCombos({ wind: true, earth: true, quake: true });
  assert.equal(c[0].g, 1.35);
  assert.equal(c[0].q, 1.5);
  assert.ok(c.some((x) => x.g === 0.8 && x.w === 1.5));
  assert.ok(c.some((x) => x.type === 'SLS'));
  assert.ok(c.some((x) => x.ae === 1));
});

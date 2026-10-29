// Tests Rechenkern Stabwerk gegen Handrechnungen (Schneider Bautabellen, Euler)
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, buildModel, solveCases, bucklingAnalysis, generateCombinations } from '../modules/stabwerk/calc.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} ≠ ${b}`);

// Querschnitt "Werte": A [cm²], I [cm⁴], E [MPa]
const SEC = { name: 'Test', type: 'values', mat: 'custom', A: 100, I: 10000, E: 200000, gamma: 0, h: 300 };
const EI = 200000e3 * 10000e-8; // kNm²
const EA = 200000e3 * 100e-4;

function project(nodes, members, supports, loads, extra = {}) {
  return {
    nodes: nodes.map(([x, y]) => ({ x, y })),
    members: members.map(([i, j, hi = false, hj = false]) => ({ i, j, sec: 1, hi, hj })),
    sections: [{ ...SEC }],
    supports,
    loadCases: [{ name: 'LF1', kind: 'G', selfWeight: false, nodal: [], dist: [], point: [], temp: [], settle: [], ...loads }],
    combinations: [],
    analysis: {},
    ...extra,
  };
}

const station = (mres, x) => mres.stations.reduce((b, s) => (Math.abs(s.x - x) < Math.abs(b.x - x) ? s : b));

test('Einfacher Balken mit Gleichlast: M = qL²/8, V = qL/2, w = 5qL⁴/(384EI)', () => {
  const L = 6, q = 10;
  const p = project([[0, 0], [L, 0]], [[1, 2]], [{ node: 1, ux: true, uy: true }, { node: 2, uy: true }], { dist: [{ member: 1, dir: 'g', q1: q, q2: q }] });
  const r = analyze(p).lc[0];
  const m = r.members[0];
  near(station(m, L / 2).M, q * L * L / 8, 1e-6, 'M Feldmitte');
  near(station(m, 0).V, q * L / 2, 1e-6, 'V Auflager');
  near(station(m, L / 2).uy, -5 * q * L ** 4 / (384 * EI), 1e-4, 'Durchbiegung');
  near(r.reactions[0].Ry, q * L / 2, 1e-6, 'Reaktion A');
  near(r.sumRy + r.sumFy, 0, 1e-9, 'Gleichgewicht');
});

test('Kragarm mit Einzellast: M = −PL, w = PL³/(3EI)', () => {
  const L = 4, P = 10;
  const p = project([[0, 0], [L, 0]], [[1, 2]], [{ node: 1, ux: true, uy: true, rz: true }], { nodal: [{ node: 2, fx: 0, fy: -P, m: 0 }] });
  const r = analyze(p).lc[0];
  near(station(r.members[0], 0).M, -P * L, 1e-9, 'Einspannmoment');
  near(r.disp[1][1], -P * L ** 3 / (3 * EI), 1e-9, 'Spitzenverschiebung');
  near(r.reactions[0].M, P * L, 1e-9, 'Reaktionsmoment');
});

test('Beidseitig eingespannter Balken: M_Rand = −qL²/12, M_Feld = qL²/24', () => {
  const L = 8, q = 12;
  const p = project([[0, 0], [L, 0]], [[1, 2]], [{ node: 1, ux: true, uy: true, rz: true }, { node: 2, ux: true, uy: true, rz: true }], { dist: [{ member: 1, dir: 'g', q1: q }] });
  const m = analyze(p).lc[0].members[0];
  near(station(m, 0).M, -q * L * L / 12, 1e-6, 'Randmoment');
  near(station(m, L / 2).M, q * L * L / 24, 1e-6, 'Feldmoment');
});

test('Einzellast im Feld mit Gelenk und Zweifeldträger', () => {
  // Zweifeldträger 2×5 m, Gleichlast: Stützmoment −qL²/8
  const L = 5, q = 20;
  const p = project([[0, 0], [L, 0], [2 * L, 0]], [[1, 2], [2, 3]], [{ node: 1, ux: true, uy: true }, { node: 2, uy: true }, { node: 3, uy: true }],
    { dist: [{ member: 1, dir: 'g', q1: q }, { member: 2, dir: 'g', q1: q }] });
  const r = analyze(p).lc[0];
  near(station(r.members[0], L).M, -q * L * L / 8, 1e-6, 'Stützmoment');
  near(r.reactions[1].Ry, 1.25 * q * L, 1e-6, 'Mittelauflager');
  // Einzellast P in Feldmitte, Gelenk über der Stütze → zwei Einfeldträger
  const p2 = project([[0, 0], [L, 0], [2 * L, 0]], [[1, 2, false, true], [2, 3]], [{ node: 1, ux: true, uy: true }, { node: 2, uy: true }, { node: 3, uy: true }],
    { point: [{ member: 1, dir: 'g', P: 40, a: 2.5 }] });
  const r2 = analyze(p2).lc[0];
  near(station(r2.members[0], 2.5).M, 40 * 5 / 4, 1e-6, 'Feldmoment mit Gelenk');
  near(station(r2.members[1], 0).M, 0, 1e-9, 'Gelenkmoment');
});

test('Zweigelenkrahmen unter Horizontallast: Gleichgewicht und Symmetrie', () => {
  const p = project([[0, 0], [0, 4], [6, 4], [6, 0]], [[1, 2], [2, 3], [3, 4]], [{ node: 1, ux: true, uy: true }, { node: 4, ux: true, uy: true }],
    { nodal: [{ node: 2, fx: 10, fy: 0, m: 0 }] });
  const r = analyze(p).lc[0];
  near(r.sumRx, -10, 1e-9, 'ΣRx');
  near(r.reactions[0].Rx, -5, 2e-3, 'gleiche Rahmenstiele → je ≈ H/2 (Riegel dehnbar)');
  near(r.sumRy, 0, 1e-9, 'ΣRy');
});

test('Temperatur: eingespannter Stab mit ΔT → N = −EA·α·ΔT', () => {
  const p = project([[0, 0], [5, 0]], [[1, 2]], [{ node: 1, ux: true, uy: true, rz: true }, { node: 2, ux: true, uy: true, rz: true }], { temp: [{ member: 1, dT: 30, dTg: 0 }] });
  const r = analyze(p).lc[0];
  near(r.members[0].N.max, -EA * 1e-5 * 30, 1e-9, 'Zwangsnormalkraft');
});

test('Stützensenkung Zweifeldträger: M_B = 3EIδ/L²', () => {
  const L = 5, d = 10; // mm
  const p = project([[0, 0], [L, 0], [2 * L, 0]], [[1, 2], [2, 3]], [{ node: 1, ux: true, uy: true }, { node: 2, uy: true }, { node: 3, uy: true }],
    { settle: [{ node: 2, ux: 0, uy: -d, rz: 0 }] });
  const r = analyze(p).lc[0];
  near(station(r.members[0], L).M, 3 * EI * d / 1000 / L ** 2, 1e-6, 'Stützmoment aus Senkung');
});

test('Knicken: Eulerfälle 2 (gelenkig) und 1 (Kragstütze)', () => {
  const L = 5, N = 100;
  const p = project([[0, 0], [0, L]], [[1, 2]], [{ node: 1, ux: true, uy: true }, { node: 2, ux: true }], { nodal: [{ node: 2, fx: 0, fy: -N, m: 0 }] });
  const model = buildModel(p, { nSub: 6 });
  const r = solveCases(model, [{ parts: [{ lc: p.loadCases[0], f: 1 }] }])[0];
  const b = bucklingAnalysis(model, r);
  near(b.alpha * N, Math.PI ** 2 * EI / L ** 2, 2e-4, 'Euler 2');
  const p1 = project([[0, 0], [0, L]], [[1, 2]], [{ node: 1, ux: true, uy: true, rz: true }], { nodal: [{ node: 2, fx: 0, fy: -N, m: 0 }] });
  const m1 = buildModel(p1, { nSub: 6 });
  const b1 = bucklingAnalysis(m1, solveCases(m1, [{ parts: [{ lc: p1.loadCases[0], f: 1 }] }])[0]);
  near(b1.alpha * N, Math.PI ** 2 * EI / (4 * L * L), 2e-4, 'Euler 1');
  near(b1.lcr[0].beta, 2, 1e-3, 'Knicklängenbeiwert');
});

test('Theorie 2. Ordnung: Kragstütze, exakt M = H·tan(kL)/k', () => {
  const L = 5, Ncr = Math.PI ** 2 * EI / (4 * L * L);
  const N = 0.3 * Ncr, H = 10;
  const p = project([[0, 0], [0, L]], [[1, 2]], [{ node: 1, ux: true, uy: true, rz: true }], { nodal: [{ node: 2, fx: H, fy: -N, m: 0 }] },
    { combinations: [{ name: 'GZT', type: 'GZT', factors: [1] }], analysis: { secondOrder: true, buckling: true, nSub: 8, imperfection: 0 } });
  const res = analyze(p);
  const c = res.combos[0];
  const M1 = H * L;
  const M2 = Math.abs(station(c.res.members[0], 0).M);
  // exakte Lösung der Differentialgleichung: M_Fuss = H·tan(kL)/k, k = √(N/EI)
  const kL = Math.sqrt(N / EI) * L;
  near(M2 / M1, Math.tan(kL) / kL, 3e-3, 'Momentenvergrösserung');
  assert.ok(M2 > M1, 'Moment 2. Ordnung grösser');
  near(c.buckling.alpha, 1 / 0.3, 1e-3, 'α_cr');
});

test('Kombinationen nach SIA 260', () => {
  const lcs = [{ name: 'G', kind: 'G' }, { name: 'Q', kind: 'Q' }, { name: 'W', kind: 'W' }];
  const c = generateCombinations(lcs);
  const uls = c.filter((x) => x.type === 'GZT');
  assert.equal(uls.length, 3);
  assert.deepEqual(uls[0].factors.map((v) => +v.toFixed(3)), [1.35, 1.5, 0.9]);
  assert.deepEqual(uls[1].factors.map((v) => +v.toFixed(3)), [1.35, 1.05, 1.5]);
});

test('Kinematisches System wird erkannt', () => {
  const p = project([[0, 0], [4, 0]], [[1, 2]], [{ node: 1, uy: true }, { node: 2, uy: true }], { nodal: [{ node: 2, fx: 1, fy: 0, m: 0 }] });
  assert.throws(() => analyze(p), /kinematisch/);
});

test('Theorie 2. Ordnung mit Schiefstellung: Gleichgewicht der Kräfte bleibt erhalten', () => {
  const p = project([[0, 0], [0, 6], [12, 6], [12, 0]], [[1, 2], [2, 3], [3, 4]], [{ node: 1, ux: true, uy: true }, { node: 4, ux: true, uy: true }],
    { selfWeight: false, dist: [{ member: 2, dir: 'g', q1: 20 }, { member: 1, dir: 'x', q1: 3 }], point: [{ member: 3, dir: 'x', P: 5, a: 2 }] },
    { combinations: [{ name: 'GZT', type: 'GZT', factors: [1] }], analysis: { secondOrder: true, buckling: false, nSub: 4, imperfection: 150 } });
  const c = analyze(p).combos[0].res;
  near(c.sumRx + c.sumFx, 0, 1e-6, 'ΣH');
  near(c.sumRy + c.sumFy, 0, 1e-6, 'ΣV');
});

test('Material und Querschnitt getrennt: gleicher Querschnitt, verschiedene Materialien', async () => {
  const { newMaterial, newSection, migrateMaterials } = await import('../modules/stabwerk/sections.js');
  const L = 5, P = 10;
  const base = (mat) => ({
    nodes: [{ x: 0, y: 0 }, { x: L, y: 0 }],
    members: [{ i: 1, j: 2, sec: 1, mat, hi: false, hj: false }],
    sections: [newSection('profile')], // HEB 200: I = 5696 cm⁴
    materials: [newMaterial('Beton', 'C25/30'), newMaterial('Baustahl', 'S355')],
    supports: [{ node: 1, ux: true, uy: true, rz: true }],
    loadCases: [{ name: 'LF', kind: 'G', selfWeight: false, nodal: [{ node: 2, fx: 0, fy: -P, m: 0 }], dist: [], point: [], temp: [], settle: [] }],
    combinations: [], analysis: {},
  });
  const wSteel = analyze(base(2)).lc[0].disp[1][1];
  near(wSteel, -P * L ** 3 / (3 * 210000e3 * 5696e-8), 1e-6, 'Stahl E = 210 GPa');
  const wConc = analyze(base(1)).lc[0].disp[1][1];
  near(wSteel / wConc, newMaterial('Beton', 'C25/30').E / 210000, 1e-6, 'Verhältnis der E-Moduli');
  // Altformat: Material im Querschnitt wird in eine Materialliste überführt
  const old = { sections: [{ name: 'A', type: 'rect', mat: 'S355', b: 100, h: 200 }, { name: 'B', type: 'rect', mat: 'C30/37', b: 300, h: 300 }], members: [{ sec: 2 }, { sec: 1 }] };
  migrateMaterials(old);
  assert.deepEqual(old.materials.map((m) => m.name), ['S355', 'C30/37']);
  assert.deepEqual(old.members.map((m) => m.mat), [2, 1]);
  assert.equal(old.sections[0].mat, undefined);
});

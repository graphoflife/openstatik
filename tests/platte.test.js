// Tests des Plattenmoduls (FE-Kern, Netz, Bemessung) – node --test tests/platte.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dktCoefficients, dktB, dktStiffness, solvePlate, plateMoments, areaLoadVector, lineLoadVector } from '../modules/platte/fe.js';
import { generateMesh, nodesOnSegment, nearestNode, hasEdge, meshQuality } from '../modules/platte/mesh.js';
import { woodArmer, requiredAs, momentResistance, punchingSIA, punchingEC, controlPerimeter, principalMoments } from '../modules/platte/design.js';
import { analyse, defaultCombos, withDefaults, locate, interpolate, geometryOf, slabIndexAt } from '../modules/platte/calc.js';
import { EXAMPLES, defaultProject } from '../modules/platte/examples.js';
import { pointInPolygon, signedArea, segIntersect, freeEdges } from '../modules/platte/geom.js';
import { moveSelection, copySelection, removeSelection, createElement, insertMidpoint, addWallsOnEdges, addWallsOnFreeEdges, vertexIdsOf, polygonProblem, addSlabLoad, slabAt } from '../modules/platte/model.js';
import { derivation, woodArmerSteps } from '../modules/platte/derivation.js';

const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} ≠ ${b} (±${rel * 100} %)`);

// ------------------------------------------------------------------ Hilfsfunktion: Quadratplatte

/** Quadratplatte a × a, Gleichlast q, D, ν; Ränder gelenkig (w = 0) oder eingespannt (zusätzlich ∂w/∂n = 0). */
function squarePlate({ a = 1, q = 1, D = 1, nu = 0.3, size = 0.04, clamped = false }) {
  const outline = [[0, 0], [a, 0], [a, a], [0, a]];
  const mesh = generateMesh({ outline, size });
  const n = mesh.nNodes;
  const fixW = new Uint8Array(n);
  const rot = [];
  for (let k = 0; k < 4; k++) {
    const p = outline[k], r = outline[(k + 1) % 4];
    const L = Math.hypot(r[0] - p[0], r[1] - p[1]);
    for (const nd of nodesOnSegment(mesh, p[0], p[1], r[0], r[1], 1e-9)) {
      fixW[nd.node] = 1;
      if (clamped) rot.push({ node: nd.node, cx: (r[0] - p[0]) / L, cy: (r[1] - p[1]) / L });
    }
  }
  const f = new Float64Array(3 * n), fe = new Float64Array(9);
  const { x, y, tri } = mesh;
  for (let t = 0; t < mesh.nTri; t++) {
    const i = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]];
    areaLoadVector(x[i[0]], y[i[0]], x[i[1]], y[i[1]], x[i[2]], y[i[2]], q, fe);
    for (let k = 0; k < 3; k++) for (let d = 0; d < 3; d++) f[3 * i[k] + d] += fe[3 * k + d];
  }
  const sol = solvePlate(mesh, { D, nu, fixW, rotConstraints: rot, loads: [f] });
  const u = sol.U[0];
  const m = plateMoments(mesh, u, D, nu);
  const w = Float64Array.from({ length: n }, (_, i) => u[3 * i]);
  const at = (px, py, arr) => interpolate(locate(mesh, px, py), arr);
  return { mesh, sol, u, w, m, at, f };
}

// ------------------------------------------------------------------ Element

test('DKT: Patch-Test – quadratisches w-Feld ergibt exakt konstante Krümmungen', () => {
  // w = A x² + B xy + C y²  →  κ = [−2A, −2C, −2B] (βx = −w,x; βy = −w,y)
  const P = [[0.3, 0.1], [1.7, 0.4], [0.6, 1.5]];
  const A = 0.7, B = -0.4, C = 1.3;
  const co = dktCoefficients(...P.flat());
  const ue = [];
  for (const [x, y] of P) ue.push(A * x * x + B * x * y + C * y * y, B * x + 2 * C * y, -(2 * A * x + B * y));
  for (const [xi, eta] of [[0, 0], [1, 0], [0, 1], [0.2, 0.3], [1 / 3, 1 / 3]]) {
    const Bm = dktB(co, xi, eta);
    const k = [0, 1, 2].map((r) => Bm.slice(9 * r, 9 * r + 9).reduce((s, v, j) => s + v * ue[j], 0));
    assert.ok(Math.abs(k[0] + 2 * A) < 1e-10 && Math.abs(k[1] + 2 * C) < 1e-10 && Math.abs(k[2] + 2 * B) < 1e-10, `κ = ${k}`);
  }
});

test('DKT: Starrkörperverschiebung und -drehung erzeugen keine Kräfte, Matrix symmetrisch', () => {
  const K = dktStiffness(0, 0, 2, 0.3, 0.4, 1.8, 5, 0.2);
  const modes = [
    [1, 0, 0, 1, 0, 0, 1, 0, 0],                               // w = 1
    [0, 1, 0, 0.3, 1, 0, 1.8, 1, 0],                           // w = y  (θx = 1)
    [0, 0, -1, 2, 0, -1, 0.4, 0, -1],                          // w = x  (θy = −1)
  ];
  for (const u of modes) {
    for (let i = 0; i < 9; i++) {
      let s = 0;
      for (let j = 0; j < 9; j++) s += K[i * 9 + j] * u[j];
      assert.ok(Math.abs(s) < 1e-10, `Restkraft ${s}`);
    }
  }
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) assert.ok(Math.abs(K[i * 9 + j] - K[j * 9 + i]) < 1e-12);
});

test('Lastvektoren: Summe der Knotenkräfte = Gesamtlast', () => {
  const f = areaLoadVector(0, 0, 3, 0, 1, 2, 4);
  close(f[0] + f[3] + f[6], 4 * 3, 1e-12, 'Fläche');
  const g = lineLoadVector(0, 0, 3, 4, 2, 6); // L = 5, Trapez 2 → 6 kN/m
  close(g[0] + g[3], 5 * (2 + 6) / 2, 1e-12, 'Linie');
});

// ------------------------------------------------------------------ Plattenlösungen (Timoshenko & Woinowsky-Krieger, Theory of Plates and Shells, 2nd ed.)

test('Quadratplatte allseitig gelenkig, Gleichlast (Timoshenko Tab. 8, ν = 0.3)', () => {
  // w_max = 0.00406·q·a⁴/D, m_x,max = m_y,max = 0.0479·q·a²
  const r = squarePlate({ size: 0.04 });
  const wmax = Math.max(...r.w);
  close(wmax, 0.00406, 0.03, 'w_max');
  close(r.at(0.5, 0.5, r.m.mx), 0.0479, 0.03, 'm_x Mitte');
  close(r.at(0.5, 0.5, r.m.my), 0.0479, 0.03, 'm_y Mitte');
  close(r.sol.R[0].reduce((s, v) => s + v, 0), 1, 1e-9, 'Σ Auflagerkräfte = q·a²');
});

test('Quadratplatte allseitig eingespannt, Gleichlast (Timoshenko Tab. 35, ν = 0.3)', () => {
  // w_max = 0.00126·q·a⁴/D, m Mitte = 0.0231·q·a², m Randmitte = −0.0513·q·a²
  const r = squarePlate({ size: 0.025, clamped: true });
  close(Math.max(...r.w), 0.00126, 0.03, 'w_max');
  close(r.at(0.5, 0.5, r.m.mx), 0.0231, 0.03, 'm Mitte');
  const edges = [r.at(0.5, 0.0, r.m.my), r.at(0.5, 1.0, r.m.my), r.at(0.0, 0.5, r.m.mx), r.at(1.0, 0.5, r.m.mx)];
  for (const v of edges) close(v, -0.0513, 0.03, 'Einspannmoment Randmitte');
  close(edges.reduce((a, b) => a + b) / 4, -0.0513, 0.02, 'Einspannmoment Mittel der vier Ränder');
  close(r.sol.R[0].reduce((s, v) => s + v, 0), 1, 1e-6, 'Σ Auflagerkräfte');
});

test('Kragplatte (schräg, eingespannt) entspricht Balkenlösung w = qL⁴/(8D) bei ν = 0', () => {
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  const R = (x, y) => [x * c - y * s, x * s + y * c];
  const L = 2, B = 1;
  const outline = [R(0, 0), R(L, 0), R(L, B), R(0, B)];
  const res = analyse(withDefaults({
    outline: outline.map(([x, y]) => ({ x, y })), h: 0.2, nu: 0, meshSize: 0.1,
    lineSupports: [{ x1: outline[3][0], y1: outline[3][1], x2: outline[0][0], y2: outline[0][1], clamped: true }],
    loadCases: [{ id: 'G', name: 'q', type: 'G', sw: false }],
    areaLoads: [{ lc: 'G', q: 10, region: 'all' }],
    combos: [],
  }));
  const set = res.sets[0];
  close(set.wmax, 10 * L ** 4 / (8 * res.D), 0.02, 'w Kragende');
  close(set.sumR, 10 * L * B, 1e-6, 'Σ R');
});

// ------------------------------------------------------------------ Netz

test('Netz: L-Platte mit Öffnung, Zwangslinien und -punkten', () => {
  const outline = [[0, 0], [10, 0], [10, 4], [5, 4], [5, 8], [0, 8]];
  const hole = [[1, 5], [3, 5], [3, 6.5], [1, 6.5]];
  const segs = [[[0, 2], [10, 2]], [[2.5, -1], [2.5, 3]]]; // zweite ragt über den Rand hinaus
  const pts = [[7.3, 3.1], [2.5, 2]];
  const mesh = generateMesh({ outline, holes: [hole], segments: segs, points: pts, size: 0.5 });
  const q = meshQuality(mesh);
  assert.equal(q.inverted, 0, 'keine invertierten Elemente');
  assert.ok(q.minAngle > 15, `minimaler Winkel ${q.minAngle}`);
  close(q.area, 10 * 4 + 5 * 4 - 2 * 1.5, 1e-9, 'Netzfläche = Nettofläche');
  const { x, y, tri } = mesh;
  for (let t = 0; t < mesh.nTri; t++) {
    const cx = (x[tri[3 * t]] + x[tri[3 * t + 1]] + x[tri[3 * t + 2]]) / 3;
    const cy = (y[tri[3 * t]] + y[tri[3 * t + 1]] + y[tri[3 * t + 2]]) / 3;
    assert.ok(pointInPolygon(cx, cy, outline) && !pointInPolygon(cx, cy, hole), 'Element im Gebiet');
  }
  // Zwangslinien als Kantenzüge enthalten
  for (const [[ax, ay], [bx, by]] of [[[0, 2], [10, 2]], [[2.5, 0], [2.5, 3]], [[3, 5], [3, 6.5]]]) {
    const ns = nodesOnSegment(mesh, ax, ay, bx, by, 1e-6);
    assert.ok(Math.abs(ns[0].t) < 1e-9 && Math.abs(ns[ns.length - 1].t - 1) < 1e-9, 'Endpunkte vorhanden');
    for (let k = 0; k + 1 < ns.length; k++) assert.ok(hasEdge(mesh, ns[k].node, ns[k + 1].node), `Kante ${k} fehlt`);
  }
  for (const p of pts) assert.ok(nearestNode(mesh, p[0], p[1]).dist < 1e-9, 'Zwangspunkt ist Knoten');
});

test('Netz: Verfeinerung um Stützen und Leistung bei ~5000 Knoten', () => {
  const t0 = Date.now();
  const mesh = generateMesh({ outline: [[0, 0], [30, 0], [30, 20], [0, 20]], size: 0.3, refine: [{ x: 10, y: 10, r0: 0.3, s0: 0.12 }] });
  assert.ok(mesh.nNodes > 4000, `${mesh.nNodes} Knoten`);
  assert.equal(meshQuality(mesh).inverted, 0);
  const n = mesh.nNodes;
  const fixW = new Uint8Array(n);
  for (const nd of nodesOnSegment(mesh, 0, 0, 30, 0, 1e-6)) fixW[nd.node] = 1;
  for (const nd of nodesOnSegment(mesh, 0, 20, 30, 20, 1e-6)) fixW[nd.node] = 1;
  const f = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) f[3 * i] = 1;
  solvePlate(mesh, { D: 1e5, nu: 0.2, fixW, loads: [f] });
  const dt = Date.now() - t0;
  assert.ok(dt < 6000, `Rechenzeit ${dt} ms`);
});

test('Geometrie: kollineare, nicht überlappende Strecken schneiden sich nicht', () => {
  assert.equal(segIntersect([0, 0], [2, 0], [8, 0], [12, 0]), null);
  assert.ok(segIntersect([0, 0], [5, 0], [3, 0], [12, 0])?.collinear);
});

// ------------------------------------------------------------------ Bemessung

test('Wood–Armer: Handrechnung', () => {
  // mx = 10, my = −8, mxy = 3: unten mx* = 10 + 3²/8 = 11.125, my* = 0; oben mx* = 0, my* = −8 − 3²/10 = −8.9
  const r = woodArmer(10, -8, 3);
  close(r.bx, 11.125, 1e-12, 'bx'); assert.equal(r.by, 0);
  assert.equal(r.tx, 0); close(r.ty, 8.9, 1e-12, 'ty');
  // reine Drillung mxy = 5: unten und oben je |mxy| in beiden Richtungen
  const d = woodArmer(0, 0, 5);
  assert.deepEqual([d.bx, d.by, d.tx, d.ty], [5, 5, 5, 5]);
  const p = principalMoments(10, 4, 6);
  close(p.m1, 7 + Math.hypot(3, 6), 1e-12, 'm1');
});

test('Biegebemessung: Handrechnung Rechteckblock', () => {
  // m = 50 kNm/m, d = 200 mm, fcd = 20, fsd = 435: μ = 50·10⁶/(1000·200²·20) = 0.0625
  // ω = 1 − √(1 − 2μ) = 0.064586; as = ω·b·d·fcd/fsd = 0.064586·1000·200·20/435 = 593.9 mm²/m
  const r = requiredAs(50, 200, 20, 435);
  close(r.as, 593.89, 0.001, 'as');
  // Rückrechnung: mRd(as) = m
  close(momentResistance(r.as, 200, 20, 435), 50, 1e-9, 'mRd');
});

test('Durchstanzen SIA 262:2013, Handrechnung Innenstütze 0.40 × 0.40 m', () => {
  // d = dv = 250 mm, rs = 0.22·6.5 = 1.43 m, fsd = 435 MPa, Es = 205 GPa, msd/mRd = 1, Dmax = 32 → kg = 1
  // ψ = 1.5·(1430/250)·(435/205000)·1 = 0.018206 (Gl. 59)
  // kr = 1/(0.45 + 0.18·0.018206·250·1) = 0.78786 (Gl. 58)
  // τcd = 0.3·√30/1.5 = 1.09545 MPa; u = 4·0.40 + π·0.25 = 2.38540 m; ke = 0.9
  // VRd,c = 0.78786·1.09545·250·(0.9·2385.40) = 463.2 kN (Gl. 57)
  const r = punchingSIA({ Vd: 400, d: 250, dv: 250, u: 1.6 + Math.PI * 0.25, ke: 0.9, rsx: 1.43, rsy: 1.43, msd: 50, mRdx: 50, mRdy: 50, fsd: 435, Es: 205000, tcd: 0.3 * Math.sqrt(30) / 1.5, Dmax: 32 });
  close(r.psi, 0.018206, 1e-4, 'ψ');
  close(r.kr, 0.78786, 1e-4, 'kr');
  close(r.VRdc, 463.2, 1e-3, 'VRd,c');
  assert.equal(r.needsReinforcement, false);
  close(r.VRdmax, 2 * 463.2, 1e-3, 'VRd,max');
  // Nachweisschnitt numerisch (Polygon) ≈ 2.3854 m
  const sq = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  const cp = controlPerimeter({ x: 0, y: 0, b: 0.4, h: 0.4 }, 0.125, sq);
  close(cp.u, 2.3854, 0.003, 'u');
  assert.equal(cp.type, 'innen');
  const edge = controlPerimeter({ x: 0, y: 9.8, b: 0.4, h: 0.4 }, 0.125, sq);
  assert.equal(edge.type, 'rand');
  const corner = controlPerimeter({ x: 9.8, y: 9.8, b: 0.4, h: 0.4 }, 0.125, sq);
  assert.equal(corner.type, 'ecke');
});

test('Durchstanzen EN 1992-1-1 6.4.4: Handrechnung', () => {
  // d = 250 mm: k = 1 + √(200/250) = 1.8944; ρ = 0.01; fck = 30
  // vRd,c = 0.12·1.8944·(100·0.01·30)^(1/3) = 0.7058 MPa; vmin = 0.035·1.8944^1.5·√30 = 0.4999 MPa
  const r = punchingEC({ VEd: 600, d: 250, u1: 4.7416, u0: 1.6, beta: 1.15, rhoL: 0.01, fck: 30, fcd: 20, gammaC: 1.5 });
  close(r.k, 1.8944, 1e-4, 'k');
  close(r.vRdc, 0.7058, 1e-3, 'vRd,c');
  close(r.vEd, 1.15 * 600e3 / (4741.6 * 250), 1e-9, 'vEd');
});

// ------------------------------------------------------------------ Gesamtberechnung

test('Beispiele: Gleichgewicht Σ Auflagerkräfte = Σ Lasten für alle Lastfälle und Kombinationen', () => {
  for (const ex of EXAMPLES) {
    const r = analyse(ex.project());
    for (const s of r.sets) {
      assert.ok(Math.abs(s.sumR - s.sumF) <= 1e-6 * Math.max(1, Math.abs(s.sumF)), `${ex.name} / ${s.name}: ΣR = ${s.sumR}, ΣF = ${s.sumF}`);
      // Summe der Lagerkräfte je Lager = Gesamtreaktion
      const tot = s.supportForces.reduce((a, f) => a + f.total, 0);
      assert.ok(Math.abs(tot - s.sumR) <= 1e-6 * Math.max(1, Math.abs(s.sumR)), `${ex.name}: Lagerzuordnung`);
    }
    assert.equal(r.mesh.quality.inverted, 0);
    assert.ok(r.design, `${ex.name}: Bemessung vorhanden`);
  }
});

test('Gesamtberechnung: Eigengewicht je Plattendicke, Lasten je Platte und Linienlasten exakt aufgebracht', () => {
  const r = analyse(EXAMPLES[2].project());
  const lc1 = r.sets.find((s) => s.key === 'lc:LF1');
  // Wohnungsdecke 12·5 + 6·4 − 2.6·1.4 = 80.36 m² (h 0.24), Balkon 6·1.8 = 10.8 m² (h 0.20)
  close(lc1.sumF, 25 * (0.24 * 80.36 + 0.20 * 10.8), 1e-9, 'Eigengewicht');
  close(r.sets.find((s) => s.key === 'lc:LF3').sumF, 2.0 * 80.36, 1e-9, 'Nutzlast auf der Wohnungsdecke');
  close(r.sets.find((s) => s.key === 'lc:LF4').sumF, 3.0 * 10.8, 1e-9, 'Balkonlast auf der Balkonplatte');
  const lc2 = r.sets.find((s) => s.key === 'lc:LF2');
  close(lc2.sumF, 1.5 * 91.16 + 1.5 * 6 + 6.0 * 4.5 + 25, 1e-9, 'Auflast + Linienlasten + Punktlast');
});

test('Standardkombinationen SIA 260: 1.35·G + 1.5·Q und G + ψ2·Q', () => {
  const lcs = [{ id: 'A', name: 'G', type: 'G' }, { id: 'B', name: 'Q1', type: 'Q', psi0: 0.7, psi2: 0.3 }, { id: 'C', name: 'Q2', type: 'Q', psi0: 0.6, psi2: 0.2 }];
  const c = defaultCombos(lcs);
  assert.equal(c.length, 3);
  assert.deepEqual([c[0].f_A, c[0].f_B, c[0].f_C].map((v) => +v.toFixed(3)), [1.35, 1.5, 0.9]);
  assert.deepEqual([c[1].f_A, c[1].f_B, c[1].f_C].map((v) => +v.toFixed(3)), [1.35, 1.05, 1.5]);
  assert.deepEqual([c[2].type, c[2].f_A, c[2].f_B, c[2].f_C], ['SLS', 1, 0.3, 0.2]);
});

test('Fehlermeldungen: ungelagerte bzw. kinematische Platte', () => {
  const p = EXAMPLES[0].project();
  p.lineSupports = [];
  assert.throws(() => analyse(p), /keine Lager/);
  p.lineSupports = [{ x1: 0, y1: 0, x2: 6, y2: 0, clamped: false }];
  assert.throws(() => analyse(p), /kinematisch/);
  p.lineSupports[0].clamped = true;
  assert.doesNotThrow(() => analyse(p));
});

test('Neues Projekt ist leer (ohne Geometrie, Lager und Lasten), Baustoffe vorbelegt', () => {
  const p = defaultProject();
  assert.equal(p.slabs.length, 0);
  assert.equal(p.pointSupports.length + p.lineSupports.length, 0);
  assert.equal(p.areaLoads.length + p.lineLoads.length + p.pointLoads.length + p.loadAreas.length, 0);
  assert.ok(p.h > 0 && p.concrete && p.meshSize > 0 && p.loadCases.length > 0);
  assert.throws(() => analyse(p), /keine Platte/);
});

test('Flachdecke: Durchstanznachweise mit Stützentyp-Erkennung', () => {
  const r = analyse(EXAMPLES[1].project());
  const types = r.punching.map((pc) => pc.type);
  assert.equal(types.filter((t) => t === 'ecke').length, 4);
  assert.equal(types.filter((t) => t === 'innen').length, 2);
  assert.equal(types.filter((t) => t === 'rand').length, 6);
  for (const pc of r.punching) {
    assert.ok(pc.Vd > 0 && pc.VRd > 0 && Number.isFinite(pc.eta));
    assert.ok(pc.res.kr > 0.4 && pc.res.kr <= 2);
  }
  // Symmetrie: Innenstützen gleich belastet
  const inner = r.punching.filter((pc) => pc.type === 'innen');
  close(inner[0].Vd, inner[1].Vd, 0.01, 'Symmetrie');
  assert.ok(signedArea(r.outlines[0]) > 0);
});

// ------------------------------------------------------------------ Grafische Bearbeitung (model.js)

const rectProject = () => {
  const p = defaultProject();
  createElement(p, 'slab', [[0, 0], [6, 0], [6, 4], [0, 4]]);
  return p;
};

test('Editor: Umriss zeichnen, Wände an allen Rändern, Lastfläche – Berechnung im Gleichgewicht', () => {
  const p = rectProject();
  assert.equal(p.slabs[0].outline.length, 4);
  assert.equal(addWallsOnEdges(p, [0, 1, 2, 3]), 4);
  assert.equal(addWallsOnEdges(p, [0, 1]), 0, 'keine doppelten Wände');
  const r1 = createElement(p, 'area', [[1, 1], [3, 1], [3, 3], [1, 3]]);
  assert.deepEqual(r1.ids, ['a:0']);
  assert.equal(p.areaLoads.length, 1);
  assert.equal(p.areaLoads[0].lc, 'LF3', 'neue Last im veränderlichen Lastfall');
  createElement(p, 'pointload', [[4, 2]]);
  createElement(p, 'lineload', [[0.5, 3.5], [5.5, 3.5]]);
  const r = analyse(p);
  const q = r.sets.find((s) => s.key === 'lc:LF3');
  close(q.sumF, 2.0 * 4 + 10 + 5 * 5, 1e-9, 'Lasten der gezeichneten Elemente');
  for (const s of r.sets) assert.ok(Math.abs(s.sumR - s.sumF) < 1e-6 * Math.max(1, s.sumF));
});

test('Editor: ungültige Polygone werden mit verständlicher Meldung abgewiesen', () => {
  const p = defaultProject();
  assert.throws(() => createElement(p, 'slab', [[0, 0], [4, 4], [4, 0], [0, 4]]), /überschneidet sich/);
  assert.throws(() => createElement(p, 'slab', [[0, 0], [4, 0]]), /mindestens drei/);
  const q = rectProject();
  assert.throws(() => createElement(q, 'opening', [[5, 3], [7, 3], [7, 5], [5, 5]]), /innerhalb der Platte/);
  assert.equal(polygonProblem([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]), null);
});

test('Editor: Verschieben nimmt zusammenfallende Punkte mit (Ecke → Wandenden)', () => {
  const p = rectProject();
  addWallsOnEdges(p, [0, 1, 2, 3]);
  createElement(p, 'column', [[3, 2]]);
  const o = p.slabs[0].outline;
  moveSelection(p, ['sv:0:2'], [1, 0.5]); // Ecke (6,4) → (7,4.5)
  assert.deepEqual([o[2].x, o[2].y], [7, 4.5]);
  assert.deepEqual([p.lineSupports[1].x2, p.lineSupports[1].y2], [7, 4.5], 'Wand 2 endet an der Ecke');
  assert.deepEqual([p.lineSupports[2].x1, p.lineSupports[2].y1], [7, 4.5], 'Wand 3 beginnt an der Ecke');
  assert.deepEqual([p.pointSupports[0].x, p.pointSupports[0].y], [3, 2], 'Stütze bleibt');
  moveSelection(p, ['c:0'], [-1, 0]);
  assert.deepEqual([p.pointSupports[0].x, o[0].x], [2, 0]);
  // ganze Platte: Ränder und die Wände darauf gehen mit, die Stütze nicht
  moveSelection(p, ['s:0'], [10, 10]);
  assert.deepEqual([o[0].x, o[0].y, p.lineSupports[0].y1, p.pointSupports[0].x], [10, 10, 10, 2]);
  assert.deepEqual([...vertexIdsOf(p, ['se:0:3'])].sort(), ['sv:0:0', 'sv:0:3']);
});

test('Editor: Kopieren und Löschen', () => {
  const p = rectProject();
  createElement(p, 'column', [[2, 2]]);
  createElement(p, 'area', [[1, 1], [2, 1], [2, 2]]);
  const ids = copySelection(p, ['c:0', 'a:0', 'sv:0:1'], [1, 0]);
  assert.deepEqual(ids, ['c:1', 'a:1']);
  assert.equal(p.pointSupports[1].x, 3);
  assert.equal(p.areaLoads.length, 2, 'Last der Lastfläche mitkopiert');
  assert.notEqual(p.loadAreas[1].id, p.loadAreas[0].id);
  // Eckpunkt löschen nur, solange drei Punkte bleiben
  const o = p.slabs[0].outline;
  const k = insertMidpoint(o, 0);
  assert.equal(k, 1);
  assert.deepEqual([o[1].x, o[1].y], [3, 0]);
  assert.equal(removeSelection(p, ['sv:0:1']), 1);
  assert.equal(p.slabs[0].outline.length, 4);
  removeSelection(p, ['sv:0:0', 'sv:0:1']);
  assert.equal(p.slabs[0].outline.length, 4, 'nicht unter drei Punkte – Rand bleibt');
  // Lastfläche mit ihren Lasten löschen
  assert.equal(removeSelection(p, ['a:0', 'c:0', 'c:1']), 3);
  assert.equal(p.loadAreas.length, 1);
  assert.equal(p.areaLoads.length, 1);
  assert.equal(p.areaLoads[0].region, p.loadAreas[0].id);
  assert.equal(p.pointSupports.length, 0);
  // Platte kopieren (mit ihren Flächenlasten) und löschen
  addSlabLoad(p, p.slabs[0].id, 'LF2', 1.5);
  const sid = copySelection(p, ['s:0'], [10, 0]);
  assert.deepEqual(sid, ['s:1']);
  assert.equal(p.slabs[1].outline[0].x, 10);
  assert.equal(p.areaLoads.filter((l) => l.region === p.slabs[1].id).length, 1);
  removeSelection(p, ['s:1']);
  assert.equal(p.slabs.length, 1);
  assert.equal(p.areaLoads.filter((l) => l.region !== 'all' && !p.slabs.some((x) => x.id === l.region) && !p.loadAreas.some((a) => a.id === l.region)).length, 0, 'keine verwaisten Lasten');
});

// ------------------------------------------------------------------ Mehrere Platten

/** Zweifeldplatte 8 × 4 m, allseitig gelagert; optional in zwei benachbarte Platten geteilt. */
function twoBays({ split = false, h2 = 0.22, load = null } = {}) {
  const p = defaultProject();
  p.meshSize = 0.25;
  if (split) {
    createElement(p, 'slab', [[0, 0], [4, 0], [4, 4], [0, 4]]);
    createElement(p, 'slab', [[4, 0], [8, 0], [8, 4], [4, 4]]);
    p.slabs[0].h = 0.22; p.slabs[1].h = h2;
  } else {
    createElement(p, 'slab', [[0, 0], [8, 0], [8, 4], [0, 4]]);
    p.slabs[0].h = 0.22;
  }
  addWallsOnFreeEdges(p);
  p.areaLoads.push({ lc: 'LF3', q: 3, region: load || 'all' });
  return p;
}

test('Mehrere Platten: zwei benachbarte Platten gleicher Dicke = eine Platte', () => {
  const a = analyse(twoBays());
  const b = analyse(twoBays({ split: true }));
  assert.equal(b.slabs.length, 2);
  for (const key of ['lc:LF1', 'co:K1']) {
    const sa = a.sets.find((s) => s.key === key), sb = b.sets.find((s) => s.key === key);
    close(sb.sumF, sa.sumF, 1e-9, `Σ Lasten ${key}`);
    close(sb.wmax, sa.wmax, 0.02, `w_max ${key}`);
    close(sb.mExt.mx[1], sa.mExt.mx[1], 0.03, `m_x,max ${key}`);
    close(sb.mExt.my[1], sa.mExt.my[1], 0.03, `m_y,max ${key}`);
  }
  // gemeinsamer Rand ist kein freier Rand: keine Wand auf x = 4
  const p = twoBays({ split: true });
  assert.ok(!p.lineSupports.some((w) => w.x1 === 4 && w.x2 === 4), 'keine Wand auf dem gemeinsamen Rand');
  assert.equal(freeEdges(p.slabs.map((sl) => sl.outline.map((q) => [q.x, q.y]))).length, 6);
});

test('Mehrere Platten: Dicke je Platte (Steifigkeit, Eigengewicht) und Flächenlast auf eine ganze Platte', () => {
  const p = twoBays({ split: true, h2: 0.30, load: 'P2' });
  const r = analyse(p);
  // Eigengewicht 25·(0.22·16 + 0.30·16)
  const lc1 = r.sets.find((s) => s.key === 'lc:LF1');
  close(lc1.sumF, 25 * (0.22 * 16 + 0.30 * 16), 1e-9, 'Eigengewicht je Dicke');
  // Flächenlast nur auf Platte 2
  const lc3 = r.sets.find((s) => s.key === 'lc:LF3');
  close(lc3.sumF, 3 * 16, 1e-9, 'Last auf ganze Platte P2');
  for (const s of r.sets) assert.ok(Math.abs(s.sumR - s.sumF) < 1e-6 * Math.max(1, s.sumF), `Gleichgewicht ${s.name}`);
  // Steifigkeit je Element ∝ h³
  const ratio = r.slabs[1].D / r.slabs[0].D;
  close(ratio, (0.30 / 0.22) ** 3, 1e-9, 'D-Verhältnis');
  const t2 = r.eSlab.findIndex((k) => k === 1);
  close(r.elemFactor[t2], ratio, 1e-9, 'Elementsteifigkeit');
  // dickere Platte biegt sich unter gleicher Last weniger durch: Last auf P1 statt P2
  const q = analyse(twoBays({ split: true, h2: 0.30, load: 'P1' }));
  const w = (res, xx) => Math.max(...Array.from(res.mesh.x).map((v, i) => (Math.abs(v - xx) < 1.5 && Math.abs(res.mesh.y[i] - 2) < 1.5 ? res.sets.find((s) => s.key === 'lc:LF3').w[i] : 0)));
  assert.ok(w(q, 2) > w(r, 6), 'dünnere Platte unter gleicher Last weicher');
  // statische Höhe der Bemessung aus der lokalen Dicke
  assert.equal(r.design.depBySlab[1].bx, 300 - 30 - 6);
  assert.equal(r.design.bySlab.length, 2);
});

test('Mehrere Platten: Verstärkung innerhalb einer Platte (Stützenkopf) und alte Dateien', () => {
  const r = analyse(EXAMPLES[1].project());
  const inner = r.punching.filter((pc) => pc.type === 'innen');
  for (const pc of inner) { assert.equal(pc.hSlab, 0.40); assert.ok(pc.d > 340); }
  const edge = r.punching.find((pc) => pc.type === 'rand');
  assert.equal(edge.hSlab, 0.30);
  // Eigengewicht: Flachdecke 20 × 13.5 m mit zwei Verstärkungen 2.6 × 2.6 m (h 0.40 statt 0.30)
  const lc1 = r.sets.find((s) => s.key === 'lc:LF1');
  close(lc1.sumF, 25 * (0.30 * 20 * 13.5 + 2 * 0.10 * 2.6 * 2.6), 1e-9, 'Eigengewicht mit Verstärkung');
  // Migration: Projekt mit einem einzelnen Umriss
  const old = { outline: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }], h: 0.2, lineSupports: [] };
  const m = withDefaults(old);
  assert.equal(m.slabs.length, 1);
  assert.equal(m.slabs[0].h, 0.2);
  assert.equal(m.outline, undefined);
});

// ------------------------------------------------------------------ Herleitung

test('Herleitung: alle Nachweise mit Formel, Werten und Ergebnis', () => {
  const p = EXAMPLES[1].project();
  const r = analyse(p);
  const secs = derivation({ results: r, project: p, viewOpts: {} });
  const ids = secs.map((s) => s.id);
  for (const id of ['material', 'kombi', 'gleich', 'as-bx', 'as-by', 'as-tx', 'as-ty', 'sls']) assert.ok(ids.includes(id), id);
  for (const pc of r.punching.filter((q) => !q.skip)) {
    const s = secs.find((x) => x.id === `p-${pc.name}`);
    assert.ok(s, pc.name);
    assert.ok(Math.abs(s.result.eta - pc.eta) < 1e-12);
    const v = s.steps.find((st) => st && /V_\{Rd,c\} =/.test(st.f));
    assert.ok(v && v.r.includes(pc.VRd.toFixed(1)), `VRd in Herleitung ${pc.name}`);
  }
  const mat = secs.find((x) => x.id === 'material');
  assert.ok(mat.steps.some((st) => st && st.f.startsWith('D =') && st.r.includes(r.D.toFixed(0))));
  // Bewehrung: Ergebnis der Herleitung = Tabelle
  const L = r.design.layers.tx;
  const sec = secs.find((x) => x.id === 'as-tx');
  assert.ok(sec.result.text.includes(Math.max(L.asMax, L.asMin).toFixed(0)));
});

test('Herleitung: Wood–Armer-Fallunterscheidung', () => {
  // Regelfall unten x: mx + |mxy|
  assert.equal(woodArmerSteps(10, 4, 6, 'bx').value, 16);
  // Korrektur: my + |mxy| < 0 → mx + mxy²/|my|
  const k = woodArmerSteps(10, -8, 3, 'bx');
  close(k.value, 11.125, 1e-12, 'korrigiert');
  assert.match(k.steps[0].label, /Korrektur/);
  // oben y: my − mxy²/|mx|
  close(woodArmerSteps(10, -8, 3, 'ty').value, 8.9, 1e-12, 'oben y');
});

test('Mehrere Platten: massgebende Platte, freie Ränder einer Verstärkung, EC-Durchstanzen', () => {
  const p = defaultProject();
  createElement(p, 'slab', [[0, 0], [10, 0], [10, 8], [0, 8]]);
  const r = createElement(p, 'slab', [[4, 3], [6, 3], [6, 5], [4, 5]]);
  assert.match(r.msg, /innerhalb einer anderen Platte/);
  p.slabs[1].h = 0.4;
  const geo = geometryOf(p);
  assert.equal(slabIndexAt(geo, 5, 4), 1, 'innen liegende Platte massgebend');
  assert.equal(slabIndexAt(geo, 1, 1), 0);
  assert.equal(slabIndexAt(geo, 6, 4, 1e-6), 0, 'auf dem Rand gilt die dünnere Platte');
  assert.equal(slabAt(p, 5, 4), 1);
  // Ränder der Verstärkung sind keine freien Ränder
  assert.equal(addWallsOnFreeEdges(p), 4);
  assert.ok(p.lineSupports.every((w) => [0, 10].includes(w.x1) || [0, 8].includes(w.y1)));
  // Eurocode-Durchstanzen mit Stütze in der Verstärkung
  p.norm = 'EC';
  p.lineSupports = [];
  createElement(p, 'column', [[5, 4]]);
  for (const [x, y] of [[0.3, 0.3], [9.7, 0.3], [9.7, 7.7], [0.3, 7.7]]) createElement(p, 'column', [[x, y]]);
  p.areaLoads.push({ lc: 'LF3', q: 3, region: p.slabs[0].id });
  const res = analyse(p);
  const s1 = res.punching.find((pc) => pc.name === 'S1');
  assert.equal(s1.hSlab, 0.4);
  assert.equal(s1.type, 'innen');
  assert.ok(s1.d > 340 && Number.isFinite(s1.eta));
  for (const s of res.sets) assert.ok(Math.abs(s.sumR - s.sumF) < 1e-6 * Math.max(1, s.sumF));
  close(res.sets.find((s) => s.key === 'lc:LF3').sumF, 3 * 80, 1e-9, 'Last auf ganze Platte inkl. Verstärkung');
});

// Tests Querschnitt-Modul: Vergleich mit Handrechnungen
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  templatePolygons, templateToPoly, projectGeometry, defaultShapes, barsLayers, barsCircle, barsRow, barsPerimeter, barsCircular,
  polygonProps, signedArea, chordWidth, offsetPolygon, selfIntersects,
} from '../modules/querschnitt/shapes.js';
import {
  analyze, createCache, grossProps, idealSectionProps, userToCore, coreToUser, thetaForUserMoment, shearCheck, materialSet,
  steelStressLimit, interpTable, SIA_FIG31, mkCurve, chooseMesh, tensionLayerSpacing,
} from '../modules/querschnitt/calc.js';
import {
  editableOutline, convertToPoly, createOutline, addOpening, addDuct, setDuct, addBars, moveSelection, removeSelection, insertVertex,
  setVertex, groupBars, rowCount, circleCount, touchesTemplate, hasOutline,
} from '../modules/querschnitt/model.js';
import { defaultProject, EXAMPLES } from '../modules/querschnitt/examples.js';
import { missingInput, forceResultants } from '../modules/querschnitt/calc.js';
import * as rc from '../js/core/rcsection.js';
import { concrete, rebar } from '../js/core/materials.js';

const near = (a, b, rel = 1e-9, msg = '') => {
  const tol = rel * Math.max(1, Math.abs(b));
  assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≠ ${b} (Toleranz ${tol})`);
};
const A20 = Math.PI * 20 * 20 / 4; // mm²

/** Projekt Rechteck b×h [mm] mit Stäben [{y,z,d}] (mm). */
function rectProject(b, h, bars, extra = {}) {
  const shape = defaultShapes();
  shape.type = 'rect';
  shape.rect = { b, h };
  return {
    shape, openings: [], bars,
    material: { norm: 'SIA', concrete: 'C30/37', steel: 'B500B', ...(extra.material || {}) },
    calc: { ref: 'gross', ...(extra.calc || {}) },
    sls: { req: 'normal', spacingAuto: true, spacing: 150, ...(extra.sls || {}) },
    loads: extra.loads || [],
    shear: extra.shear || { active: false },
  };
}

// ------------------------------------------------------------------ Vorlagen

test('Vorlagen: Flächen nach Handformel und Gegenuhrzeigersinn', () => {
  const s = defaultShapes();
  const area = (t) => { const g = templatePolygons(t, s[t]); return grossProps(g.outer, g.holes).A; };
  near(area('rect'), 300 * 600, 1e-12, 'Rechteck');
  near(area('T'), 1500 * 200 + 350 * 700, 1e-12, 'Plattenbalken');
  near(area('I'), 500 * 150 + 500 * 180 + 160 * (1000 - 150 - 180), 1e-12, 'Doppel-T');
  // Hohlkasten: Aussen (bu×(h−to) + bo×to) minus Innenraum (bu−2tw)×(h−to−tu)
  near(area('box'), 2400 * 1350 + 4000 * 250 - (2400 - 700) * (1600 - 250 - 220), 1e-12, 'Hohlkasten');
  near(area('circle'), Math.PI * 500 ** 2 / 4, 1e-12, 'Kreis (flächengleiches 72-Eck)');
  near(area('ring'), Math.PI / 4 * (1000 ** 2 - 600 ** 2), 1e-12, 'Kreisring');
  near(area('L'), 600 * 200 + 200 * 400, 1e-12, 'L-Winkel');
  for (const t of ['rect', 'T', 'I', 'box', 'circle', 'ring', 'L']) {
    const g = templatePolygons(t, s[t]);
    assert.ok(signedArea(g.outer) > 0, `${t}: Aussenpolygon im Gegenuhrzeigersinn`);
    assert.ok(!selfIntersects(g.outer), `${t}: ohne Selbstüberschneidung`);
  }
  assert.throws(() => templatePolygons('T', { b: 1500, hf: 900, bw: 350, h: 900 }), /Plattenstärke/);
  assert.throws(() => templatePolygons('rect', { b: 0, h: 500 }), /positiv/);
  assert.throws(() => templatePolygons('box', { bo: 2000, bu: 2000, h: 1000, to: 200, tu: 200, tw: 1000 }), /Stegdicken/);
});

test('Umwandlung Vorlage → freies Polygon erhält die Querschnittswerte', () => {
  const s = defaultShapes();
  for (const t of ['T', 'box', 'ring']) {
    s.type = t;
    const g0 = templatePolygons(t, s[t]);
    const p0 = grossProps(g0.outer, g0.holes);
    const conv = templateToPoly(s);
    const proj = { shape: { ...s, type: 'poly', poly: conv.poly }, openings: conv.openings, bars: [] };
    const g1 = projectGeometry(proj);
    assert.equal(g1.errors.length, 0);
    const p1 = grossProps(g1.outer, g1.holes);
    // Koordinaten auf 0.01 mm gerundet
    near(p1.A, p0.A, 1e-5, `${t}: A`);
    near(p1.Iy, p0.Iy, 1e-5, `${t}: Iy`);
    near(p1.Iz, p0.Iz, 1e-5, `${t}: Iz`);
    assert.equal(conv.openings.length, g0.holes.length);
  }
});

test('Selbstüberschneidendes Polygon wird mit verständlicher Meldung abgelehnt', () => {
  const s = defaultShapes();
  s.type = 'poly';
  s.poly = [{ y: 0, z: 0 }, { y: 300, z: 300 }, { y: 300, z: 0 }, { y: 0, z: 300 }];
  const g = projectGeometry({ shape: s, openings: [], bars: [] });
  assert.match(g.errors[0], /schneidet sich selbst/);
});

// ------------------------------------------------------------------ Querschnittswerte

test('Plattenbalken: Bruttowerte und Hauptachsen nach Handrechnung (Steiner)', () => {
  // Platte 1500×200 (Schwerpunkt z = 800), Steg 350×700 (z = 350); Masse in mm
  const g = templatePolygons('T', { b: 1500, hf: 200, bw: 350, h: 900 });
  const p = grossProps(g.outer, g.holes);
  const A1 = 1500 * 200, A2 = 350 * 700, A = A1 + A2;
  const zs = (A1 * 800 + A2 * 350) / A; // = 597.71 mm
  const Iy = 1500 * 200 ** 3 / 12 + A1 * (800 - zs) ** 2 + 350 * 700 ** 3 / 12 + A2 * (350 - zs) ** 2;
  const Iz = 200 * 1500 ** 3 / 12 + 700 * 350 ** 3 / 12;
  near(p.A, A, 1e-12, 'A');
  near(p.cz, zs, 1e-12, 'zs');
  near(p.cy, 0, 1e-12, 'ys');
  near(p.Iy, Iy, 1e-10, 'Iy');
  near(p.Iz, Iz, 1e-10, 'Iz');
  near(p.Iyz, 0, 1e-6, 'Iyz');
  // symmetrisch: Hauptachsen = y/z; Iz > Iy → Achse 1 vertikal (α = ±90°)
  near(p.I1, Iz, 1e-10, 'I1');
  near(p.I2, Iy, 1e-10, 'I2');
  near(Math.abs(p.alpha), Math.PI / 2, 1e-9, 'α');
  // Widerstandsmomente
  near(p.Wy_top, Iy / (900 - zs), 1e-10, 'Wy oben');
  near(p.Wy_bot, Iy / zs, 1e-10, 'Wy unten');
});

test('L-Winkel: Deviationsmoment und Hauptachsen nach Handrechnung', () => {
  // L mit b = 600, h = 400, tb = 150, th = 200 (Ecke in 0/0)
  // Teil 1: 600×150 (y 0…600, z 0…150), Teil 2: 200×250 (y 0…200, z 150…400)
  const g = templatePolygons('L', { b: 600, h: 400, tb: 150, th: 200 });
  const p = grossProps(g.outer, g.holes);
  const A1 = 600 * 150, A2 = 200 * 250, A = A1 + A2;
  const y1 = 300, z1 = 75, y2 = 100, z2 = 275;
  const ys = (A1 * y1 + A2 * y2) / A, zs = (A1 * z1 + A2 * z2) / A;
  const Iy = 600 * 150 ** 3 / 12 + A1 * (z1 - zs) ** 2 + 200 * 250 ** 3 / 12 + A2 * (z2 - zs) ** 2;
  const Iz = 150 * 600 ** 3 / 12 + A1 * (y1 - ys) ** 2 + 250 * 200 ** 3 / 12 + A2 * (y2 - ys) ** 2;
  const Iyz = A1 * (y1 - ys) * (z1 - zs) + A2 * (y2 - ys) * (z2 - zs); // Eigenanteile der Rechtecke = 0
  near(p.A, A, 1e-12, 'A');
  near(p.cy, ys, 1e-12, 'ys');
  near(p.cz, zs, 1e-12, 'zs');
  near(p.Iy, Iy, 1e-10, 'Iy');
  near(p.Iz, Iz, 1e-10, 'Iz');
  near(p.Iyz, Iyz, 1e-10, 'Iyz');
  assert.ok(Iyz < 0, 'Iyz negativ für diesen Winkel');
  // Hauptträgheitsmomente: I1,2 = (Iy+Iz)/2 ± √(((Iy−Iz)/2)² + Iyz²), tan 2α = −2Iyz/(Iy − Iz)
  const m = (Iy + Iz) / 2, r = Math.hypot((Iy - Iz) / 2, Iyz);
  near(p.I1, m + r, 1e-10, 'I1');
  near(p.I2, m - r, 1e-10, 'I2');
  const alpha = 0.5 * Math.atan2(-2 * Iyz, Iy - Iz);
  near(p.alpha, alpha, 1e-10, 'α');
  // Kontrolle: im gedrehten System verschwindet das Deviationsmoment
  const c = Math.cos(p.alpha), s = Math.sin(p.alpha);
  const Iyz1 = (Iy - Iz) * s * c + Iyz * (c * c - s * s);
  near(Iyz1, 0, 1e-9 * Math.abs(Iyz), 'Iy′z′');
});

test('Gleichschenkliger L-Winkel: Hauptachse unter 45°', () => {
  const g = templatePolygons('L', { b: 600, h: 600, tb: 200, th: 200 });
  const p = grossProps(g.outer, g.holes);
  // Handrechnung: A = 200000, ys = zs = 220, Iy = Iz = 5.7867e9, Iyz = −2.88e9
  near(p.cy, 220, 1e-12); near(p.cz, 220, 1e-12);
  near(p.Iyz, -2.88e9, 1e-10);
  near(p.I1, 5786666666.667 + 2.88e9, 1e-10);
  near(p.alpha * 180 / Math.PI, 45, 1e-9);
});

test('Ideelle Werte: Rechteck 300×500 mit 3Ø20 (n = 6) – Handrechnung und Kern stimmen überein', () => {
  const g = templatePolygons('rect', { b: 300, h: 500 });
  const gross = grossProps(g.outer, g.holes);
  const bars = [-100, 0, 100].map((y) => ({ y, z: 50, A: A20 }));
  const id = idealSectionProps(gross, bars, 6);
  const As = 3 * A20;
  const Ai = 150000 + 5 * As;
  const zi = (150000 * 250 + 5 * As * 50) / Ai;
  const Iyi = 300 * 500 ** 3 / 12 + 150000 * (250 - zi) ** 2 + 5 * As * (50 - zi) ** 2;
  near(id.A, Ai, 1e-12, 'Ai');
  near(id.cz, zi, 1e-12, 'zi');
  near(id.Iy, Iyi, 1e-10, 'Iy,i');
  // Vergleich mit rcsection.idealProps (in m)
  const sec = rc.buildSection({ regions: [{ pts: g.outer.map(([y, z]) => [y / 1000, z / 1000]), law: { sigma: () => 0, tangent: () => 0, epsMin: -1 } }], bars: bars.map((b) => ({ y: b.y / 1000, z: b.z / 1000, A: b.A * 1e-6, law: { sigma: () => 0, tangent: () => 0 } })) });
  const k = rc.idealProps(sec, 6);
  near(k.A * 1e6, Ai, 1e-9, 'Kern A');
  near(k.Iy * 1e12, Iyi, 1e-9, 'Kern Iy');
});

// ------------------------------------------------------------------ Vorzeichen

test('Vorzeichen: Benutzer ↔ Kern (My_core = −My_user, Mz_core = −Mz_user)', () => {
  assert.deepEqual(userToCore(100, 50), { My: -100, Mz: -50 });
  assert.deepEqual(coreToUser(-100, -50), { My: 100, Mz: 50 });
  const rt = coreToUser(userToCore(12.5, -7).My, userToCore(12.5, -7).Mz);
  assert.deepEqual(rt, { My: 12.5, Mz: -7 });
  near(thetaForUserMoment(100, 0), Math.PI / 2, 1e-12, 'My+ → Druck oben');
  near(Math.abs(thetaForUserMoment(0, 100)), Math.PI, 1e-12, 'Mz+ → Druck links');
  near(thetaForUserMoment(0, -100), 0, 1e-12, 'Mz− → Druck rechts');
});

test('Vorzeichen physikalisch: My > 0 → Zug unten, Mz > 0 → Zug rechts, N > 0 → Zug', () => {
  const bars = [[-120, 60], [120, 60], [-120, 340], [120, 340]].map(([y, z]) => ({ y, z, d: 20 }));
  const p = rectProject(400, 400, bars, { loads: [
    { name: 'My+', type: 'GZG', N: 0, My: 50, Mz: 0 },
    { name: 'Mz+', type: 'GZG', N: 0, My: 0, Mz: 50 },
    { name: 'N+', type: 'GZG', N: 100, My: 0, Mz: 0 },
  ] });
  const r = analyze(p);
  const byPos = (st, y, z) => st.bars.find((b) => Math.abs(b.y * 1000 - y) < 1e-6 && Math.abs(b.z * 1000 - z) < 1e-6).sigma;
  // Stelle der grössten Betondruckspannung (Eckpunkt mit minimaler Dehnung)
  const sec = r.secs.sls;
  const comp = (st) => { const v = rc.stressesAt(sec, st).verts; return v.reduce((m, x) => (x.sigma < m.sigma ? x : m)); };
  const s1 = r.cases[0].slsState;
  assert.ok(byPos(s1, -120, 60) > 0 && byPos(s1, 120, 60) > 0, 'My+: untere Stäbe auf Zug');
  assert.ok(byPos(s1, -120, 340) < byPos(s1, -120, 60), 'My+: obere Stäbe weniger gezogen');
  assert.ok(comp(s1).z > 0.39, 'My+: Betondruck oben');
  near(s1.My, 50, 1e-6, 'Rückrechnung My');
  const s2 = r.cases[1].slsState;
  assert.ok(byPos(s2, 120, 60) > 0 && byPos(s2, 120, 340) > 0, 'Mz+: rechte Stäbe auf Zug');
  assert.ok(byPos(s2, -120, 60) < byPos(s2, 120, 60), 'Mz+: linke Stäbe weniger gezogen');
  assert.ok(comp(s2).y < -0.19, 'Mz+: Betondruck links');
  near(s2.Mz, 50, 1e-6, 'Rückrechnung Mz');
  const s3 = r.cases[2].slsState;
  for (const b of s3.bars) near(b.sigma, 100 / (4 * A20 * 1e-6) / 1000, 1e-6, 'N+: gleichmässiger Zug in allen Stäben');
});

// ------------------------------------------------------------------ Bruchzustand

test('Biegewiderstand Rechteck 300×500, 3Ø20, C30/37, B500B – SIA 262 (εcu = 3 ‰)', () => {
  // Handrechnung Parabel-Rechteck: αR = 1 − εc2/(3εcu) = 7/9, Schwerpunktabstand ka·x mit
  // ka = 1 − (εcu²/2 − εc2²/12)/(εcu·(εcu − εc2/3)) = 0.40476
  // fcd = 30/1.5 = 20 MPa (ηfc = 1), fsd = 500/1.15 = 434.8 MPa, d = 450 mm
  // x = As·fsd/(αR·b·fcd) = 87.8 mm; MRd = As·fsd·(d − ka·x) = 169.8 kNm
  const ecu = 3, ec2 = 2;
  const aR = 1 - ec2 / (3 * ecu), ka = 1 - (ecu ** 2 / 2 - ec2 ** 2 / 12) / (ecu * (ecu - ec2 / 3));
  const As = 3 * A20, fsd = 500 / 1.15, fcd = 20, b = 300, d = 450;
  const x = As * fsd / (aR * b * fcd);
  const MRd = As * fsd * (d - ka * x) / 1e6;
  near(MRd, 169.84, 1e-3, 'Handrechnung');
  const p = rectProject(300, 500, [-100, 0, 100].map((y) => ({ y, z: 50, d: 20 })), { loads: [{ name: 'LF', type: 'GZT', N: 0, My: 100, Mz: 0 }] });
  const r = analyze(p);
  near(r.mrd.MyPos, MRd, 0.005, 'Fasermodell MRd');
  const c = r.cases[0];
  near(c.eta, 100 / MRd, 0.005, 'η');
  assert.ok(c.uls.MyR > 0, 'Widerstand in Richtung Zug unten');
  near(c.uls.rstate.ext.ecMin, -0.003, 1e-6, 'Bruchzustand: εc = −3 ‰');
  near(c.uls.rstate.x * 1000, x, 0.01, 'Druckzonenhöhe x');
  assert.match(c.uls.mode, /Beton/);
});

test('Biegewiderstand Rechteck 300×500, 3Ø20, C30/37, B500B – EN 1992-1-1 (εcu = 3.5 ‰)', () => {
  // αR = 1 − 2/(3·3.5) = 0.8095, ka = 0.4160; fcd = 1.0·30/1.5 = 20 MPa, fyd = 434.8 MPa
  // x = 84.4 mm; MRd = 409.8 kN · (450 − 0.416·84.4) mm = 170.0 kNm
  const ecu = 3.5, ec2 = 2;
  const aR = 1 - ec2 / (3 * ecu), ka = 1 - (ecu ** 2 / 2 - ec2 ** 2 / 12) / (ecu * (ecu - ec2 / 3));
  near(aR, 0.80952, 1e-4); near(ka, 0.41597, 1e-4);
  const As = 3 * A20, fsd = 500 / 1.15;
  const x = As * fsd / (aR * 300 * 20);
  const MRd = As * fsd * (450 - ka * x) / 1e6;
  near(MRd, 170.02, 1e-3, 'Handrechnung');
  const p = rectProject(300, 500, [-100, 0, 100].map((y) => ({ y, z: 50, d: 20 })), { material: { norm: 'EC' } });
  const r = analyze(p);
  near(r.mrd.MyPos, MRd, 0.005, 'Fasermodell MRd (EC)');
  // Gegenrichtung (Zug oben, keine obere Bewehrung): nur Betonzug = 0 → kleiner Widerstand aus Stahl als Druckglied
  assert.ok(Math.abs(r.mrd.MyNeg) < 0.2 * MRd);
});

test('Zentrischer Druck: NRd = (Ac − As)·fcd + As·Es·εc2 (Stahl bei 2 ‰ noch elastisch)', () => {
  // 300×500, 4Ø20 in den Ecken. SIA: Es·εc2 = 205000·0.002 = 410 MPa < fsd = 434.8 MPa
  const bars = [[-100, 50], [100, 50], [-100, 450], [100, 450]].map(([y, z]) => ({ y, z, d: 20 }));
  const As = 4 * A20;
  const NcHand = -((150000 - As) * 20 + As * 410) / 1000; // = −3490 kN
  const p = rectProject(300, 500, bars, { loads: [{ name: 'Druck', type: 'GZT', N: NcHand / 2, My: 0, Mz: 0 }] });
  const r = analyze(p);
  near(r.axial.Nc, NcHand, 1e-6, 'Nc SIA');
  near(r.cases[0].eta, 0.5, 1e-6, 'η = N/Nc');
  // Zentrischer Zug: Nt = As·fsd
  near(r.axial.Nt, As * 500 / 1.15 / 1000, 1e-6, 'Nt');
  // EC: Es = 200000 → 400 MPa
  const r2 = analyze({ ...p, material: { ...p.material, norm: 'EC' } });
  near(r2.axial.Nc, -((150000 - As) * 20 + As * 400) / 1000, 1e-6, 'Nc EC');
});

test('M-κ: Bruchmoment der M-κ-Linie = Biegewiderstand aus dem Interaktionsdiagramm', () => {
  const p = rectProject(300, 600, [...[-102, -34, 34, 102].map((y) => ({ y, z: 48, d: 20 })), { y: -105, z: 555, d: 14 }, { y: 105, z: 555, d: 14 }]);
  const r = analyze(p);
  for (const [N, th] of [[0, Math.PI / 2], [-1000, Math.PI / 2], [0, -Math.PI / 2]]) {
    const mk = mkCurve(r.secs.uls, N, th);
    const cap = rc.capacityAtN(r.secs.uls, th, N);
    const Mcap = Math.abs(cap.My);
    near(mk.ultimate.M, Mcap, 2e-3, `Mu (N=${N}, θ=${th.toFixed(2)})`);
    assert.ok(mk.yield && mk.yield.kappa < mk.ultimate.kappa, 'Fliessen vor Bruch');
    // monoton steigende Krümmung
    for (let i = 1; i < mk.points.length; i++) assert.ok(mk.points[i].kappa >= mk.points[i - 1].kappa);
  }
  // Mittelwerte mit Zugfestigkeit: Rissmoment ≈ fctm·W (+ Stahl), W = b·h²/6
  const mean = r.lazy.mk('mean', 0, Math.PI / 2);
  const Mcr = materialSet(p).c.fctm * 300 * 600 ** 2 / 6 / 1e6;
  assert.ok(mean.crack.M > Mcr && mean.crack.M < 1.15 * Mcr, `Rissmoment ${mean.crack.M} vs ${Mcr}`);
});

// ------------------------------------------------------------------ Gebrauchstauglichkeit

test('GZG gerissen elastisch: Rechteck 300×500, 3Ø20, n = 15, M = 100 kNm – Handrechnung', () => {
  // Druckzonenhöhe aus b·x²/2 = n·As·(d − x):  x = [−n·As + √((n·As)² + 2·b·n·As·d)]/b
  // σs = M/(As·(d − x/3)),  σc = 2M/(b·x·(d − x/3))
  const b = 300, d = 450, n = 15, As = 3 * A20, M = 100e6;
  const x = (-n * As + Math.sqrt((n * As) ** 2 + 2 * b * n * As * d)) / b; // ≈ 164.1 mm
  const sigS = M / (As * (d - x / 3));
  const sigC = 2 * M / (b * x * (d - x / 3));
  near(x, 164.1, 2e-3, 'x Handrechnung');
  const p = rectProject(300, 500, [-100, 0, 100].map((y) => ({ y, z: 50, d: 20 })), {
    calc: { nMode: 'manual', n: 15 },
    loads: [{ name: 'GZG', type: 'GZG', N: 0, My: 100, Mz: 0 }],
  });
  const r = analyze(p);
  const st = r.cases[0].slsState;
  assert.ok(st.ok);
  near(st.x * 1000, x, 0.01, 'x');
  near(st.sigmaSmax, sigS, 0.01, 'σs');
  near(-st.sigmaCmin, sigC, 0.01, 'σc');
  // Nachweis normaler Anforderungen: σs ≤ fsd
  const ch = r.cases[0].sls.checks[0];
  near(ch.Rd, 500 / 1.15, 1e-9);
  near(r.cases[0].eta, st.sigmaSmax / (500 / 1.15), 1e-9);
  // Stababstand der Zuglage: 100 mm
  near(tensionLayerSpacing(st), 100, 1e-6, 's');
});

test('Spannungsgrenzen: SIA Fig. 31 (Näherung) und EN 1992-1-1 7.2(5)', () => {
  const sia = materialSet({ material: { norm: 'SIA', concrete: 'C30/37', steel: 'B500B' } });
  near(steelStressLimit(sia, { req: 'erhoeht' }, 150).value, interpTable(SIA_FIG31.erhoeht, 150));
  near(steelStressLimit(sia, { req: 'hoch' }, 125).value, (270 + 230) / 2);
  near(steelStressLimit(sia, { req: 'hoch' }, 400).value, 160, 1e-12, 'konstant fortgesetzt');
  near(steelStressLimit(sia, { req: 'normal' }).value, 500 / 1.15);
  near(steelStressLimit(sia, { req: 'manual', sigmaAdm: 240 }).value, 240);
  const ec = materialSet({ material: { norm: 'EC', concrete: 'C30/37', steel: 'B500B' } });
  near(steelStressLimit(ec, {}).value, 400, 1e-12, '0.8·fyk');
});

// ------------------------------------------------------------------ Querkraft

test('Querkraft SIA 262 4.3.3: VRd,s und VRd,c nach Handrechnung', () => {
  const mat = materialSet({ material: { norm: 'SIA', concrete: 'C30/37', steel: 'B500B' } });
  const g = { bw: 300, d: 450, z: 405, Asl: 3 * A20, Ac: 150000 };
  const r = shearCheck(mat, g, { dw: 10, s: 150, legs: 2, angle: 30 }, 250, 0, 0.8);
  // VRd,s = (2·78.54/150)·405·434.78·cot30° = 319.3 kN
  const VRds = 2 * Math.PI * 25 / 150 * 405 * (500 / 1.15) / Math.tan(Math.PI / 6) / 1000;
  // VRd,c = 300·405·0.55·20·sin30°·cos30° = 578.7 kN
  const VRdc = 300 * 405 * 0.55 * 20 * 0.5 * Math.sqrt(3) / 2 / 1000;
  near(r.VRds, VRds, 1e-12); near(VRds, 319.3, 1e-3);
  near(r.VRdc, VRdc, 1e-12); near(VRdc, 578.7, 1e-3);
  near(r.eta, 250 / VRds, 1e-12);
  // ohne Querkraftbewehrung: kd = 1/(1 + εv·d·kg), εv = fsd/Es·mEd/mRd, kg = 48/(16 + Dmax)
  const r0 = shearCheck(mat, g, { dw: 0, s: 0, legs: 0, Dmax: 32, epsMode: 'elastic' }, 100, 0, 0.8);
  const epsv = 434.7826 / 205000 * 0.8;
  const kd = 1 / (1 + epsv * 450 * 1);
  near(r0.kd, kd, 1e-5);
  near(r0.VRd, kd * 0.3 * Math.sqrt(30) / 1.5 * 450 * 300 / 1000, 1e-5);
});

test('Querkraft EN 1992-1-1 6.2: VRd,c, VRd,s und VRd,max nach Handrechnung', () => {
  const mat = materialSet({ material: { norm: 'EC', concrete: 'C30/37', steel: 'B500B' } });
  const g = { bw: 300, d: 450, z: 405, Asl: 3 * A20, Ac: 150000 };
  const r0 = shearCheck(mat, g, { dw: 0, s: 0, legs: 0 }, 100, 0);
  const k = 1 + Math.sqrt(200 / 450), rho = 3 * A20 / (300 * 450);
  const VRdc = Math.max(0.12 * k * Math.cbrt(100 * rho * 30), 0.035 * k ** 1.5 * Math.sqrt(30)) * 300 * 450 / 1000;
  near(r0.VRdc, VRdc, 1e-12, 'VRd,c');
  const r = shearCheck(mat, g, { dw: 10, s: 150, legs: 2, angle: 30 }, 250, 0);
  const cot = 1 / Math.tan(Math.PI / 6);
  near(r.VRds, 2 * Math.PI * 25 / 150 * 405 * (500 / 1.15) * cot / 1000, 1e-12, 'VRd,s');
  near(r.VRdmax, 300 * 405 * 0.6 * (1 - 30 / 250) * 20 / (cot + 1 / cot) / 1000, 1e-12, 'VRd,max');
});

// ------------------------------------------------------------------ Bewehrungsgeneratoren & Netz

test('Bewehrungsgeneratoren', () => {
  const s = defaultShapes(); // Rechteck 300×600
  const geom = projectGeometry({ shape: s, openings: [], bars: [] });
  const bars = barsLayers(geom, { nBot: 4, dBot: 20, nTop: 2, dTop: 14, c: 30, dw: 8 });
  // a = 30 + 8 + 10 = 48 → unten z = 48, y = −102 … 102; oben a = 45 → z = 555, y = ±105
  assert.equal(bars.length, 6);
  near(bars[0].z, 48); near(bars[0].y, -102); near(bars[3].y, 102); near(bars[1].y, -34);
  near(bars[4].z, 555); near(bars[4].y, -105); near(bars[5].y, 105);
  const ring = barsCircle(0, 0, 190, 10, 20, 90);
  assert.equal(ring.length, 10);
  for (const b of ring) near(Math.hypot(b.y, b.z), 190, 1e-3);
  const row = barsRow(0, 0, 300, 0, 4, 16);
  assert.deepEqual(row.map((b) => b.y), [0, 100, 200, 300]);
  const per = barsPerimeter(geom, { c: 30, dw: 10, d: 20, s: 200 });
  // Rechteck a = 50: Ecken (−100/50), (100/50), (100/550), (−100/550); Seiten 200 bzw. 500 mm → 1 + 3 Felder
  assert.equal(per.length, 2 * (1 + 3));
  assert.ok(per.some((b) => b.y === -100 && b.z === 50));
  const circ = barsCircular({ type: 'ring', ring: { D: 1000, t: 200 } }, { n: 12, d: 16, nInner: 8, c: 30, dw: 10 });
  assert.equal(circ.length, 20);
  near(Math.hypot(circ[0].y, circ[0].z), 500 - 48, 1e-3);
  near(Math.hypot(circ[12].y, circ[12].z), 300 + 48, 1e-3);
  // Offset-Polygon eines Quadrats
  const off = offsetPolygon([[0, 0], [100, 0], [100, 100], [0, 100]], 10);
  near(polygonProps(off).A, 80 * 80);
  near(chordWidth(geom.outer, geom.holes, 100), 300);
});

test('Fasernetz: 1500 … 3000 Fasern für alle Vorlagen', () => {
  const s = defaultShapes();
  for (const t of ['rect', 'T', 'I', 'box', 'circle', 'ring', 'L']) {
    const g = templatePolygons(t, s[t]);
    const regions = [{ pts: g.outer.map(([y, z]) => [y / 1000, z / 1000]) }, ...g.holes.map((h) => ({ pts: h.map(([y, z]) => [y / 1000, z / 1000]) }))];
    const mesh = chooseMesh(regions);
    const sec = rc.buildSection({ regions: regions.map((r, k) => ({ ...r, hole: k > 0, law: { sigma: () => 0, tangent: () => 0, epsMin: -1 } })), mesh });
    assert.ok(sec.nFibers >= 1200 && sec.nFibers <= 3500, `${t}: ${sec.nFibers} Fasern`);
  }
});

test('Gesamtberechnung: Cache liefert identische Resultate, Fehler verständlich', () => {
  const p = rectProject(300, 600, [...[-102, -34, 34, 102].map((y) => ({ y, z: 48, d: 20 }))], {
    loads: [{ name: 'LF1', type: 'GZT', N: -200, My: 150, Mz: 20, V: 120 }, { name: 'LF2', type: 'GZG', N: 0, My: 90, Mz: 0 }],
    shear: { active: true, dw: 8, s: 200, legs: 2, angle: 30, side: 'unten' },
  });
  const cache = createCache();
  const a = analyze(p, cache), b = analyze(p, cache);
  near(a.cases[0].eta, b.cases[0].eta, 1e-15);
  assert.ok(a.cases[0].shear.VRd > 0);
  near(a.shearGeo.d, 600 - 48, 1e-12, 'd automatisch');
  near(a.shearGeo.bw, 300, 1e-12, 'bw automatisch');
  assert.ok(Number.isFinite(a.etaMax) && a.etaMax > 0);
  const bad = rectProject(-300, 600, []);
  assert.throws(() => analyze(bad), /positiv/);
  void concrete; void rebar;
});

test('Bezugspunkt: Ausnutzung und Zustand unabhängig vom Bezugspunkt (statisch gleichwertige Lasten)', () => {
  // Rechteck 300×500 (Schwerpunkt z = 250), Ursprung an der Unterkante: N im Ursprung entspricht
  // N im Schwerpunkt mit My = N·(zR − zG)·(−1)… in Benutzerkonvention: My,G = My,R − N·(zR − zG) = 0 − N·(−0.25 m)
  const bars = [...[-100, 0, 100].map((y) => ({ y, z: 50, d: 16 })), { y: -100, z: 450, d: 12 }, { y: 100, z: 450, d: 12 }];
  for (const N of [-300, -1000]) {
    const pR = rectProject(300, 500, bars, { calc: { ref: 'origin' }, loads: [{ name: 'R', type: 'GZT', N, My: 0, Mz: 0 }] });
    const pG = rectProject(300, 500, bars, { calc: { ref: 'gross' }, loads: [{ name: 'G', type: 'GZT', N, My: N * 0.25, Mz: 0 }] });
    const cR = analyze(pR).cases[0], cG = analyze(pG).cases[0];
    near(cR.eta, cG.eta, 1e-9, `η bei N = ${N}`);
    // Widerstand um R = Widerstand um G + N·(zR − zG)
    near(cR.uls.MyR, cG.uls.MyR + N * -0.25, 1e-6, 'MRd,y um R');
    if (cR.ulsState.ok) {
      near(cR.ulsState.My, 0, 1e-6, 'Rückrechnung My um R');
      near(cR.ulsState.eRef, cG.ulsState.e0 + cG.ulsState.kz * -0.25, 1e-9, 'Dehnung im Ursprung');
    }
  }
  // Exzentrische Druckkraft an der Unterkante ist nicht aufnehmbar (zu wenig obere Bewehrung): η > 1
  const pR = rectProject(300, 500, bars, { calc: { ref: 'origin' }, loads: [{ name: 'R', type: 'GZT', N: -1000, My: 0, Mz: 0 }] });
  assert.ok(analyze(pR).cases[0].eta > 1);
});

// ------------------------------------------------------------------ Leeres Projekt, Editor-Operationen, Herleitung

test('Leeres Projekt: geführter Ablauf Querschnitt → Bewehrung → Lastfall', () => {
  const p = defaultProject();
  assert.equal(hasOutline(p), false);
  assert.equal(p.bars.length, 0);
  assert.equal(p.loads.length, 0);
  assert.match(missingInput(p).msg, /Querschnitt/);
  assert.match(missingInput(p).hint, /Rechteck/);
  const r = createOutline(p, [[-150, 0], [150, 0], [150, 500], [-150, 500]]);
  assert.equal(r.replaced, false);
  assert.match(missingInput(p).msg, /Bewehrung/);
  addBars(p, groupBars({ kind: 'row', a: [-100, 50], b: [100, 50], n: 3, d: 20 }));
  assert.match(missingInput(p).msg, /Lastfall/);
  p.loads.push({ name: 'LF 1', type: 'GZT', N: 0, My: 100, Mz: 0 });
  assert.equal(missingInput(p), null);
  const R = analyze(p);
  near(R.grossMm.A, 150000, 1e-12, 'A');
  assert.ok(R.cases[0].eta > 0.3 && R.cases[0].eta < 1);
  // Alle Beispiele sind vollständig
  for (const ex of EXAMPLES) assert.equal(missingInput(ex.project()), null, ex.name);
});

test('Editor: Rechteck wird Vorlage, sonst Polygon; Selbstüberschneidung abgelehnt', () => {
  const p = defaultProject();
  createOutline(p, [[-200, 0], [200, 0], [200, 700], [-200, 700]]);
  assert.equal(p.shape.type, 'rect');
  assert.deepEqual(p.shape.rect, { b: 400, h: 700 });
  const r = createOutline(p, [[0, 0], [0, 300], [200, 300], [200, 0]]); // im Uhrzeigersinn, nicht zentriert
  assert.equal(r.replaced, true);
  assert.equal(p.shape.type, 'poly');
  assert.ok(signedArea(p.shape.poly.map((q) => [q.y, q.z])) > 0, 'Gegenuhrzeigersinn');
  assert.throws(() => createOutline(p, [[0, 0], [200, 100], [200, 0], [0, 150]]), /schneidet sich selbst/);
  assert.throws(() => createOutline(p, [[0, 0], [100, 0], [200, 0]]), /keine Fläche/);
});

test('Editor: Ziehen eines Vorlagen-Eckpunkts wandelt in «Polygon frei» um', () => {
  const p = defaultProject();
  p.shape.type = 'T';
  p.shape.T = { b: 1200, hf: 200, bw: 300, h: 800 };
  const eo = editableOutline(p);
  assert.equal(eo.template, true);
  assert.equal(eo.outer.length, 8);
  const before = eo.outer.map((q) => q.slice());
  assert.equal(touchesTemplate(p, ['v:2']), true);
  assert.equal(touchesTemplate(p, ['b:0']), false);
  const r = moveSelection(p, ['v:2'], [0, 50]);
  assert.equal(r.converted, 'Plattenbalken');
  assert.equal(p.shape.type, 'poly');
  const after = p.shape.poly.map((q) => [q.y, q.z]);
  before.forEach((q, i) => {
    near(after[i][0], q[0], 1e-12, `y${i}`);
    near(after[i][1], q[1] + (i === 2 ? 50 : 0), 1e-12, `z${i}`);
  });
  // Hohlkasten: Hohlraum der Vorlage zuerst, danach eigene Aussparungen
  const b = defaultProject();
  b.shape.type = 'box';
  const k = addOpening(b, [[-100, 800], [100, 800], [100, 900], [-100, 900]]);
  assert.equal(k, 1, 'eigene Aussparung nach dem Hohlraum der Vorlage');
  moveSelection(b, ['o:1'], [10, 0]);
  assert.equal(b.shape.type, 'box', 'eigene Aussparung verschieben wandelt nicht um');
  near(b.openings[0].pts[0].y, -90, 1e-12);
  moveSelection(b, ['ov:0:0'], [0, -20]);
  assert.equal(b.shape.type, 'poly');
  assert.equal(b.openings.length, 2);
  assert.equal(b.openings[0].fromTemplate, true);
  assert.equal(b.openings[1].pts[0].y, -90, 'eigene Aussparung bleibt erhalten');
});

test('Editor: Kopieren, Löschen und Eckpunkt einfügen', () => {
  const p = defaultProject();
  createOutline(p, [[0, 0], [400, 0], [400, 600], [0, 600]]);
  addBars(p, [{ y: 50, z: 50, d: 16 }, { y: 350, z: 50, d: 16 }]);
  const c = moveSelection(p, ['b:0', 'b:1'], [0, 500], true);
  assert.deepEqual(c.ids, ['b:2', 'b:3']);
  assert.equal(p.bars[3].z, 550);
  assert.equal(p.bars.length, 4);
  removeSelection(p, ['b:0', 'b:2']);
  assert.deepEqual(p.bars.map((b) => [b.y, b.z]), [[350, 50], [350, 550]]);
  const ins = insertVertex(p, 'e:0');
  assert.equal(ins.id, 'v:1');
  assert.deepEqual(p.shape.poly[1], { y: 200, z: 0 });
  setVertex(p, 'v:1', 200, -100);
  assert.equal(p.shape.poly.length, 5);
  near(analyze({ ...p, loads: [] }).grossMm.A, 400 * 600 + 400 * 100 / 2, 1e-12, 'Fläche mit Spitze');
  // Eckpunkte löschen bis unter 3 → Umriss weg, Bewehrung bleibt
  removeSelection(p, ['v:0', 'v:1', 'v:2']);
  assert.equal(hasOutline(p), false);
  assert.equal(p.bars.length, 2);
  createOutline(p, [[0, 0], [400, 0], [400, 600], [0, 600]]);
  addOpening(p, [[100, 200], [300, 200], [300, 400], [100, 400]]);
  const res = removeSelection(p, ['c']);
  assert.equal(res.outline, true);
  assert.equal(p.openings.length, 0);
  assert.equal(p.bars.length, 2);
});

test('Editor: Stabgruppen und Hüllrohr', () => {
  const row = groupBars({ kind: 'row', a: [-120, 46], b: [120, 46], n: 4, d: 20 });
  assert.deepEqual(row.map((b) => b.y), [-120, -40, 40, 120]);
  const circ = groupBars({ kind: 'circle', a: [0, 0], b: [0, 200], n: 8, d: 16 });
  assert.equal(circ.length, 8);
  near(circ[0].y, 0, 1e-9); near(circ[0].z, 200, 1e-9, 'erster Stab am zweiten Punkt');
  near(circ[2].y, -200, 1e-9, 'Gegenuhrzeigersinn');
  assert.equal(rowCount(240), 3);
  assert.equal(circleCount(200), 8);
  const p = defaultProject();
  createOutline(p, [[-300, 0], [300, 0], [300, 800], [-300, 800]]);
  const k = addDuct(p, [0, 400], 120);
  const A = (o) => Math.abs(signedArea(o.pts.map((q) => [q.y, q.z])));
  near(A(p.openings[0]), Math.PI * 60 * 60, 2e-3, 'flächengleiches 32-Eck');
  setDuct(p, k, { D: 200 });
  near(A(p.openings[0]), Math.PI * 100 * 100, 2e-3);
  assert.equal(p.openings[0].name, 'Hüllrohr Ø200');
  moveSelection(p, [`o:${k}`], [50, 0]);
  assert.equal(p.openings[0].circle.y, 50, 'Mittelpunkt wandert mit');
  moveSelection(p, [`ov:${k}:0`], [5, 0]);
  assert.equal(p.openings[0].circle, undefined, 'einzelner Eckpunkt → freie Aussparung');
});

test('Herleitung: innere Kräfte im Bruchzustand ergeben N und MRd (Rechteck 300×500, 3Ø20)', () => {
  const bars = [-100, 0, 100].map((y) => ({ y, z: 50, d: 20 }));
  for (const N of [0, -400]) {
    const p = rectProject(300, 500, bars, { loads: [{ name: 'LF', type: 'GZT', N, My: 100, Mz: 0 }] });
    const R = analyze(p);
    const u = R.cases[0].uls;
    const fr = forceResultants(R.secs.uls, u.rstate);
    near(fr.N, N, 1e-3, 'Gleichgewicht N (Bisektion)');
    near(fr.My, u.MyR, 2e-3, 'MRd aus den inneren Kräften');
    near(fr.Fst, 3 * A20 * 500 / 1.15 / 1000, 1e-9, 'Stahl fliesst: Fs = As·fsd');
    near(fr.pst[1], 0.05, 1e-9, 'Angriffspunkt der Zugkraft');
    if (N === 0) near(fr.My, fr.Fst * fr.lever, 1e-6, 'M = Fs·z bei N = 0');
  }
});

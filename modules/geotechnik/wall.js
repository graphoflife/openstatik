// Winkelstützmauer (Stahlbeton-Winkelstützmauer je Laufmeter): Erddruck auf die lotrechte Ersatzwand
// durch das Fersenende, Gleiten, Ausmittigkeit (Kippen), Grundbruch und Schnittkräfte (DOM-frei).
//
// Koordinaten: x = 0 an der Vorderkante des Fundaments (Zehe), y = 0 in der Fundamentsohle.
// Bodenschichten: Tiefe z ab Hinterfüllungsoberkante an der Mauerrückseite (y = H = d + h_s).
// Kräfte je m; Moment um die Zehe positiv im Gegenuhrzeigersinn (kippend).
import { makeSoil, verticalStress, layerAt, designParams, rad } from './soil.js';
import { earthPressureProfile, passiveCurved } from './earthpressure.js';
import { evalFooting, eccentricityRatios } from './bearing.js';

/** Geometrie aus den Eingaben ableiten und prüfen. */
export function wallGeometry(rw) {
  const g = {
    hs: +rw.hs, tTop: +rw.tTop, tBot: +rw.tBot, toe: +rw.toe, heel: +rw.heel, d: +rw.d,
    Df: Math.max(0, +rw.Df || 0), beta: +rw.beta || 0,
    key: rw.key?.on ? { depth: Math.max(0, +rw.key.depth || 0), width: Math.max(0, +rw.key.width || 0), x: +rw.key.x || 0 } : null,
  };
  const bad = (m) => { throw new Error(m); };
  if (!(g.hs > 0)) bad('Die Wandhöhe h_s muss grösser als 0 sein.');
  if (!(g.d > 0)) bad('Die Fundamentdicke d muss grösser als 0 sein.');
  if (!(g.tTop > 0) || !(g.tBot > 0)) bad('Die Wanddicken oben und unten müssen grösser als 0 sein.');
  if (g.tTop > g.tBot + 1e-9) bad('Die Wanddicke oben darf nicht grösser sein als unten (Anzug auf der Luftseite).');
  if (g.toe < 0 || g.heel < 0) bad('Sporn- bzw. Fersenlänge dürfen nicht negativ sein.');
  if (Math.abs(g.beta) >= 45) bad('Die Geländeneigung β hinter der Mauer muss zwischen −45° und 45° liegen.');
  g.B = g.toe + g.tBot + g.heel;
  g.H = g.d + g.hs;
  g.xb = g.toe + g.tBot; // Rückseite der Wand
  if (g.Df > g.H) bad('Die Einbindetiefe vorne D_f darf nicht grösser als die Mauerhöhe sein.');
  if (g.key) {
    if (g.key.width <= 0 || g.key.depth <= 0) g.key = null;
    else g.key.x = Math.min(Math.max(0, g.key.x), g.B - g.key.width);
  }
  g.ySurfB = g.H + g.heel * Math.tan(rad(g.beta)); // Gelände über dem Fersenende
  return g;
}

function polyArea(P) {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length];
    const cr = x1 * y2 - x2 * y1;
    A += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr;
  }
  A /= 2;
  return { A: Math.abs(A), x: cx / (6 * A), y: cy / (6 * A) };
}

/**
 * Vollständige Mauerberechnung.
 * rw: {hs, tTop, tBot, toe, heel, d, Df, beta, q, method:'rankine'|'coulomb', water, gammaC, key:{on,depth,width,x},
 *      interface, drainage}
 */
export function wallAnalysis(soilIn, rw, norm) {
  const g = wallGeometry(rw);
  const gc = Number(rw.gammaC) || 25;
  const soilAll = makeSoil(soilIn);
  const soil = makeSoil(soilIn, { ignoreWater: !rw.water });
  const warnings = [];
  if (!rw.water && soilAll.zw < g.H) warnings.push('Grundwasser liegt über der Fundamentsohle, Wasserdruck ist aber ausgeschaltet. «Wasserdruck» aktivieren oder eine wirksame Drainage nachweisen.');
  const q = Math.max(0, Number(rw.q) || 0);
  const deltaMode = rw.method === 'coulomb' ? 'ratio' : 'beta';
  const zSurfB = g.H - g.ySurfB; // Tiefe des Geländes über dem Fersenende (≤ 0)

  // ---------------------------------------------------------------- Erddruck auf die Ersatzwand
  const ep = earthPressureProfile({ soil, zTop: zSurfB, zBot: g.H, alpha: 0, beta: g.beta, kind: 'active', deltaMode, q, water: !!rw.water });
  warnings.push(...ep.warnings);
  const yOf = (z) => g.H - z;

  // ---------------------------------------------------------------- Eigengewichte
  const forces = []; // {name, kind:'G'|'Qe'|'Qv', Fx, Fy (nach oben +), x, y}
  const stem = polyArea([[g.toe, g.d], [g.xb, g.d], [g.xb, g.H], [g.xb - g.tTop, g.H]]);
  forces.push({ name: 'Wand', kind: 'G', Fx: 0, Fy: -gc * stem.A, x: stem.x, y: stem.y });
  forces.push({ name: 'Fundamentplatte', kind: 'G', Fx: 0, Fy: -gc * g.B * g.d, x: g.B / 2, y: g.d / 2 });
  if (g.key) forces.push({ name: 'Sporn', kind: 'G', Fx: 0, Fy: -gc * g.key.width * g.key.depth, x: g.key.x + g.key.width / 2, y: -g.key.depth / 2 });
  // Boden über der Ferse (Streifenintegration, totale Spannungen)
  if (g.heel > 0) {
    const n = 24, dx = g.heel / n;
    let W = 0, Mx = 0, My = 0;
    for (let k = 0; k < n; k++) {
      const x = g.xb + (k + 0.5) * dx;
      const ys = g.H + (x - g.xb) * Math.tan(rad(g.beta));
      const w = verticalStress(soil, g.H - g.d, g.H - ys, 0).sv * dx;
      W += w; Mx += w * x; My += w * (g.d + ys) / 2;
    }
    if (W > 0) forces.push({ name: 'Boden über Ferse', kind: 'G', Fx: 0, Fy: -W, x: Mx / W, y: My / W });
  }
  // Boden über der Zehe
  if (g.Df > g.d && g.toe > 0) {
    const w = verticalStress(soil, g.H - g.d, g.H - g.Df, 0).sv * g.toe;
    forces.push({ name: 'Boden über Zehe', kind: 'G', Fx: 0, Fy: -w, x: g.toe / 2, y: (g.d + g.Df) / 2 });
  }
  // Auflast auf der Ferse (veränderlich, vertikal)
  if (q > 0 && g.heel > 0) forces.push({ name: 'Auflast q auf Ferse', kind: 'Qv', Fx: 0, Fy: -q * g.heel, x: g.xb + g.heel / 2, y: g.ySurfB });
  // Erddruck
  if (ep.EhG > 0) forces.push({ name: 'Erddruck E_ah,G', kind: 'G', Fx: -ep.EhG, Fy: 0, x: g.B, y: yOf(ep.zEG) });
  if (ep.EvG > 0) forces.push({ name: 'Erddruck E_av,G', kind: 'G', Fx: 0, Fy: -ep.EvG, x: g.B, y: yOf(ep.zEG) });
  if (ep.EhQ > 0) forces.push({ name: 'Erddruck E_ah,Q', kind: 'Qe', Fx: -ep.EhQ, Fy: 0, x: g.B, y: yOf(ep.zEQ) });
  if (ep.EvQ > 0) forces.push({ name: 'Erddruck E_av,Q', kind: 'Qe', Fx: 0, Fy: -ep.EvQ, x: g.B, y: yOf(ep.zEQ) });
  // Wasser
  let water = null;
  if (rw.water && soil.zw < g.H) {
    const gw = soil.gammaW;
    const yw = g.H - soil.zw;
    const ywf = Math.min(yw, g.Df);
    const uHeel = gw * yw, uToe = gw * Math.max(0, ywf);
    if (ep.U > 0) forces.push({ name: 'Wasserdruck hinten', kind: 'G', Fx: -ep.U, Fy: 0, x: g.B, y: yOf(ep.zU) });
    if (ywf > 0) forces.push({ name: 'Wasserdruck vorne', kind: 'G', Fx: 0.5 * gw * ywf * ywf, Fy: 0, x: 0, y: ywf / 3 });
    const Uup = (uToe + uHeel) / 2 * g.B;
    const xU = (uToe + uHeel) > 0 ? g.B * (uToe + 2 * uHeel) / (3 * (uToe + uHeel)) : g.B / 2;
    if (Uup > 0) forces.push({ name: 'Sohlwasserdruck', kind: 'G', Fx: 0, Fy: Uup, x: xU, y: 0 });
    water = { yw, ywf, uHeel, uToe, U: Uup };
  }

  // ---------------------------------------------------------------- Resultierende
  const resultant = (fG, fQe, fQv) => {
    let N = 0, Hh = 0, M = 0;
    for (const f of forces) {
      const k = f.kind === 'G' ? fG : f.kind === 'Qe' ? fQe : fQv;
      if (!k) continue;
      N += -f.Fy * k; Hh += -f.Fx * k;
      M += (f.x * f.Fy - f.y * f.Fx) * k;
    }
    const xR = N > 0 ? -M / N : NaN;
    return { fG, fQe, fQv, N, H: Hh, M, xR, e: g.B / 2 - xR };
  };
  const charG = resultant(1, 0, 0);
  const charAll = resultant(1, 1, 1);

  // Stabilität gegen Kippen um die Zehe (Information): M_stb / M_dst
  let Mstb = 0, Mdst = 0;
  for (const f of forces) {
    const m = f.x * f.Fy - f.y * f.Fx;
    if (f.kind === 'Qv') continue;
    if (m > 0) Mdst += m; else Mstb -= m;
  }

  // ---------------------------------------------------------------- Kombinationen, Grundbruch
  const applyM = norm.geoMode === 'M';
  const combos = [];
  for (const fG of [norm.gG, norm.gGinf]) for (const [fQe, fQv] of [[norm.gQ, norm.gQ], [norm.gQ, 0], [0, 0]]) {
    const key = `${fG}|${fQe}|${fQv}`;
    if (!combos.some((c) => c.key === key)) combos.push({ key, ...resultant(fG, fQe, fQv) });
  }
  const geo = { shape: 'strip', B: g.B, L: 1, D: g.H, alphaBase: 0, drainage: rw.drainage || 'drained', zFront: g.H - g.Df };
  const bearing = combos.map((c) => {
    if (!(c.N > 0)) return { combo: c, eta: Infinity, error: 'Abheben (N ≤ 0)' };
    try {
      return { combo: c, ...evalFooting(soilAll, norm, geo, { V: c.N, HB: c.H, HL: 0, MB: c.N * c.e, ML: 0 }, applyM) };
    } catch (e) { return { combo: c, eta: Infinity, error: e.message }; }
  });
  let govB = bearing[0];
  for (const b of bearing) if (b.eta > govB.eta) govB = b;

  // ---------------------------------------------------------------- Gleiten
  const baseL = layerAt(soilAll.layers, g.H + 1e-6);
  const bp = designParams(baseL, norm, applyM);
  const tanD = (rw.interface === 'precast' ? 2 / 3 : 1) * Math.tan(rad(bp.phi));
  const NGfav = norm.gGinf * charG.N;
  // Erdwiderstand vor dem Sporn (nur Spornhöhe), abgemindert mit γ_R,e
  let Ep = 0;
  if (g.key) {
    const Lk = layerAt(soilAll.layers, g.H + g.key.depth / 2);
    const pk = designParams(Lk, norm, applyM);
    const Kp = passiveCurved({ phi: pk.phi, delta: 0 });
    const n = 20, dz = g.key.depth / n;
    for (let k = 0; k < n; k++) {
      const z = g.H + (k + 0.5) * dz;
      const sv = verticalStress(soilAll, z, g.H - g.Df, 0).svp;
      Ep += (Kp.Kpgh * sv + Kp.Kpch * pk.c) * dz;
    }
  }
  const sliding = [];
  for (const fQe of [norm.gQ, 0]) {
    const c = resultant(norm.gG, fQe, 0);
    const items = [];
    if ((rw.drainage || 'drained') !== 'undrained') items.push({ type: 'drainiert', Rk: Math.max(0, NGfav) * tanD });
    if ((rw.drainage || 'drained') !== 'drained' && bp.cu > 0) {
      const Bp = Math.max(0, g.B - 2 * Math.abs(c.e));
      items.push({ type: 'undrainiert', Rk: Bp * bp.cu });
    }
    let gv = items[0];
    for (const it of items) if (it.Rk < gv.Rk) gv = it;
    const Rd = (gv?.Rk ?? 0) / norm.gRh + Ep / norm.gRe;
    sliding.push({ fQe, Hd: c.H, NGfav, type: gv?.type ?? '–', Rk: gv?.Rk ?? 0, Ep, Rd, eta: c.H <= 1e-9 ? 0 : Rd > 0 ? c.H / Rd : Infinity });
  }
  let govS = sliding[0];
  for (const s of sliding) if (s.eta > govS.eta) govS = s;

  // ---------------------------------------------------------------- Ausmittigkeit
  const eccPerm = eccentricityRatios({ shape: 'strip', B: g.B, eB: charG.e });
  let eccDesign = null;
  for (const c of combos) {
    if (!(c.N > 0)) continue;
    const r = eccentricityRatios({ shape: 'strip', B: g.B, eB: c.e });
    if (!eccDesign || r.gap > eccDesign.gap) eccDesign = { ...r, combo: c };
  }

  // ---------------------------------------------------------------- Sohldruck (linear)
  const basePressure = (c) => {
    const N = c.N, e = c.e, B = g.B;
    if (!(N > 0)) return { pts: [], max: 0, min: 0 };
    const xR = B / 2 - e;
    if (Math.abs(e) <= B / 6) {
      const s1 = N / B * (1 + 6 * e / B), s2 = N / B * (1 - 6 * e / B); // s1 an der Zehe (x=0)
      return { pts: [[0, s1], [B, s2]], max: Math.max(s1, s2), min: Math.min(s1, s2), gap: 0 };
    }
    const c3 = 3 * Math.min(xR, B - xR);
    const smax = 2 * N / c3;
    return xR <= B / 2
      ? { pts: [[0, smax], [c3, 0], [B, 0]], max: smax, min: 0, gap: B - c3 }
      : { pts: [[0, 0], [B - c3, 0], [B, smax]], max: smax, min: 0, gap: B - c3 };
  };
  const cA = resultant(norm.gG, norm.gQ, norm.gQ);
  const sigChar = basePressure(charAll);
  const sigDesign = basePressure(cA);

  // ---------------------------------------------------------------- Schnittkräfte Wand (Einspannung)
  const stemEp = earthPressureProfile({ soil, zTop: 0, zBot: g.hs, alpha: 0, beta: g.beta, kind: 'active', deltaMode, q, water: !!rw.water });
  const sec = stemSections(stemEp, g.hs, norm);

  // ---------------------------------------------------------------- Fundamentplatte (Zehe/Ferse)
  const slab = slabForces(g, cA, sigDesign, soil, q, norm, ep, water, gc);

  const checks = {
    sliding: govS, bearing: govB, eccPerm, eccDesign,
  };
  const etaMax = Math.max(govS.eta, govB.eta, eccPerm.kern, eccDesign?.gap ?? 0);
  return {
    g, ep, stemEp, forces, charG, charAll, combos, bearing, govB, sliding, govS, eccPerm, eccDesign,
    sigChar, sigDesign, cA, sec, slab, water, warnings, Mstb, Mdst, Fkipp: Mdst > 0 ? Mstb / Mdst : Infinity,
    checks, etaMax, tanD, baseLayer: baseL.name, Ep, applyM,
  };
}

/** Biegemoment und Querkraft in der Wand über die Höhe (je m), charakteristisch und Bemessung. */
function stemSections(ep, hs, norm) {
  const pts = ep.pts;
  const rows = [];
  const nS = 20;
  for (let k = 0; k <= nS; k++) {
    const s = hs * k / nS; // Tiefe unter Wandkopf
    let VG = 0, VQ = 0, VW = 0, MG = 0, MQ = 0, MW = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i], B = pts[i + 1];
      if (A.z >= s) break;
      const zb = Math.min(B.z, s), dz = zb - A.z;
      if (dz <= 0) continue;
      const f = (B.z - A.z) > 0 ? (zb - A.z) / (B.z - A.z) : 0;
      const lin = (a, b) => [a, a + (b - a) * f];
      for (const [key, set] of [['ehG', 'G'], ['ehQ', 'Q'], ['u', 'W']]) {
        const [ea, eb] = lin(A[key], B[key]);
        const V = (ea + eb) / 2 * dz;
        const zc = V > 0 ? A.z + dz * (ea + 2 * eb) / (3 * (ea + eb)) : A.z;
        const M = V * (s - zc);
        if (set === 'G') { VG += V; MG += M; } else if (set === 'Q') { VQ += V; MQ += M; } else { VW += V; MW += M; }
      }
    }
    rows.push({
      s, VG, VQ, VW, MG, MQ, MW,
      Vk: VG + VQ + VW, Mk: MG + MQ + MW,
      Vd: norm.gG * (VG + VW) + norm.gQ * VQ, Md: norm.gG * (MG + MW) + norm.gQ * MQ,
    });
  }
  return { rows, base: rows[rows.length - 1] };
}

/** Momente und Querkräfte der Fundamentplatte an den Wandflächen (Bemessung, Kombination γ_G, γ_Q). */
function slabForces(g, cA, sig, soil, q, norm, ep, water, gc) {
  if (!(cA.N > 0)) return null;
  const sigma = (x) => {
    const p = sig.pts;
    for (let i = 0; i < p.length - 1; i++) if (x >= p[i][0] - 1e-9 && x <= p[i + 1][0] + 1e-9) {
      const t = (x - p[i][0]) / Math.max(1e-12, p[i + 1][0] - p[i][0]);
      return p[i][1] + t * (p[i + 1][1] - p[i][1]);
    }
    return 0;
  };
  const uplift = (x) => (water ? water.uToe + (water.uHeel - water.uToe) * x / g.B : 0);
  const soilAbove = (x) => {
    if (x <= g.toe) return g.Df > g.d ? verticalStress(soil, g.H - g.d, g.H - g.Df, 0).sv : 0;
    if (x >= g.xb) { const ys = g.H + (x - g.xb) * Math.tan(rad(g.beta)); return verticalStress(soil, g.H - g.d, g.H - ys, 0).sv; }
    return 0;
  };
  const n = 40;
  // Zehe: Kragarm von x = 0 bis x = toe, Schnitt an der Wandvorderseite
  let Mt = 0, Vt = 0;
  if (g.toe > 0) {
    const dx = g.toe / n;
    for (let k = 0; k < n; k++) {
      const x = (k + 0.5) * dx;
      const down = norm.gG * (gc * g.d + soilAbove(x) - uplift(x));
      const net = sigma(x) - down; // nach oben positiv
      Vt += net * dx; Mt += net * dx * (g.toe - x);
    }
  }
  // Ferse: von x = xb bis B, Schnitt an der Wandrückseite
  let Mh = 0, Vh = 0;
  if (g.heel > 0) {
    const dx = g.heel / n;
    for (let k = 0; k < n; k++) {
      const x = g.xb + (k + 0.5) * dx;
      const down = norm.gG * (gc * g.d + soilAbove(x) - uplift(x)) + norm.gQ * q;
      const net = down - sigma(x); // nach unten positiv
      Vh += net * dx; Mh += net * dx * (x - g.xb);
    }
    const Ev = norm.gG * ep.EvG + norm.gQ * ep.EvQ;
    Vh += Ev; Mh += Ev * g.heel;
  }
  return { toe: { M: Mt, V: Vt }, heel: { M: Mh, V: Vh } };
}

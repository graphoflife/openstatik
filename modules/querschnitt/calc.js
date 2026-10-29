// Querschnitt – Rechenkern (DOM-frei, in Node testbar)
//
// Einheiten im Kern: Geometrie m, Kräfte kN, Momente kNm, Spannungen MPa, Dehnungen dimensionslos.
// Eingabe/Ausgabe für die Oberfläche: Abmessungen und Stabkoordinaten in mm.
//
// Vorzeichen (Benutzer):  N > 0 Zug;  My > 0 → Zug unten (z < 0);  Mz > 0 → Zug rechts (y > 0).
// Vorzeichen (Kern, rcsection.js): My_core = ∫σ·z dA (positiv → Zug oben), Mz_core = −∫σ·y dA (positiv → Zug links).
// Umrechnung: My_core = −My_user,  Mz_core = −Mz_user.

import * as rc from '../../js/core/rcsection.js';
import { concrete, concreteLaw, rebar, rebarLaw } from '../../js/core/materials.js';
import { projectGeometry, bounds, chordWidth, barAreaMm2 } from './shapes.js';

const MM = 1e-3;
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

// ------------------------------------------------------------------ Vorzeichen

/** Benutzermomente → Kernkonvention. */
export function userToCore(My, Mz) { return { My: -num(My), Mz: -num(Mz) }; }
/** Kernmomente → Benutzerkonvention. */
export function coreToUser(My, Mz) { return { My: -num(My), Mz: -num(Mz) }; }

/**
 * Richtung θ der Druckseite (n = (cos θ, sin θ)) für ein Benutzermoment (My, Mz) bei doppelt-symmetrischem
 * Querschnitt: My > 0 (Zug unten) → θ = 90°, Mz > 0 (Zug rechts) → θ = 180°.
 */
export function thetaForUserMoment(My, Mz) {
  if (Math.hypot(My, Mz) < 1e-12) return Math.PI / 2;
  return Math.atan2(My, -Mz);
}

// ------------------------------------------------------------------ Baustoffe

/** Linear-elastisches Betongesetz ohne Zugfestigkeit und ohne Begrenzung (gerissener Zustand, GZG). */
export function linearConcreteNoTension(Ec, name = 'Beton linear') {
  return {
    type: 'concrete', name, Ec, fc: Infinity, ec2: 0.002, ecu: Infinity, epsMin: -Infinity, epsMax: Infinity,
    sigma: (e) => (e < 0 ? Ec * e : 0),
    tangent: (e) => (e < 0 ? Ec : 0),
  };
}

/** Linear-elastisches Stahlgesetz (GZG). */
export function linearSteel(Es, name = 'Stahl linear') {
  return { type: 'rebar', name, Es, fy: Infinity, ey: Infinity, eu: Infinity, epsMin: -Infinity, epsMax: Infinity, sigma: (e) => Es * e, tangent: () => Es };
}

/** Baustoffkennwerte und Werkstoffgesetze eines Projekts. */
export function materialSet(project) {
  const m = project.material || {};
  const norm = m.norm === 'EC' ? 'EC' : 'SIA';
  const c = concrete(m.concrete || 'C30/37', { norm, gammaC: m.gammaC > 0 ? m.gammaC : 1.5, alphaCC: m.alphaCC > 0 ? m.alphaCC : undefined });
  const s = rebar(m.steel || 'B500B', { norm, gammaS: m.gammaS > 0 ? m.gammaS : 1.15 });
  const calc = project.calc || {};
  const phi = Math.max(0, num(calc.creep));
  const nShort = s.Es / c.Ecm;
  const nSLS = calc.nMode === 'manual' && calc.n > 0 ? calc.n : s.Es * (1 + phi) / c.Ecm;
  const hardening = !!m.hardening;
  return {
    norm, c, s, phi, nShort, nSLS, hardening,
    uls: { c: concreteLaw(c, { kind: 'design' }), s: rebarLaw(s, { kind: 'design', hardening }) },
    sls: { c: linearConcreteNoTension(s.Es / nSLS), s: linearSteel(s.Es) },
    mkDesign: () => ({ c: concreteLaw(c, { kind: 'design', creep: phi }), s: rebarLaw(s, { kind: 'design', hardening }) }),
    mkMean: () => ({ c: concreteLaw(c, { kind: 'mean', tension: true, creep: phi }), s: rebarLaw(s, { kind: 'mean', hardening: true }) }),
  };
}

// ------------------------------------------------------------------ Querschnittswerte

/**
 * Hauptachsen mit Bereinigung numerischer Reste: |Iyz| < 1e-10·(Iy+Iz) → 0; bei Iy ≈ Iz und Iyz = 0
 * (z.B. Kreis, Quadrat) ist jede Achse Hauptachse → α = 0.
 */
function principal(Iy, Iz, Iyz) {
  const tr = Math.abs(Iy) + Math.abs(Iz);
  if (Math.abs(Iyz) < 1e-10 * tr) Iyz = 0;
  if (Iyz === 0 && Math.abs(Iy - Iz) < 1e-9 * tr) return { Iyz, I1: Math.max(Iy, Iz), I2: Math.min(Iy, Iz), alpha: 0, isotropic: true };
  return { Iyz, ...rc.principalAxes(Iy, Iz, Iyz), isotropic: false };
}

/**
 * Bruttoquerschnittswerte (Beton) aus Aussenpolygon und Löchern (beliebige Einheit).
 * Iy = ∫z² dA, Iz = ∫y² dA, Iyz = ∫y·z dA (je um die Schwerachsen); Hauptachsen nach rcsection.principalAxes:
 * Achse 1 mit I1 = max in Richtung (cos α, sin α).
 */
export function grossProps(outer, holes = []) {
  let A = 0, Qy = 0, Qz = 0, Iy0 = 0, Iz0 = 0, Iyz0 = 0;
  for (const [pts, sg] of [[outer, 1], ...holes.map((h) => [h, -1])]) {
    const p = rc.polygonProps(pts);
    if (!p.A) continue;
    A += sg * p.A; Qy += sg * p.Qy; Qz += sg * p.Qz; Iy0 += sg * p.Iy0; Iz0 += sg * p.Iz0; Iyz0 += sg * p.Iyz0;
  }
  if (!(A > 0)) throw new Error('Die Querschnittsfläche ist null oder negativ (Aussparungen grösser als der Querschnitt?).');
  const cy = Qz / A, cz = Qy / A;
  const Iy = Iy0 - A * cz * cz, Iz = Iz0 - A * cy * cy;
  const pa = principal(Iy, Iz, Iyz0 - A * cy * cz);
  const bb = bounds(outer);
  return {
    A, cy, cz, Iy, Iz, Iyz: pa.Iyz, I1: pa.I1, I2: pa.I2, alpha: pa.alpha, isotropic: pa.isotropic,
    ...bb,
    Wy_top: Iy / (bb.zmax - cz), Wy_bot: Iy / (cz - bb.zmin), Wz_right: Iz / (bb.ymax - cy), Wz_left: Iz / (cy - bb.ymin),
    iy: Math.sqrt(Iy / A), iz: Math.sqrt(Iz / A),
  };
}

/**
 * Ideelle (ungerissene) Querschnittswerte mit Wertigkeit n: Stäbe mit (n − 1)·As zum Bruttobeton addiert.
 * bars: [{y, z, A}] in derselben Einheit wie die Polygone (A in Einheit²).
 */
export function idealSectionProps(gross, bars, n) {
  let A = gross.A, Sy = gross.A * gross.cz, Sz = gross.A * gross.cy;
  for (const b of bars) { const a = (n - 1) * b.A; A += a; Sy += a * b.z; Sz += a * b.y; }
  const cy = Sz / A, cz = Sy / A;
  const dy = gross.cy - cy, dz = gross.cz - cz;
  let Iy = gross.Iy + gross.A * dz * dz, Iz = gross.Iz + gross.A * dy * dy, Iyz = gross.Iyz + gross.A * dy * dz;
  for (const b of bars) {
    const a = (n - 1) * b.A, yy = b.y - cy, zz = b.z - cz;
    Iy += a * zz * zz; Iz += a * yy * yy; Iyz += a * yy * zz;
  }
  const pa = principal(Iy, Iz, Iyz);
  return {
    A, cy, cz, Iy, Iz, Iyz: pa.Iyz, I1: pa.I1, I2: pa.I2, alpha: pa.alpha, isotropic: pa.isotropic, n,
    Wy_top: Iy / (gross.zmax - cz), Wy_bot: Iy / (cz - gross.zmin), Wz_right: Iz / (gross.ymax - cy), Wz_left: Iz / (cy - gross.ymin),
  };
}

// ------------------------------------------------------------------ Fasernetz

/**
 * Fasergrösse so wählen, dass das Fasermodell rund `target` Fasern hat (Zielbereich 1500 … 3000).
 * Zählt die Unterteilung genau wie rcsection.buildSection (Ear-Clipping, Halbierung bis Kantenlänge ≤ h).
 */
export function chooseMesh(regions, target = 2200) {
  const tris = regions.flatMap((r) => rc.triangulate(r.pts));
  const L = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const count = (h) => {
    let n = 0;
    const rec = (a, b, c) => {
      if (n > 60000) return;
      if (Math.max(L(a, b), L(b, c), L(c, a)) <= h) { n++; return; }
      const m = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const ab = m(a, b), bc = m(b, c), ca = m(c, a);
      rec(a, ab, ca); rec(ab, b, bc); rec(ca, bc, c); rec(ab, bc, ca);
    };
    for (const [a, b, c] of tris) rec(a, b, c);
    return n;
  };
  const bb = bounds(...regions.map((r) => r.pts));
  const size = Math.max(bb.b, bb.h);
  let lo = size / 500, hi = size;
  let best = null;
  for (let k = 0; k < 24; k++) {
    const h = Math.sqrt(lo * hi);
    const n = count(h);
    const score = Math.abs(Math.log(n / target));
    if (!best || score < best.score) best = { h, n, score };
    if (n > target) lo = h; else hi = h;
    if (hi / lo < 1.02) break;
  }
  return best.h;
}

// ------------------------------------------------------------------ Geometrie in m

function geometryM(project) {
  const g = projectGeometry(project);
  if (g.errors.length) throw new Error(g.errors[0]);
  if (!g.outer.length) throw new Error('Kein Querschnitt definiert.');
  const toM = (pts) => pts.map(([y, z]) => [y * MM, z * MM]);
  return {
    mm: g,
    outer: toM(g.outer),
    holes: g.holes.map(toM),
    bars: g.bars.map((b) => ({ y: b.y * MM, z: b.z * MM, d: b.d, A: barAreaMm2(b.d) * 1e-6, i: b.i })),
    warnings: g.warnings,
  };
}

function buildWithLaws(gm, laws, mesh, ref) {
  return rc.buildSection({
    regions: [{ pts: gm.outer, law: laws.c }, ...gm.holes.map((pts) => ({ pts, law: laws.c, hole: true }))],
    bars: gm.bars.map((b) => ({ y: b.y, z: b.z, A: b.A, law: laws.s, i: b.i, d: b.d })),
    mesh, ref,
  });
}

// ------------------------------------------------------------------ Vollständigkeit der Eingabe

/**
 * Fehlt noch etwas für die Berechnung? Rückgabe {msg, hint} des nächsten Arbeitsschritts oder null.
 * Reihenfolge: Querschnitt → Bewehrung → Lastfall (geführter Ablauf bei leerem Projekt).
 */
export function missingInput(project) {
  const sh = project.shape || {};
  const hasOutline = sh.type && (sh.type !== 'poly' || (sh.poly || []).filter((r) => Number.isFinite(r?.y) && Number.isFinite(r?.z)).length >= 3);
  if (!hasOutline) {
    return {
      msg: 'Noch kein Querschnitt vorhanden.',
      hint: 'Querschnitt zeichnen mit «Rechteck» (Taste Q: zwei Ecken anklicken) oder «Polygon» (Taste U: Eckpunkte anklicken, Enter schliesst). Vorlagen wie Plattenbalken oder Kreis gibt es im Register «Querschnitt», fertige Projekte unter «Beispiele».',
    };
  }
  if (!(project.bars || []).some((b) => b.d > 0 && Number.isFinite(b.y) && Number.isFinite(b.z))) {
    return {
      msg: 'Es fehlt noch die Bewehrung.',
      hint: 'Bewehrung setzen mit «Stab» (Taste B: Stabmitte anklicken) oder «Stabreihe» (Taste L: Anfangs- und Endpunkt anklicken). Die Fangpunkte ○ liegen im Achsabstand der Bewehrung vom Rand. Ganze Lagen erzeugt das Register «Bewehrung».',
    };
  }
  if (!(project.loads || []).length) {
    return {
      msg: 'Es fehlt noch ein Lastfall.',
      hint: 'Lastfall erfassen: im Register «Lasten» mit «GZT-Lastfall» N und die Momente eintragen – oder im Eigenschaftsfenster (nichts ausgewählt) «Lastfall anlegen».',
    };
  }
  return null;
}

// ------------------------------------------------------------------ Dehnungszustände

/**
 * Zerlegung der inneren Kräfte einer Dehnungsebene {e0, ky, kz} (e0 im Bezugspunkt des Fasermodells):
 * Betonkraft Fc, Stahlzugkraft Fst und Stahldruckkraft Fsc [kN] mit Angriffspunkten [y, z] in m
 * (Koordinaten der Eingabe). Momente um den Bezugspunkt in Benutzerkonvention (My > 0 Zug unten).
 */
export function forceResultants(sec, plane) {
  const { y, z, A, law, laws, isBar } = sec;
  const acc = () => ({ F: 0, Fy: 0, Fz: 0, n: 0 });
  const C = acc(), T = acc(), S = acc();
  for (let i = 0; i < sec.nFibers; i++) {
    const e = plane.e0 + plane.ky * y[i] + plane.kz * z[i];
    const f = laws[law[i]].sigma(e) * A[i] * 1000;
    if (!f) continue;
    const b = isBar[i] ? (f > 0 ? T : S) : C;
    b.F += f; b.Fy += f * y[i]; b.Fz += f * z[i]; b.n++;
  }
  const point = (b) => (Math.abs(b.F) > 1e-9 ? [b.Fy / b.F + sec.ref[0], b.Fz / b.F + sec.ref[1]] : null);
  const My = -(C.Fz + T.Fz + S.Fz), Mz = C.Fy + T.Fy + S.Fy;
  // Gesamte Druckkraft (Beton + Druckstäbe) und Hebelarm zur Zugkraft in Richtung des Dehnungsgradienten
  const Fcomp = C.F + S.F;
  const pComp = Math.abs(Fcomp) > 1e-9 ? [(C.Fy + S.Fy) / Fcomp + sec.ref[0], (C.Fz + S.Fz) / Fcomp + sec.ref[1]] : null;
  const pT = point(T);
  const k = Math.hypot(plane.ky, plane.kz);
  let lever = null;
  if (pComp && pT && k > 1e-12) lever = Math.abs((pT[0] - pComp[0]) * plane.ky / k + (pT[1] - pComp[1]) * plane.kz / k);
  return {
    Fc: C.F, Fst: T.F, Fsc: S.F, N: C.F + T.F + S.F, My, Mz,
    pc: point(C), pst: pT, psc: point(S), pComp, Fcomp, lever, nTension: T.n, nCompression: S.n,
  };
}


/** Kennwerte einer Dehnungsebene {e0, ky, kz} (e0 im Bezugspunkt). */
export function stateInfo(sec, plane) {
  const { e0, ky, kz } = plane;
  const ext = rc.strainExtremes(sec, e0, ky, kz);
  const st = rc.stressesAt(sec, plane);
  const k = Math.hypot(ky, kz);
  let x;
  if (ext.ecMax <= 0) x = Infinity;
  else if (ext.ecMin >= 0) x = 0;
  else x = -ext.ecMin / k;
  let sigmaCmin = 0;
  for (const v of st.verts) sigmaCmin = Math.min(sigmaCmin, v.sigma);
  const bars = st.bars.map((b, j) => ({ ...b, i: sec.bars[j].i, d: sec.bars[j].d, A: sec.bars[j].A }));
  let sigmaSmax = -Infinity, sigmaSmin = Infinity;
  for (const b of bars) { sigmaSmax = Math.max(sigmaSmax, b.sigma); sigmaSmin = Math.min(sigmaSmin, b.sigma); }
  const r = rc.resultants(sec, e0, ky, kz);
  const mu = coreToUser(r.My, r.Mz);
  return {
    e0, ky, kz, ext, x, na: rc.neutralAxis(sec, plane), sigmaCmin, bars,
    sigmaSmax: bars.length ? sigmaSmax : NaN, sigmaSmin: bars.length ? sigmaSmin : NaN,
    N: r.N, My: mu.My, Mz: mu.Mz, ref: sec.ref,
  };
}

/** Dehnungszustand unter gegebenen Schnittgrössen (Kernkonvention). */
export function solveState(sec, N, MyC, MzC, kind = 'uls') {
  const st = rc.solveStrain(sec, N, MyC, MzC);
  if (!st.ok) {
    let msg = 'Unter den Bemessungslasten ist kein Gleichgewicht möglich – der Tragwiderstand ist überschritten (η > 1).';
    if (kind === 'sls') {
      msg = sec.bars.length
        ? 'Kein Gleichgewicht im gerissenen Zustand – die Zugkräfte können von der Bewehrung nicht aufgenommen werden.'
        : 'Ohne Bewehrung kann der gerissene Querschnitt keine Zugkraft aufnehmen – Stäbe im Register «Bewehrung» erfassen.';
    }
    return { ok: false, msg };
  }
  return { ok: true, fail: !!st.fail, ...stateInfo(sec, st) };
}

function interpAngle(a, b, u) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + u * d;
}

/** Schnittpunkt des Strahls from + s·dir (s > 0) mit dem geschlossenen Polygon curve [{My, Mz, theta}]. */
function rayHit(curve, from, dir) {
  let hit = null;
  for (let i = 0; i < curve.length; i++) {
    const p = curve[i], q = curve[(i + 1) % curve.length];
    const ex = q.My - p.My, ey = q.Mz - p.Mz;
    const den = dir[0] * ey - dir[1] * ex;
    if (Math.abs(den) < 1e-14) continue;
    const px = p.My - from[0], py = p.Mz - from[1];
    const sv = (px * ey - py * ex) / den;
    const u = (px * dir[1] - py * dir[0]) / den;
    if (sv > 0 && u >= -1e-9 && u <= 1 + 1e-9 && (!hit || sv < hit.s)) hit = { s: sv, theta: interpAngle(p.theta, q.theta, Math.min(1, Math.max(0, u))) };
  }
  return hit;
}

/**
 * Ausnutzung bei konstanter Normalkraft (Kernkonvention) nach rcsection.utilization: η = max(ηM, ηN).
 * Liegt (0/0) bei diesem N ausserhalb des My-Mz-Bereichs, steigert der Kern die Momente vom Flächenschwerpunkt
 * des Bereichs aus. Rückgabe wie utilization plus {from: [My, Mz] Strahlursprung, shifted}.
 */
export function utilizationAtN(sec, N, My, Mz, nAngles = 96) {
  const util = rc.utilization(sec, N, My, Mz, nAngles);
  const from = util.origin || [0, 0];
  return { ...util, etaM: util.etaM ?? util.eta, etaN: util.etaN ?? 0, from, shifted: Math.hypot(from[0], from[1]) > 1e-9 };
}

/** Dehnungsebene im Bruchzustand am Widerstandspunkt (radiale Skalierung bei konstantem N). */
export function resistancePlane(sec, N, MyC, MzC, util) {
  const from = util.from || [0, 0];
  const d = [MyC - from[0], MzC - from[1]], L = Math.hypot(d[0], d[1]);
  if (util.outside || L < 1e-9 || !util.curve?.length) return rc.ultimatePlane(sec, Math.PI / 2, N <= 0 ? 3 : 0);
  const hit = rayHit(util.curve, from, [d[0] / L, d[1] / L]);
  if (!hit) return null;
  const r = rc.capacityAtN(sec, hit.theta, N);
  return r ? { e0: r.e0, ky: r.ky, kz: r.kz } : null;
}

/** Versagensart einer Bruchdehnungsebene. */
export function failureMode(sec, info) {
  const cl = sec.concreteLaw, bl = sec.barLaw;
  if (info.ext.ecMax <= 1e-9 && Math.abs(info.ext.ecMax - info.ext.ecMin) < 1e-6) return 'zentrischer Druck (ε_c2)';
  if (info.ext.ecMin <= cl.epsMin * 0.995) return 'Betonstauchung ε_cu erreicht';
  if (bl && info.bars.length && Math.max(...info.bars.map((b) => b.eps)) >= bl.epsMax * 0.995) return 'Stahldehnung ε_ud erreicht';
  return 'Drehpunkt ε_c2 im Druckbereich';
}

// ------------------------------------------------------------------ GZG: Spannungsbegrenzung

/**
 * Näherung der Kurven SIA 262 (2013) Fig. 31: zulässige Stahlspannung σs,adm in Abhängigkeit des Stababstands s.
 * Stückweise lineare, gerundete Ablesewerte (s in mm, σ in N/mm²); ausserhalb 50 … 300 mm konstant fortgesetzt.
 * Die Werte sind eine Näherung und im Einzelfall mit der Norm zu vergleichen.
 */
export const SIA_FIG31 = {
  erhoeht: [[50, 400], [100, 360], [150, 320], [200, 290], [250, 265], [300, 240]],
  hoch: [[50, 320], [100, 270], [150, 230], [200, 200], [250, 180], [300, 160]],
};

export const SLS_REQUIREMENTS = [
  { value: 'normal', label: 'normale Anforderungen' },
  { value: 'erhoeht', label: 'erhöhte Anforderungen' },
  { value: 'hoch', label: 'hohe Anforderungen' },
  { value: 'manual', label: 'Grenzwert vorgeben' },
];

export function interpTable(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return tab[tab.length - 1][1];
}

/** Zulässige Stahlspannung im GZG. Rückgabe {value, ref, label}. */
export function steelStressLimit(mat, sls = {}, spacing = 150) {
  if (mat.norm === 'EC') return { value: 0.8 * mat.s.fsk, ref: 'EN 1992-1-1, 7.2(5): σ_s ≤ k_3·f_yk = 0.8·f_yk', label: '0.8·f_yk' };
  const req = sls.req || 'normal';
  if (req === 'manual') return { value: sls.sigmaAdm > 0 ? sls.sigmaAdm : mat.s.fsd, ref: 'SIA 262, 4.4.2: σ_s,adm vorgegeben', label: 'manuell' };
  if (req === 'erhoeht' || req === 'hoch') {
    const v = Math.min(mat.s.fsd, interpTable(SIA_FIG31[req], spacing));
    return { value: v, ref: `SIA 262, 4.4.2 / Fig. 31 (Näherung), ${req === 'hoch' ? 'hohe' : 'erhöhte'} Anforderungen, s = ${Math.round(spacing)} mm`, label: req === 'hoch' ? 'hoch' : 'erhöht' };
  }
  return { value: mat.s.fsd, ref: 'SIA 262, 4.4.2: normale Anforderungen – Kontrolle σ_s ≤ f_sd (Rissbreite über Mindestbewehrung)', label: 'normal' };
}

/**
 * Stababstand der höchstbeanspruchten Zuglage [mm]: Stäbe mit σs ≥ 0.75·σs,max, projiziert auf die Nulllinie;
 * massgebend ist der grösste Achsabstand benachbarter Stäbe. null, wenn weniger als 2 Stäbe.
 */
export function tensionLayerSpacing(state) {
  const t = state.bars.filter((b) => b.sigma > 0);
  if (t.length < 2) return null;
  const smax = Math.max(...t.map((b) => b.sigma));
  const layer = t.filter((b) => b.sigma >= 0.75 * smax);
  if (layer.length < 2) return null;
  const k = Math.hypot(state.ky, state.kz);
  const dir = k > 1e-12 ? [-state.kz / k, state.ky / k] : [1, 0];
  const u = layer.map((b) => b.y * dir[0] + b.z * dir[1]).sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < u.length; i++) gap = Math.max(gap, u[i] - u[i - 1]);
  return gap / MM;
}

// ------------------------------------------------------------------ Querkraft

/**
 * Wirksame Querkraftgeometrie aus dem Querschnitt (mm): bw (kleinste Materialbreite zwischen 10 % und 90 % der Höhe),
 * d (Abstand Druckrand – Schwerpunkt der Zugbewehrung), z = 0.9·d, Asl (Zugbewehrung).
 */
export function shearGeometry(geomMm, grossMm, side = 'unten') {
  const { outer, holes, bars } = geomMm;
  const bb = bounds(outer);
  let bw = Infinity;
  for (let i = 0; i <= 40; i++) {
    const z = bb.zmin + bb.h * (0.1 + 0.8 * i / 40);
    bw = Math.min(bw, chordWidth(outer, holes, z));
  }
  const tens = bars.filter((b) => (side === 'oben' ? b.z > grossMm.cz : b.z < grossMm.cz));
  const As = tens.reduce((s, b) => s + barAreaMm2(b.d), 0);
  let d;
  if (As > 0) {
    const zs = tens.reduce((s, b) => s + barAreaMm2(b.d) * b.z, 0) / As;
    d = side === 'oben' ? zs - bb.zmin : bb.zmax - zs;
  } else d = 0.9 * bb.h;
  return { bw, d, z: 0.9 * d, Asl: As, h: bb.h };
}

/**
 * Querkraftnachweis. VEd [kN], NEd [kN] (Zug positiv), etaM = MEd/MRd (für εv nach SIA).
 * g: {bw, d, z, Asl, Ac} in mm/mm², sh: {dw, s, legs, angle [°], Dmax, epsMode}
 */
export function shearCheck(mat, g, sh, VEd, NEd = 0, etaM = 1) {
  const { c, s } = mat;
  const V = Math.abs(num(VEd));
  const ang = Math.min(89, Math.max(1, num(sh.angle, 30))) * Math.PI / 180;
  const cot = 1 / Math.tan(ang), tan = Math.tan(ang);
  const legs = Math.max(0, num(sh.legs, 2)), dw = Math.max(0, num(sh.dw)), sw = Math.max(0, num(sh.s));
  const hasStirrups = legs > 0 && dw > 0 && sw > 0;
  const asw = hasStirrups ? legs * barAreaMm2(dw) / sw : 0; // mm²/mm
  const checks = [], notes = [];
  const out = { hasStirrups, asw: asw * 1000, VEd: V, checks, notes };
  if (mat.norm === 'SIA') {
    if (hasStirrups) {
      const VRds = asw * g.z * s.fsd * cot / 1000;
      const kc = 0.55;
      const VRdc = g.bw * g.z * kc * c.fcd * Math.sin(ang) * Math.cos(ang) / 1000;
      Object.assign(out, { VRds, VRdc, kc, VRd: Math.min(VRds, VRdc) });
      checks.push({ label: 'Querkraftbewehrung V_Rd,s', ref: 'SIA 262, 4.3.3.4.3: V_Rd,s = (A_sw/s)·z·f_sd·cot α', Ed: V, Rd: VRds, unit: 'kN' });
      checks.push({ label: 'Betondruckfeld V_Rd,c', ref: 'SIA 262, 4.3.3.4.6: V_Rd,c = b_w·z·k_c·f_cd·sin α·cos α, k_c = 0.55', Ed: V, Rd: VRdc, unit: 'kN' });
      const deg = ang * 180 / Math.PI;
      if (deg < 25 - 1e-9 || deg > 45 + 1e-9) notes.push('Neigung α ausserhalb 25° … 45° (SIA 262, 4.3.3.3.2).');
    } else {
      const kg = 48 / (16 + num(sh.Dmax, 32));
      const epsv = sh.epsMode === 'plastic' ? 1.5 * s.fsd / s.Es : s.fsd / s.Es * Math.min(1, Math.max(0, num(etaM, 1)));
      const kd = 1 / (1 + epsv * g.d * kg);
      const VRd = kd * c.tcd * g.d * g.bw / 1000;
      Object.assign(out, { kg, epsv, kd, VRd, tcd: c.tcd });
      checks.push({ label: 'Querkraft ohne Bügel V_Rd', ref: 'SIA 262, 4.3.3.2.1: V_Rd = k_d·τ_cd·d·b_w, k_d = 1/(1 + ε_v·d·k_g)', Ed: V, Rd: VRd, unit: 'kN' });
    }
  } else {
    const gc = c.gammaC;
    const k = Math.min(2, 1 + Math.sqrt(200 / g.d));
    const rhoL = Math.min(0.02, g.Asl / (g.bw * g.d));
    const sigcp = Math.min(0.2 * c.fcd, Math.max(0, -num(NEd) * 1000 / g.Ac));
    const vmin = 0.035 * Math.pow(k, 1.5) * Math.sqrt(c.fck);
    const VRdc = Math.max(0.18 / gc * k * Math.cbrt(100 * rhoL * c.fck) + 0.15 * sigcp, vmin + 0.15 * sigcp) * g.bw * g.d / 1000;
    Object.assign(out, { k, rhoL, sigcp, vmin, VRdc });
    if (hasStirrups) {
      const VRds = asw * g.z * s.fsd * cot / 1000;
      const nu1 = 0.6 * (1 - c.fck / 250);
      const VRdmax = g.bw * g.z * nu1 * c.fcd / (cot + tan) / 1000;
      Object.assign(out, { VRds, VRdmax, nu1, VRd: Math.min(VRds, VRdmax) });
      checks.push({ label: 'Querkraftbewehrung V_Rd,s', ref: 'EN 1992-1-1, 6.2.3 (6.8): V_Rd,s = (A_sw/s)·z·f_ywd·cot θ', Ed: V, Rd: VRds, unit: 'kN' });
      checks.push({ label: 'Druckstrebe V_Rd,max', ref: 'EN 1992-1-1, 6.2.3 (6.9): V_Rd,max = α_cw·b_w·z·ν_1·f_cd/(cot θ + tan θ)', Ed: V, Rd: VRdmax, unit: 'kN' });
      if (cot < 1 - 1e-9 || cot > 2.5 + 1e-9) notes.push('cot θ ausserhalb 1.0 … 2.5 (EN 1992-1-1, 6.2.3(2)).');
    } else {
      out.VRd = VRdc;
      checks.push({ label: 'Querkraft ohne Bügel V_Rd,c', ref: 'EN 1992-1-1, 6.2.2 (6.2a/b)', Ed: V, Rd: VRdc, unit: 'kN' });
    }
  }
  out.eta = checks.reduce((m, ch) => Math.max(m, ch.Rd > 0 ? ch.Ed / ch.Rd : Infinity), 0);
  return out;
}

// ------------------------------------------------------------------ Momenten-Krümmungs-Beziehung

/**
 * M-κ-Linie bei konstanter Normalkraft N für Richtung θ (Druckseite n = (cos θ, sin θ)).
 * Dehnungsebene ε(u) = e0 − κ·u (u = y·cos θ + z·sin θ). M = Moment in Lastrichtung (positiv).
 * 1. Bruchkrümmung κu durch Steigerung und Bisektion (Grenzdehnungen εcu bzw. εud),
 * 2. Kurve mit verdichteten Stützstellen, Riss- und Fliesspunkt durch Bisektion verfeinert.
 * Rückgabe {points:[{kappa, M}], crack, yield, ultimate, error}
 */
export function mkCurve(sec, N, theta, opts = {}) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const cl = sec.concreteLaw, bl = sec.barLaw;
  const steps = opts.steps ?? 56;
  const comp = (r) => -s * r.My + c * r.Mz;
  const Nf = (e0, kap) => rc.resultants(sec, e0, -kap * c, -kap * s).N - N;
  // Projektionen u der Betonecken und Stäbe (bezogen auf den Bezugspunkt)
  let ucMax = -Infinity, usMin = Infinity, usMax = -Infinity;
  for (const [y, z] of sec.cVerts) ucMax = Math.max(ucMax, y * c + z * s);
  for (const b of sec.bars) { const u = b.yr * c + b.zr * s; usMin = Math.min(usMin, u); usMax = Math.max(usMax, u); }
  const ecu = -cl.epsMin, eu = bl ? bl.epsMax : Infinity;
  /**
   * Gleichgewicht in N über e0. Gesucht wird nur im zulässigen Dehnungsbereich
   * (Beton ≥ −εcu, Stahl innerhalb ±εud); dort wächst N monoton mit e0. Kein Nullpunkt → Bruch.
   */
  const solveE0 = (kap) => {
    let lo = -ecu + kap * ucMax;
    let hi = Number.isFinite(usMin) ? eu + kap * usMin : lo + 1;
    if (Number.isFinite(usMax) && Number.isFinite(eu)) lo = Math.max(lo, -eu + kap * usMax);
    if (!(lo <= hi)) return null;
    let flo = Nf(lo, kap), fhi = Nf(hi, kap);
    const tolN = 1e-7 * Math.max(1, Math.abs(N));
    if (flo > tolN || fhi < -tolN) return null;
    if (Math.abs(flo) <= tolN) return lo;
    if (Math.abs(fhi) <= tolN) return hi;
    let side = 0; // Illinois-Verfahren
    for (let it = 0; it < 120; it++) {
      const m = fhi - flo > 0 ? (lo * fhi - hi * flo) / (fhi - flo) : (lo + hi) / 2;
      const fm = Nf(m, kap);
      if (Math.abs(fm) < tolN || hi - lo < 1e-14) return m;
      if (fm > 0) { hi = m; fhi = fm; if (side === -1) flo /= 2; side = -1; }
      else { lo = m; flo = fm; if (side === 1) fhi /= 2; side = 1; }
    }
    return (lo + hi) / 2;
  };
  const evalAt = (kap) => {
    const e0 = solveE0(kap);
    if (e0 === null) return null;
    const ky = -kap * c, kz = -kap * s;
    const ext = rc.strainExtremes(sec, e0, ky, kz);
    const r = rc.resultants(sec, e0, ky, kz);
    return { kappa: kap, M: comp(r), e0, ext };
  };
  const p0 = evalAt(0);
  if (!p0) return { points: [], error: 'Die Normalkraft liegt ausserhalb des Tragwiderstands.' };
  // 1. Bruchkrümmung suchen
  const h = Math.max(2 * Math.max(...sec.cVerts.map(([y, z]) => Math.abs(y * c + z * s))), 0.01);
  let kOk = 0, kBad = null;
  let kap = 0.01 * (Number.isFinite(ecu) ? ecu : 0.003) / h;
  for (let i = 0; i < 80; i++) {
    if (!evalAt(kap)) { kBad = kap; break; }
    kOk = kap;
    kap *= 1.4;
  }
  if (kBad === null) return { points: [], error: 'Keine Bruchkrümmung gefunden.' };
  for (let i = 0; i < 26; i++) {
    const m = (kOk + kBad) / 2;
    if (evalAt(m)) kOk = m; else kBad = m;
  }
  const kU = kOk;
  // 2. Kurve
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const p = i === 0 ? p0 : evalAt(kU * Math.pow(i / steps, 1.5));
    if (!p) break;
    pts.push(p);
  }
  const refine = (pred, label) => {
    const j = pts.findIndex((p) => pred(p));
    if (j <= 0) return null;
    let a = pts[j - 1], b = pts[j];
    for (let it = 0; it < 18; it++) {
      const p = evalAt((a.kappa + b.kappa) / 2);
      if (!p) break;
      if (pred(p)) b = p; else a = p;
    }
    const q = { ...b, label };
    pts.splice(j, 0, q);
    return q;
  };
  const crack = opts.crackStrain ? refine((p) => p.ext.ecMax >= opts.crackStrain, 'Riss') : null;
  const yieldPt = bl && Number.isFinite(bl.ey) ? refine((p) => Math.max(Math.abs(p.ext.esMax || 0), Math.abs(p.ext.esMin || 0)) >= bl.ey, 'Fliessen') : null;
  const ult = pts[pts.length - 1];
  return {
    points: pts.map((p) => ({ kappa: p.kappa, M: p.M })),
    crack: crack && { kappa: crack.kappa, M: crack.M },
    yield: yieldPt && { kappa: yieldPt.kappa, M: yieldPt.M },
    ultimate: ult && { kappa: ult.kappa, M: ult.M, ext: ult.ext },
    theta, N,
  };
}

// ------------------------------------------------------------------ Interaktion

/** N-M-Interaktion (Bruchzustand) für Biegung um y (axis 'My') oder z (axis 'Mz') in Benutzerkonvention. */
export function nmDiagram(sec, axis = 'My', n = 80) {
  const theta = axis === 'Mz' ? Math.PI : Math.PI / 2;
  return rc.interactionNM(sec, theta, n).map((p) => ({ N: p.N, M: p.M }));
}

/** My-Mz-Interaktion bei Normalkraft N in Benutzerkonvention [{My, Mz}]. */
export function mymzCurve(sec, N, n = 72) {
  return rc.interactionMyMz(sec, N, n).map((p) => ({ ...coreToUser(p.My, p.Mz), theta: p.theta }));
}

// ------------------------------------------------------------------ Cache & Gesamtberechnung

export function createCache() {
  return { key: null, secs: null, util: new Map(), lazy: new Map(), entries: new Map() };
}

function memo(map, key, fn, max = 200) {
  if (map.has(key)) return map.get(key);
  const v = fn();
  if (map.size >= max) map.delete(map.keys().next().value);
  map.set(key, v);
  return v;
}

export const REF_POINTS = [
  { value: 'gross', label: 'Schwerpunkt Beton (brutto)' },
  { value: 'ideal', label: 'Ideeller Schwerpunkt' },
  { value: 'origin', label: 'Koordinatenursprung (0/0)' },
];

/**
 * Vollständige Querschnittsanalyse eines Projekts.
 * cache: aus createCache() – Fasermodelle und Interaktionsrechnungen werden wiederverwendet.
 */
export function analyze(project, cache = createCache()) {
  const gm = geometryM(project);
  const mat = materialSet(project);
  const gross = grossProps(gm.outer, gm.holes);
  const grossMm = grossProps(gm.mm.outer, gm.mm.holes);
  const As = gm.bars.reduce((s, b) => s + b.A, 0);
  const ideal = idealSectionProps(gross, gm.bars, mat.nShort);
  const refMode = project.calc?.ref || 'gross';
  // R: Bezugspunkt der eingegebenen Schnittgrössen. Intern wird stets im Betonschwerpunkt G gerechnet,
  // damit die Ausnutzung (Momente radial bei konstantem N) nicht von der Wahl des Bezugspunkts abhängt.
  const G = [gross.cy, gross.cz];
  const ref = refMode === 'origin' ? [0, 0] : refMode === 'ideal' ? [ideal.cy, ideal.cz] : G;
  const dy = ref[0] - G[0], dz = ref[1] - G[1];
  /** Benutzermomente um R → um G bzw. umgekehrt (N in kN, Hebel in m). */
  const toG = (N, MyU, MzU) => ({ My: MyU - N * dz, Mz: MzU + N * dy });
  const toR = (N, MyU, MzU) => ({ My: MyU + N * dz, Mz: MzU - N * dy });
  /** Moment in Richtung θ (M-κ) um G → um R. */
  const dirToR = (N, theta, M) => M + N * (Math.sin(theta) * dz + Math.cos(theta) * dy);

  // Fasermodell GZT: abhängig von Geometrie und Baustoffen. Interaktionsresultate bleiben gültig,
  // solange sich dieser Schlüssel nicht ändert (Bezugspunkt, GZG-Wertigkeit, Kriechen beeinflussen ihn nicht).
  const m = project.material || {};
  const key = JSON.stringify({ o: gm.outer, h: gm.holes, b: gm.bars, m: [mat.norm, m.concrete, m.steel, m.gammaC, m.gammaS, m.alphaCC, !!m.hardening] });
  // Mehrere Querschnitte (Positionen) nebeneinander: je Fasermodell ein Eintrag (zuletzt benutzte zuerst behalten)
  cache.entries ||= new Map();
  let entry = cache.entries.get(key);
  if (entry) cache.entries.delete(key);
  else {
    const regions = [{ pts: gm.outer }, ...gm.holes.map((pts) => ({ pts }))];
    const mesh = chooseMesh(regions);
    entry = { secs: { uls: buildWithLaws(gm, mat.uls, mesh, G), mesh, byKey: new Map() }, util: new Map(), lazy: new Map() };
  }
  cache.entries.set(key, entry);
  while (cache.entries.size > 6) cache.entries.delete(cache.entries.keys().next().value);
  cache.key = key; cache.secs = entry.secs; cache.util = entry.util; cache.lazy = entry.lazy;
  // Die Maps werden festgehalten: zwischengespeicherte Resultate einer Position bleiben gültig, auch wenn
  // inzwischen eine andere Position gerechnet wurde.
  const utilMap = entry.util, lazyMap = entry.lazy;
  const secs = entry.secs;
  /** Weitere Fasermodelle mit anderen Werkstoffgesetzen (gleiches Netz), zwischengespeichert. */
  const secWith = (k, lawsFn) => memo(secs.byKey, k, () => buildWithLaws(gm, lawsFn(), secs.mesh, G), 12);
  const secU = secs.uls;
  const secS = secWith(`sls|${mat.nSLS}`, () => mat.sls);
  secs.sls = secS;
  const axial = rc.axialCapacity(secU);
  const capAt0 = (th) => rc.capacityAtN(secU, th, 0);
  const mrd = memo(lazyMap, 'mrd', () => {
    const a = capAt0(Math.PI / 2), b = capAt0(-Math.PI / 2), cc = capAt0(Math.PI), d = capAt0(0);
    return { MyPos: a ? -a.My : NaN, MyNeg: b ? -b.My : NaN, MzPos: cc ? -cc.Mz : NaN, MzNeg: d ? -d.Mz : NaN };
  });

  const warnings = [...gm.warnings];
  if (!gm.bars.length) warnings.push('Keine Bewehrung definiert – unbewehrter Querschnitt (nur Druck aufnehmbar).');

  const sh = project.shear || {};
  const shearOn = !!sh.active;
  let shearGeo = null;
  if (shearOn) {
    const auto = shearGeometry(gm.mm, grossMm, sh.side === 'oben' ? 'oben' : 'unten');
    shearGeo = {
      auto,
      bw: sh.bwAuto !== false ? auto.bw : num(sh.bw, auto.bw),
      d: sh.dAuto !== false ? auto.d : num(sh.d, auto.d),
      Asl: auto.Asl,
      Ac: grossMm.A,
    };
    shearGeo.z = sh.zAuto !== false ? 0.9 * shearGeo.d : num(sh.z, 0.9 * shearGeo.d);
  }

  /** Zustandskennwerte (um G gerechnet) auf den Bezugspunkt R umrechnen; Kopie, Cache bleibt unverändert. */
  const atR = (st) => {
    if (!st || st.e0 === undefined) return st;
    const mR = toR(st.N, st.My, st.Mz);
    return { ...st, eRef: st.e0 + st.ky * dy + st.kz * dz, My: mR.My, Mz: mR.Mz };
  };

  /** Tragwiderstand (Bruchzustand) für Benutzer-Schnittgrössen um R; Ergebnisse wieder um R. */
  const capFor = (N, MyU, MzU) => {
    const mg = toG(N, MyU, MzU);
    const { My, Mz } = userToCore(mg.My, mg.Mz);
    const u = memo(utilMap, `${N}|${My}|${Mz}`, () => {
      const util = utilizationAtN(secU, N, My, Mz, 96);
      const plane = resistancePlane(secU, N, My, Mz, util);
      const rinfo = plane ? stateInfo(secU, plane) : null;
      const mR = coreToUser(util.MyR, util.MzR);
      return {
        eta: util.eta, etaM: util.etaM, etaN: util.etaN, Nc: util.Nc, Nt: util.Nt, outside: !!util.outside, NR: util.NR, MyR: mR.My, MzR: mR.Mz,
        from: [-util.from[0], -util.from[1]], shifted: util.shifted,
        curve: util.curve.map((p) => ({ ...coreToUser(p.My, p.Mz), theta: p.theta })),
        rstate: rinfo, mode: rinfo ? failureMode(secU, rinfo) : '',
      };
    });
    // Ausgabe um R (Kopie)
    const shift = (pt) => toR(N, pt.My, pt.Mz);
    const res = shift({ My: u.MyR, Mz: u.MzR });
    const from = shift({ My: u.from[0], Mz: u.from[1] });
    return { ...u, MyR: res.My, MzR: res.Mz, from: [from.My, from.Mz], curve: u.curve.map((p) => ({ ...shift(p), theta: p.theta })), rstate: atR(u.rstate) };
  };

  const cases = (project.loads || []).map((lc, i) => {
    const type = lc.type === 'GZG' ? 'GZG' : 'GZT';
    const N = num(lc.N), MyU = num(lc.My), MzU = num(lc.Mz);
    const mg = toG(N, MyU, MzU);
    const { My, Mz } = userToCore(mg.My, mg.Mz);
    const r = { i, name: lc.name || `LF ${i + 1}`, type, N, My: MyU, Mz: MzU, V: num(lc.V) };
    r.ulsState = atR(solveState(secU, N, My, Mz, 'uls'));
    r.slsState = atR(solveState(secS, N, My, Mz, 'sls'));
    if (type === 'GZT') {
      const u = capFor(N, MyU, MzU);
      r.uls = u;
      r.eta = u.eta;
      if (shearOn) {
        r.shear = shearCheck(mat, shearGeo, sh, r.V, N, Math.min(1, u.eta));
        r.etaV = r.shear.eta;
      }
    } else {
      const st = r.slsState;
      if (!st.ok) {
        r.sls = { eta: Infinity, error: st.msg, checks: [] };
      } else {
        const sAuto = project.sls?.spacingAuto !== false ? tensionLayerSpacing(st) : null;
        const spacing = sAuto ?? num(project.sls?.spacing, 150);
        const lim = steelStressLimit(mat, project.sls, spacing);
        const checks = [];
        const sigS = Math.max(0, num(st.sigmaSmax, 0));
        if (gm.bars.length) checks.push({ label: 'Stahlspannung σ_s', ref: lim.ref, Ed: sigS, Rd: lim.value, unit: 'MPa', digits: 0 });
        const sigC = -st.sigmaCmin;
        if (mat.norm === 'EC') checks.push({ label: 'Betondruckspannung |σ_c|', ref: 'EN 1992-1-1, 7.2(2): |σ_c| ≤ k_1·f_ck = 0.6·f_ck', Ed: sigC, Rd: 0.6 * mat.c.fck, unit: 'MPa', digits: 1 });
        const eta = checks.reduce((mx, ch) => Math.max(mx, ch.Ed / ch.Rd), 0);
        const notes = [];
        if (sigS > mat.s.fsk) notes.push('σ_s > f_sk: Stahl fliesst – linear-elastische Berechnung nicht mehr zutreffend.');
        if (sigC > 0.6 * mat.c.fck && mat.norm === 'SIA') notes.push('|σ_c| > 0.6·f_ck: ausgeprägtes nichtlineares Kriechen möglich.');
        r.sls = { eta, checks, spacing, spacingAuto: sAuto !== null, lim, sigS, sigC, notes };
      }
      r.eta = r.sls.eta;
    }
    return r;
  });

  const ulsCases = cases.filter((c) => c.type === 'GZT');
  const slsCases = cases.filter((c) => c.type === 'GZG');
  const etaAll = (c) => Math.max(c.eta ?? 0, c.etaV ?? 0);
  let etaMax = 0, governing = null;
  for (const c of cases) { const e = etaAll(c); if (!(e <= etaMax)) { etaMax = e; governing = c.i; } }

  const results = {
    geom: gm, mat, gross, grossMm, ideal, As, rho: As / gross.A, ref, refMode, secRef: G,
    mesh: secs.mesh, nFibers: secU.nFibers, axial, mrd,
    cases, ulsCases, slsCases, etaMax: cases.length ? etaMax : NaN, governing, warnings, shearGeo,
    secs,
  };
  // Verzögerte (rechenintensive) Auswertungen, nur bei Bedarf; Momente jeweils um den Bezugspunkt R
  const mkToR = (res, N, theta) => {
    if (res.error) return res;
    const f = (pt) => pt && { ...pt, M: dirToR(N, theta, pt.M) };
    return { ...res, points: res.points.map(f), crack: f(res.crack), yield: f(res.yield), ultimate: f(res.ultimate) };
  };
  results.lazy = {
    cap: capFor,
    nm: (axis) => memo(lazyMap, `nm|${axis}`, () => nmDiagram(secU, axis))
      .map((pt) => ({ N: pt.N, M: axis === 'Mz' ? pt.M - pt.N * dy : pt.M + pt.N * dz })),
    mymz: (N) => memo(lazyMap, `mymz|${N}`, () => mymzCurve(secU, N, 72)).map((pt) => ({ ...toR(N, pt.My, pt.Mz), theta: pt.theta })),
    mk: (law, N, theta) => mkToR(memo(lazyMap, `mk|${law}|${N}|${theta}|${mat.phi}`, () => {
      if (law === 'mean') {
        const laws = mat.mkMean();
        return mkCurve(secWith(`mean|${mat.phi}`, () => laws), N, theta, { crackStrain: mat.c.fctm / laws.c.Ec });
      }
      return mkCurve(mat.phi > 0 ? secWith(`mkd|${mat.phi}`, mat.mkDesign) : secU, N, theta);
    }), N, theta),
  };
  return results;
}

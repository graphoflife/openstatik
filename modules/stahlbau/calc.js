// Stahlbau – Stabnachweise nach EN 1993-1-1 bzw. SIA 263 (DOM-frei, in Node testbar)
//
// Ablauf compute(project):
//   Querschnitt (profiles.js) → Stab mit Schnittgrössen je Kombination (beam.js bzw. direkte Eingabe)
//   → je Kombination: Klassifizierung (Tab. 5.2), Querschnittsnachweise (6.2), Stabilität (6.3.1–6.3.3)
//   → Gebrauchstauglichkeit (Durchbiegung) → massgebende Ausnutzung.
// Interne Einheiten: N, mm (Querschnitt, Widerstände); Ein-/Ausgabe in kN, kNm, m.
import { structuralSteel } from '../../js/core/materials.js';
import { sectionProps, CATALOG } from './profiles.js';
import { mcrFormula, ltbEigen, cFactors, mcrUniform } from './ltb.js';
import { systemGeometry, normLoad, analyzeBeam, combine, autoCombos, defaultFactors, Incomplete } from './beam.js';

export const E_STEEL = 210000;
export const G_STEEL = 81000;
export const ALPHA = { a0: 0.13, a: 0.21, b: 0.34, c: 0.49, d: 0.76 };

// Normbezüge (EN 1993-1-1 massgebend für die Rechnung; SIA 263 sinngemäss)
const REF = {
  class: ['EN 1993-1-1 5.5, Tab. 5.2', 'SIA 263 Tab. 5'],
  N: ['EN 1993-1-1 6.2.3/6.2.4', 'SIA 263 Querschnittswiderstand'],
  V: ['EN 1993-1-1 6.2.6', 'SIA 263 Querschnittswiderstand'],
  Vb: ['EN 1993-1-5 5.2/5.3', 'SIA 263 Schubbeulen'],
  M: ['EN 1993-1-1 6.2.5/6.2.8', 'SIA 263 Querschnittswiderstand'],
  NM: ['EN 1993-1-1 6.2.9', 'SIA 263 Querschnittswiderstand'],
  Nb: ['EN 1993-1-1 6.3.1', 'SIA 263 4.5 (Knicken)'],
  NbT: ['EN 1993-1-1 6.3.1.4', 'SIA 263 4.5 (Knicken)'],
  Mb: ['EN 1993-1-1 6.3.2', 'SIA 263 4.5 (Kippen)'],
  int: ['EN 1993-1-1 6.3.3, Anhang B', 'SIA 263 4.5 (Druck und Biegung)'],
  w: ['EN 1990 A1.4', 'SIA 260 Tab. 3'],
};
export function ref(key, norm) {
  const r = REF[key];
  if (!r) return '';
  return norm === 'SIA' ? `${r[1]} · ${r[0]}` : r[0];
}

// ------------------------------------------------------------------ Knicken

/** Abminderungsfaktor χ für Biegeknicken (EN 1993-1-1 6.3.1.2). */
export function chiFlex(lam, curve) {
  const alpha = ALPHA[curve] ?? 0.49;
  if (!(lam > 0.2)) return { chi: 1, Phi: 0.5 * (1 + alpha * (lam - 0.2) + lam * lam), alpha };
  const Phi = 0.5 * (1 + alpha * (lam - 0.2) + lam * lam);
  const chi = Math.min(1, 1 / (Phi + Math.sqrt(Phi * Phi - lam * lam)));
  return { chi, Phi, alpha };
}

/**
 * χLT für Biegedrillknicken.
 * method: 'general' (6.3.2.2), 'rolled' (6.3.2.3 inkl. f-Modifikation mit kc), 'sia' (SIA 263: αLT 0.21/0.49, λ̄LT,0 = 0.4)
 */
export function chiLT(lam, alpha, method = 'general', kc = 1) {
  const lam0 = method === 'general' ? 0.2 : 0.4;
  const beta = method === 'rolled' ? 0.75 : 1;
  const Phi = 0.5 * (1 + alpha * (lam - lam0) + beta * lam * lam);
  if (!(lam > lam0)) return { chi: 1, chiMod: 1, Phi, f: 1, lam0, beta, alpha };
  let chi = 1 / (Phi + Math.sqrt(Phi * Phi - beta * lam * lam));
  chi = Math.min(chi, 1);
  if (method === 'rolled') chi = Math.min(chi, 1 / (lam * lam));
  let f = 1, chiMod = chi;
  if (method === 'rolled') {
    f = Math.min(1, 1 - 0.5 * (1 - kc) * (1 - 2 * (lam - 0.8) ** 2));
    chiMod = Math.min(1, 1 / (lam * lam), chi / f);
  }
  return { chi, chiMod, Phi, f, lam0, beta, alpha, kc };
}

/** Knicklinien nach Tab. 6.2 sowie Kipplinien nach Tab. 6.4/6.5. */
export function bucklingCurves(sec, grade) {
  const s460 = grade === 'S460';
  const out = {};
  if (sec.type === 'I') {
    const hb = sec.h / sec.b;
    if (hb > 1.2) {
      if (sec.tf <= 40) { out.y = s460 ? 'a0' : 'a'; out.z = s460 ? 'a0' : 'b'; } else { out.y = s460 ? 'a' : 'b'; out.z = s460 ? 'a' : 'c'; }
    } else if (sec.tf <= 100) { out.y = s460 ? 'a' : 'b'; out.z = s460 ? 'a' : 'c'; } else { out.y = s460 ? 'c' : 'd'; out.z = s460 ? 'c' : 'd'; }
    out.ltGeneral = hb <= 2 ? 'a' : 'b';
    out.ltRolled = hb <= 2 ? 'b' : 'c';
    out.ltSia = 'a';
  } else if (sec.type === 'WI') {
    if (sec.tf <= 40) { out.y = 'b'; out.z = 'c'; } else { out.y = 'c'; out.z = 'd'; }
    const hb = sec.h / sec.b;
    out.ltGeneral = hb <= 2 ? 'c' : 'd';
    out.ltRolled = hb <= 2 ? 'c' : 'd';
    out.ltSia = 'c';
  } else if (sec.type === 'RHS' || sec.type === 'CHS') {
    out.y = out.z = s460 ? 'a0' : 'a';
    out.ltGeneral = out.ltRolled = 'd';
    out.ltSia = 'a';
  } else if (sec.type === 'U') {
    out.y = out.z = 'c';
    out.ltGeneral = out.ltRolled = 'd';
    out.ltSia = 'a';
  } else {
    out.y = sec.curveY || 'b'; out.z = sec.curveZ || 'c';
    out.ltGeneral = out.ltRolled = out.ltSia = sec.ltbCurve || 'd';
  }
  return out;
}

// ------------------------------------------------------------------ Klassifizierung (Tab. 5.2)

/** Beulwert kσ für beidseitig gestützte Teile (EN 1993-1-5 Tab. 4.1). */
export function ksigmaInternal(psi) {
  if (psi >= 1) return 4;
  if (psi > 0) return 8.2 / (1.05 + psi);
  if (psi > -1) return 7.81 - 6.29 * psi + 9.78 * psi * psi;
  return 5.98 * (1 - Math.max(psi, -3)) ** 2;
}
/** Beulwert kσ für einseitig gestützte Teile (EN 1993-1-5 Tab. 4.2). tipMax: grösste Druckspannung am freien Rand. */
export function ksigmaOutstand(psi, tipMax) {
  if (tipMax) { const p = Math.max(-3, Math.min(1, psi)); return 0.57 - 0.21 * p + 0.07 * p * p; }
  if (psi >= 1) return 0.43;
  if (psi > 0) return 0.578 / (psi + 0.34);
  if (psi > -1) return 1.7 - 5 * psi + 17.1 * psi * psi;
  return 23.8;
}

/** Spannungsfunktion (Druck positiv) für N [N], My [Nmm], Mz [Nmm] bezogen auf Schwerpunkt yc/zc. */
function stressFn(A, Iy, Iz, N, My, Mz, yc = 0, zc = 0) {
  return ([y, z]) => N / A + (Iy > 0 ? My * (z - zc) / Iy : 0) + (Iz > 0 ? Mz * (y - yc) / Iz : 0);
}

/**
 * Klassifiziert den Querschnitt unter N (Druck +) [N], My, Mz [Nmm] (Beträge, ungünstige Richtung).
 * Rückgabe {cls, parts:[{label, kind, ct, lim:[l1,l2,l3], cls, psi, alpha}], method}
 */
export function classify(sec, fy, N, My, Mz) {
  const eps = Math.sqrt(235 / fy);
  if (sec.type === 'custom') return { cls: sec.userClass || 1, parts: [], eps, note: 'vom Benutzer vorgegeben' };
  if (sec.type === 'CHS') {
    const ct = sec.d / sec.t;
    const lim = [50 * eps * eps, 70 * eps * eps, 90 * eps * eps];
    const cls = ct <= lim[0] ? 1 : ct <= lim[1] ? 2 : ct <= lim[2] ? 3 : 4;
    return { cls, eps, parts: [{ label: 'Rohrwand d/t', kind: 'tube', ct, lim, cls }] };
  }
  let n = N, my = Math.abs(My), mz = Math.abs(Mz);
  if (Math.abs(n) < 1e-9 && my < 1e-9 && mz < 1e-9) my = 1; // ohne Beanspruchung: reine Biegung
  const sig = stressFn(sec.A, sec.Iy, sec.Iz, n, my, mz);
  // Plastische Druckzonenhöhe für Stege (Gradient aus My): α = 0.5 + N/(2·fy·Σc·t)
  const webArea = (orient) => sec.plates.filter((p) => p.kind === 'internal' && p.orient === orient).reduce((s, p) => s + p.c * p.t, 0);
  const parts = [];
  for (const pl of sec.plates) {
    const s1 = sig(pl.p1), s2 = sig(pl.p2);
    const ct = pl.c / pl.t;
    const r = { label: pl.label, id: pl.id, kind: pl.kind, ct, s1, s2 };
    if (s1 <= 1e-9 && s2 <= 1e-9) { Object.assign(r, { cls: 1, lim: [Infinity, Infinity, Infinity], psi: NaN, alpha: 0, tension: true }); parts.push(r); continue; }
    if (pl.kind === 'internal') {
      const smax = Math.max(s1, s2), smin = Math.min(s1, s2);
      const psi = smin / smax;
      let alpha = 1;
      if (psi < 1 - 1e-9) {
        // Gradient vorhanden: plastische Nulllinie aus N (EN 1993-1-1 Tab. 5.2, Stege)
        const gradMoment = pl.orient === 'v' ? my : mz;
        if (gradMoment > 1e-9) alpha = Math.max(0, Math.min(1, 0.5 + n / (2 * fy * webArea(pl.orient))));
        else alpha = psi >= 0 ? 1 : 1 / (1 - psi);
      }
      const l1 = alpha > 0.5 ? 396 * eps / (13 * alpha - 1) : 36 * eps / Math.max(alpha, 1e-6);
      const l2 = alpha > 0.5 ? 456 * eps / (13 * alpha - 1) : 41.5 * eps / Math.max(alpha, 1e-6);
      const l3 = psi > -1 ? 42 * eps / (0.67 + 0.33 * psi) : 62 * eps * (1 - psi) * Math.sqrt(-psi);
      Object.assign(r, { psi, alpha, lim: [l1, l2, l3] });
    } else {
      const tipMax = s2 >= s1;
      const psi = tipMax ? s1 / s2 : s2 / s1;
      const ks = ksigmaOutstand(psi, tipMax);
      // α = 1 (Druck über das ganze Teil, auf der sicheren Seite)
      Object.assign(r, { psi, alpha: 1, ks, tipMax, lim: [9 * eps, 10 * eps, 21 * eps * Math.sqrt(ks)] });
    }
    r.cls = ct <= r.lim[0] ? 1 : ct <= r.lim[1] ? 2 : ct <= r.lim[2] ? 3 : 4;
    parts.push(r);
  }
  const cls = parts.reduce((m, p) => Math.max(m, p.cls), 1);
  return { cls, parts, eps };
}

// ------------------------------------------------------------------ Wirksamer Querschnitt (Klasse 4)

/**
 * Wirksame Querschnittswerte nach EN 1993-1-5 4.3/4.4 für eine Beanspruchungsart.
 * load: 'N' (zentrischer Druck), 'My' (Biegung, Druck oben), 'Mz' (Biegung, Druck auf +y-Seite)
 * Zwei Durchgänge: Spannungsverteilung am Bruttoquerschnitt, dann am wirksamen Querschnitt.
 */
export function effectiveSection(sec, fy, load) {
  const eps = Math.sqrt(235 / fy);
  let holes = [];
  let props = { A: sec.A, Iy: sec.Iy, Iz: sec.Iz, yc: 0, zc: 0 };
  for (let pass = 0; pass < 2; pass++) {
    const sig = load === 'N' ? () => 1 : load === 'My' ? ([, z]) => (z - props.zc) : ([y]) => (y - props.yc);
    holes = [];
    for (const pl of sec.plates) {
      const s1 = sig(pl.p1), s2 = sig(pl.p2);
      if (s1 <= 0 && s2 <= 0) continue;
      const c = pl.c;
      let from, to, psi, ks, rho;
      if (pl.kind === 'internal') {
        const maxAtP1 = s1 >= s2;
        const smax = Math.max(s1, s2), smin = Math.min(s1, s2);
        psi = smin / smax;
        ks = ksigmaInternal(psi);
        const lp = (c / pl.t) / (28.4 * eps * Math.sqrt(ks));
        rho = lp <= 0.5 + Math.sqrt(Math.max(0, 0.085 - 0.055 * psi)) ? 1 : Math.min(1, (lp - 0.055 * (3 + psi)) / (lp * lp));
        if (rho >= 1) continue;
        let a, b; // Lochgrenzen vom Rand grösster Druckspannung aus
        if (psi >= 0) { const beff = rho * c, be1 = 2 * beff / (5 - psi), be2 = beff - be1; a = be1; b = c - be2; } else {
          const bc = c / (1 - psi), beff = rho * bc; a = 0.4 * beff; b = bc - 0.6 * beff;
        }
        [from, to] = maxAtP1 ? [a, b] : [c - b, c - a];
      } else {
        const tipMax = s2 >= s1;
        psi = tipMax ? s1 / s2 : s2 / s1;
        ks = ksigmaOutstand(psi, tipMax);
        const lp = (c / pl.t) / (28.4 * eps * Math.sqrt(ks));
        rho = lp <= 0.748 ? 1 : Math.min(1, (lp - 0.188) / (lp * lp));
        if (rho >= 1) continue;
        if (tipMax) {
          if (psi >= 0) { from = rho * c; to = c; } else { const bc = c / (1 - psi); from = c - bc + rho * bc; to = c; }
        } else if (psi >= 0) { from = rho * c; to = c; } else { const bc = c / (1 - psi); from = rho * bc; to = bc; }
      }
      if (to - from <= 1e-9) continue;
      const dir = [(pl.p2[0] - pl.p1[0]) / c, (pl.p2[1] - pl.p1[1]) / c];
      const mid = (from + to) / 2, len = to - from;
      const cy = pl.p1[0] + dir[0] * mid, cz = pl.p1[1] + dir[1] * mid;
      const dy = pl.orient === 'v' ? pl.t : len, dz = pl.orient === 'v' ? len : pl.t;
      holes.push({ plate: pl.id, label: pl.label, y: cy, z: cz, dy, dz, rho, psi, ks, from, to, c });
    }
    // Querschnittswerte ohne Löcher
    let A = sec.A, Sy = 0, Sz = 0;
    for (const hh of holes) { const a = hh.dy * hh.dz; A -= a; Sy -= a * hh.z; Sz -= a * hh.y; }
    const zc = Sy / A, yc = Sz / A;
    let Iy = sec.Iy + sec.A * zc * zc, Iz = sec.Iz + sec.A * yc * yc;
    for (const hh of holes) {
      const a = hh.dy * hh.dz;
      Iy -= hh.dy * hh.dz ** 3 / 12 + a * (hh.z - zc) ** 2;
      Iz -= hh.dz * hh.dy ** 3 / 12 + a * (hh.y - yc) ** 2;
    }
    props = { A, Iy, Iz, yc, zc };
  }
  const zTop = sec.zMax, zBot = -sec.zMax;
  const yR = sec.yMaxEdge ?? sec.yMax, yL = sec.yMinEdge ?? -sec.yMax;
  return {
    ...props, holes,
    Wy: props.Iy / Math.max(zTop - props.zc, props.zc - zBot),
    Wz: props.Iz / Math.max(yR - props.yc, props.yc - yL),
    eNy: props.yc, eNz: props.zc,
  };
}

// ------------------------------------------------------------------ Querschnittswiderstand

function shearAreas(sec, etaV) {
  let Avz = sec.Avz;
  if (sec.type === 'I' || sec.type === 'U') Avz = Math.max(sec.Avz, etaV * sec.AvzMin);
  if (sec.type === 'WI') Avz = etaV * sec.AvzMin;
  return { Avz, Avy: sec.Avy };
}

/** Querschnittsgrössen für die Nachweise je Klasse. */
function resistances(sec, mat, cls, effs, etaV) {
  const fy = mat.fy, g0 = mat.gammaM0, g1 = mat.gammaM1;
  const R = { cls, fy, g0, g1 };
  R.Aeff = cls === 4 && effs.N ? effs.N.A : sec.A;
  R.Wy = cls <= 2 ? sec.Wply : cls === 3 ? sec.Wely : (effs.My?.Wy ?? sec.Wely);
  R.Wz = cls <= 2 ? sec.Wplz : cls === 3 ? sec.Welz : (effs.Mz?.Wz ?? sec.Welz);
  R.eNy = cls === 4 && effs.N ? effs.N.eNy : 0;
  R.eNz = cls === 4 && effs.N ? effs.N.eNz : 0;
  R.NcRd = R.Aeff * fy / g0;
  R.NtRd = sec.A * fy / g0;
  R.McyRd = R.Wy * fy / g0;
  R.MczRd = R.Wz * fy / g0;
  const av = shearAreas(sec, etaV);
  R.Avz = av.Avz; R.Avy = av.Avy;
  R.VplzRd = av.Avz * fy / Math.sqrt(3) / g0;
  R.VplyRd = av.Avy * fy / Math.sqrt(3) / g0;
  // Schubbeulen (EN 1993-1-5 5.1(2)): hw/tw > 72·ε/η
  const eps = Math.sqrt(235 / fy);
  if (sec.type === 'I' || sec.type === 'WI' || sec.type === 'U' || sec.type === 'RHS') {
    const tw = sec.type === 'RHS' ? sec.t : sec.tw;
    const hw = sec.hw;
    R.hwtw = hw / tw;
    R.hwtwLim = 72 * eps / etaV;
    if (R.hwtw > R.hwtwLim) {
      const lw = hw / (86.4 * tw * eps); // nur Quersteifen an den Auflagern (kτ = 5.34)
      const chiw = lw < 0.83 / etaV ? etaV : 0.83 / lw;
      const nWebs = sec.type === 'RHS' ? 2 : 1;
      R.lamw = lw; R.chiw = chiw;
      R.VbRd = Math.min(R.VplzRd, chiw * fy * hw * tw * nWebs / (Math.sqrt(3) * g1));
    }
  }
  // Stegfläche für M-V-Interaktion
  if (sec.type === 'RHS') { R.Aw = 2 * sec.hw * sec.t; R.twEff = 2 * sec.t; } else if (sec.type === 'CHS' || sec.type === 'custom') { R.Aw = 0; } else { R.Aw = sec.hw * sec.tw; R.twEff = sec.tw; }
  return R;
}

/** Querschnittsnachweise an einer Stelle. f: {N (Druck +), My, Mz, Vz, Vy} in N, Nmm. */
function sectionCheck(sec, R, f) {
  const fy = R.fy, g0 = R.g0;
  const N = f.N, My = Math.abs(f.My), Mz = Math.abs(f.Mz), Vz = Math.abs(f.Vz), Vy = Math.abs(f.Vy);
  const out = {};
  out.N = { eta: N >= 0 ? N / R.NcRd : -N / R.NtRd, Ed: N, Rd: N >= 0 ? R.NcRd : -R.NtRd };
  out.Vz = { eta: Vz / R.VplzRd, Ed: Vz, Rd: R.VplzRd };
  out.Vy = { eta: Vy / R.VplyRd, Ed: Vy, Rd: R.VplyRd };
  if (R.VbRd) out.Vb = { eta: Vz / R.VbRd, Ed: Vz, Rd: R.VbRd };
  const rz = out.Vz.eta > 0.5 ? (2 * out.Vz.eta - 1) ** 2 : 0;
  const ry = out.Vy.eta > 0.5 ? (2 * out.Vy.eta - 1) ** 2 : 0;
  let MyV = R.McyRd;
  if (rz > 0) {
    if (sec.type === 'CHS' || sec.type === 'custom' || !R.Aw) MyV = (1 - Math.min(1, rz)) * R.McyRd;
    else if (R.cls <= 2) MyV = Math.min(R.McyRd, (R.Wy - rz * R.Aw * R.Aw / (4 * R.twEff)) * fy / g0);
    else MyV = Math.min(R.McyRd, (R.Wy - rz * R.twEff * sec.hw * sec.hw / 6) * fy / g0);
    MyV = Math.max(0, MyV);
  }
  const MzV = (1 - Math.min(1, ry)) * R.MczRd;
  out.My = { eta: MyV > 0 ? My / MyV : Infinity, Ed: My, Rd: MyV, rho: rz };
  out.Mz = { eta: MzV > 0 ? Mz / MzV : Infinity, Ed: Mz, Rd: MzV, rho: ry };
  // N + M
  const nm = { method: '' };
  if (R.cls <= 2 && (sec.type === 'I' || sec.type === 'WI' || sec.type === 'RHS' || sec.type === 'CHS')) {
    const Npl = Math.max(1e-9, R.NcRd - (rz > 0 && R.Aw ? rz * R.Aw * fy / g0 : 0));
    const n = Math.abs(N) / Npl;
    nm.n = n;
    if (n >= 1) { nm.eta = n; nm.method = 'n ≥ 1'; } else {
      let MNy, MNz, a, b;
      if (sec.type === 'I' || sec.type === 'WI') {
        const aw = Math.min(0.5, (sec.A - 2 * sec.b * sec.tf) / sec.A);
        const hwtwfy = sec.hw * sec.tw * fy / g0;
        MNy = n <= 0.25 && Math.abs(N) <= 0.5 * hwtwfy ? MyV : Math.min(MyV, MyV * (1 - n) / (1 - 0.5 * aw));
        MNz = Math.abs(N) <= hwtwfy || n <= aw ? MzV : MzV * (1 - ((n - aw) / (1 - aw)) ** 2);
        a = 2; b = Math.max(1, 5 * n);
        nm.a = aw; nm.method = 'plastisch (6.36–6.38, 6.41)';
      } else if (sec.type === 'RHS') {
        const aw = Math.min(0.5, (sec.A - 2 * sec.b * sec.t) / sec.A), af = Math.min(0.5, (sec.A - 2 * sec.h * sec.t) / sec.A);
        MNy = Math.min(MyV, MyV * (1 - n) / (1 - 0.5 * aw));
        MNz = Math.min(MzV, MzV * (1 - n) / (1 - 0.5 * af));
        a = b = Math.min(6, 1.66 / (1 - 1.13 * n * n));
        nm.a = aw; nm.method = 'plastisch (6.39–6.41)';
      } else {
        MNy = MyV * (1 - n ** 1.7); MNz = MzV * (1 - n ** 1.7);
        a = b = 2;
        nm.method = 'plastisch Rohr';
      }
      const xy = MNy > 0 ? My / MNy : Infinity, xz = MNz > 0 ? Mz / MNz : Infinity;
      nm.MNy = MNy; nm.MNz = MNz; nm.alpha = a; nm.beta = b;
      nm.eta = Math.max(xy, xz, xy ** a + xz ** b);
      if (Mz < 1e-6) nm.eta = Math.max(xy, n);
      if (My < 1e-6 && Mz > 1e-6) nm.eta = Math.max(xz, n);
    }
  } else {
    // linear (elastisch bzw. konservativ 6.2.1(7)); Klasse 4 mit Zusatzmomenten aus Schwerpunktverschiebung
    const NRd = N >= 0 ? R.NcRd : R.NtRd;
    const dMy = R.cls === 4 ? Math.abs(N) * Math.abs(R.eNz) : 0;
    const dMz = R.cls === 4 ? Math.abs(N) * Math.abs(R.eNy) : 0;
    nm.eta = Math.abs(N) / NRd + (My + dMy) / MyV + (Mz + dMz) / MzV;
    nm.method = R.cls <= 2 ? 'linear (6.2.1(7))' : R.cls === 3 ? 'elastisch (6.42)' : 'wirksamer Querschnitt (6.44)';
    nm.dMy = dMy; nm.dMz = dMz;
  }
  out.NM = nm;
  return out;
}

// ------------------------------------------------------------------ Momentenbeiwerte Cm (Anhang B, Tab. B.3)

/** Cm aus Momentenwerten an äquidistanten Stellen; type 'q' (Gleichlast) oder 'P' (Einzellast). */
export function cmFactor(Ms, type = 'q') {
  const n = Ms.length - 1;
  const Mmax = Math.max(...Ms.map(Math.abs));
  if (!(Mmax > 0)) return { Cm: 1, kind: 'none' };
  const MA = Ms[0], MB = Ms[n];
  let dev = 0;
  for (let i = 0; i <= n; i++) dev = Math.max(dev, Math.abs(Ms[i] - (MA + (MB - MA) * i / n)));
  const Mh = Math.abs(MA) >= Math.abs(MB) ? MA : MB;
  const other = Mh === MA ? MB : MA;
  const psi = Math.abs(Mh) > 1e-12 ? other / Mh : 1;
  if (dev <= 0.01 * Mmax) return { Cm: Math.max(0.4, 0.6 + 0.4 * psi), kind: 'linear', psi };
  // Feldmoment Ms = lokaler Extremwert im Feldinneren (Querkraftnullpunkt), sonst Wert in Feldmitte
  let Msp = null;
  for (let i = 1; i < n; i++) {
    if ((Ms[i] - Ms[i - 1]) * (Ms[i + 1] - Ms[i]) <= 0 && (Msp === null || Math.abs(Ms[i]) > Math.abs(Msp))) Msp = Ms[i];
  }
  if (Msp === null) Msp = Ms[Math.round(n / 2)];
  let Cm;
  if (Math.abs(Mh) >= Math.abs(Msp)) {
    const as = Msp / Mh;
    if (as >= 0) Cm = 0.2 + 0.8 * as;
    else if (psi >= 0) Cm = type === 'P' ? -0.8 * as : 0.1 - 0.8 * as;
    else Cm = type === 'P' ? 0.2 * (-psi) - 0.8 * as : 0.1 * (1 - psi) - 0.8 * as;
    return { Cm: Math.min(1, Math.max(0.4, Cm)), kind: 'Mh', psi, alphaS: as, Mh, Ms: Msp };
  }
  const ah = Mh / Msp;
  if (ah >= 0 || psi >= 0) Cm = type === 'P' ? 0.9 + 0.1 * ah : 0.95 + 0.05 * ah;
  else Cm = type === 'P' ? 0.9 + 0.1 * ah * (1 + 2 * psi) : 0.95 + 0.05 * ah * (1 + 2 * psi);
  return { Cm: Math.min(1, Math.max(0.4, Cm)), kind: 'Ms', psi, alphaH: ah, Mh, Ms: Msp };
}

/** Interaktionsbeiwerte nach Anhang B (Methode 2). */
export function interactionFactors(o) {
  // o: {plastic, susceptible, rhs, lamY, lamZ, nY, nZ, Cmy, Cmz, CmLT}
  const { plastic, susceptible, lamY, lamZ, nY, nZ, Cmy, Cmz, CmLT } = o;
  let kyy, kzz, kyz, kzy;
  if (plastic) {
    kyy = Cmy * Math.min(1 + (lamY - 0.2) * nY, 1 + 0.8 * nY);
    kzz = o.rhs ? Cmz * Math.min(1 + (lamZ - 0.2) * nZ, 1 + 0.8 * nZ) : Cmz * Math.min(1 + (2 * lamZ - 0.6) * nZ, 1 + 1.4 * nZ);
    kyz = 0.6 * kzz;
    if (!susceptible) kzy = 0.6 * kyy;
    else if (lamZ < 0.4) kzy = Math.min(0.6 + lamZ, 1 - 0.1 * lamZ * nZ / (CmLT - 0.25));
    else kzy = Math.max(1 - 0.1 * lamZ * nZ / (CmLT - 0.25), 1 - 0.1 * nZ / (CmLT - 0.25));
  } else {
    kyy = Cmy * Math.min(1 + 0.6 * lamY * nY, 1 + 0.6 * nY);
    kzz = Cmz * Math.min(1 + 0.6 * lamZ * nZ, 1 + 0.6 * nZ);
    kyz = kzz;
    kzy = susceptible ? Math.max(1 - 0.05 * lamZ * nZ / (CmLT - 0.25), 1 - 0.05 * nZ / (CmLT - 0.25)) : 0.8 * kyy;
  }
  return { kyy, kyz, kzy, kzz };
}

// ------------------------------------------------------------------ Stab aufbauen

const SHAPES = {
  lin: (x, psi) => 1 + (psi - 1) * x,
  q: (x) => 4 * x * (1 - x),
  P: (x) => 2 * Math.min(x, 1 - x),
  qe: (x) => 1 - 6 * x + 6 * x * x,
};
export const SHAPE_OPTIONS = [
  { value: 'lin', label: 'linear (ψ)' },
  { value: 'q', label: 'Parabel (Gleichlast)' },
  { value: 'P', label: 'Dreieck (Einzellast Mitte)' },
  { value: 'qe', label: 'Parabel, eingespannt' },
];

export function latRestraintPositions(p, L, supports, freeEnds) {
  const xs = new Set();
  for (const s of supports) xs.add(s.x);
  for (const r of p.stab?.restraints || []) if (Number.isFinite(r.x) && r.x > 1e-6 && r.x < L - 1e-6) xs.add(r.x);
  return [...xs].filter((x) => !freeEnds.some((f) => Math.abs(f - x) < 1e-9)).sort((a, b) => a - b);
}

function segmentsFrom(restr, L, freeEnds) {
  const segs = [];
  const pts = restr.slice();
  if (pts.length && pts[0] > 1e-9) segs.push({ x0: 0, x1: pts[0], freeStart: true });
  for (let i = 0; i < pts.length - 1; i++) segs.push({ x0: pts[i], x1: pts[i + 1] });
  if (pts.length && pts[pts.length - 1] < L - 1e-9) segs.push({ x0: pts[pts.length - 1], x1: L, freeEnd: true });
  if (!pts.length) segs.push({ x0: 0, x1: L, freeStart: true, freeEnd: true });
  for (const s of segs) s.L = s.x1 - s.x0;
  return segs.filter((s) => s.L > 1e-6);
}

/** Direkte Schnittgrössen: ein Stab der Länge L, je Zeile eine Bemessungssituation. */
function buildForcesMember(p) {
  const F = p.forces || {};
  const L = Number(F.L);
  if (!(L > 0)) throw new Error('Bitte eine Stablänge L grösser als 0 eingeben (Register «Belastung»).');
  const cases = F.cases || [];
  if (!cases.length) throw new Incomplete('Noch keine Bemessungsschnittgrössen erfasst.', 'Den Stab in der Grafik anklicken und im Eigenschaftsfenster «Situation hinzufügen» wählen – oder im Register «Belastung» mindestens eine Zeile mit N, My … erfassen.');
  const supports = [{ x: 0, type: 'pin' }, { x: L, type: 'pin' }];
  const n = 40;
  const xs = Array.from({ length: n + 1 }, (_, i) => L * i / n);
  const combos = cases.map((c, i) => {
    const sy = SHAPES[c.shapeY] ? c.shapeY : 'lin', sz = SHAPES[c.shapeZ] ? c.shapeZ : 'lin';
    const psiY = Number.isFinite(c.psiY) ? Math.max(-1, Math.min(1, c.psiY)) : 1, psiZ = Number.isFinite(c.psiZ) ? Math.max(-1, Math.min(1, c.psiZ)) : 1;
    const My = (x) => (c.My || 0) * SHAPES[sy](x / L, psiY);
    const Mz = (x) => (c.Mz || 0) * SHAPES[sz](x / L, psiZ);
    const loadZ = { q: () => 0, points: [], type: 'none' };
    if (sy === 'q') { const q = 8 * (c.My || 0) / (L * L); loadZ.q = () => q; loadZ.type = 'q'; }
    if (sy === 'qe') { const q = -12 * (c.My || 0) / (L * L); loadZ.q = () => q; loadZ.type = 'q'; }
    if (sy === 'P') { loadZ.points = [{ x: L / 2, P: 4 * (c.My || 0) / L }]; loadZ.type = 'P'; }
    const typeY = sy === 'P' ? 'P' : 'q', typeZ = sz === 'P' ? 'P' : 'q';
    const N = Number(c.N) || 0;
    return {
      id: `F${i + 1}`, name: c.name || `Bemessungssituation ${i + 1}`, type: 'ULS',
      My, Mz, Vz: () => Math.abs(c.Vz || 0), Vy: () => Math.abs(c.Vy || 0), N,
      loadZ, loadTypeY: typeY, loadTypeZ: typeZ, shapeY: sy, shapeZ: sz,
      sample: () => ({ x: xs, My: xs.map(My), Mz: xs.map(Mz), Vz: xs.map(() => Math.abs(c.Vz || 0)), Vy: xs.map(() => Math.abs(c.Vy || 0)), N: xs.map(() => N) }),
    };
  });
  const restr = latRestraintPositions(p, L, supports, []);
  return {
    mode: 'forces', L, supports, freeEnds: [], fields: [{ x0: 0, x1: L, L, cant: false }], combos, lcs: [], loads: [],
    restraints: restr, segments: segmentsFrom(restr, L, []),
  };
}

/** Träger mit Lasten: Schnittgrössen über die Stabstatik je Kombination. */
function buildBeamMember(p, sec, mat) {
  const b = p.beam || {};
  const geo = systemGeometry(b);
  const L = geo.L;
  const lcs = (b.loadCases || []).map((l) => ({ ...l }));
  if (!lcs.length) throw new Error('Keine Lastfälle definiert – bitte im Register «Belastung» einen Lastfall anlegen.');
  if (!(b.loads || []).length) {
    throw new Incomplete('Noch keine Lasten auf dem Träger.', 'Werkzeug «Streckenlast» (Taste Q) oder «Einzellast» (Taste F) wählen und auf den Träger klicken – oder im Register «Belastung» Lasten erfassen. Fertige Beispiele finden Sie oben unter «Beispiele».');
  }
  const ids = new Set(lcs.map((l) => l.id));
  const loads = [];
  for (const [i, ld] of (b.loads || []).entries()) {
    if (!ids.has(ld.lc)) throw new Error(`Last ${i + 1}: Der Lastfall «${ld.lc}» existiert nicht. Bitte einen vorhandenen Lastfall wählen.`);
    const nl = normLoad(ld, L);
    if (nl.type === 'P' && (ld.x1 < 0 || ld.x1 > L + 1e-9)) throw new Error(`Last ${i + 1}: Die Position x = ${ld.x1} m liegt ausserhalb des Trägers (0 … ${+L.toFixed(3)} m).`);
    if (nl.type === 'q' && nl.x2 - nl.x1 <= 1e-9 && nl.v1) throw new Error(`Last ${i + 1}: Linienlast mit Länge 0 – bitte x₂ grösser als x₁ wählen oder leer lassen (= ganze Länge).`);
    loads.push(nl);
  }
  if (b.selfWeight) {
    const gk = sec.A * 1e-6 * mat.gamma; // kN/m
    lcs.unshift({ id: 'EG', name: 'Eigengewicht', cat: 'G', auto: true });
    loads.push({ lc: 'EG', type: 'q', dir: 'z', v1: gk, v2: gk, x1: 0, x2: L, self: true });
  }
  const restr = latRestraintPositions(p, L, geo.supports, geo.freeEnds);
  const EIy = E_STEEL * 1e3 * sec.Iy * 1e-12, EIz = E_STEEL * 1e3 * sec.Iz * 1e-12; // kNm²
  const an = analyzeBeam(b, lcs, loads, EIy, EIz, restr);
  const pattern = geo.fields.length > 1; // Durchlaufträger, Kragarme: feldweise Laststellung
  let combos;
  const fac = { ...defaultFactors(p.norm), ...(p.combos?.factors || {}) };
  if (p.combos?.auto === false && (p.combos.manual || []).length) {
    combos = p.combos.manual.map((c, i) => {
      const factors = { ...(c.f || {}) };
      for (const [k, v] of Object.entries(c)) if (k.startsWith('f_') && Number.isFinite(v)) factors[k.slice(2)] = v;
      return { id: `M${i + 1}`, name: c.name || `Kombination ${i + 1}`, type: c.type || 'ULS', factors };
    });
    if (b.selfWeight) for (const c of combos) if (c.factors.EG === undefined || c.factors.EG === null) {
      // Eigengewicht wie die übrigen ständigen Lasten
      const g = lcs.find((l) => l.cat === 'G' && !l.auto);
      c.factors.EG = g ? (c.factors[g.id] ?? (c.type === 'ULS' ? fac.gG : 1)) : (c.type === 'ULS' ? fac.gG : 1);
    }
  } else combos = autoCombos(lcs, fac, { pattern });
  for (const c of combos) {
    const cb = combine(an, c.factors);
    c.My = (x, side) => cb.z.M(x, side);
    c.Vz = (x, side) => cb.z.V(x, side);
    c.Mz = (x, side) => cb.y.M(x, side);
    c.Vy = (x, side) => cb.y.V(x, side);
    c.N = cb.N;
    c.wz = cb.z.w; c.wy = cb.y.w;
    // Querlasten in z ohne Eigengewicht (für Lastangriffshöhe beim Kippen)
    const userZ = loads.filter((l) => l.dir === 'z' && !l.self && c.factors[l.lc]);
    c.loadZ = {
      q: (x) => { let q = 0; for (const l of userZ) if (l.type === 'q' && x >= Math.min(l.x1, l.x2) - 1e-9 && x <= Math.max(l.x1, l.x2) + 1e-9) q += c.factors[l.lc] * (l.v1 + (l.v2 - l.v1) * (x - l.x1) / ((l.x2 - l.x1) || 1)); return q; },
      points: userZ.filter((l) => l.type === 'P').map((l) => ({ x: l.x1, P: c.factors[l.lc] * l.v1 })),
      loads: userZ.map((l) => ({ ...l, f: c.factors[l.lc] })),
    };
    c.sample = () => {
      const x = [], My = [], Vz = [], Mz = [], Vy = [], N = [];
      an.el.forEach((e, i) => {
        for (const s of [0, e.l]) {
          const zz = cb.z.evalAt(i, s), yy = cb.y.evalAt(i, s);
          x.push(e.x0 + s); My.push(zz.M); Vz.push(zz.V); Mz.push(yy.M); Vy.push(yy.V); N.push(cb.N);
        }
      });
      return { x, My, Vz, Mz, Vy, N };
    };
  }
  return {
    mode: 'beam', L, supports: geo.supports, freeEnds: geo.freeEnds, fields: geo.fields, system: geo.system, combos, lcs, loads, an,
    restraints: restr, segments: segmentsFrom(restr, L, geo.freeEnds), factors: fac,
  };
}

// ------------------------------------------------------------------ Nachweise je Kombination

/** Lastrichtung der Querlasten in einem Bereich (+1 nach unten). */
function loadDirection(cb, x0, x1) {
  let s = 0;
  const n = 20;
  for (let i = 0; i <= n; i++) s += cb.loadZ.q(x0 + (x1 - x0) * i / n) * (x1 - x0) / n;
  for (const pt of cb.loadZ.points) if (pt.x >= x0 - 1e-9 && pt.x <= x1 + 1e-9) s += pt.P;
  return s > 0 ? 1 : s < 0 ? -1 : 0;
}

function loadTypeIn(cb, x0, x1, member) {
  if (member.mode === 'forces') return cb.loadTypeY;
  const ls = (cb.loadZ.loads || []).filter((l) => (l.type === 'P' ? l.x1 >= x0 - 1e-9 && l.x1 <= x1 + 1e-9 : Math.max(l.x1, l.x2) > x0 && Math.min(l.x1, l.x2) < x1));
  if (ls.length && ls.every((l) => l.type === 'P')) return 'P';
  return 'q';
}

const samplesOn = (fn, x0, x1, n = 16) => Array.from({ length: n + 1 }, (_, i) => fn(x0 + (x1 - x0) * i / n, i === 0 ? 1 : -1));

function gammaSet(p) {
  const norm = p.norm === 'EC' ? 'EC' : 'SIA';
  const d = norm === 'SIA' ? { M0: 1.05, M1: 1.05 } : { M0: 1.0, M1: 1.0 };
  if (p.gamma && p.gamma.auto === false) return { M0: Number(p.gamma.M0) || d.M0, M1: Number(p.gamma.M1) || d.M1 };
  return d;
}

/** Wählt das χLT-Verfahren. */
export function ltbMethod(p, sec) {
  const m = p.stab?.chiLT || 'auto';
  if (m !== 'auto') return (m === 'rolled' && !(sec.type === 'I' || sec.type === 'WI')) ? 'general' : m;
  if (p.norm !== 'EC') return 'sia';
  return sec.type === 'I' || sec.type === 'WI' ? 'rolled' : 'general';
}

function checkCombo(ctx, member, cb, p) {
  const { sec, mat, curves, etaV } = ctx;
  const stab = p.stab || {};
  const fy = mat.fy;
  const smp = cb.sample();
  const nSt = smp.x.length;
  // Einhüllende für Klassifizierung
  let Nc = -Infinity, MyMax = 0, MzMax = 0, xMy = 0;
  for (let i = 0; i < nSt; i++) {
    Nc = Math.max(Nc, smp.N[i]);
    if (Math.abs(smp.My[i]) > MyMax) { MyMax = Math.abs(smp.My[i]); xMy = smp.x[i]; }
    MzMax = Math.max(MzMax, Math.abs(smp.Mz[i]));
  }
  const NcN = Math.max(0, Nc) * 1e3;
  const klass = classify(sec, fy, NcN, MyMax * 1e6, MzMax * 1e6);
  const cls = klass.cls;
  const effs = {};
  if (cls === 4 && sec.plates?.length) {
    effs.N = effectiveSection(sec, fy, 'N');
    effs.My = effectiveSection(sec, fy, 'My');
    effs.Mz = effectiveSection(sec, fy, 'Mz');
  }
  const R = resistances(sec, mat, cls, effs, etaV);
  // Querschnittsnachweise an allen Stellen
  const cs = {};
  const keep = (key, val, x, extra) => {
    if (!cs[key] || val.eta > cs[key].eta + 1e-12) cs[key] = { ...val, x, ...extra };
  };
  for (let i = 0; i < nSt; i++) {
    const r = sectionCheck(sec, R, { N: smp.N[i] * 1e3, My: smp.My[i] * 1e6, Mz: smp.Mz[i] * 1e6, Vz: smp.Vz[i] * 1e3, Vy: smp.Vy[i] * 1e3 });
    const x = smp.x[i];
    keep('N', r.N, x); keep('Vz', r.Vz, x); keep('Vy', r.Vy, x); if (r.Vb) keep('Vb', r.Vb, x);
    keep('My', r.My, x); keep('Mz', r.Mz, x);
    keep('NM', { ...r.NM, Ed: undefined, Rd: undefined }, x, { N: smp.N[i], My: smp.My[i], Mz: smp.Mz[i], Vz: smp.Vz[i] });
  }
  const st = stability(ctx, member, cb, smp, R, effs, p, { Nc, MyMax, MzMax });
  return { combo: cb, smp, klass, cls, effs, R, cs, st, Nc, MyMax, MzMax, xMy };
}

function stability(ctx, member, cb, smp, R, effs, p, env) {
  const { sec, mat, curves } = ctx;
  const stab = p.stab || {};
  const fy = mat.fy, g1 = mat.gammaM1;
  const E = E_STEEL, G = G_STEEL;
  const out = { segments: [] };
  const NEd = Math.max(0, env.Nc) * 1e3; // N
  const LrefY = Math.max(...member.fields.map((f) => f.L));
  const segs = member.segments;
  const LsegMax = Math.max(...segs.map((s) => s.L));
  const betaY = Number(stab.betaY) > 0 ? Number(stab.betaY) : 1, betaZ = Number(stab.betaZ) > 0 ? Number(stab.betaZ) : 1;
  const LcrY = betaY * LrefY * 1000, LcrZ = betaZ * LsegMax * 1000;
  const NRk = R.Aeff * fy;
  const NcrY = Math.PI ** 2 * E * sec.Iy / (LcrY * LcrY);
  const NcrZ = Math.PI ** 2 * E * sec.Iz / (LcrZ * LcrZ);
  const lamY = Math.sqrt(NRk / NcrY), lamZ = Math.sqrt(NRk / NcrZ);
  const fY = chiFlex(lamY, curves.y), fZ = chiFlex(lamZ, curves.z);
  Object.assign(out, { NEd, LrefY, LsegMax, LcrY, LcrZ, NRk, NcrY, NcrZ, lamY, lamZ, chiY: fY.chi, chiZ: fZ.chi, PhiY: fY.Phi, PhiZ: fZ.Phi, alphaY: fY.alpha, alphaZ: fZ.alpha, curveY: curves.y, curveZ: curves.z });
  out.NbyRd = fY.chi * NRk / g1;
  out.NbzRd = fZ.chi * NRk / g1;
  // Drill- bzw. Biegedrillknicken (offene Querschnitte)
  out.chiT = 1;
  if (sec.type === 'I' || sec.type === 'WI' || sec.type === 'U') {
    const kw = Number(stab.kw) || 1;
    const LT = kw * LsegMax * 1000;
    const i02 = sec.iy ** 2 + sec.iz ** 2 + (sec.y0 || 0) ** 2;
    const NcrT = (G * sec.It + Math.PI ** 2 * E * sec.Iw / (LT * LT)) / i02;
    let Ncr = NcrT;
    if (sec.type === 'U') {
      const beta = 1 - (sec.y0 ** 2) / i02;
      const s = NcrY + NcrT;
      Ncr = (s - Math.sqrt(s * s - 4 * beta * NcrY * NcrT)) / (2 * beta);
      out.NcrTF = Ncr;
    }
    const lamT = Math.sqrt(NRk / Ncr);
    const fT = chiFlex(lamT, curves.z);
    Object.assign(out, { LT, i02, NcrT, NcrTorsion: Ncr, lamT, chiT: fT.chi, PhiT: fT.Phi, NbTRd: fT.chi * NRk / g1, torsional: true });
  }
  // Kippen
  const susceptibleSection = !(sec.closed);
  const ltbActive = susceptibleSection && stab.ltb !== false && !stab.contRestraint && env.MyMax > 1e-9;
  out.ltbActive = ltbActive;
  out.ltbReason = !susceptibleSection ? 'Hohlprofil – nicht kippgefährdet' : stab.ltb === false ? 'Kippnachweis ausgeschaltet' : stab.contRestraint ? 'Druckgurt durchgehend seitlich gehalten' : env.MyMax <= 1e-9 ? 'kein Biegemoment My' : '';
  const method = ltbMethod(p, sec);
  out.ltbMethod = method;
  const lpos = stab.loadPos || 'top';
  const zgGeom = lpos === 'top' ? sec.h / 2 : lpos === 'bottom' ? -sec.h / 2 : 0;
  out.zgGeom = zgGeom;
  const kAll = Number(stab.k) || 1, kwAll = Number(stab.kw) || 1;
  const endFix = (kv) => ({ start: kv < 0.95, end: kv < 0.6 });
  const kFix = endFix(kAll), kwFix = endFix(kwAll);
  // globale FE-Analyse (bei Bedarf, einmal je Kombination)
  let feGlobal = null;
  const runFE = (zq) => {
    const Lmm = member.L * 1000;
    const restraints = member.restraints.map((x) => ({ x: x * 1000, v: true, phi: true }));
    const atStart = restraints.find((r) => r.x < 1e-6), atEnd = restraints.find((r) => r.x > Lmm - 1e-6);
    if (atStart) { atStart.dv = kFix.start; atStart.dphi = kwFix.start; }
    if (atEnd) { atEnd.dv = kFix.end; atEnd.dphi = kwFix.end; }
    const nodesAt = [];
    for (const l of cb.loadZ.loads || []) { if (l.type === 'q') nodesAt.push(l.x1 * 1000, l.x2 * 1000); }
    return ltbEigen({
      L: Lmm, E, G, Iz: sec.Iz, It: sec.It, Iw: sec.Iw,
      M: (x) => cb.My(x / 1000) * 1e6,
      q: (x) => cb.loadZ.q(x / 1000), zq,
      points: cb.loadZ.points.map((pt) => ({ x: pt.x * 1000, P: pt.P * 1000, z: zq })),
      restraints, nodesAt, nel: Math.min(48, Math.max(24, 8 * member.segments.length)),
    });
  };
  const getFE = () => { if (!feGlobal) feGlobal = runFE(zgGeom); return feGlobal; };
  const Wy = R.Wy;
  const curveLT = method === 'general' ? curves.ltGeneral : method === 'rolled' ? curves.ltRolled : curves.ltSia;
  const alphaLT = method === 'sia' ? (sec.type === 'WI' ? 0.49 : 0.21) : ALPHA[curveLT];
  // Cmy über das Feld mit dem grössten Moment (zwischen in z gehaltenen Punkten = Auflager)
  const fieldOf = (x) => member.fields.find((f) => x >= f.x0 - 1e-9 && x <= f.x1 + 1e-9) || member.fields[0];
  for (const seg of segs) {
    const S = { ...seg };
    // Bemessungswerte im Segment
    let MyS = 0, MzS = 0, xS = seg.x0, NS = 0;
    for (let i = 0; i < smp.x.length; i++) {
      const x = smp.x[i];
      if (x < seg.x0 - 1e-9 || x > seg.x1 + 1e-9) continue;
      if (Math.abs(smp.My[i]) > MyS) { MyS = Math.abs(smp.My[i]); xS = x; }
      MzS = Math.max(MzS, Math.abs(smp.Mz[i]));
      NS = Math.max(NS, smp.N[i]);
    }
    Object.assign(S, { MyEd: MyS, MzEd: MzS, xMy: xS, NEd: Math.max(0, NS) });
    const MsY = samplesOn((x, s) => cb.My(x, s), seg.x0, seg.x1);
    const MsZ = samplesOn((x, s) => cb.Mz(x, s), seg.x0, seg.x1);
    const ltype = loadTypeIn(cb, seg.x0, seg.x1, member);
    S.CmLT = cmFactor(MsY, ltype);
    const fld = fieldOf(xS);
    const MsF = samplesOn((x, s) => cb.My(x, s), fld.x0, fld.x1);
    S.Cmy = stab.swayY ? { Cm: 0.9, kind: 'sway' } : cmFactor(MsF, loadTypeIn(cb, fld.x0, fld.x1, member));
    S.Cmz = stab.swayZ ? { Cm: 0.9, kind: 'sway' } : cmFactor(MsZ, member.mode === 'forces' ? cb.loadTypeZ : 'q');
    // Mcr
    if (ltbActive && MyS > 1e-9) {
      const touchesStart = Math.abs(seg.x0) < 1e-9 && !seg.freeStart, touchesEnd = Math.abs(seg.x1 - member.L) < 1e-9 && !seg.freeEnd;
      const nk = (touchesStart && kFix.start ? 1 : 0) + (touchesEnd && kFix.end ? 1 : 0);
      const nkw = (touchesStart && kwFix.start ? 1 : 0) + (touchesEnd && kwFix.end ? 1 : 0);
      const kSeg = nk === 2 ? 0.5 : nk === 1 ? 0.7 : 1;
      const kwSeg = nkw === 2 ? 0.5 : nkw === 1 ? 0.7 : 1;
      Object.assign(S, { k: kSeg, kw: kwSeg });
      const dir = loadDirection(cb, seg.x0, seg.x1);
      const zgEff = zgGeom * (dir || 1);
      S.zg = zgEff;
      const free = seg.freeStart || seg.freeEnd;
      const cf = cFactors(MsY, kSeg);
      S.shape = cf.shape; S.psi = cf.psi;
      let useFE = stab.mcr === 'fe' || free;
      let C1 = cf.C1, C2 = cf.C2, csrc = cf.source;
      if (stab.mcr !== 'fe' && stab.cAuto === false && !free) { C1 = Number(stab.C1) || 1; C2 = Number(stab.C2) || 0; csrc = 'vom Benutzer vorgegeben'; useFE = false; } else if (stab.mcr !== 'fe' && cf.needsFE) useFE = true;
      if (!useFE) {
        const f = mcrFormula({ E, G, Iz: sec.Iz, It: sec.It, Iw: sec.Iw, L: seg.L * 1000, k: kSeg, kw: kwSeg, C1, C2, zg: zgEff });
        Object.assign(S, { Mcr: f.Mcr, C1, C2, csrc, mcrBy: 'formula', formula: f });
      } else {
        const fe = getFE();
        const Mcr = fe.lambda * MyS * 1e6;
        const M0 = mcrUniform(E, G, sec.Iz, sec.It, sec.Iw, seg.L * 1000);
        const reason = free ? 'Kragarm – 3-Faktoren-Formel nicht anwendbar' : stab.mcr === 'fe' ? 'Eigenwertanalyse gewählt' : 'nicht tabellierter Momentenverlauf';
        Object.assign(S, { Mcr, C1eq: Mcr / M0, csrc: reason, mcrBy: 'fe', lambdaCr: fe.lambda });
      }
      S.lamLT = Math.sqrt(Wy * fy / S.Mcr);
      const kc = method === 'rolled' ? kcFactor(cf) : 1;
      const lt = chiLT(S.lamLT, alphaLT, method, kc);
      S.lt = lt; S.chiLT = lt.chiMod; S.kc = kc; S.alphaLT = alphaLT; S.curveLT = method === 'sia' ? (sec.type === 'WI' ? 'c' : 'a') : curveLT;
      S.MbRd = S.chiLT * Wy * fy / g1;
      S.etaLT = MyS * 1e6 / S.MbRd;
    } else {
      S.chiLT = 1;
      S.MbRd = Wy * fy / g1;
    }
    // Interaktion 6.3.3
    const MyRk = Wy * fy, MzRk = R.Wz * fy;
    const NEdS = S.NEd * 1e3;
    const dMy = R.cls === 4 ? NEdS * Math.abs(R.eNz) : 0, dMz = R.cls === 4 ? NEdS * Math.abs(R.eNy) : 0;
    const My = MyS * 1e6, Mz = MzS * 1e6;
    if (env.Nc >= -1e-9) {
      const nY = NEdS / (out.chiY * NRk / g1), nZ = NEdS / (out.chiZ * NRk / g1);
      const susceptible = ltbActive;
      const CmLT = Math.max(0.4, S.CmLT.Cm);
      const kf = interactionFactors({ plastic: R.cls <= 2, susceptible, rhs: sec.closed, lamY, lamZ, nY, nZ, Cmy: S.Cmy.Cm, Cmz: S.Cmz.Cm, CmLT });
      const chiZN = Math.min(out.chiZ, out.chiT);
      const tN1 = NEdS / (out.chiY * NRk / g1), tN2 = NEdS / (chiZN * NRk / g1);
      const tMy = (My + dMy) / (S.chiLT * MyRk / g1), tMz = (Mz + dMz) / (MzRk / g1);
      Object.assign(S, { nY, nZ, kf, susceptible, int61: tN1 + kf.kyy * tMy + kf.kyz * tMz, int62: tN2 + kf.kzy * tMy + kf.kzz * tMz, terms: { tN1, tN2, tMy, tMz }, dMy, dMz, chiZN });
    } else {
      // Zug + Biegung: Kippen und Biegung um z linear (auf der sicheren Seite)
      S.tension = true;
      S.intT = My / (S.chiLT * MyRk / g1) + Mz / (MzRk / g1);
    }
    out.segments.push(S);
  }
  return out;
}

/** Korrekturbeiwert kc (Tab. 6.6). */
function kcFactor(cf) {
  if (cf.shape === 'linear') return 1 / (1.33 - 0.33 * cf.psi);
  if (cf.shape === 'q') return 0.94;
  if (cf.shape === 'P' || cf.shape === 'qe') return 0.90;
  return 1;
}

// ------------------------------------------------------------------ Gebrauchstauglichkeit

function slsChecks(member, p) {
  const lim = { 'SLS-char': Number(p.sls?.limitChar) || 300, 'SLS-qp': Number(p.sls?.limitQp) || 250 };
  const out = [];
  for (const c of member.combos) {
    if (!c.type.startsWith('SLS')) continue;
    for (const dir of ['z', 'y']) {
      const w = dir === 'z' ? c.wz : c.wy;
      if (!w) continue;
      for (const f of member.fields) {
        let wm = 0, xm = f.x0;
        member.an.X.forEach((x, i) => { if (x >= f.x0 - 1e-9 && x <= f.x1 + 1e-9 && Math.abs(w[i]) > Math.abs(wm)) { wm = w[i]; xm = x; } });
        if (dir === 'y' && Math.abs(wm) < 1e-9) continue;
        const Lr = f.cant ? 2 * f.L : f.L;
        const wl = Lr * 1000 / lim[c.type];
        out.push({ combo: c, dir, field: f, w: wm, x: xm, wLim: wl, limit: lim[c.type], cant: f.cant, eta: Math.abs(wm) / wl, ratio: Math.abs(wm) > 1e-9 ? f.L * 1000 / Math.abs(wm) : Infinity });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ Hauptfunktion

export function materialFor(p, sec) {
  const g = gammaSet(p);
  return structuralSteel(p.steel || 'S355', { norm: p.norm === 'EC' ? 'EC' : 'SIA', t: sec.tmax, gammaM0: g.M0, gammaM1: g.M1 });
}

export function compute(p) {
  const sec = sectionProps(p.section || {});
  const norm = p.norm === 'EC' ? 'EC' : 'SIA';
  const mat = materialFor(p, sec);
  const curves = bucklingCurves(sec, p.steel);
  const ctx = { sec, mat, curves, norm, etaV: norm === 'EC' ? 1.2 : 1.0 };
  const member = p.mode === 'forces' ? buildForcesMember(p) : buildBeamMember(p, sec, mat);
  const warnings = [];
  const ulsCombos = member.combos.filter((c) => c.type === 'ULS');
  if (!ulsCombos.length) throw new Error('Keine Kombination für die Tragsicherheit vorhanden – bitte im Register «Kombinationen» eine ULS-Kombination anlegen.');
  const uls = ulsCombos.map((c) => checkCombo(ctx, member, c, p));
  const sls = member.mode === 'beam' ? slsChecks(member, p) : [];

  // Nachweisliste: je Nachweis das Maximum über alle Kombinationen
  const checks = [];
  const add = (c) => { if (c && Number.isFinite(c.eta) || c?.eta === Infinity) checks.push(c); };
  const worst = (fn) => {
    let best = null;
    for (const u of uls) { const v = fn(u); if (v && (!best || v.eta > best.eta)) best = { ...v, u }; }
    return best;
  };
  const kN = (v) => v / 1e3, kNm = (v) => v / 1e6;
  const hasN = uls.some((u) => Math.abs(u.Nc) > 1e-9 || u.smp.N.some((n) => Math.abs(n) > 1e-9));
  const hasMz = uls.some((u) => u.MzMax > 1e-9);
  const hasVy = uls.some((u) => u.cs.Vy.Ed > 1e-9);
  const hasMy = uls.some((u) => u.MyMax > 1e-9);
  const wN = worst((u) => u.cs.N);
  if (hasN) add({ id: 'N', group: 'Querschnitt', label: wN.Ed >= 0 ? 'Normalkraft (Druck)' : 'Normalkraft (Zug)', ref: ref('N', norm), Ed: kN(Math.abs(wN.Ed)), Rd: kN(Math.abs(wN.Rd)), unit: 'kN', eta: wN.eta, u: wN.u, x: wN.x });
  const wVz = worst((u) => u.cs.Vz);
  add({ id: 'Vz', group: 'Querschnitt', label: 'Querkraft Vz', ref: ref('V', norm), Ed: kN(wVz.Ed), Rd: kN(wVz.Rd), unit: 'kN', eta: wVz.eta, u: wVz.u, x: wVz.x });
  const wVb = worst((u) => u.cs.Vb);
  if (wVb) add({ id: 'Vb', group: 'Querschnitt', label: 'Schubbeulen Steg', ref: ref('Vb', norm), Ed: kN(wVb.Ed), Rd: kN(wVb.Rd), unit: 'kN', eta: wVb.eta, u: wVb.u, x: wVb.x });
  if (hasVy) { const w = worst((u) => u.cs.Vy); add({ id: 'Vy', group: 'Querschnitt', label: 'Querkraft Vy', ref: ref('V', norm), Ed: kN(w.Ed), Rd: kN(w.Rd), unit: 'kN', eta: w.eta, u: w.u, x: w.x }); }
  if (hasMy) { const w = worst((u) => u.cs.My); add({ id: 'My', group: 'Querschnitt', label: w.rho > 0 ? 'Biegung My (mit Querkraft)' : 'Biegung My', ref: ref('M', norm), Ed: kNm(w.Ed), Rd: kNm(w.Rd), unit: 'kNm', eta: w.eta, u: w.u, x: w.x }); }
  if (hasMz) { const w = worst((u) => u.cs.Mz); add({ id: 'Mz', group: 'Querschnitt', label: 'Biegung Mz', ref: ref('M', norm), Ed: kNm(w.Ed), Rd: kNm(w.Rd), unit: 'kNm', eta: w.eta, u: w.u, x: w.x }); }
  if ((hasN && (hasMy || hasMz)) || (hasMy && hasMz)) {
    const w = worst((u) => u.cs.NM);
    add({ id: 'NM', group: 'Querschnitt', label: hasN ? 'Normalkraft und Biegung' : 'Zweiachsige Biegung', ref: ref('NM', norm), eta: w.eta, u: w.u, x: w.x, detail: w.method });
  }
  // Stabilität
  const anyComp = uls.some((u) => u.Nc > 1e-9);
  if (anyComp) {
    const wy = worst((u) => (u.Nc > 1e-9 ? { eta: u.st.NEd / u.st.NbyRd, Ed: u.st.NEd, Rd: u.st.NbyRd } : null));
    add({ id: 'Nby', group: 'Stabilität', label: 'Biegeknicken um y-y', ref: ref('Nb', norm), Ed: kN(wy.Ed), Rd: kN(wy.Rd), unit: 'kN', eta: wy.eta, u: wy.u });
    const wz = worst((u) => (u.Nc > 1e-9 ? { eta: u.st.NEd / u.st.NbzRd, Ed: u.st.NEd, Rd: u.st.NbzRd } : null));
    add({ id: 'Nbz', group: 'Stabilität', label: 'Biegeknicken um z-z', ref: ref('Nb', norm), Ed: kN(wz.Ed), Rd: kN(wz.Rd), unit: 'kN', eta: wz.eta, u: wz.u });
    const wt = worst((u) => (u.Nc > 1e-9 && u.st.torsional ? { eta: u.st.NEd / u.st.NbTRd, Ed: u.st.NEd, Rd: u.st.NbTRd } : null));
    if (wt) add({ id: 'NbT', group: 'Stabilität', label: sec.type === 'U' ? 'Biegedrillknicken (zentrischer Druck)' : 'Drillknicken', ref: ref('NbT', norm), Ed: kN(wt.Ed), Rd: kN(wt.Rd), unit: 'kN', eta: wt.eta, u: wt.u });
  }
  const wLT = worst((u) => { let b = null; for (const s of u.st.segments) if (s.etaLT !== undefined && (!b || s.etaLT > b.eta)) b = { eta: s.etaLT, Ed: s.MyEd * 1e6, Rd: s.MbRd, seg: s }; return b; });
  if (wLT) add({ id: 'Mb', group: 'Stabilität', label: 'Biegedrillknicken (Kippen)', ref: ref('Mb', norm), Ed: kNm(wLT.Ed), Rd: kNm(wLT.Rd), unit: 'kNm', eta: wLT.eta, u: wLT.u, seg: wLT.seg });
  if (anyComp || (hasMz && hasMy)) {
    const w61 = worst((u) => { let b = null; for (const s of u.st.segments) if (s.int61 !== undefined && (!b || s.int61 > b.eta)) b = { eta: s.int61, seg: s }; return b; });
    const w62 = worst((u) => { let b = null; for (const s of u.st.segments) if (s.int62 !== undefined && (!b || s.int62 > b.eta)) b = { eta: s.int62, seg: s }; return b; });
    if (w61) add({ id: 'int61', group: 'Stabilität', label: 'Interaktion N + M (6.61)', ref: ref('int', norm), eta: w61.eta, u: w61.u, seg: w61.seg, detail: 'Ausweichen in y-Richtung (Biegeknicken y-y)' });
    if (w62) add({ id: 'int62', group: 'Stabilität', label: 'Interaktion N + M (6.62)', ref: ref('int', norm), eta: w62.eta, u: w62.u, seg: w62.seg, detail: 'Ausweichen aus der Ebene (Knicken z-z / Kippen)' });
  }
  const wT = worst((u) => { let b = null; for (const s of u.st.segments) if (s.intT !== undefined && u.MzMax > 1e-9 && (!b || s.intT > b.eta)) b = { eta: s.intT, seg: s }; return b; });
  if (wT) add({ id: 'intT', group: 'Stabilität', label: 'Kippen und Biegung Mz (Zug)', ref: ref('Mb', norm), eta: wT.eta, u: wT.u, seg: wT.seg });
  // Gebrauchstauglichkeit
  for (const type of ['SLS-char', 'SLS-qp']) {
    const list = sls.filter((s) => s.combo.type === type);
    if (!list.length) continue;
    const w = list.reduce((a, b) => (b.eta > a.eta ? b : a));
    add({ id: `w-${type}`, group: 'Gebrauchstauglichkeit', label: `Durchbiegung ${type === 'SLS-char' ? 'charakteristisch' : 'quasi-ständig'} (${w.cant ? '2·L' : 'L'}/${w.limit})`, ref: ref('w', norm), Ed: Math.abs(w.w), Rd: w.wLim, unit: 'mm', eta: w.eta, sls: w, x: w.x, comboName: w.combo.name });
  }
  for (const c of checks) if (c.u) c.comboName = c.u.combo.name;
  const etaMax = checks.reduce((m, c) => Math.max(m, c.eta), 0);
  const gov = checks.reduce((a, b) => (!a || b.eta > a.eta ? b : a), null);
  // massgebende Kombination (Tragsicherheit)
  const etaOf = (u) => {
    let m = 0;
    for (const k of ['N', 'Vz', 'Vy', 'Vb', 'My', 'Mz', 'NM']) if (u.cs[k]) m = Math.max(m, u.cs[k].eta);
    if (u.Nc > 1e-9) m = Math.max(m, u.st.NEd / u.st.NbyRd, u.st.NEd / u.st.NbzRd, u.st.torsional ? u.st.NEd / u.st.NbTRd : 0);
    for (const s of u.st.segments) m = Math.max(m, s.etaLT || 0, (u.Nc > 1e-9 || (u.MzMax > 1e-9 && u.MyMax > 1e-9)) ? Math.max(s.int61 || 0, s.int62 || 0) : 0, u.MzMax > 1e-9 ? s.intT || 0 : 0);
    return m;
  };
  for (const u of uls) u.eta = etaOf(u);
  const govUls = uls.reduce((a, b) => (b.eta > a.eta ? b : a));
  // Hinweise
  if (uls.some((u) => u.cls === 4)) {
    if (sec.type === 'CHS') warnings.push('Querschnittsklasse 4 bei Rundrohr: Schalenbeulen nach EN 1993-1-6 ist nicht abgedeckt – Nachweise mit elastischen Werten, bitte separat prüfen.');
    else warnings.push('Querschnittsklasse 4: Nachweise mit wirksamen Querschnittswerten nach EN 1993-1-5 (Aeff, Weff).');
  }
  if (sec.type === 'U' && govUls.st.ltbActive) warnings.push('U-Profil: Lasten greifen nicht im Schubmittelpunkt an (Torsion). Kippen nach der Formel für doppelt symmetrische Querschnitte ist eine Näherung.');
  if (wVb) warnings.push('Der Steg ist schubbeulgefährdet (hw/tw > 72·ε/η) – Nachweis nach EN 1993-1-5 ohne Zwischensteifen.');
  if (p.mode === 'forces' && uls.some((u) => u.cs.Vz.eta > 0.5)) warnings.push('Direkte Eingabe: Die Querkraft wird über die ganze Stablänge angesetzt (Interaktion M–V auf der sicheren Seite).');
  return { sec, mat, norm, curves, member, uls, sls, checks, etaMax, gov, govUls, warnings, ltbMethod: ltbMethod(p, sec), gamma: gammaSet(p) };
}

// ------------------------------------------------------------------ Profil vorschlagen

/**
 * Durchsucht eine Profilreihe und liefert alle Profile mit Ausnutzung, aufsteigend nach Masse.
 * Rückgabe {list:[{name, mass, eta, gov, ok, error}], best}
 */
export function suggestProfiles(p, series) {
  const list = [];
  for (const prof of CATALOG[series] || []) {
    const q = JSON.parse(JSON.stringify(p));
    q.section = { ...(q.section || {}), series, name: prof.name };
    const sec = sectionProps(q.section);
    try {
      const r = compute(q);
      list.push({ name: prof.name, mass: sec.mass, eta: r.etaMax, gov: r.gov?.label || '', ok: r.etaMax <= 1.0001, h: sec.h });
    } catch (e) {
      list.push({ name: prof.name, mass: sec.mass, eta: Infinity, gov: e.message, ok: false, error: true, h: sec.h });
    }
  }
  list.sort((a, b) => a.mass - b.mass);
  const best = list.find((x) => x.ok) || null;
  return { series, list, best };
}

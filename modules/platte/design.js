// Bemessung von Platten: Wood–Armer, Biegebewehrung, Mindestbewehrung, Durchstanzen (DOM-frei)
import { inDomain, segIntersect } from './geom.js';

// ------------------------------------------------------------------ Bemessungsmomente

/**
 * Bemessungsmomente nach Wood–Armer (R.H. Wood, Concrete 2 (1968); G.S.T. Armer, Concrete 2 (1968)).
 * Eingabe mx, my, mxy [kNm/m] (positiv = Zug unten).
 * Rückgabe: Beträge ≥ 0 {bx, by (unten), tx, ty (oben)}.
 */
export function woodArmer(mx, my, mxy) {
  const a = Math.abs(mxy), a2 = mxy * mxy;
  // untere Bewehrung (positive Momente)
  let bx = mx + a, by = my + a;
  if (bx < 0) {
    bx = 0;
    by = my + a2 / Math.abs(mx);
    if (by < 0) by = 0;
  } else if (by < 0) {
    by = 0;
    bx = mx + a2 / Math.abs(my);
    if (bx < 0) bx = 0;
  }
  // obere Bewehrung (negative Momente)
  let tx = mx - a, ty = my - a;
  if (tx > 0) {
    tx = 0;
    ty = my - a2 / Math.abs(mx);
    if (ty > 0) ty = 0;
  } else if (ty > 0) {
    ty = 0;
    tx = mx - a2 / Math.abs(my);
    if (tx > 0) tx = 0;
  }
  return { bx, by, tx: 0 - tx || 0, ty: 0 - ty || 0 };
}

/** Hauptmomente und Richtung (Winkel von m1 zur x-Achse [rad]). */
export function principalMoments(mx, my, mxy) {
  const c = (mx + my) / 2, r = Math.hypot((mx - my) / 2, mxy);
  return { m1: c + r, m2: c - r, phi: 0.5 * Math.atan2(2 * mxy, mx - my) };
}

// ------------------------------------------------------------------ Biegebemessung

/**
 * Erforderliche Bewehrung für ein Moment m ≥ 0 [kNm/m] (Rechteckquerschnitt b = 1 m, ohne Druckbewehrung).
 * Rechteckiger Spannungsblock σc = fcd über die Höhe λ·x (SIA 262: λ = 0.85, EN 1992: λ = 0.8).
 * d [mm], fcd, fsd [MPa]. Rückgabe {as [mm²/m], x [mm], xd, ok, msg}
 */
export function requiredAs(m, d, fcd, fsd, lambda = 0.85) {
  if (!(m > 0)) return { as: 0, x: 0, xd: 0, ok: true, z: 0.9 * d };
  if (!(d > 0)) return { as: NaN, x: NaN, xd: NaN, ok: false, msg: 'Statische Höhe d ≤ 0' };
  const M = m * 1000; // Nmm je mm Breite
  const mu = M / (d * d * fcd);
  if (mu >= 0.5) return { as: NaN, x: NaN, xd: NaN, ok: false, mu, msg: 'Biegedruckzone ungenügend – Platte verstärken' };
  const omega = 1 - Math.sqrt(1 - 2 * mu);
  const a = omega * d; // Höhe des Spannungsblocks
  const as = omega * d * fcd / fsd * 1000;
  const x = a / lambda;
  return { as, x, xd: x / d, z: d - a / 2, mu, ok: true };
}

/** Biegewiderstand mRd [kNm/m] für as [mm²/m], d [mm]. */
export function momentResistance(as, d, fcd, fsd) {
  const asm = as / 1000; // mm²/mm
  const a = asm * fsd / fcd;
  return asm * fsd * (d - a / 2) / 1000;
}

/**
 * Mindestbewehrung je Richtung und Lage [mm²/m]:
 * ρmin = max(0.26·fctm/fsk; 0.13 %) bezogen auf b·d (Ansatz EN 1992-1-1, 9.2.1.1 bzw. 9.3.1.1;
 * wird hier auch für SIA als Richtwert verwendet), oder vorgegebenes ρmin [%].
 */
export function minReinforcement(d, fctm, fsk, mode = 'auto', rhoUser = 0.13) {
  if (mode === 'none') return 0;
  const rho = mode === 'user' ? rhoUser / 100 : Math.max(0.26 * fctm / fsk, 0.0013);
  return rho * 1000 * d;
}

/** Statische Höhen [mm] der vier Lagen. outer: Richtung der äusseren Lage ('x'|'y'). */
export function effectiveDepths(hMeters, cBot, cTop, dBot, dTop, outerBot = 'x', outerTop = 'x') {
  const h = hMeters * 1000;
  const outB = h - cBot - dBot / 2, inB = h - cBot - 1.5 * dBot;
  const outT = h - cTop - dTop / 2, inT = h - cTop - 1.5 * dTop;
  return {
    bx: outerBot === 'x' ? outB : inB,
    by: outerBot === 'x' ? inB : outB,
    tx: outerTop === 'x' ? outT : inT,
    ty: outerTop === 'x' ? inT : outT,
  };
}

// ------------------------------------------------------------------ Durchstanzen

/**
 * Nachweisschnitt um eine Rechteckstütze (b × h, Zentrum x,y) im Abstand r vom Stützenrand.
 * Teile ausserhalb der Platte und im «Schatten» von Öffnungen (Abstand < shadowDist) sind unwirksam.
 * Rückgabe {u (wirksam) [m], uFull [m], pieces:[[x1,y1,x2,y2,wirksam]], edges (Anzahl angeschnittener Ränder), type}
 */
export function controlPerimeter(col, r, outline, holes = [], shadowDist = 0) {
  const bx = Math.max(0, col.b) / 2, hy = Math.max(0, col.h) / 2;
  const path = [];
  const N_ARC = 16;
  const add = (x, y) => path.push([col.x + x, col.y + y]);
  // Gegenuhrzeigersinn ab rechter Seite
  const straight = (x0, y0, x1, y1, n) => { for (let k = 0; k < n; k++) add(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n); };
  const arc = (cx, cy, a0) => { for (let k = 0; k < N_ARC; k++) { const a = (a0 + 90 * k / N_ARC) * Math.PI / 180; add(cx + r * Math.cos(a), cy + r * Math.sin(a)); } };
  const ns = (L) => Math.max(2, Math.ceil(L / Math.max(r, 0.02) * 4));
  straight(bx + r, -hy, bx + r, hy, ns(2 * hy)); arc(bx, hy, 0);
  straight(bx, hy + r, -bx, hy + r, ns(2 * bx)); arc(-bx, hy, 90);
  straight(-bx - r, hy, -bx - r, -hy, ns(2 * hy)); arc(-bx, -hy, 180);
  straight(-bx, -hy - r, bx, -hy - r, ns(2 * bx)); arc(bx, -hy, 270);
  let u = 0, uFull = 0;
  const pieces = [];
  for (let k = 0; k < path.length; k++) {
    const p = path[k], q = path[(k + 1) % path.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    uFull += len;
    let eff = inDomain(mx, my, outline, holes);
    if (eff && shadowDist > 0 && holes.length) {
      const dx = mx - col.x, dy = my - col.y, dl = Math.hypot(dx, dy) || 1;
      const far = [col.x + dx / dl * (dl + shadowDist), col.y + dy / dl * (dl + shadowDist)];
      outer: for (const hpoly of holes) {
        for (let i = 0; i < hpoly.length; i++) {
          if (segIntersect([col.x, col.y], far, hpoly[i], hpoly[(i + 1) % hpoly.length])) { eff = false; break outer; }
        }
      }
    }
    if (eff) u += len;
    pieces.push([p[0], p[1], q[0], q[1], eff]);
  }
  // Anzahl angeschnittener Plattenränder (für Rand-/Eckstütze)
  let edges = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    let hit = false;
    for (let k = 0; k < path.length && !hit; k++) {
      if (segIntersect(path[k], path[(k + 1) % path.length], a, b)) hit = true;
    }
    if (hit) edges++;
  }
  const outside = pieces.some((pc) => !pc[4] && !inDomainLoose(pc, outline));
  const type = !outside || edges === 0 ? 'innen' : edges === 1 ? 'rand' : 'ecke';
  return { u, uFull, pieces, edges, type };
}

function inDomainLoose(pc, outline) {
  // Stück liegt innerhalb des Randes (nur durch Öffnung unwirksam)
  const mx = (pc[0] + pc[2]) / 2, my = (pc[1] + pc[3]) / 2;
  return inDomain(mx, my, outline, []);
}

export const KE_SIA = { innen: 0.9, rand: 0.7, ecke: 0.65 };
export const BETA_EC = { innen: 1.15, rand: 1.4, ecke: 1.5 };

/**
 * Durchstanzwiderstand ohne Durchstanzbewehrung nach SIA 262:2013, Ziff. 4.3.6 (Näherungsstufe 2).
 * p: {Vd [kN], d [mm] (mittlere statische Höhe), dv [mm], u [m] (Nachweisschnitt), ke, rsx, rsy [m],
 *     msd [kNm/m], mRdx, mRdy [kNm/m], fsd, Es, tcd [MPa], Dmax [mm]}
 */
export function punchingSIA(p) {
  const kg = 48 / (16 + (p.Dmax ?? 32));                                  // (Gl. 59)
  const ratio = (m, mR) => (mR > 0 ? Math.max(0, m / mR) : Infinity);
  const psiX = 1.5 * (p.rsx * 1000 / p.d) * (p.fsd / p.Es) * Math.pow(ratio(p.msd, p.mRdx), 1.5);  // (Gl. 59/60)
  const psiY = 1.5 * (p.rsy * 1000 / p.d) * (p.fsd / p.Es) * Math.pow(ratio(p.msd, p.mRdy), 1.5);
  const psi = Math.max(psiX, psiY);
  const kr = Math.min(2, 1 / (0.45 + 0.18 * psi * p.d * kg));             // (Gl. 58)
  const uRed = p.ke * p.u;                                                  // 4.3.6.2.5
  const VRdc = kr * p.tcd * p.dv * uRed * 1000 / 1000;                      // (Gl. 57) [kN]
  const VRdmax = Math.min(2 * kr, 3.5) * p.tcd * p.dv * uRed;               // 4.3.6.5.7 [kN]
  const need = p.Vd > VRdc;
  return {
    norm: 'SIA', kg, psiX, psiY, psi, kr, uRed, VRdc, VRdmax,
    eta: VRdc > 0 ? p.Vd / VRdc : Infinity,
    etaMax: VRdmax > 0 ? p.Vd / VRdmax : Infinity,
    needsReinforcement: need,
    possible: p.Vd <= VRdmax,
    msdOverMrd: Math.max(ratio(p.msd, p.mRdx), ratio(p.msd, p.mRdy)),
  };
}

/**
 * Durchstanzen nach EN 1992-1-1, 6.4.4 (ohne Durchstanzbewehrung) und 6.4.5(3) (Maximalwert am Stützenrand).
 * p: {VEd [kN], d [mm], u1 [m] (2d), u0 [m] (Stützenumfang), beta, rhoL, fck, fcd, gammaC}
 */
export function punchingEC(p) {
  const k = Math.min(2, 1 + Math.sqrt(200 / p.d));
  const CRdc = 0.18 / (p.gammaC ?? 1.5);
  const rho = Math.min(0.02, Math.max(0, p.rhoL));
  const vmin = 0.035 * Math.pow(k, 1.5) * Math.sqrt(p.fck);
  const vRdc = Math.max(CRdc * k * Math.cbrt(100 * rho * p.fck), vmin);
  const vEd = p.beta * p.VEd * 1000 / (p.u1 * 1000 * p.d);
  const nu = 0.6 * (1 - p.fck / 250);
  const vRdmax = 0.4 * nu * p.fcd;
  const vEd0 = p.u0 > 0 ? p.beta * p.VEd * 1000 / (p.u0 * 1000 * p.d) : 0;
  const VRdc = vRdc * p.u1 * 1000 * p.d / p.beta / 1000;
  const VRdmax = p.u0 > 0 ? vRdmax * p.u0 * 1000 * p.d / p.beta / 1000 : Infinity;
  return {
    norm: 'EC', k, rho, vmin, vRdc, vEd, vRdmax, vEd0, VRdc, VRdmax,
    eta: vEd / vRdc, etaMax: vRdmax > 0 ? vEd0 / vRdmax : 0,
    needsReinforcement: vEd > vRdc, possible: vEd0 <= vRdmax,
  };
}

/** Plattendicke-Kennwerte: Biegesteifigkeit D [kNm] aus E [MPa], h [m], ν. */
export function flexuralRigidity(E, h, nu) {
  return E * 1000 * h ** 3 / (12 * (1 - nu * nu));
}

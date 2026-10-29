// Spannungsausbreitung (Boussinesq, Steinbrenner) und Setzungsberechnung (DOM-frei)
//
//  Eckpunktformel für eine gleichmässig belastete Rechteckfläche a×b (Steinbrenner, aus Boussinesq):
//   σ_z = p/(2π)·[ arctan(a·b/(z·R)) + a·b·z/R·(1/(a²+z²) + 1/(b²+z²)) ],  R = √(a²+b²+z²)
//  Beliebige Punkte durch Überlagerung von vier Eckrechtecken (mit Vorzeichen).
//  Setzung: s = Σ Δσ_z·Δz / M_E bis zur Grenztiefe, in der Δσ_z = f·σ'_v0 (f = 0.2, DIN 4019).
import { verticalStress, layerAt } from './soil.js';

const PI = Math.PI;

/** Einflusswert unter der Ecke einer Rechteckfläche a×b in der Tiefe z (σ_z / p). */
export function cornerFactor(a, b, z) {
  if (a <= 0 || b <= 0) return 0;
  if (z <= 1e-9) return 0.25;
  const R = Math.sqrt(a * a + b * b + z * z);
  return (Math.atan(a * b / (z * R)) + a * b * z / R * (1 / (a * a + z * z) + 1 / (b * b + z * z))) / (2 * PI);
}

const F = (u, v, z) => Math.sign(u) * Math.sign(v) * cornerFactor(Math.abs(u), Math.abs(v), z);

/** Einflusswert σ_z/p im Punkt (x, y) (bezogen auf die Mitte) unter einem Rechteck B×L in der Tiefe z. */
export function rectFactor(B, L, x, y, z) {
  const x1 = -B / 2 - x, x2 = B / 2 - x, y1 = -L / 2 - y, y2 = L / 2 - y;
  if (z <= 1e-9) return (x1 < 0 && x2 > 0 && y1 < 0 && y2 > 0) ? 1 : (x1 <= 0 && x2 >= 0 && y1 <= 0 && y2 >= 0) ? 0.5 : 0;
  return F(x2, y2, z) - F(x1, y2, z) - F(x2, y1, z) + F(x1, y1, z);
}

/** Streifenlast der Breite B (exakte Lösung): σ_z/p = [β₁−β₂ + sinβ₁cosβ₁ − sinβ₂cosβ₂]/π. */
export function stripFactor(B, x, z) {
  if (z <= 1e-9) return Math.abs(x) < B / 2 ? 1 : Math.abs(x) === B / 2 ? 0.5 : 0;
  const b1 = Math.atan((x + B / 2) / z), b2 = Math.atan((x - B / 2) / z);
  return (b1 - b2 + Math.sin(b1) * Math.cos(b1) - Math.sin(b2) * Math.cos(b2)) / PI;
}

/**
 * Kreisfläche mit Radius R, Punkt im Abstand r vom Mittelpunkt (Integration der Boussinesq-Lösung über
 * Sektoren mit Spitze im Aufpunkt; exakt bis auf die Winkelquadratur). Mitte: 1 − [1/(1+(R/z)²)]^{3/2}.
 */
export function circleFactor(R, r, z) {
  if (z <= 1e-9) return r < R ? 1 : r === R ? 0.5 : 0;
  if (r < 1e-9) return 1 - Math.pow(1 / (1 + (R / z) ** 2), 1.5);
  const n = 240;
  const g = (rho) => Math.pow(z / Math.sqrt(z * z + rho * rho), 3);
  let s = 0;
  for (let k = 0; k < n; k++) {
    const psi = (k + 0.5) * 2 * PI / n;
    const c = Math.cos(psi), sn = Math.sin(psi);
    const disc = R * R - r * r * sn * sn;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    if (r < R) s += 1 - g(-r * c + sq);
    else if (c < 0) s += g(-r * c - sq) - g(-r * c + sq);
  }
  return s / n;
}

/** Punktlast P (Boussinesq): σ_z = 3P/(2π z²)·[1 + (r/z)²]^{-5/2}. */
export function pointLoadStress(P, r, z) {
  return 3 * P / (2 * PI * z * z) * Math.pow(1 + (r / z) ** 2, -2.5);
}

/** Einflusswert für die Fundamentform (x quer, y längs, bezogen auf die Mitte). */
export function stressFactor(shape, B, L, x, y, z) {
  if (shape === 'strip') return stripFactor(B, x, z);
  if (shape === 'circle') return circleFactor(B / 2, Math.hypot(x, y), z);
  return rectFactor(B, L, x, y, z);
}

/** Lage der Berechnungspunkte (Mitte, kennzeichnender Punkt nach Grasshoff, Rand/Ecke). */
export function settlementPoints(shape, B, L) {
  if (shape === 'strip') return [
    { key: 'centre', label: 'Mitte', x: 0, y: 0 },
    { key: 'char', label: 'Kennz. Punkt', x: 0.37 * B, y: 0 },
    { key: 'edge', label: 'Rand', x: B / 2, y: 0 },
  ];
  if (shape === 'circle') return [
    { key: 'centre', label: 'Mitte', x: 0, y: 0 },
    { key: 'char', label: 'Kennz. Punkt', x: 0.845 * B / 2, y: 0 },
    { key: 'edge', label: 'Rand', x: B / 2, y: 0 },
  ];
  return [
    { key: 'centre', label: 'Mitte', x: 0, y: 0 },
    { key: 'char', label: 'Kennz. Punkt', x: 0.37 * B, y: 0.37 * L },
    { key: 'edge', label: 'Ecke', x: B / 2, y: L / 2 },
  ];
}

/**
 * Setzungsberechnung.
 * s: {shape, B, L, D, loadMode:'p'|'V', p0, V, unload, limitFactor (0.2), rigid, zMaxFactor}
 */
export function settlementAnalysis(soil, s) {
  const shape = s.shape || 'rect';
  const B = Number(s.B), L = shape === 'strip' ? Infinity : shape === 'circle' ? Number(s.B) : Number(s.L);
  if (!(B > 0) || !(L > 0)) throw new Error('Fundamentabmessungen B und L müssen grösser als 0 sein.');
  const D = Math.max(0, Number(s.D) || 0);
  const area = shape === 'strip' ? B : shape === 'circle' ? PI * B * B / 4 : B * L;
  const p0 = s.loadMode === 'V' ? (Number(s.V) || 0) / area : Number(s.p0) || 0;
  const st0 = verticalStress(soil, D, 0, 0);
  const pNet = s.unload ? p0 - st0.sv : p0;
  const f = Number(s.limitFactor) > 0 ? Number(s.limitFactor) : 0.2;
  const pts = settlementPoints(shape, B, shape === 'rect' ? L : B);
  const refKey = s.rigid === false ? 'centre' : 'char';
  const Lf = shape === 'rect' ? L : B;
  const fac = (p, z) => stressFactor(shape, B, Lf, p.x, p.y, z);
  const svp = (z) => verticalStress(soil, z, 0, 0).svp;
  const ref = pts.find((p) => p.key === refKey);
  const warnings = [];

  // Grenztiefe
  const zMax = D + Math.max(5, (Number(s.zMaxFactor) || 10) * B);
  let zLim = zMax, limitFound = false;
  if (pNet > 0) {
    const g = (z) => pNet * fac(ref, z - D) - f * svp(z);
    const step = Math.max(0.02, B / 40);
    let z0 = D + 1e-3, g0 = g(z0);
    if (g0 <= 0) { zLim = D; limitFound = true; }
    else {
      for (let z = D + step; z <= zMax + 1e-9; z += step) {
        const gz = g(z);
        if (gz <= 0) {
          let a = z0, b = z;
          for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (g(m) > 0) a = m; else b = m; }
          zLim = (a + b) / 2; limitFound = true;
          break;
        }
        z0 = z;
      }
    }
    if (!limitFound) warnings.push(`Grenztiefe bis z = ${zMax.toFixed(1)} m nicht erreicht – Setzung bis dorthin integriert.`);
  } else {
    zLim = D;
    warnings.push('Die Aushubentlastung ist grösser als die Sohlspannung (Netto-Sohldruck ≤ 0): keine Setzung aus Belastung.');
  }

  // Integration
  const breaks = new Set([D, zLim]);
  for (const l of soil.layers) if (l.z > D && l.z < zLim) breaks.add(l.z);
  const bk = [...breaks].sort((a, b) => a - b);
  const layerSum = new Map();
  const totals = Object.fromEntries(pts.map((p) => [p.key, 0]));
  const profile = [];
  for (let i = 0; i < bk.length - 1; i++) {
    const a = bk[i], b = bk[i + 1];
    if (b - a < 1e-9) continue;
    const Lr = layerAt(soil.layers, (a + b) / 2);
    const n = Math.max(4, Math.ceil((b - a) / Math.max(0.02, (zLim - D) / 200)));
    const dz = (b - a) / n;
    let row = layerSum.get(Lr.z);
    if (!row) { row = { idx: Lr.idx, name: Lr.name, ME: Lr.ME, from: a, to: b, ds: Object.fromEntries(pts.map((p) => [p.key, 0])), dsig: 0, len: 0 }; layerSum.set(Lr.z, row); }
    row.to = b;
    for (let k = 0; k < n; k++) {
      const zm = a + (k + 0.5) * dz;
      for (const p of pts) {
        const dsg = pNet * fac(p, zm - D);
        const ds = dsg * dz / (Lr.ME * 1000) * 1000; // mm
        totals[p.key] += ds;
        row.ds[p.key] += ds;
        if (p.key === refKey) { row.dsig += dsg * dz; row.len += dz; }
      }
    }
  }
  const layers = [...layerSum.values()].sort((a, b) => a.from - b.from).map((r) => ({ ...r, dsigAvg: r.len > 0 ? r.dsig / r.len : 0 }));

  // Verläufe über die Tiefe (Diagramme)
  const zEnd = Math.max(zLim * 1.25, D + 2 * B);
  const nP = 80;
  for (let k = 0; k <= nP; k++) {
    const z = D + (zEnd - D) * k / nP;
    const row = { z, svp: svp(z) };
    row.lim = f * row.svp;
    for (const p of pts) row[p.key] = pNet > 0 ? pNet * fac(p, Math.max(z - D, 1e-6)) : 0;
    profile.push(row);
  }
  // kumulierte Setzung über die Tiefe (Setzung des Punktes in Tiefe z infolge der Schichten darunter)
  const cum = [];
  if (pNet > 0 && zLim > D) {
    const n = 100, dz = (zLim - D) / n;
    let acc = 0;
    const vals = [];
    for (let k = n - 1; k >= 0; k--) {
      const zm = D + (k + 0.5) * dz;
      const Lr = layerAt(soil.layers, zm);
      acc += pNet * fac(ref, zm - D) * dz / (Lr.ME * 1000) * 1000;
      vals.push([acc, D + k * dz]);
    }
    cum.push([0, zLim], ...vals);
  }

  // Setzungsmulde entlang der Querachse
  const trough = [];
  if (pNet > 0 && zLim > D) {
    const xs = [];
    for (let k = 0; k <= 40; k++) xs.push(-1.5 * B + 3 * B * k / 40);
    const n = 60, dz = (zLim - D) / n;
    const MEs = [];
    for (let k = 0; k < n; k++) MEs.push(layerAt(soil.layers, D + (k + 0.5) * dz).ME * 1000);
    for (const x of xs) {
      let sx = 0;
      for (let k = 0; k < n; k++) sx += pNet * stressFactor(shape, B, Lf, x, 0, (k + 0.5) * dz) * dz / MEs[k] * 1000;
      trough.push([x, sx]);
    }
  }

  return {
    shape, B, L: shape === 'rect' ? L : shape === 'circle' ? B : null, D, area, p0, pNet, sv0D: st0.sv, svp0D: st0.svp, f,
    zLim, limitFound, points: pts.map((p) => ({ ...p, s: totals[p.key] })), refKey,
    sRef: totals[refKey], sCentre: totals.centre, sChar: totals.char, sEdge: totals.edge,
    layers, profile, cum, trough, warnings,
  };
}

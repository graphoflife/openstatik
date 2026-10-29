// Finite Elemente für schubstarre Platten (Kirchhoff): DKT-Element (DOM-frei)
//
// Discrete Kirchhoff Triangle nach J.-L. Batoz, K.-J. Bathe, L.-W. Ho:
// «A study of three-node triangular plate bending elements», Int. J. Numer. Meth. Eng. 15 (1980) 1771–1812.
//
// Konventionen
//   w        Durchbiegung, positiv in Lastrichtung (nach unten)
//   θx = ∂w/∂y, θy = −∂w/∂x   (Knotenfreiheitsgrade, Reihenfolge je Knoten: w, θx, θy)
//   κ = [βx,x, βy,y, βx,y + βy,x] mit βx = −w,x, βy = −w,y
//   m = D·[[1,ν,0],[ν,1,0],[0,0,(1−ν)/2]]·κ  →  mx = −D(w,xx + ν w,yy) (positiv = Zug unten)
//   mxy = −D(1−ν) w,xy
// Einheiten: m, kN → D [kNm], Momente [kNm/m], Lasten kN/m² bzw. kN/m bzw. kN.
import { SkylineMatrix, rcm, SingularError } from '../../js/core/linalg.js';

// Gausspunkte (Flächenkoordinaten ξ, η) – 3-Punkt-Regel, exakt für quadratische Integranden
const GP = [[1 / 6, 1 / 6], [2 / 3, 1 / 6], [1 / 6, 2 / 3]];
const GW = 1 / 6;

/** Geometriekoeffizienten des DKT-Elements: Matrizen CX, CY (9×6) mit Hx = CX·N, Hy = CY·N. */
export function dktCoefficients(x1, y1, x2, y2, x3, y3) {
  // Seiten k = 4 (2–3), 5 (3–1), 6 (1–2)
  const xs = [x2 - x3, x3 - x1, x1 - x2];
  const ys = [y2 - y3, y3 - y1, y1 - y2];
  const a = [], b = [], c = [], d = [], e = [];
  for (let k = 0; k < 3; k++) {
    const l2 = xs[k] * xs[k] + ys[k] * ys[k];
    a[k] = -xs[k] / l2;
    b[k] = 0.75 * xs[k] * ys[k] / l2;
    c[k] = (0.25 * xs[k] * xs[k] - 0.5 * ys[k] * ys[k]) / l2;
    d[k] = -ys[k] / l2;
    e[k] = (0.25 * ys[k] * ys[k] - 0.5 * xs[k] * xs[k]) / l2;
  }
  const [a4, a5, a6] = a, [b4, b5, b6] = b, [c4, c5, c6] = c, [d4, d5, d6] = d, [e4, e5, e6] = e;
  // Spalten: N1..N6 → 0..5
  const CX = new Float64Array(54), CY = new Float64Array(54);
  const sx = (r, col, v) => { CX[r * 6 + col] = v; };
  const sy = (r, col, v) => { CY[r * 6 + col] = v; };
  sx(0, 4, -1.5 * a5); sx(0, 5, 1.5 * a6);
  sx(1, 4, b5); sx(1, 5, b6);
  sx(2, 0, 1); sx(2, 4, -c5); sx(2, 5, -c6);
  sx(3, 3, 1.5 * a4); sx(3, 5, -1.5 * a6);
  sx(4, 3, b4); sx(4, 5, b6);
  sx(5, 1, 1); sx(5, 3, -c4); sx(5, 5, -c6);
  sx(6, 3, -1.5 * a4); sx(6, 4, 1.5 * a5);
  sx(7, 3, b4); sx(7, 4, b5);
  sx(8, 2, 1); sx(8, 3, -c4); sx(8, 4, -c5);

  sy(0, 4, -1.5 * d5); sy(0, 5, 1.5 * d6);
  sy(1, 0, -1); sy(1, 4, e5); sy(1, 5, e6);
  sy(2, 4, -b5); sy(2, 5, -b6);
  sy(3, 3, 1.5 * d4); sy(3, 5, -1.5 * d6);
  sy(4, 1, -1); sy(4, 3, e4); sy(4, 5, e6);
  sy(5, 3, -b4); sy(5, 5, -b6);
  sy(6, 3, -1.5 * d4); sy(6, 4, 1.5 * d5);
  sy(7, 2, -1); sy(7, 3, e4); sy(7, 4, e5);
  sy(8, 3, -b4); sy(8, 4, -b5);
  const x31 = x3 - x1, y31 = y3 - y1, x12 = x1 - x2, y12 = y1 - y2;
  const twoA = x31 * y12 - x12 * y31;
  return { CX, CY, x31, y31, x12, y12, twoA };
}

/** Krümmungs-Verschiebungs-Matrix B (3×9, zeilenweise) im Punkt (ξ, η). */
export function dktB(co, xi, eta, out = new Float64Array(27)) {
  const L = 1 - xi - eta;
  // Ableitungen der quadratischen Formfunktionen N1..N6
  const dNx = [-(4 * L - 1), 4 * xi - 1, 0, 4 * eta, -4 * eta, 4 * (L - xi)];
  const dNe = [-(4 * L - 1), 0, 4 * eta - 1, 4 * xi, 4 * (L - eta), -4 * xi];
  const { CX, CY, x31, y31, x12, y12, twoA } = co;
  for (let r = 0; r < 9; r++) {
    let hxx = 0, hxe = 0, hyx = 0, hye = 0;
    const o = r * 6;
    for (let k = 0; k < 6; k++) {
      const cx = CX[o + k], cy = CY[o + k];
      if (cx !== 0) { hxx += cx * dNx[k]; hxe += cx * dNe[k]; }
      if (cy !== 0) { hyx += cy * dNx[k]; hye += cy * dNe[k]; }
    }
    out[r] = (y31 * hxx + y12 * hxe) / twoA;
    out[9 + r] = (-x31 * hyx - x12 * hye) / twoA;
    out[18 + r] = (-x31 * hxx - x12 * hxe + y31 * hyx + y12 * hye) / twoA;
  }
  return out;
}

/** Elementsteifigkeitsmatrix (9×9, zeilenweise). D [kNm], ν. */
export function dktStiffness(x1, y1, x2, y2, x3, y3, D, nu, out = new Float64Array(81)) {
  const co = dktCoefficients(x1, y1, x2, y2, x3, y3);
  const A = co.twoA / 2;
  out.fill(0);
  const B = new Float64Array(27);
  const d11 = D, d12 = D * nu, d33 = D * (1 - nu) / 2;
  const DB = new Float64Array(27);
  for (const [xi, eta] of GP) {
    dktB(co, xi, eta, B);
    for (let j = 0; j < 9; j++) {
      DB[j] = d11 * B[j] + d12 * B[9 + j];
      DB[9 + j] = d12 * B[j] + d11 * B[9 + j];
      DB[18 + j] = d33 * B[18 + j];
    }
    const f = 2 * A * GW;
    for (let i = 0; i < 9; i++) {
      const b0 = B[i], b1 = B[9 + i], b2 = B[18 + i];
      for (let j = i; j < 9; j++) {
        const v = f * (b0 * DB[j] + b1 * DB[9 + j] + b2 * DB[18 + j]);
        out[i * 9 + j] += v;
      }
    }
  }
  for (let i = 0; i < 9; i++) for (let j = 0; j < i; j++) out[i * 9 + j] = out[j * 9 + i];
  return out;
}

/**
 * Momente [mx, my, mxy] im Punkt (ξ, η) aus den Elementverschiebungen ue (9).
 */
export function dktMoments(co, ue, D, nu, xi, eta, B = new Float64Array(27)) {
  dktB(co, xi, eta, B);
  let k0 = 0, k1 = 0, k2 = 0;
  for (let j = 0; j < 9; j++) { k0 += B[j] * ue[j]; k1 += B[9 + j] * ue[j]; k2 += B[18 + j] * ue[j]; }
  return [D * (k0 + nu * k1), D * (nu * k0 + k1), D * (1 - nu) / 2 * k2];
}

/**
 * Konsistenter Lastvektor für eine konstante Flächenlast q (kubische Interpolation von w,
 * Bazeley/Cheung/Irons/Zienkiewicz): f_w = qA/3, f_∂w/∂x = −qA(xi−xs)/8, f_∂w/∂y = −qA(yi−ys)/8.
 * In den Freiheitsgraden (w, θx = ∂w/∂y, θy = −∂w/∂x).
 */
export function areaLoadVector(x1, y1, x2, y2, x3, y3, q, out = new Float64Array(9)) {
  const A = ((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)) / 2;
  const xc = (x1 + x2 + x3) / 3, yc = (y1 + y2 + y3) / 3;
  const xs = [x1, x2, x3], ys = [y1, y2, y3];
  for (let i = 0; i < 3; i++) {
    out[3 * i] = q * A / 3;
    out[3 * i + 1] = -q * A * (ys[i] - yc) / 8;
    out[3 * i + 2] = q * A * (xs[i] - xc) / 8;
  }
  return out;
}

/**
 * Konsistente Knotenlasten einer linear veränderlichen Linienlast (pa → pb) [kN/m] entlang einer
 * Netzkante a→b (Hermite-Interpolation). Gibt [fwa, fθxa, fθya, fwb, fθxb, fθyb] zurück.
 */
export function lineLoadVector(xa, ya, xb, yb, pa, pb) {
  const L = Math.hypot(xb - xa, yb - ya);
  if (L <= 0) return [0, 0, 0, 0, 0, 0];
  const tx = (xb - xa) / L, ty = (yb - ya) / L;
  const fwa = L * (7 * pa + 3 * pb) / 20, fwb = L * (3 * pa + 7 * pb) / 20;
  const fsa = L * L * (3 * pa + 2 * pb) / 60, fsb = -L * L * (2 * pa + 3 * pb) / 60;
  // f_s·∂w/∂s = f_s·(tx·∂w/∂x + ty·∂w/∂y) = f_s·(−tx·θy + ty·θx)
  return [fwa, fsa * ty, -fsa * tx, fwb, fsb * ty, -fsb * tx];
}

/**
 * Löst das Plattenproblem für mehrere Lastvektoren.
 * mesh: {x, y, tri, nNodes}
 * opts: {
 *   D, nu,
 *   elemFactor: Float64Array(nt) – optionaler Steifigkeitsfaktor je Element (z.B. starrer Stützenkopf)
 *   fixW: Uint8Array(n)            – starre vertikale Lagerung
 *   springW: Float64Array(n)       – vertikale Federn [kN/m]
 *   springR: Float64Array(n)       – Drehfedern um x und y [kNm/rad]
 *   rotConstraints: [{node, cx, cy}] – Zwangsbedingung cx·θx + cy·θy = 0 (Einspannung entlang Linie, Penalty)
 *   loads: [Float64Array(3n)]
 * }
 * Rückgabe: {U:[Float64Array(3n)], R:[Float64Array(n)] (Auflagerkraft nach oben [kN]), neq, profile, t}
 */
export function solvePlate(mesh, opts) {
  const t0 = now();
  const { x, y, tri, nNodes: n } = mesh;
  const nt = tri.length / 3;
  const { D, nu } = opts;
  const ef = opts.elemFactor || null;
  const fixW = opts.fixW || new Uint8Array(n);
  const springW = opts.springW || new Float64Array(n);
  const springR = opts.springR || new Float64Array(n);
  const rotC = opts.rotConstraints || [];
  const loads = opts.loads || [];

  // Knotennummerierung (RCM) zur Profilreduktion
  const adj = Array.from({ length: n }, () => []);
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tri[3 * t + e], b = tri[3 * t + (e + 1) % 3];
      if (!adj[a].includes(b)) adj[a].push(b);
      if (!adj[b].includes(a)) adj[b].push(a);
    }
  }
  const perm = rcm(adj);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[perm[i]] = i;
  const eq = new Int32Array(3 * n).fill(-1);
  let neq = 0;
  for (let k = 0; k < n; k++) {
    const i = order[k];
    if (!fixW[i]) eq[3 * i] = neq++;
    eq[3 * i + 1] = neq++;
    eq[3 * i + 2] = neq++;
  }
  // Skyline-Profil
  const first = new Int32Array(neq);
  for (let i = 0; i < neq; i++) first[i] = i;
  const edofs = new Int32Array(9);
  const elemDofs = (t) => {
    for (let k = 0; k < 3; k++) { const v = tri[3 * t + k]; edofs[3 * k] = eq[3 * v]; edofs[3 * k + 1] = eq[3 * v + 1]; edofs[3 * k + 2] = eq[3 * v + 2]; }
    return edofs;
  };
  for (let t = 0; t < nt; t++) {
    const ds = elemDofs(t);
    let mn = Infinity;
    for (const d of ds) if (d >= 0 && d < mn) mn = d;
    for (const d of ds) if (d >= 0 && mn < first[d]) first[d] = mn;
  }
  const K = new SkylineMatrix(neq, first);
  const a = K.a, ptr = K.ptr, fst = K.first;
  const ke = new Float64Array(81);
  const needR = new Uint8Array(nt); // Elemente an starren Lagern (für Reaktionen)
  for (let t = 0; t < nt; t++) {
    const i1 = tri[3 * t], i2 = tri[3 * t + 1], i3 = tri[3 * t + 2];
    if (fixW[i1] || fixW[i2] || fixW[i3]) needR[t] = 1;
    dktStiffness(x[i1], y[i1], x[i2], y[i2], x[i3], y[i3], ef ? D * ef[t] : D, nu, ke);
    const ds = elemDofs(t);
    for (let p = 0; p < 9; p++) {
      const I = ds[p];
      if (I < 0) continue;
      const base = ptr[I] - fst[I];
      for (let q = 0; q < 9; q++) {
        const J = ds[q];
        if (J < 0 || J > I) continue;
        a[base + J] += ke[p * 9 + q];
      }
    }
  }
  const diag = (I) => ptr[I] + I - fst[I];
  for (let i = 0; i < n; i++) {
    if (springW[i] > 0 && eq[3 * i] >= 0) a[diag(eq[3 * i])] += springW[i];
    if (springR[i] > 0) { a[diag(eq[3 * i + 1])] += springR[i]; a[diag(eq[3 * i + 2])] += springR[i]; }
  }
  const kPen = 1e7 * D;
  for (const c of rotC) {
    const I = eq[3 * c.node + 1], J = eq[3 * c.node + 2];
    const nrm = Math.hypot(c.cx, c.cy) || 1;
    const cx = c.cx / nrm, cy = c.cy / nrm;
    a[diag(I)] += kPen * cx * cx;
    a[diag(J)] += kPen * cy * cy;
    K.add(Math.max(I, J), Math.min(I, J), kPen * cx * cy);
  }
  const t1 = now();
  try {
    K.factor();
  } catch (e) {
    if (e instanceof SingularError) {
      throw new Error('Die Platte ist kinematisch (ungenügend gelagert). Bitte mindestens drei nicht auf einer Geraden liegende Punktlager, Linienlager oder eine Einspannung definieren.');
    }
    throw e;
  }
  if (K.negativePivots > 0) throw new Error('Die Steifigkeitsmatrix ist nicht positiv definit – Lagerung prüfen (die Platte ist vermutlich verschieblich).');
  const t2 = now();

  const U = [], R = [];
  const ru = new Float64Array(9);
  for (const f of loads) {
    const b = new Float64Array(neq);
    for (let d = 0; d < 3 * n; d++) if (eq[d] >= 0) b[eq[d]] = f[d];
    const xsol = K.solve(b);
    const u = new Float64Array(3 * n);
    for (let d = 0; d < 3 * n; d++) if (eq[d] >= 0) u[d] = xsol[eq[d]];
    // Reaktionen: starre Lager R = f − (K·u), Federn R = k·w
    const r = new Float64Array(n);
    const ku = new Float64Array(n);
    for (let t = 0; t < nt; t++) {
      if (!needR[t]) continue;
      const i1 = tri[3 * t], i2 = tri[3 * t + 1], i3 = tri[3 * t + 2];
      dktStiffness(x[i1], y[i1], x[i2], y[i2], x[i3], y[i3], ef ? D * ef[t] : D, nu, ke);
      const nodes = [i1, i2, i3];
      for (let k = 0; k < 3; k++) { ru[3 * k] = u[3 * nodes[k]]; ru[3 * k + 1] = u[3 * nodes[k] + 1]; ru[3 * k + 2] = u[3 * nodes[k] + 2]; }
      for (let k = 0; k < 3; k++) {
        if (!fixW[nodes[k]]) continue;
        let s = 0;
        for (let q = 0; q < 9; q++) s += ke[(3 * k) * 9 + q] * ru[q];
        ku[nodes[k]] += s;
      }
    }
    for (let i = 0; i < n; i++) {
      if (fixW[i]) r[i] = f[3 * i] - ku[i];
      else if (springW[i] > 0) r[i] = springW[i] * u[3 * i];
    }
    U.push(u); R.push(r);
  }
  const t3 = now();
  return { U, R, neq, profile: K.a.length, time: { assemble: t1 - t0, factor: t2 - t1, solve: t3 - t2 } };
}

/**
 * Schnittmomente: je Element im Schwerpunkt sowie gemittelt an den Knoten (Mittelung der
 * Eckwerte aller angrenzenden Elemente, flächengewichtet).
 * Elemente starrer Stützenköpfe (headMask[t] = 1; ohne headMask: elemFactor > 1) gehen nicht in die Knotenmittelung
 * der Randknoten ein; Knoten im Inneren eines Stützenkopfes erhalten den Mittelwert der Werte am
 * Stützenrand (Moment am Anschnitt statt singulärer Spitze der Punktlagerung).
 * Rückgabe: {emx, emy, emxy (Elementschwerpunkt), mx, my, mxy (Knoten)}
 */
export function plateMoments(mesh, u, D, nu, elemFactor = null, headMask = null) {
  const { x, y, tri, nNodes: n } = mesh;
  const nt = tri.length / 3;
  const emx = new Float64Array(nt), emy = new Float64Array(nt), emxy = new Float64Array(nt);
  const mx = new Float64Array(n), my = new Float64Array(n), mxy = new Float64Array(n), wsum = new Float64Array(n);
  const isHead = headMask ? (t) => headMask[t] === 1 : (t) => !!elemFactor && elemFactor[t] > 1;
  const anyHead = headMask ? headMask.some((v) => v === 1) : !!elemFactor;
  const soft = anyHead ? new Uint8Array(n) : null;
  const ue = new Float64Array(9), B = new Float64Array(27);
  const corners = [[0, 0], [1, 0], [0, 1]];
  for (let t = 0; t < nt; t++) {
    const i1 = tri[3 * t], i2 = tri[3 * t + 1], i3 = tri[3 * t + 2];
    const co = dktCoefficients(x[i1], y[i1], x[i2], y[i2], x[i3], y[i3]);
    const nodes = [i1, i2, i3];
    for (let k = 0; k < 3; k++) { ue[3 * k] = u[3 * nodes[k]]; ue[3 * k + 1] = u[3 * nodes[k] + 1]; ue[3 * k + 2] = u[3 * nodes[k] + 2]; }
    const stiff = isHead(t);
    const De = elemFactor ? D * elemFactor[t] : D;
    const mc = dktMoments(co, ue, De, nu, 1 / 3, 1 / 3, B);
    emx[t] = mc[0]; emy[t] = mc[1]; emxy[t] = mc[2];
    const A = co.twoA / 2;
    const wgt = stiff ? A * 1e-9 : A;
    for (let k = 0; k < 3; k++) {
      const m = dktMoments(co, ue, De, nu, corners[k][0], corners[k][1], B);
      const v = nodes[k];
      mx[v] += wgt * m[0]; my[v] += wgt * m[1]; mxy[v] += wgt * m[2]; wsum[v] += wgt;
      if (soft && !stiff) soft[v] = 1;
    }
  }
  for (let i = 0; i < n; i++) if (wsum[i] > 0) { mx[i] /= wsum[i]; my[i] /= wsum[i]; mxy[i] /= wsum[i]; }
  if (anyHead) {
    // Knoten nur in starren Elementen: Mittelwert der benachbarten Randknoten
    const sx = new Float64Array(n), sy = new Float64Array(n), sxy = new Float64Array(n), cnt = new Float64Array(n);
    for (let t = 0; t < nt; t++) {
      if (!isHead(t)) continue;
      for (let k = 0; k < 3; k++) {
        const a = tri[3 * t + k];
        if (soft[a] || wsum[a] <= 0) continue;
        for (let j = 0; j < 3; j++) {
          const b = tri[3 * t + j];
          if (!soft[b]) continue;
          sx[a] += mx[b]; sy[a] += my[b]; sxy[a] += mxy[b]; cnt[a]++;
        }
      }
    }
    for (let i = 0; i < n; i++) if (cnt[i] > 0) { mx[i] = sx[i] / cnt[i]; my[i] = sy[i] / cnt[i]; mxy[i] = sxy[i] / cnt[i]; }
    for (let t = 0; t < nt; t++) {
      if (!isHead(t)) continue;
      const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
      emx[t] = (mx[a] + mx[b] + mx[c]) / 3; emy[t] = (my[a] + my[b] + my[c]) / 3; emxy[t] = (mxy[a] + mxy[b] + mxy[c]) / 3;
    }
  }
  return { emx, emy, emxy, mx, my, mxy };
}

function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

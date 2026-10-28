// Stahlprofile: Nenndimensionen aus den Normtabellen und Berechnung der Querschnittswerte (DOM-frei)
//
// Gespeichert werden nur die Nennmasse (h, b, tw, tf, r …) nach
//   IPE, HEA, HEB, HEM:  EN 10365 / Euronorm 19-57, DIN 1025
//   UPN:                 EN 10365 / DIN 1026-1 (Flanschneigung 8 % bzw. 5 % für h > 300 mm)
//   RHS/SHS, CHS:        EN 10210-2 (warmgefertigte Hohlprofile, ro = 1.5·t, ri = 1.0·t)
// Alle Querschnittswerte werden daraus berechnet (inkl. Ausrundungen).
// Einheiten: mm, mm², mm⁴, mm⁶; Masse in kg/m.
//
// Koordinaten: y horizontal (nach rechts), z vertikal (nach oben), Ursprung im Schwerpunkt.
// Starke Achse = y-y (Biegung My mit Spannungen über die Höhe h).

const RHO_STEEL = 7850; // kg/m³

// ------------------------------------------------------------------ Tabellen (Nennmasse in mm)

// [Name, h, b, tw, tf, r]
const IPE = [
  [80, 80, 46, 3.8, 5.2, 5], [100, 100, 55, 4.1, 5.7, 7], [120, 120, 64, 4.4, 6.3, 7], [140, 140, 73, 4.7, 6.9, 7],
  [160, 160, 82, 5.0, 7.4, 9], [180, 180, 91, 5.3, 8.0, 9], [200, 200, 100, 5.6, 8.5, 12], [220, 220, 110, 5.9, 9.2, 12],
  [240, 240, 120, 6.2, 9.8, 15], [270, 270, 135, 6.6, 10.2, 15], [300, 300, 150, 7.1, 10.7, 15], [330, 330, 160, 7.5, 11.5, 18],
  [360, 360, 170, 8.0, 12.7, 18], [400, 400, 180, 8.6, 13.5, 21], [450, 450, 190, 9.4, 14.6, 21], [500, 500, 200, 10.2, 16.0, 21],
  [550, 550, 210, 11.1, 17.2, 24], [600, 600, 220, 12.0, 19.0, 24],
];
const HEA = [
  [100, 96, 100, 5, 8, 12], [120, 114, 120, 5, 8, 12], [140, 133, 140, 5.5, 8.5, 12], [160, 152, 160, 6, 9, 15],
  [180, 171, 180, 6, 9.5, 15], [200, 190, 200, 6.5, 10, 18], [220, 210, 220, 7, 11, 18], [240, 230, 240, 7.5, 12, 21],
  [260, 250, 260, 7.5, 12.5, 24], [280, 270, 280, 8, 13, 24], [300, 290, 300, 8.5, 14, 27], [320, 310, 300, 9, 15.5, 27],
  [340, 330, 300, 9.5, 16.5, 27], [360, 350, 300, 10, 17.5, 27], [400, 390, 300, 11, 19, 27], [450, 440, 300, 11.5, 21, 27],
  [500, 490, 300, 12, 23, 27], [550, 540, 300, 12.5, 24, 27], [600, 590, 300, 13, 25, 27], [650, 640, 300, 13.5, 26, 27],
  [700, 690, 300, 14.5, 27, 27], [800, 790, 300, 15, 28, 30], [900, 890, 300, 16, 30, 30], [1000, 990, 300, 16.5, 31, 30],
];
const HEB = [
  [100, 100, 100, 6, 10, 12], [120, 120, 120, 6.5, 11, 12], [140, 140, 140, 7, 12, 12], [160, 160, 160, 8, 13, 15],
  [180, 180, 180, 8.5, 14, 15], [200, 200, 200, 9, 15, 18], [220, 220, 220, 9.5, 16, 18], [240, 240, 240, 10, 17, 21],
  [260, 260, 260, 10, 17.5, 24], [280, 280, 280, 10.5, 18, 24], [300, 300, 300, 11, 19, 27], [320, 320, 300, 11.5, 20.5, 27],
  [340, 340, 300, 12, 21.5, 27], [360, 360, 300, 12.5, 22.5, 27], [400, 400, 300, 13.5, 24, 27], [450, 450, 300, 14, 26, 27],
  [500, 500, 300, 14.5, 28, 27], [550, 550, 300, 15, 29, 27], [600, 600, 300, 15.5, 30, 27], [650, 650, 300, 16, 31, 27],
  [700, 700, 300, 17, 32, 27], [800, 800, 300, 17.5, 33, 30], [900, 900, 300, 18.5, 35, 30], [1000, 1000, 300, 19, 36, 30],
];
const HEM = [
  [100, 120, 106, 12, 20, 12], [120, 140, 126, 12.5, 21, 12], [140, 160, 146, 13, 22, 12], [160, 180, 166, 14, 23, 15],
  [180, 200, 186, 14.5, 24, 15], [200, 220, 206, 15, 25, 18], [220, 240, 226, 15.5, 26, 18], [240, 270, 248, 18, 32, 21],
  [260, 290, 268, 18, 32.5, 24], [280, 310, 288, 18.5, 33, 24], [300, 340, 310, 21, 39, 27], [320, 359, 309, 21, 40, 27],
  [340, 377, 309, 21, 40, 27], [360, 395, 308, 21, 40, 27], [400, 432, 307, 21, 40, 27], [450, 478, 307, 21, 40, 27],
  [500, 524, 306, 21, 40, 27], [550, 572, 306, 21, 40, 27], [600, 620, 305, 21, 40, 27], [650, 668, 305, 21, 40, 27],
  [700, 716, 304, 21, 40, 27], [800, 814, 303, 21, 40, 30], [900, 910, 302, 21, 40, 30], [1000, 1008, 302, 21, 40, 30],
];
// [Name, h, b, tw (s), tf (t bei b/2), r1]; r2 = r1/2
const UPN = [
  [80, 80, 45, 6, 8, 8], [100, 100, 50, 6, 8.5, 8.5], [120, 120, 55, 7, 9, 9], [140, 140, 60, 7, 10, 10],
  [160, 160, 65, 7.5, 10.5, 10.5], [180, 180, 70, 8, 11, 11], [200, 200, 75, 8.5, 11.5, 11.5], [220, 220, 80, 9, 12.5, 12.5],
  [240, 240, 85, 9.5, 13, 13], [260, 260, 90, 10, 14, 14], [280, 280, 95, 10, 15, 15], [300, 300, 100, 10, 16, 16],
  [320, 320, 100, 14, 17.5, 17.5], [350, 350, 100, 14, 16, 16], [380, 380, 102, 13.5, 16, 16], [400, 400, 110, 14, 18, 18],
];
// Quadratische Hohlprofile [a, t…]
const SHS = [
  [40, [3, 4]], [50, [3, 4, 5]], [60, [4, 5]], [70, [4, 5]], [80, [4, 5, 6]], [90, [5, 6]], [100, [5, 6, 8, 10]],
  [120, [5, 6, 8, 10]], [140, [6, 8, 10]], [150, [6, 8, 10]], [160, [6, 8, 10]], [180, [8, 10]], [200, [8, 10, 12.5]],
  [250, [8, 10, 12.5]], [300, [10, 12.5]],
];
// Rechteckige Hohlprofile [h, b, t…]
const RHS = [
  [80, 40, [4]], [100, 50, [4, 5]], [120, 60, [5, 6]], [120, 80, [5, 6]], [140, 80, [5, 6]], [150, 100, [6, 8]],
  [160, 80, [6, 8]], [180, 100, [6, 8]], [200, 100, [6, 8, 10]], [200, 120, [8, 10]], [250, 150, [8, 10]],
  [300, 200, [10, 12.5]], [400, 200, [10, 12.5]],
];
// Rundrohre [d, t…]
const CHS = [
  [48.3, [3.2, 4]], [60.3, [3.2, 4]], [76.1, [4, 5]], [88.9, [4, 5, 6.3]], [101.6, [5, 6.3]], [114.3, [5, 6.3, 8]],
  [139.7, [5, 6.3, 8, 10]], [168.3, [6.3, 8, 10]], [193.7, [8, 10]], [219.1, [8, 10, 12.5]], [244.5, [10, 12.5]],
  [273, [10, 12.5]], [323.9, [10, 12.5]], [355.6, [12.5, 16]], [406.4, [12.5, 16]], [457, [12.5, 16]], [508, [12.5, 16]],
];

const num = (x) => String(x).replace('.', '.');
const MUL = '×';

function buildCatalog() {
  const cat = {};
  const add = (series, list) => { cat[series] = list; };
  add('IPE', IPE.map(([n, h, b, tw, tf, r]) => ({ name: `IPE ${n}`, type: 'I', h, b, tw, tf, r })));
  add('HEA', HEA.map(([n, h, b, tw, tf, r]) => ({ name: `HEA ${n}`, type: 'I', h, b, tw, tf, r })));
  add('HEB', HEB.map(([n, h, b, tw, tf, r]) => ({ name: `HEB ${n}`, type: 'I', h, b, tw, tf, r })));
  add('HEM', HEM.map(([n, h, b, tw, tf, r]) => ({ name: `HEM ${n}`, type: 'I', h, b, tw, tf, r })));
  add('UPN', UPN.map(([n, h, b, tw, tf, r]) => ({ name: `UPN ${n}`, type: 'U', h, b, tw, tf, r, r2: r / 2, slope: h > 300 ? 0.05 : 0.08 })));
  add('SHS', SHS.flatMap(([a, ts]) => ts.map((t) => ({ name: `SHS ${a}${MUL}${a}${MUL}${num(t)}`, type: 'RHS', h: a, b: a, t }))));
  add('RHS', RHS.flatMap(([h, b, ts]) => ts.map((t) => ({ name: `RHS ${h}${MUL}${b}${MUL}${num(t)}`, type: 'RHS', h, b, t }))));
  add('CHS', CHS.flatMap(([d, ts]) => ts.map((t) => ({ name: `CHS ${num(d)}${MUL}${num(t)}`, type: 'CHS', d, t, h: d, b: d }))));
  return cat;
}

export const CATALOG = buildCatalog();

export const SERIES = [
  { id: 'IPE', label: 'IPE – schmale I-Träger', type: 'I' },
  { id: 'HEA', label: 'HEA – Breitflansch leicht', type: 'I' },
  { id: 'HEB', label: 'HEB – Breitflansch', type: 'I' },
  { id: 'HEM', label: 'HEM – Breitflansch verstärkt', type: 'I' },
  { id: 'UPN', label: 'UPN – U-Profile', type: 'U' },
  { id: 'SHS', label: 'SHS – quadratische Hohlprofile', type: 'RHS' },
  { id: 'RHS', label: 'RHS – rechteckige Hohlprofile', type: 'RHS' },
  { id: 'CHS', label: 'CHS – Rundrohre', type: 'CHS' },
  { id: 'WI', label: 'Geschweisster I-Querschnitt', type: 'WI' },
  { id: 'USER', label: 'Benutzerdefinierte Werte', type: 'custom' },
];

/** Serien, die nach dem leichtesten Profil durchsucht werden können. */
export const SEARCHABLE = ['IPE', 'HEA', 'HEB', 'HEM', 'UPN', 'SHS', 'RHS', 'CHS'];

export function profileNames(series) {
  return (CATALOG[series] || []).map((p) => p.name);
}

export function findProfile(series, name) {
  const list = CATALOG[series] || [];
  return list.find((p) => p.name === name) || null;
}

// ------------------------------------------------------------------ Geometrie-Hilfen

/** Kreisbogenpunkte (Winkel in rad, inkl. Endpunkte). */
function arcPts(cx, cy, r, a0, a1, n = 8) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

/** Rundet die Ecken eines Polygons mit Radien radii[i] (0 = scharf) aus. */
export function roundPolygon(pts, radii, seg = 8) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const r = radii[i] || 0;
    const P = pts[i];
    if (r <= 0) { out.push(P); continue; }
    const A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n];
    let d1 = [A[0] - P[0], A[1] - P[1]], d2 = [B[0] - P[0], B[1] - P[1]];
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    d1 = [d1[0] / l1, d1[1] / l1]; d2 = [d2[0] / l2, d2[1] / l2];
    const cos = Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1]));
    const th = Math.acos(cos);
    if (th < 1e-6 || Math.PI - th < 1e-6) { out.push(P); continue; }
    const dist = r / Math.tan(th / 2);
    const T1 = [P[0] + d1[0] * dist, P[1] + d1[1] * dist];
    const T2 = [P[0] + d2[0] * dist, P[1] + d2[1] * dist];
    let bis = [d1[0] + d2[0], d1[1] + d2[1]];
    const lb = Math.hypot(...bis); bis = [bis[0] / lb, bis[1] / lb];
    const C = [P[0] + bis[0] * r / Math.sin(th / 2), P[1] + bis[1] * r / Math.sin(th / 2)];
    const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    let a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    let da = a2 - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    out.push(...arcPts(C[0], C[1], r, a1, a1 + da, seg));
  }
  return out;
}

/** Flächenwerte eines Polygons (Vorzeichen nach Umlaufsinn). y = pts[i][0], z = pts[i][1]. */
export function polygonProps(pts) {
  let A = 0, Sy = 0, Sz = 0, Iyy = 0, Izz = 0, Iyz = 0;
  // Sy = ∫z dA, Sz = ∫y dA, Iyy = ∫z² dA, Izz = ∫y² dA
  for (let i = 0, n = pts.length; i < n; i++) {
    const [y0, z0] = pts[i], [y1, z1] = pts[(i + 1) % n];
    const c = y0 * z1 - y1 * z0;
    A += c;
    Sz += (y0 + y1) * c;
    Sy += (z0 + z1) * c;
    Izz += (y0 * y0 + y0 * y1 + y1 * y1) * c;
    Iyy += (z0 * z0 + z0 * z1 + z1 * z1) * c;
    Iyz += (y0 * z1 + 2 * y0 * z0 + 2 * y1 * z1 + y1 * z0) * c;
  }
  return { A: A / 2, Sy: Sy / 6, Sz: Sz / 6, Iyy: Iyy / 12, Izz: Izz / 12, Iyz: Iyz / 24 };
}

/** Polygon an Halbebene n·p ≥ c abschneiden (Sutherland-Hodgman). */
export function clipPolygon(pts, n, c) {
  const out = [];
  const f = (p) => n[0] * p[0] + n[1] * p[1] - c;
  for (let i = 0; i < pts.length; i++) {
    const P = pts[i], Q = pts[(i + 1) % pts.length];
    const fp = f(P), fq = f(Q);
    if (fp >= 0) out.push(P);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
    }
  }
  return out;
}

const signedArea = (pts) => polygonProps(pts).A;
const ccw = (pts) => (signedArea(pts) < 0 ? pts.slice().reverse() : pts);

/** Querschnittswerte aus Ringen (aussen gegen Uhrzeigersinn, Löcher beliebig) inkl. Wpl. */
function ringsProps(outer, holes = []) {
  const o = ccw(outer);
  const hs = holes.map((hh) => ccw(hh));
  const sum = (fn) => fn(o) - hs.reduce((s, hh) => s + fn(hh), 0);
  const P = (r) => polygonProps(r);
  const A = sum((r) => P(r).A);
  const yc = sum((r) => P(r).Sz) / A;
  const zc = sum((r) => P(r).Sy) / A;
  const Iyy = sum((r) => P(r).Iyy) - A * zc * zc;
  const Izz = sum((r) => P(r).Izz) - A * yc * yc;
  return { A, yc, zc, Iy: Iyy, Iz: Izz, o, hs };
}

/** Fläche und statisches Moment eines Ringsystems im Bereich n·p ≥ c. */
function clippedMoments(o, hs, n, c) {
  const part = (r) => { const q = clipPolygon(r, n, c); return q.length >= 3 ? polygonProps(q) : { A: 0, Sy: 0, Sz: 0 }; };
  const po = part(o);
  let A = po.A, Sy = po.Sy, Sz = po.Sz;
  for (const hh of hs) { const ph = part(hh); A -= ph.A; Sy -= ph.Sy; Sz -= ph.Sz; }
  return { A, Sy, Sz };
}

/** Plastisches Widerstandsmoment über die flächenhalbierende Nulllinie (numerisch). axis 'y' oder 'z'. */
function plasticModulus(o, hs, A, axis, bounds) {
  // axis 'y': Nulllinie horizontal z = zp; axis 'z': vertikal y = yp
  const n = axis === 'y' ? [0, 1] : [1, 0];
  const [lo0, hi0] = axis === 'y' ? [bounds.z0, bounds.z1] : [bounds.y0, bounds.y1];
  let lo = lo0, hi = hi0;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    const a = clippedMoments(o, hs, n, mid).A; // Fläche oberhalb/rechts
    if (a > A / 2) lo = mid; else hi = mid;
  }
  const p = (lo + hi) / 2;
  const up = clippedMoments(o, hs, n, p);
  const dn = clippedMoments(o, hs, [-n[0], -n[1]], -p);
  const S = (m) => (axis === 'y' ? m.Sy - m.A * p : m.Sz - m.A * p);
  return { W: Math.abs(S(up)) + Math.abs(S(dn)), p };
}

// ------------------------------------------------------------------ Eckausrundung (Zwickel)

const K_FILLET = (10 - 3 * Math.PI) / (12 - 3 * Math.PI); // Schwerpunktabstand Zwickel / r = 0.2234
const A_FILLET = 1 - Math.PI / 4;                          // Zwickelfläche / r² = 0.2146
/** Eigenträgheitsmoment eines Zwickels um seine Schwerachse (parallel zu einer Kathete) / r⁴ ≈ 0.00754 */
const I_FILLET = (() => {
  const Iq = (Math.PI / 16 - 4 / (9 * Math.PI)); // Viertelkreis um eigene Schwerachse
  const d = 1 - 4 / (3 * Math.PI);
  const aboutEdge = 1 / 3 - (Iq + Math.PI / 4 * d * d);
  return aboutEdge - A_FILLET * K_FILLET * K_FILLET;
})();

// ------------------------------------------------------------------ Querschnittswerte je Typ

/** I-Profile (gewalzt mit Ausrundung r, geschweisst mit r = 0). Formeln nach EN 10365 / Euronorm. */
function propsI(p, welded = false) {
  const { h, b, tw, tf } = p;
  const r = welded ? 0 : p.r;
  const hw = h - 2 * tf;
  const Af = A_FILLET * r * r;
  const A = 2 * b * tf + hw * tw + 4 * Af;
  const dz = h / 2 - tf - K_FILLET * r; // Abstand Zwickelschwerpunkt von y-Achse
  const dy = tw / 2 + K_FILLET * r;     // Abstand Zwickelschwerpunkt von z-Achse
  const Iy = (b * h ** 3 - (b - tw) * hw ** 3) / 12 + 4 * (I_FILLET * r ** 4 + Af * dz * dz);
  const Iz = (2 * tf * b ** 3 + hw * tw ** 3) / 12 + 4 * (I_FILLET * r ** 4 + Af * dy * dy);
  const Wply = b * tf * (h - tf) + tw * hw * hw / 4 + 4 * Af * dz;
  const Wplz = b * b * tf / 2 + hw * tw * tw / 4 + 4 * Af * dy;
  // St. Venant: EN 10365 (informativ) mit Ausrundungsanteil
  let It;
  if (welded) {
    It = (2 * b * tf ** 3 + (h - tf) * tw ** 3) / 3;
  } else {
    const a1 = (tw / tf) * (0.145 + 0.1 * r / tf);
    const D1 = ((r + tw / 2) ** 2 + (r + tf) ** 2 - r * r) / (2 * r + tf);
    It = (2 / 3) * (b - 0.63 * tf) * tf ** 3 + (1 / 3) * hw * tw ** 3 + 2 * a1 * D1 ** 4;
  }
  const Iw = Iz * (h - tf) ** 2 / 4;
  // Schubflächen EN 1993-1-1 6.2.6(3)
  const AvzRolled = A - 2 * b * tf + (tw + 2 * r) * tf;
  const Avz = welded ? hw * tw : AvzRolled; // η·hw·tw-Minimum in calc.js (normabhängig)
  const Avy = 2 * b * tf;
  const a = welded ? (p.a || 0) : 0;
  const cw = welded ? hw - 2 * Math.SQRT2 * a : hw - 2 * r; // gerader Stegteil
  const cf = welded ? (b - tw) / 2 - Math.SQRT2 * a : (b - tw) / 2 - r; // Flanschüberstand
  return {
    A, Iy, Iz, Wply, Wplz, Wely: 2 * Iy / h, Welz: 2 * Iz / b, It, Iw, Avz, Avy, hw, cw, cf, r, zMax: h / 2, yMax: b / 2,
    AvzMin: hw * tw,
  };
}

/** UPN mit geneigten Flanschinnenflächen – numerische Integration über das ausgerundete Polygon. */
function upnOutline(p) {
  const { h, b, tw, tf, r, r2, slope } = p;
  const t = (y) => tf + slope * (b / 2 - y); // Flanschdicke bei Abstand y vom Stegrücken
  const pts = [
    [0, -h / 2], [b, -h / 2], [b, -h / 2 + t(b)], [tw, -h / 2 + t(tw)],
    [tw, h / 2 - t(tw)], [b, h / 2 - t(b)], [b, h / 2], [0, h / 2],
  ];
  const radii = [0, 0, r2, r, r, r2, 0, 0];
  return { pts: roundPolygon(pts, radii, 10), t };
}

function propsU(p) {
  const { h, b, tw, tf, r } = p;
  const { pts, t } = upnOutline(p);
  const g = ringsProps(pts);
  const ys = g.yc; // Schwerpunktabstand vom Stegrücken
  const shifted = g.o.map(([y, z]) => [y - ys, z]);
  const bounds = { y0: -ys, y1: b - ys, z0: -h / 2, z1: h / 2 };
  const Wply = plasticModulus(shifted, [], g.A, 'y', bounds).W;
  const pz = plasticModulus(shifted, [], g.A, 'z', bounds);
  // Dünnwandige Kennwerte (Mittellinie): Steg in y = tw/2, Flansche bis y = b
  const hp = h - tf, bp = b - tw / 2;
  const tf_at = (s) => t(tw / 2 + s); // Flanschdicke entlang der Flanschmittellinie
  // Schubmittelpunkt: e = h'²/(2 Iy) ∫ s·t(s) ds (ab Stegmittellinie)
  const n = 40;
  let int1 = 0, int2a = 0, int2b = 0, int2c = 0;
  for (let i = 0; i <= n; i++) {
    const s = bp * i / n, w = (i === 0 || i === n) ? 1 : (i % 2 ? 4 : 2);
    const ts = tf_at(s);
    int1 += w * s * ts; int2a += w * ts; int2b += w * s * ts; int2c += w * s * s * ts;
  }
  const f = bp / n / 3;
  int1 *= f; int2a *= f; int2b *= f; int2c *= f;
  const e = hp * hp / (2 * g.Iy) * int1; // Abstand Schubmittelpunkt hinter Stegmittellinie
  // Wölbwiderstand Iw = ∫ω² t ds (Pol im Schubmittelpunkt)
  const IwWeb = e * e * tw * hp ** 3 / 12;
  const IwFl = 2 * (hp / 2) ** 2 * (e * e * int2a - 2 * e * int2b + int2c);
  const Iw = IwWeb + IwFl;
  const It = (2 * b * tf ** 3 + h * tw ** 3) / 3; // Näherung, deckt Tabellenwerte auf ±2 % ab
  const yScFromBack = tw / 2 - e;
  const AvzRolled = g.A - 2 * b * tf + (tw + r) * tf; // EN 1993-1-1 6.2.6(3)(b)
  return {
    A: g.A, Iy: g.Iy, Iz: g.Iz, Wply, Wplz: pz.W, Wely: 2 * g.Iy / h, Welz: g.Iz / Math.max(ys, b - ys),
    It, Iw, Avz: AvzRolled, Avy: 2 * b * tf, hw: h - 2 * tf, cw: h - 2 * tf - 2 * r, cf: b - tw - r, r,
    ys, y0: yScFromBack - ys, ypl: pz.p, zMax: h / 2, yMax: Math.max(ys, b - ys), yMinEdge: -ys, yMaxEdge: b - ys,
    outline: shifted, AvzMin: (h - 2 * tf) * tw,
  };
}

/** Warmgefertigte Rechteckhohlprofile nach EN 10210-2 Anhang B (ro = 1.5 t, ri = t). */
function propsRHS(p) {
  const { h, b, t } = p;
  const ro = 1.5 * t, ri = t;
  const Ao = A_FILLET * ro * ro, Ai = A_FILLET * ri * ri;
  const A = b * h - (b - 2 * t) * (h - 2 * t) - 4 * Ao + 4 * Ai;
  const dzo = h / 2 - K_FILLET * ro, dzi = h / 2 - t - K_FILLET * ri;
  const dyo = b / 2 - K_FILLET * ro, dyi = b / 2 - t - K_FILLET * ri;
  const Iy = (b * h ** 3 - (b - 2 * t) * (h - 2 * t) ** 3) / 12 - 4 * (I_FILLET * ro ** 4 + Ao * dzo * dzo) + 4 * (I_FILLET * ri ** 4 + Ai * dzi * dzi);
  const Iz = (h * b ** 3 - (h - 2 * t) * (b - 2 * t) ** 3) / 12 - 4 * (I_FILLET * ro ** 4 + Ao * dyo * dyo) + 4 * (I_FILLET * ri ** 4 + Ai * dyi * dyi);
  const Wply = (b * h * h - (b - 2 * t) * (h - 2 * t) ** 2) / 4 - 4 * Ao * dzo + 4 * Ai * dzi;
  const Wplz = (h * b * b - (h - 2 * t) * (b - 2 * t) ** 2) / 4 - 4 * Ao * dyo + 4 * Ai * dyi;
  // Torsion (EN 10210-2 B.2): It = t³·p/3 + 2·K·Am, K = 2·Am·t/p
  const Rc = (ro + ri) / 2;
  const pm = 2 * ((b - t) + (h - t)) - 2 * Rc * (4 - Math.PI);
  const Am = (b - t) * (h - t) - Rc * Rc * (4 - Math.PI);
  const It = t ** 3 * pm / 3 + 4 * Am * Am * t / pm;
  return {
    A, Iy, Iz, Wply, Wplz, Wely: 2 * Iy / h, Welz: 2 * Iz / b, It, Iw: 0,
    Avz: A * h / (b + h), Avy: A * b / (b + h), hw: h - 2 * t, cw: h - 3 * t, cf: b - 3 * t, ro, ri,
    zMax: h / 2, yMax: b / 2, AvzMin: 0,
  };
}

function propsCHS(p) {
  const { d, t } = p;
  const di = d - 2 * t;
  const A = Math.PI * (d * d - di * di) / 4;
  const I = Math.PI * (d ** 4 - di ** 4) / 64;
  const Wpl = (d ** 3 - di ** 3) / 6;
  return {
    A, Iy: I, Iz: I, Wply: Wpl, Wplz: Wpl, Wely: 2 * I / d, Welz: 2 * I / d, It: 2 * I, Iw: 0,
    Avz: 2 * A / Math.PI, Avy: 2 * A / Math.PI, hw: d, zMax: d / 2, yMax: d / 2, AvzMin: 0,
  };
}

// ------------------------------------------------------------------ Umriss für die Darstellung

function outlineI(p, welded) {
  const { h, b, tw, tf } = p;
  const r = welded ? 0 : p.r;
  const H = h / 2, B = b / 2, w = tw / 2;
  const pts = [
    [-B, -H], [B, -H], [B, -H + tf], [w, -H + tf], [w, H - tf], [B, H - tf], [B, H], [-B, H], [-B, H - tf], [-w, H - tf], [-w, -H + tf], [-B, -H + tf],
  ];
  const radii = [0, 0, 0, r, r, 0, 0, 0, 0, r, r, 0];
  const welds = [];
  if (welded && p.a > 0) {
    const l = p.a * Math.SQRT2;
    for (const sy of [1, -1]) for (const sz of [1, -1]) {
      const y0 = sy * w, z0 = sz * (H - tf);
      welds.push([[y0, z0], [y0 + sy * l, z0], [y0, z0 - sz * l]]);
    }
  }
  return { rings: [roundPolygon(pts, radii, 10)], welds };
}

function outlineRHS(p) {
  const { h, b, t } = p;
  const ro = 1.5 * t, ri = t;
  const rect = (B, H) => [[-B, -H], [B, -H], [B, H], [-B, H]];
  return { rings: [roundPolygon(rect(b / 2, h / 2), [ro, ro, ro, ro], 10), roundPolygon(rect(b / 2 - t, h / 2 - t), [ri, ri, ri, ri], 10)] };
}

function outlineCHS(p) {
  const circ = (r) => Array.from({ length: 96 }, (_, i) => [r * Math.cos(2 * Math.PI * i / 96), r * Math.sin(2 * Math.PI * i / 96)]);
  return { rings: [circ(p.d / 2), circ(p.d / 2 - p.t)] };
}

// ------------------------------------------------------------------ Teilflächen für Klassifizierung / wirksame Breiten

/**
 * Plattenelemente (gerade Teile c) mit Lage: p1 → p2. Bei Kragteilen ist p1 der gestützte Rand, p2 der freie Rand.
 * orient: 'v' (vertikal, parallel zu z) oder 'h' (horizontal, parallel zu y).
 */
function platesI(s) {
  const H = s.h / 2, tf = s.tf;
  const zf = H - tf / 2;
  const y1 = s.tw / 2 + (s.type === 'WI' ? Math.SQRT2 * (s.a || 0) : s.r);
  const out = [
    { id: 'web', label: 'Steg', kind: 'internal', p1: [0, s.cw / 2], p2: [0, -s.cw / 2], c: s.cw, t: s.tw, orient: 'v' },
  ];
  for (const [sz, lab] of [[1, 'Obergurt'], [-1, 'Untergurt']]) {
    for (const sy of [1, -1]) {
      out.push({ id: `f${sz > 0 ? 'o' : 'u'}${sy > 0 ? 'r' : 'l'}`, label: lab, kind: 'outstand', p1: [sy * y1, sz * zf], p2: [sy * (y1 + s.cf), sz * zf], c: s.cf, t: tf, orient: 'h' });
    }
  }
  return out;
}

function platesU(s) {
  const yb = s.yMinEdge; // Stegrücken
  const yw = yb + s.tw / 2;
  const zf = s.h / 2 - s.tf / 2;
  const y1 = yb + s.tw + s.r;
  return [
    { id: 'web', label: 'Steg', kind: 'internal', p1: [yw, s.cw / 2], p2: [yw, -s.cw / 2], c: s.cw, t: s.tw, orient: 'v' },
    { id: 'fo', label: 'Obergurt', kind: 'outstand', p1: [y1, zf], p2: [y1 + s.cf, zf], c: s.cf, t: s.tf, orient: 'h' },
    { id: 'fu', label: 'Untergurt', kind: 'outstand', p1: [y1, -zf], p2: [y1 + s.cf, -zf], c: s.cf, t: s.tf, orient: 'h' },
  ];
}

function platesRHS(s) {
  const B = s.b / 2 - s.t / 2, H = s.h / 2 - s.t / 2;
  const cw = s.h - 3 * s.t, cf = s.b - 3 * s.t;
  return [
    { id: 'wr', label: 'Steg', kind: 'internal', p1: [B, cw / 2], p2: [B, -cw / 2], c: cw, t: s.t, orient: 'v' },
    { id: 'wl', label: 'Steg', kind: 'internal', p1: [-B, cw / 2], p2: [-B, -cw / 2], c: cw, t: s.t, orient: 'v' },
    { id: 'fo', label: 'Obergurt', kind: 'internal', p1: [-cf / 2, H], p2: [cf / 2, H], c: cf, t: s.t, orient: 'h' },
    { id: 'fu', label: 'Untergurt', kind: 'internal', p1: [-cf / 2, -H], p2: [cf / 2, -H], c: cf, t: s.t, orient: 'h' },
  ];
}

// ------------------------------------------------------------------ Hauptfunktion

/**
 * Liefert die vollständigen Querschnittswerte.
 * def: {series, name} für Katalogprofile, {series:'WI', h, b, tw, tf, a} oder {series:'USER', …Werte}
 */
export function sectionProps(def) {
  const series = def.series || 'IPE';
  let s;
  if (series === 'WI') {
    const w = def.welded || def;
    s = { name: `I ${fmt0(w.h)}${MUL}${fmt0(w.b)}${MUL}${fmt0(w.tw)}/${fmt0(w.tf)}`, type: 'WI', series, h: +w.h, b: +w.b, tw: +w.tw, tf: +w.tf, a: +w.a || 0, r: 0, rolled: false };
    validateI(s);
    Object.assign(s, propsI(s, true));
    Object.assign(s, outlineI(s, true));
    s.plates = platesI(s);
  } else if (series === 'USER') {
    const u = def.custom || def;
    s = {
      name: u.name || 'Benutzerdefiniert', type: 'custom', series, rolled: true, h: +u.h, b: +u.b,
      A: u.A * 100, Iy: u.Iy * 1e4, Iz: u.Iz * 1e4, Wely: u.Wely * 1e3, Welz: u.Welz * 1e3, Wply: u.Wply * 1e3, Wplz: u.Wplz * 1e3,
      It: u.It * 1e4, Iw: u.Iw * 1e6, Avz: u.Avz * 100, Avy: u.Avy * 100, zMax: u.h / 2, yMax: u.b / 2,
      userClass: +u.cls || 1, curveY: u.curveY || 'b', curveZ: u.curveZ || 'c', ltbCurve: u.ltbCurve || 'd', AvzMin: 0, plates: [],
    };
    for (const k of ['A', 'Iy', 'Iz', 'Wely', 'Welz', 'Wply', 'Wplz', 'Avz']) {
      if (!(s[k] > 0)) throw new Error(`Benutzerdefinierter Querschnitt: Wert ${k} fehlt oder ist nicht positiv. Bitte im Register «Profil» ergänzen.`);
    }
    if (!(s.h > 0) || !(s.b > 0)) throw new Error('Benutzerdefinierter Querschnitt: Höhe h und Breite b müssen positiv sein (für Lastangriffspunkt und Darstellung).');
    s.It = s.It > 0 ? s.It : 0;
    s.Iw = s.Iw > 0 ? s.Iw : 0;
    s.Avy = s.Avy > 0 ? s.Avy : s.A - s.Avz;
    s.rings = [[[-s.b / 2, -s.h / 2], [s.b / 2, -s.h / 2], [s.b / 2, s.h / 2], [-s.b / 2, s.h / 2]]];
    s.dashed = true;
  } else {
    const base = findProfile(series, def.name) || CATALOG[series]?.[0];
    if (!base) throw new Error(`Unbekannte Profilreihe «${series}». Bitte im Register «Profil» eine Reihe wählen.`);
    s = { ...base, series, rolled: true };
    if (s.type === 'I') {
      Object.assign(s, propsI(s, false));
      Object.assign(s, outlineI(s, false));
      s.plates = platesI(s);
    } else if (s.type === 'U') {
      Object.assign(s, propsU(s));
      s.rings = [s.outline];
      s.plates = platesU(s);
    } else if (s.type === 'RHS') {
      Object.assign(s, propsRHS(s));
      Object.assign(s, outlineRHS(s));
      s.tw = s.t; s.tf = s.t;
      s.plates = platesRHS(s);
    } else if (s.type === 'CHS') {
      Object.assign(s, propsCHS(s));
      Object.assign(s, outlineCHS(s));
      s.tw = s.t; s.tf = s.t;
      s.plates = [];
    }
  }
  s.iy = Math.sqrt(s.Iy / s.A);
  s.iz = Math.sqrt(s.Iz / s.A);
  s.mass = s.A * 1e-6 * RHO_STEEL; // kg/m
  s.y0 = s.y0 || 0; // Schubmittelpunkt relativ zum Schwerpunkt (nur UPN ≠ 0)
  s.tmax = s.type === 'RHS' || s.type === 'CHS' ? s.t : Math.max(s.tf || 0, s.tw || 0);
  s.closed = s.type === 'RHS' || s.type === 'CHS';
  s.doublySym = s.type === 'I' || s.type === 'WI' || s.type === 'RHS' || s.type === 'CHS' || s.type === 'custom';
  return s;
}

function fmt0(x) { return String(+(+x).toFixed(1)); }

function validateI(s) {
  const bad = (msg) => { throw new Error(`Geschweisster Querschnitt: ${msg}`); };
  for (const k of ['h', 'b', 'tw', 'tf']) if (!(s[k] > 0)) bad(`${k} muss grösser als 0 sein.`);
  if (2 * s.tf >= s.h) bad('Die Flanschdicken sind grösser als die Höhe – bitte h oder tf korrigieren.');
  if (s.tw >= s.b) bad('Die Stegdicke tw muss kleiner als die Flanschbreite b sein.');
  if (s.a < 0) bad('Die Schweissnahtdicke a darf nicht negativ sein.');
}

/** Für Tests: Polygonintegration eines gezeichneten Umrisses (Kontrolle der geschlossenen Formeln). */
export function outlineProps(s) {
  const [o, ...hs] = s.rings;
  return ringsProps(o, hs);
}

/**
 * Lage der plastischen Nulllinie z_pl [mm] für Biegung My (Druck oben) mit Normalkraft N (Druck +) [N]:
 * Druckzone oberhalb z_pl mit Fläche (A + N/fy)/2. Rückgabe null, wenn |N| ≥ A·fy.
 */
export function plasticNeutralAxis(s, N, fy) {
  const Ac = (s.A + N / fy) / 2;
  if (Ac <= 0 || Ac >= s.A) return null;
  const [o, ...hs] = s.rings.map((r) => ccw(r));
  let lo = -s.zMax, hi = s.zMax;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    const a = clippedMoments(o, hs, [0, 1], mid).A;
    if (a > Ac) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

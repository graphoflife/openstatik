// Baustoffe und Bemessungswerte nach SIA 262/263 bzw. EN 1992/1993 (DOM-frei)
// Einheiten: Festigkeiten und E-Moduli in MPa (= N/mm²), Dehnungen dimensionslos.

export const NORMS = [
  { value: 'SIA', label: 'SIA 260 ff. (Schweiz)' },
  { value: 'EC', label: 'Eurocode (EN 1990 ff.)' },
];

// ------------------------------------------------------------------ Beton

export const CONCRETE_CLASSES = ['C12/15', 'C16/20', 'C20/25', 'C25/30', 'C30/37', 'C35/45', 'C40/50', 'C45/55', 'C50/60'];

/**
 * Kennwerte eines Betons.
 * opts: {norm:'SIA'|'EC', gammaC=1.5, alphaCC (EC, Standard 1.0), etaT (SIA, Standard 1.0)}
 * Rückgabe: fck, fcm, fctm, fctk05, Ecm, fcd, tcd (SIA τcd), ec2, ecu, n, gammaC, name
 */
export function concrete(name = 'C30/37', opts = {}) {
  const norm = opts.norm || 'SIA';
  const fck = Number(String(name).replace(/^C(\d+).*/, '$1'));
  const fcm = fck + 8;
  const fctm = fck <= 50 ? 0.3 * Math.pow(fck, 2 / 3) : 2.12 * Math.log(1 + fcm / 10);
  const gammaC = opts.gammaC ?? 1.5;
  let fcd, Ecm, ec2, ecu, n = 2, tcd = null, etaFc = 1;
  if (norm === 'SIA') {
    // SIA 262 (2013) 2.3.2.3, 4.2.1
    etaFc = Math.min(1, Math.pow(30 / fck, 1 / 3));
    const etaT = opts.etaT ?? 1.0;
    fcd = etaFc * etaT * fck / gammaC;
    tcd = 0.3 * etaT * Math.sqrt(fck) / gammaC;
    Ecm = 10000 * Math.pow(fcm, 1 / 3);
    ec2 = 0.002;
    ecu = 0.003;
  } else {
    // EN 1992-1-1 3.1, Tab. 3.1
    const alphaCC = opts.alphaCC ?? 1.0;
    fcd = alphaCC * fck / gammaC;
    Ecm = 22000 * Math.pow(fcm / 10, 0.3);
    ec2 = fck <= 50 ? 0.002 : 0.002 + 0.000085 * Math.pow(fck - 50, 0.53);
    ecu = fck <= 50 ? 0.0035 : 0.0026 + 0.035 * Math.pow((90 - fck) / 100, 4);
    n = fck <= 50 ? 2 : 1.4 + 23.4 * Math.pow((90 - fck) / 100, 4);
  }
  return {
    name, norm, fck, fcm, fctm, fctk05: 0.7 * fctm, fctk95: 1.3 * fctm, Ecm, fcd, tcd, ec2, ecu, n, gammaC, etaFc,
    gamma: 25, // Raumlast Stahlbeton [kN/m³]
    nu: 0.2,
    alphaT: 1e-5,
  };
}

/**
 * Spannungs-Dehnungs-Gesetz Beton (Druck negativ).
 * opts.kind: 'design' (Parabel-Rechteck mit fcd), 'mean' (Parabel-Rechteck mit fcm, für Verformungen),
 *            'linear' (linear-elastisch mit Ecm ohne Zug), 'sargin' (EN 1992 3.1.5, nichtlinear mit fcm;
 *            mit opts.strength = 'design' und opts.Ec = Ecd nach EN 1992 5.8.6 mit fcd)
 * opts.tension: true → Zugfestigkeit fctm linear bis Riss (für Steifigkeiten)
 * opts.Ec: abweichender E-Modul (z.B. Ecd = Ecm/γcE nach SIA 262 4.3.7 für Stützen)
 * opts.creep φ: Dehnungen werden mit (1+φ) gestreckt (vereinfachte Kriechberücksichtigung)
 */
export function concreteLaw(c, opts = {}) {
  const kind = opts.kind || 'design';
  const phi = opts.creep || 0;
  // opts.strength: 'design' | 'mean' überschreibt die Festigkeit unabhängig vom Gesetz (z.B. linear mit fcd)
  const fc = opts.strength === 'design' ? c.fcd : opts.strength === 'mean' ? c.fcm : kind === 'design' ? c.fcd : c.fcm;
  const ec2 = c.ec2 * (1 + phi), ecu = c.ecu * (1 + phi);
  const ecuTol = ecu * (1 + 1e-9); // Rundungstoleranz an der Grenzdehnung
  const n = c.n;
  const Ec = (opts.Ec || c.Ecm) / (1 + phi);
  const ft = opts.tension ? c.fctm : 0;
  const ecr = ft / Ec;
  let sigma, tangent;
  if (kind === 'linear') {
    sigma = (e) => (e >= 0 ? (e <= ecr ? Ec * e : 0) : Math.max(-fc, Ec * e) * (e < -ecuTol ? 0 : 1));
    tangent = (e) => (e >= 0 ? (e <= ecr ? Ec : 0) : (Ec * e > -fc && e >= -ecuTol ? Ec : 0));
  } else if (kind === 'sargin') {
    const ec1 = Math.min(0.7 * Math.pow(c.fcm, 0.31), 2.8) / 1000 * (1 + phi);
    const k = 1.05 * Ec * ec1 / fc;
    sigma = (e) => {
      if (e >= 0) return e <= ecr ? Ec * e : 0;
      if (e < -ecuTol) return 0;
      const eta = -e / ec1;
      return -fc * (k * eta - eta * eta) / (1 + (k - 2) * eta);
    };
    tangent = (e) => {
      if (e >= 0) return e <= ecr ? Ec : 0;
      if (e < -ecuTol) return 0;
      const eta = -e / ec1, den = 1 + (k - 2) * eta;
      return fc / ec1 * ((k - 2 * eta) * den - (k * eta - eta * eta) * (k - 2)) / (den * den);
    };
  } else {
    // Parabel-Rechteck
    sigma = (e) => {
      if (e >= 0) return e <= ecr ? Ec * e : 0;
      if (e < -ecuTol) return 0;
      if (e <= -ec2) return -fc;
      return -fc * (1 - Math.pow(1 + e / ec2, n));
    };
    tangent = (e) => {
      if (e >= 0) return e <= ecr ? Ec : 0;
      if (e <= -ec2) return 0;
      return fc * n / ec2 * Math.pow(1 + e / ec2, n - 1);
    };
  }
  return { type: 'concrete', sigma, tangent, epsMin: -ecu, epsMax: Infinity, ec2, ecu, fc, Ec, name: c.name };
}

// ------------------------------------------------------------------ Betonstahl

export const REBAR_GRADES = ['B500A', 'B500B', 'B500C', 'B450C'];

/** Betonstahl-Kennwerte (SIA 262 Tab. 9 / EN 1992 Anh. C). */
export function rebar(grade = 'B500B', opts = {}) {
  const norm = opts.norm || 'SIA';
  const fsk = grade === 'B450C' ? 450 : 500;
  const gammaS = opts.gammaS ?? 1.15;
  const ks = { B500A: 1.05, B500B: 1.08, B500C: 1.15, B450C: 1.15 }[grade] ?? 1.08;
  const euk = { B500A: 0.025, B500B: 0.05, B500C: 0.075, B450C: 0.075 }[grade] ?? 0.05;
  const Es = norm === 'SIA' ? 205000 : 200000;
  const eud = norm === 'SIA' ? ({ B500A: 0.02, B500B: 0.045, B500C: 0.065, B450C: 0.065 }[grade] ?? 0.045) : 0.9 * euk;
  return { name: grade, norm, fsk, fsd: fsk / gammaS, Es, ks, euk, eud, gammaS };
}

/**
 * Spannungs-Dehnungs-Gesetz Betonstahl (symmetrisch, bilinear).
 * opts.kind: 'design' (fsd, horizontal oder mit Verfestigung), 'mean' (fsk, Verfestigung bis ks·fsk)
 * opts.hardening: true → Verfestigung bis ks·fsd bei εud
 */
export function rebarLaw(s, opts = {}) {
  const kind = opts.kind || 'design';
  const fy = kind === 'design' ? s.fsd : s.fsk;
  const ey = fy / s.Es;
  const eu = kind === 'design' ? s.eud : s.euk;
  const fu = opts.hardening ? s.ks * fy : fy;
  const Eh = eu > ey ? (fu - fy) / (eu - ey) : 0;
  const euTol = eu * (1 + 1e-9); // Rundungstoleranz: Stäbe genau auf εud dürfen nicht ausfallen
  const sigma = (e) => {
    const a = Math.abs(e);
    if (a > euTol) return 0;
    const v = a <= ey ? s.Es * a : fy + Eh * (a - ey);
    return e < 0 ? -v : v;
  };
  const tangent = (e) => { const a = Math.abs(e); return a <= ey ? s.Es : a <= euTol ? Eh : 0; };
  return { type: 'rebar', sigma, tangent, epsMin: -eu, epsMax: eu, fy, ey, eu, Es: s.Es, name: s.name };
}

/** Querschnittsfläche eines Stabes [mm²]. */
export const barArea = (d) => Math.PI * d * d / 4;

export const BAR_DIAMETERS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 26, 30, 34, 40];

/** Bewehrungsfläche pro Meter für Ø und Abstand s [mm] → [mm²/m]. */
export const barAreaPerM = (d, s) => barArea(d) * 1000 / s;

/** Wählt eine praktikable Bewehrung (Ø/s) für eine erforderliche Fläche as [mm²/m]. */
export function chooseBars(asReq, opts = {}) {
  const diams = opts.diameters || [8, 10, 12, 14, 16, 18, 20, 22, 26, 30];
  const spacings = opts.spacings || [100, 125, 150, 200, 250, 300];
  let best = null;
  for (const d of diams) for (const s of spacings) {
    const a = barAreaPerM(d, s);
    if (a >= asReq && (!best || a < best.as)) best = { d, s, as: a, label: `Ø${d} s=${s}` };
  }
  return best || { d: diams[diams.length - 1], s: spacings[0], as: barAreaPerM(diams[diams.length - 1], spacings[0]), label: `Ø${diams[diams.length - 1]} s=${spacings[0]} (ungenügend)` };
}

// ------------------------------------------------------------------ Baustahl

export const STEEL_GRADES = ['S235', 'S275', 'S355', 'S460'];

/** Baustahl (SIA 263 Tab. 1 / EN 1993-1-1 Tab. 3.1), t ≤ 40 mm. */
export function structuralSteel(grade = 'S355', opts = {}) {
  const norm = opts.norm || 'SIA';
  const t = opts.t || 0;
  const tab = {
    S235: [235, 360, 215, 360], S275: [275, 430, 255, 410], S355: [355, 490, 335, 470], S460: [460, 540, 430, 540],
  }[grade] || [355, 490, 335, 470];
  const fy = t > 40 ? tab[2] : tab[0];
  const fu = t > 40 ? tab[3] : tab[1];
  const gM0 = opts.gammaM0 ?? (norm === 'SIA' ? 1.05 : 1.0);
  const gM1 = opts.gammaM1 ?? (norm === 'SIA' ? 1.05 : 1.0);
  const gM2 = opts.gammaM2 ?? 1.25;
  return {
    name: grade, norm, fy, fu, E: 210000, G: 81000, nu: 0.3, gamma: 78.5, alphaT: 1.2e-5,
    gammaM0: gM0, gammaM1: gM1, gammaM2: gM2,
    eps: Math.sqrt(235 / fy),
  };
}

// ------------------------------------------------------------------ Holz (für Stabstatik)

export const TIMBER_CLASSES = {
  C24: { fmk: 24, E0: 11000, G: 690, gamma: 4.2 },
  GL24h: { fmk: 24, E0: 11500, G: 650, gamma: 4.2 },
  GL28h: { fmk: 28, E0: 12600, G: 650, gamma: 4.6 },
};

// ------------------------------------------------------------------ Lastbeiwerte

/** Teilsicherheits- und Kombinationsbeiwerte nach SIA 260 / EN 1990. */
export function loadFactors(norm = 'SIA') {
  return norm === 'SIA'
    ? { gG: 1.35, gGinf: 0.8, gQ: 1.5, psi: { Nutzlast: [0.7, 0.5, 0.3], Schnee: [0.6, 0.5, 0.2], Wind: [0.6, 0.5, 0.0], Temperatur: [0.6, 0.5, 0.0] } }
    : { gG: 1.35, gGinf: 1.0, gQ: 1.5, psi: { Nutzlast: [0.7, 0.5, 0.3], Schnee: [0.5, 0.2, 0.0], Wind: [0.6, 0.2, 0.0], Temperatur: [0.6, 0.5, 0.0] } };
}

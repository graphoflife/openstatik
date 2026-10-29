// Baugrund: Schichtprofil, Spannungen, Normen und Partialfaktoren (DOM-frei)
//
// Schichtprofil: Tiefen z [m] ab einer Bezugsebene (Geländeoberkante der jeweiligen Analyse),
// positiv nach unten. Das Profil entsteht an einer Stelle x aus dem Bodenmodell mit frei geformten
// Zonen (ground.js); Schicht i reicht von z_i bis z_{i+1}, die erste beginnt oben (z = −∞).
import { makeGround } from './ground.js';

export const DEG = Math.PI / 180;
export const rad = (d) => d * DEG;
export const deg = (r) => r / DEG;

/** Voreinstellungen der Nachweiskonzepte (alle Werte im Projekt editierbar). */
export const NORMS = {
  SIA: {
    code: 'SIA',
    label: 'SIA 267 / SIA 260',
    // Bodenkennwerte (SIA 267, Tab. 1)
    gPhi: 1.2, gC: 1.5, gCu: 1.5, gGamma: 1.0,
    // Grundbruch und Gleiten: 'R' = charakteristische Bodenkennwerte und Widerstandsbeiwerte γ_R,
    //                         'M' = Bemessungswerte der Bodenkennwerte (γ_M)
    geoMode: 'R',
    // Einwirkungen (SIA 260, Tab. 1, Typ 2)
    gG: 1.35, gGinf: 0.8, gQ: 1.5,
    // Böschung (Typ 3): ständige Lasten 1.0, veränderliche
    gQslope: 1.3,
    // Widerstandsbeiwerte
    gRv: 1.4, gRh: 1.1, gRe: 1.4, gRs: 1.0,
  },
  EC: {
    code: 'EC',
    label: 'EN 1997-1, Nachweisverfahren 2',
    // Bodenkennwerte M2 (nur Böschung bzw. Modus 'M')
    gPhi: 1.25, gC: 1.25, gCu: 1.4, gGamma: 1.0,
    geoMode: 'R',
    gG: 1.35, gGinf: 1.0, gQ: 1.5,
    gQslope: 1.3,
    // R2: Grundbruch 1.4, Gleiten 1.1, Erdwiderstand 1.4; Böschung über M2 (wie DA3)
    gRv: 1.4, gRh: 1.1, gRe: 1.4, gRs: 1.0,
  },
};

export function normPreset(code) {
  return { ...(NORMS[code] || NORMS.SIA) };
}

/** Prüft und sortiert die Schichten, ergänzt abgeleitete Grössen. */
export function prepareLayers(layers, gammaW = 10) {
  if (!Array.isArray(layers) || !layers.length) throw new Error('Mindestens eine Bodenschicht erforderlich.');
  const out = layers.map((l, i) => {
    const L = {
      idx: i,
      name: l.name || `Schicht ${i + 1}`,
      z: Number(l.z) || 0,
      gamma: num(l.gamma, 19),
      gammaP: num(l.gammaP, 10),
      phi: num(l.phi, 0),
      c: num(l.c, 0),
      cu: num(l.cu, 0),
      ME: num(l.ME, 10),
      dr: num(l.dr, 2 / 3),
      col: Number(l.col) || ((i % 8) + 1),
    };
    if (L.gamma <= 0) throw new Error(`${L.name}: Raumgewicht γ muss positiv sein.`);
    if (L.gammaP < 0) throw new Error(`${L.name}: γ' darf nicht negativ sein.`);
    if (L.phi < 0 || L.phi >= 60) throw new Error(`${L.name}: Reibungswinkel φ' ausserhalb 0…60°.`);
    if (L.c < 0 || L.cu < 0) throw new Error(`${L.name}: Kohäsion darf nicht negativ sein.`);
    if (L.ME <= 0) throw new Error(`${L.name}: Steifemodul M_E muss positiv sein.`);
    L.gammaSat = L.gammaP + gammaW;
    return L;
  });
  out.sort((a, b) => a.z - b.z);
  out[0].z = Math.min(0, out[0].z);
  for (let i = 0; i < out.length; i++) out[i].zBot = i + 1 < out.length ? out[i + 1].z : Infinity;
  return out;
}

function num(v, d) { return Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d; }

/** Schicht in der Tiefe z (an Grenzen gilt die untere Schicht). */
export function layerAt(layers, z) {
  let L = layers[0];
  for (const l of layers) if (z >= l.z - 1e-9) L = l;
  return L;
}

/**
 * Bodenprofil an der Stelle x (Standard 0): {layers, zw, gammaW, ground}.
 * soilInput: {soils, zones, base, gw: {on, z}, gammaW} oder altes Format {layers, …}.
 * zw = Tiefe des Grundwasserspiegels (Infinity ohne GW). ground: 2D-Modell für Punktabfragen.
 */
export function makeSoil(soilInput, opts = {}) {
  const gammaW = num(soilInput?.gammaW, 10);
  const ground = makeGround(soilInput, gammaW);
  const layers = ground.layersAt(Number(opts.x) || 0);
  const gwOn = opts.ignoreWater ? false : !!soilInput?.gw?.on;
  const zw = gwOn ? num(soilInput.gw.z, Infinity) : Infinity;
  return { layers, zw, gammaW, ground };
}

/**
 * Vertikalspannungen in der Tiefe z bei Geländeoberfläche in der Tiefe zTop (≤ z).
 * Rückgabe: {sv (total), u (Porenwasserdruck), svp (effektiv)} in kN/m².
 * q: Auflast an der Oberfläche [kN/m²]. Oberhalb des GW wirkt γ, darunter γ_sat = γ' + γ_w.
 */
export function verticalStress(soil, z, zTop = 0, q = 0) {
  let sv = q;
  if (z > zTop) {
    const { layers, zw } = soil;
    // Grenzen: Schichtgrenzen und Wasserspiegel
    const cuts = [zTop, z];
    for (const l of layers) if (l.z > zTop && l.z < z) cuts.push(l.z);
    if (zw > zTop && zw < z) cuts.push(zw);
    cuts.sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b - a <= 0) continue;
      const m = (a + b) / 2;
      const L = layerAt(layers, m);
      sv += (m > zw ? L.gammaSat : L.gamma) * (b - a);
    }
  }
  const u = z > soil.zw ? soil.gammaW * (z - soil.zw) : 0;
  return { sv, u, svp: sv - u };
}

/** Effektives Raumgewicht in der Tiefe z (γ über, γ' unter dem Grundwasserspiegel). */
export function gammaEff(soil, z) {
  const L = layerAt(soil.layers, z);
  return z > soil.zw ? L.gammaP : L.gamma;
}

/** Bemessungswerte der Scherparameter einer Schicht (γ_M). apply=false → charakteristisch. */
export function designParams(L, norm, apply = true) {
  if (!apply) return { phi: L.phi, c: L.c, cu: L.cu, gammaF: 1 };
  const phi = deg(Math.atan(Math.tan(rad(L.phi)) / norm.gPhi));
  return { phi, c: L.c / norm.gC, cu: L.cu / norm.gCu, gammaF: 1 / (norm.gGamma || 1) };
}

/**
 * Gemittelte Kennwerte zwischen z0 und z1 (dickengewichtet; φ über tan φ gemittelt).
 * Rückgabe {phi, c, cu, gammaEff, gamma, layers:[{name, from, to}], phiSpread}
 */
export function averageParams(soil, z0, z1, norm = null, applyM = false) {
  const { layers, zw } = soil;
  const cuts = [z0, z1];
  for (const l of layers) if (l.z > z0 && l.z < z1) cuts.push(l.z);
  if (zw > z0 && zw < z1) cuts.push(zw);
  cuts.sort((a, b) => a - b);
  let sT = 0, sTan = 0, sC = 0, sCu = 0, sG = 0, sGt = 0;
  let phiMin = Infinity, phiMax = -Infinity;
  const used = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1], t = b - a;
    if (t <= 1e-9) continue;
    const m = (a + b) / 2;
    const L = layerAt(layers, m);
    const p = norm ? designParams(L, norm, applyM) : { phi: L.phi, c: L.c, cu: L.cu, gammaF: 1 };
    sT += t; sTan += t * Math.tan(rad(p.phi)); sC += t * p.c; sCu += t * p.cu;
    sG += t * (m > zw ? L.gammaP : L.gamma) * p.gammaF;
    sGt += t * (m > zw ? L.gammaSat : L.gamma) * p.gammaF;
    phiMin = Math.min(phiMin, L.phi); phiMax = Math.max(phiMax, L.phi);
    const last = used[used.length - 1];
    if (last && last.idx === L.idx) last.to = b; else used.push({ idx: L.idx, name: L.name, from: a, to: b });
  }
  if (sT <= 0) {
    const L = layerAt(layers, z0);
    const p = norm ? designParams(L, norm, applyM) : { phi: L.phi, c: L.c, cu: L.cu, gammaF: 1 };
    return { phi: p.phi, c: p.c, cu: p.cu, gammaEff: (z0 > zw ? L.gammaP : L.gamma), gamma: L.gamma, layers: [{ idx: L.idx, name: L.name, from: z0, to: z1 }], phiSpread: 0 };
  }
  return {
    phi: deg(Math.atan(sTan / sT)), c: sC / sT, cu: sCu / sT, gammaEff: sG / sT, gamma: sGt / sT,
    layers: used, phiSpread: phiMax - phiMin,
  };
}

/** Darstellung der Bodenarten (Deckkraft, Schraffur, Farbton), Stil 1…8. */
export const LAYER_STYLES = [
  { op: 0.30, hatch: 45, gap: 1.0, tint: null },
  { op: 0.34, hatch: -45, gap: 1.0, tint: '--c-series-5' },
  { op: 0.30, hatch: 0, gap: 0.8, tint: '--c-series-3' },
  { op: 0.32, hatch: null, gap: 1, tint: '--c-series-1' },
  { op: 0.28, hatch: 90, gap: 1.2, tint: '--c-series-4' },
  { op: 0.30, hatch: 'x', gap: 1.4, tint: '--c-series-6' },
  { op: 0.30, hatch: 30, gap: 0.9, tint: '--c-series-2' },
  { op: 0.26, hatch: -60, gap: 1.1, tint: '--text-3' },
];
export const layerStyle = (col) => LAYER_STYLES[((Math.round(col) || 1) - 1 + 80) % 8];
/** Farbe einer Bodenart (CSS, aus den Themenfarben gemischt – hell und dunkel). */
export function soilColor(col) {
  const st = layerStyle(col);
  return st.tint ? `color-mix(in srgb, var(--c-soil) 58%, var(${st.tint}))` : 'var(--c-soil)';
}

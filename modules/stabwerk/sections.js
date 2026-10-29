// Materialien und Querschnitte für die Stabstatik (DOM-frei)
//
// Material und Querschnitt sind getrennte Listen im Projekt: jeder Stab wählt beides separat.
//   Material:     {name, type, grade, E [MPa], G [MPa], nu, gamma [kN/m³], alphaT [1/K], fk [MPa]}
//   Querschnitt:  {name, type: 'rect'|'circle'|'tube'|'profile'|'values', b, h, d, t [mm], profile, A [cm²], I [cm⁴]}
import { concrete } from '../../js/core/materials.js';

// ------------------------------------------------------------------ Materialbibliothek

const TIMBER = {
  C24: { E: 11000, G: 690, gamma: 4.2, fk: 24 },
  C30: { E: 12000, G: 750, gamma: 4.6, fk: 30 },
  GL24h: { E: 11500, G: 650, gamma: 4.2, fk: 24 },
  GL28h: { E: 12600, G: 650, gamma: 4.6, fk: 28 },
  GL32h: { E: 14200, G: 650, gamma: 4.9, fk: 32 },
};
const STEEL = { S235: 235, S275: 275, S355: 355, S460: 460 };

/** Materialarten mit ihren Normklassen. */
export const MATERIAL_TYPES = [
  { value: 'Beton', label: 'Beton (SIA 262)', grades: ['C12/15', 'C16/20', 'C20/25', 'C25/30', 'C30/37', 'C35/45', 'C40/50', 'C45/55', 'C50/60'], def: 'C25/30' },
  { value: 'Baustahl', label: 'Baustahl (SIA 263)', grades: Object.keys(STEEL), def: 'S235' },
  { value: 'Betonstahl', label: 'Betonstahl (SIA 262)', grades: ['B500A', 'B500B', 'B500C'], def: 'B500B' },
  { value: 'Holz', label: 'Holz (SIA 265)', grades: Object.keys(TIMBER), def: 'GL24h' },
  { value: 'Benutzer', label: 'Benutzerdefiniert', grades: [], def: null },
];

/** Kennwerte einer Normklasse. */
export function gradeValues(type, grade) {
  if (type === 'Beton') {
    const c = concrete(grade, { norm: 'SIA' });
    const E = Math.round(c.Ecm), nu = 0.2;
    return { E, nu, G: Math.round(E / (2 * (1 + nu))), gamma: 25, alphaT: 1e-5, fk: c.fck };
  }
  if (type === 'Baustahl') return { E: 210000, nu: 0.3, G: 81000, gamma: 78.5, alphaT: 1.2e-5, fk: STEEL[grade] ?? 235 };
  if (type === 'Betonstahl') return { E: 205000, nu: 0.3, G: 78800, gamma: 78.5, alphaT: 1e-5, fk: 500 };
  if (type === 'Holz') { const t = TIMBER[grade] || TIMBER.GL24h; return { E: t.E, nu: 0.3, G: t.G, gamma: t.gamma, alphaT: 5e-6, fk: t.fk }; }
  return { E: 30000, nu: 0.2, G: 12500, gamma: 25, alphaT: 1e-5, fk: 0 };
}

/** Neues Material nach Norm (oder benutzerdefiniert). */
export function newMaterial(type = 'Beton', grade) {
  const t = MATERIAL_TYPES.find((x) => x.value === type) || MATERIAL_TYPES[0];
  const g = grade || t.def;
  return { name: g || 'Material', type: t.value, grade: g, ...gradeValues(t.value, g) };
}

export function materialSummary(m) {
  if (!m) return '–';
  return `E = ${(m.E / 1000).toFixed(m.E < 20000 ? 1 : 0)} GPa · γ = ${m.gamma} kN/m³${m.fk ? ` · f_k = ${m.fk} MPa` : ''}`;
}

export const MATERIAL_COLORS = { Beton: 'var(--c-concrete-line)', Baustahl: 'var(--c-steel)', Betonstahl: 'var(--c-rebar)', Holz: 'var(--c-soil)', Benutzer: 'var(--c-series-4)' };

// Altformat: Werkstoff-IDs der früheren Version (Querschnitt mit Material)
const LEGACY = {
  'C20/25': ['Beton', 'C20/25'], 'C25/30': ['Beton', 'C25/30'], 'C30/37': ['Beton', 'C30/37'], 'C35/45': ['Beton', 'C35/45'], 'C40/50': ['Beton', 'C40/50'], 'C50/60': ['Beton', 'C50/60'],
  S235: ['Baustahl', 'S235'], S275: ['Baustahl', 'S275'], S355: ['Baustahl', 'S355'], C24: ['Holz', 'C24'], GL24h: ['Holz', 'GL24h'], GL28h: ['Holz', 'GL28h'],
};
export function materialFromLegacy(id, sec = {}) {
  if (id === 'custom') return { name: 'Benutzerdefiniert', type: 'Benutzer', grade: null, ...gradeValues('Benutzer'), E: +sec.E || 30000, gamma: sec.gamma ?? 25 };
  const [type, grade] = LEGACY[id] || ['Beton', 'C30/37'];
  return newMaterial(type, grade);
}

// ------------------------------------------------------------------ Querschnitte

/** Walzprofile (starke Achse): h [mm], A [cm²], Iy [cm⁴], Wy [cm³] (Tabellenwerte) */
export const PROFILES = {
  'IPE 100': [100, 10.3, 171, 34.2], 'IPE 120': [120, 13.2, 318, 53.0], 'IPE 140': [140, 16.4, 541, 77.3],
  'IPE 160': [160, 20.1, 869, 109], 'IPE 180': [180, 23.9, 1317, 146], 'IPE 200': [200, 28.5, 1943, 194],
  'IPE 220': [220, 33.4, 2772, 252], 'IPE 240': [240, 39.1, 3892, 324], 'IPE 270': [270, 45.9, 5790, 429],
  'IPE 300': [300, 53.8, 8356, 557], 'IPE 330': [330, 62.6, 11770, 713], 'IPE 360': [360, 72.7, 16270, 904],
  'IPE 400': [400, 84.5, 23130, 1156], 'IPE 450': [450, 98.8, 33740, 1500], 'IPE 500': [500, 116, 48200, 1928],
  'IPE 550': [550, 134, 67120, 2441], 'IPE 600': [600, 156, 92080, 3069],
  'HEA 100': [96, 21.2, 349, 72.8], 'HEA 120': [114, 25.3, 606, 106], 'HEA 140': [133, 31.4, 1033, 155],
  'HEA 160': [152, 38.8, 1673, 220], 'HEA 180': [171, 45.3, 2510, 294], 'HEA 200': [190, 53.8, 3692, 389],
  'HEA 220': [210, 64.3, 5410, 515], 'HEA 240': [230, 76.8, 7763, 675], 'HEA 260': [250, 86.8, 10450, 836],
  'HEA 280': [270, 97.3, 13670, 1013], 'HEA 300': [290, 112.5, 18260, 1260], 'HEA 320': [310, 124.4, 22930, 1479],
  'HEA 340': [330, 133.5, 27690, 1678], 'HEA 360': [350, 142.8, 33090, 1891], 'HEA 400': [390, 159.0, 45070, 2311],
  'HEA 450': [440, 178.0, 63720, 2896], 'HEA 500': [490, 197.5, 86970, 3550],
  'HEB 100': [100, 26.0, 450, 89.9], 'HEB 120': [120, 34.0, 864, 144], 'HEB 140': [140, 43.0, 1509, 216],
  'HEB 160': [160, 54.3, 2492, 311], 'HEB 180': [180, 65.3, 3831, 426], 'HEB 200': [200, 78.1, 5696, 570],
  'HEB 220': [220, 91.0, 8091, 736], 'HEB 240': [240, 106.0, 11260, 938], 'HEB 260': [260, 118.4, 14920, 1148],
  'HEB 280': [280, 131.4, 19270, 1376], 'HEB 300': [300, 149.1, 25170, 1678], 'HEB 320': [320, 161.3, 30820, 1926],
  'HEB 340': [340, 170.9, 36660, 2156], 'HEB 360': [360, 180.6, 43190, 2400], 'HEB 400': [400, 197.8, 57680, 2884],
  'HEB 450': [450, 218.0, 79890, 3551], 'HEB 500': [500, 238.6, 107200, 4287],
};

export const SECTION_TYPES = [
  { value: 'rect', label: 'Rechteck b × h' },
  { value: 'circle', label: 'Kreis Ø' },
  { value: 'tube', label: 'Rohr Ø × t' },
  { value: 'profile', label: 'Walzprofil' },
  { value: 'values', label: 'Querschnittswerte A, I' },
];

export function newSection(type = 'rect') {
  const base = { type, b: 300, h: 500, d: 400, t: 10, profile: 'HEB 200', A: 100, I: 10000 };
  const names = { rect: 'Rechteck 30/50', circle: 'Kreis Ø400', tube: 'Rohr Ø400×10', profile: 'HEB 200', values: 'Querschnitt' };
  return { name: names[type] || 'Querschnitt', ...base };
}

/** Geometrische Querschnittswerte: A [m²], I [m⁴], h [m], W [m³]. */
export function sectionGeom(sec) {
  let A, I, h, W;
  if (sec.type === 'rect') {
    const b = sec.b / 1000, hh = sec.h / 1000;
    A = b * hh; I = b * hh ** 3 / 12; h = hh; W = b * hh * hh / 6;
  } else if (sec.type === 'circle') {
    const d = sec.d / 1000;
    A = Math.PI * d * d / 4; I = Math.PI * d ** 4 / 64; h = d; W = Math.PI * d ** 3 / 32;
  } else if (sec.type === 'tube') {
    const d = sec.d / 1000, t = Math.min(sec.t / 1000, d / 2), di = d - 2 * t;
    A = Math.PI * (d * d - di * di) / 4; I = Math.PI * (d ** 4 - di ** 4) / 64; h = d; W = 2 * I / d;
  } else if (sec.type === 'profile') {
    const p = PROFILES[sec.profile] || PROFILES['HEB 200'];
    h = p[0] / 1000; A = p[1] * 1e-4; I = p[2] * 1e-8; W = p[3] * 1e-6;
  } else {
    A = (sec.A || 0) * 1e-4; I = (sec.I || 0) * 1e-8; h = (sec.h || 0) / 1000 || Math.sqrt(12 * I / Math.max(A, 1e-12)); W = h > 0 ? 2 * I / h : 0;
  }
  return { A, I, h, W };
}

/**
 * Rechenwerte eines Stabes aus Querschnitt und Material: E [kN/m²], A [m²], I [m⁴], gamma [kN/m³], h [m], W [m³], alphaT.
 */
export function sectionProps(sec, mat) {
  const g = sectionGeom(sec || newSection());
  const m = mat || newMaterial();
  return { ...g, E: (+m.E || 0) * 1000, gamma: +m.gamma || 0, alphaT: +m.alphaT || 0, mat: m, fk: m.fk };
}

/** Kurzbezeichnung für Tabellen. */
export function sectionLabel(sec) {
  if (!sec) return '–';
  if (sec.type === 'rect') return `${sec.b}×${sec.h}`;
  if (sec.type === 'circle') return `Ø${sec.d}`;
  if (sec.type === 'tube') return `Ø${sec.d}×${sec.t}`;
  if (sec.type === 'profile') return sec.profile;
  return `A = ${sec.A} cm², I = ${sec.I} cm⁴`;
}

export function sectionSummary(sec) {
  const g = sectionGeom(sec);
  return `${SECTION_TYPES.find((t) => t.value === sec.type)?.label.split(' ')[0] || ''} ${sectionLabel(sec)} · A = ${(g.A * 1e4).toFixed(0)} cm² · I = ${(g.I * 1e8).toFixed(0)} cm⁴`;
}

/** Projekt der früheren Version (Material im Querschnitt) auf getrennte Listen umstellen. */
export function migrateMaterials(p) {
  if (Array.isArray(p.materials) && p.materials.length) {
    for (const m of p.members || []) if (!(m.mat >= 1 && m.mat <= p.materials.length)) m.mat = 1;
    return p;
  }
  const mats = [];
  const keyOf = (s) => (s.mat === 'custom' ? `custom:${s.E}:${s.gamma}` : s.mat || 'C30/37');
  const index = new Map();
  for (const s of p.sections || []) {
    const k = keyOf(s);
    if (!index.has(k)) { mats.push(materialFromLegacy(s.mat || 'C30/37', s)); index.set(k, mats.length); }
  }
  if (!mats.length) mats.push(newMaterial('Beton', 'C25/30'));
  for (const m of p.members || []) {
    const s = p.sections?.[m.sec - 1];
    m.mat = s ? index.get(keyOf(s)) : 1;
  }
  for (const s of p.sections || []) { delete s.mat; delete s.E; delete s.gamma; }
  p.materials = mats;
  return p;
}

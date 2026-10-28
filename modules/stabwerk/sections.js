// Werkstoffe und Querschnitte für die Stabstatik (DOM-frei)
import { concrete } from '../../js/core/materials.js';

/** Werkstoffliste: E [MPa], γ [kN/m³], α_T [1/K], fy [MPa] (Stahl) */
export const MATERIALS = [
  ...['C20/25', 'C25/30', 'C30/37', 'C35/45', 'C40/50', 'C50/60'].map((n) => {
    const c = concrete(n, { norm: 'SIA' });
    return { id: n, label: `Beton ${n}`, kind: 'Beton', E: Math.round(c.Ecm), gamma: 25, alphaT: 1e-5, fk: c.fck };
  }),
  { id: 'S235', label: 'Stahl S235', kind: 'Stahl', E: 210000, gamma: 78.5, alphaT: 1.2e-5, fk: 235 },
  { id: 'S275', label: 'Stahl S275', kind: 'Stahl', E: 210000, gamma: 78.5, alphaT: 1.2e-5, fk: 275 },
  { id: 'S355', label: 'Stahl S355', kind: 'Stahl', E: 210000, gamma: 78.5, alphaT: 1.2e-5, fk: 355 },
  { id: 'C24', label: 'Holz C24', kind: 'Holz', E: 11000, gamma: 4.2, alphaT: 5e-6, fk: 24 },
  { id: 'GL24h', label: 'Brettschichtholz GL24h', kind: 'Holz', E: 11500, gamma: 4.2, alphaT: 5e-6, fk: 24 },
  { id: 'GL28h', label: 'Brettschichtholz GL28h', kind: 'Holz', E: 12600, gamma: 4.6, alphaT: 5e-6, fk: 28 },
  { id: 'custom', label: 'Benutzerdefiniert', kind: 'Benutzer', E: 30000, gamma: 25, alphaT: 1e-5, fk: 0 },
];

export const materialById = (id) => MATERIALS.find((m) => m.id === id) || MATERIALS.find((m) => m.id === 'C30/37');

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
  { value: 'profile', label: 'Walzprofil' },
  { value: 'values', label: 'Querschnittswerte' },
];

/**
 * Querschnittswerte in Rechenheiten: E [kN/m²], A [m²], I [m⁴], gamma [kN/m³], h [m], W [m³], alphaT.
 * Querschnitt: {name, type, mat, b, h, d [mm], profile, A [cm²], I [cm⁴], E [MPa], gamma}
 */
export function sectionProps(sec) {
  const m = materialById(sec.mat);
  const E = (sec.mat === 'custom' ? sec.E : m.E) * 1000;
  const gamma = sec.mat === 'custom' ? sec.gamma ?? m.gamma : m.gamma;
  let A, I, h, W;
  if (sec.type === 'rect') {
    const b = sec.b / 1000, hh = sec.h / 1000;
    A = b * hh; I = b * hh ** 3 / 12; h = hh; W = b * hh * hh / 6;
  } else if (sec.type === 'circle') {
    const d = sec.d / 1000;
    A = Math.PI * d * d / 4; I = Math.PI * d ** 4 / 64; h = d; W = Math.PI * d ** 3 / 32;
  } else if (sec.type === 'profile') {
    const p = PROFILES[sec.profile] || PROFILES['HEB 200'];
    h = p[0] / 1000; A = p[1] * 1e-4; I = p[2] * 1e-8; W = p[3] * 1e-6;
  } else {
    A = (sec.A || 0) * 1e-4; I = (sec.I || 0) * 1e-8; h = (sec.h || 0) / 1000 || Math.sqrt(12 * I / Math.max(A, 1e-12)); W = h > 0 ? 2 * I / h : 0;
  }
  return { E, A, I, gamma, h, W, alphaT: m.alphaT, mat: m, fk: m.fk };
}

/** Kurzbezeichnung für Tabellen. */
export function sectionLabel(sec) {
  if (sec.type === 'rect') return `${sec.b}×${sec.h}`;
  if (sec.type === 'circle') return `Ø${sec.d}`;
  if (sec.type === 'profile') return sec.profile;
  return `A=${sec.A} I=${sec.I}`;
}

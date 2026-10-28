// Mauerwerkskennwerte (DOM-frei, in Node testbar)
//
// Alle Standardwerte sind Richtwerte für die Vorbemessung. Die massgebenden charakteristischen
// Werte (fxk, fyk, Exk …) sind den Produktangaben bzw. SIA 266 (Tabellenwerte) zu entnehmen und
// vom Anwender zu prüfen. Einheiten: Festigkeiten und E-Modul in MPa, Raumlast in kN/m³.

/**
 * Mauerwerksarten mit Standardwerten.
 *  fxk   Druckfestigkeit senkrecht zu den Lagerfugen
 *  fyk   Druckfestigkeit parallel zu den Lagerfugen
 *  KE    Verhältnis Exk / fxk (EN 1996-1-1 3.7.2: Empfehlung 1000)
 *  gamma Raumlast des Mauerwerks inkl. Mörtel [kN/m³]
 *  mu    Reibungsbeiwert in der Lagerfuge (tan φ)
 *  fvk0  Haftscherfestigkeit (nur für EN-1996-Ansatz) [MPa]
 *  fb    normierte Steindruckfestigkeit (Grenzwert fvk ≤ 0.065·fb, EN 1996-1-1 3.6.2) [MPa]
 *  phi   Endkriechzahl φ∞ (EN 1996-1-1 Tab. 3.8, Mittelwerte)
 *  solid Vollsteine (Steingruppe 1) → Erhöhung der Teilflächenpressung zulässig
 *  course, unit  Schichthöhe und Steinlänge für die Darstellung [m]
 */
export const MASONRY_TYPES = [
  { id: 'MB', label: 'Backstein (MB)', fxk: 5.0, fyk: 1.5, KE: 1000, gamma: 12, mu: 0.6, fvk0: 0.20, fb: 20, phi: 1.0, solid: false, course: 0.2, unit: 0.3 },
  { id: 'MK', label: 'Kalksandstein (MK)', fxk: 6.0, fyk: 2.0, KE: 1000, gamma: 18, mu: 0.6, fvk0: 0.15, fb: 20, phi: 1.5, solid: true, course: 0.2, unit: 0.25 },
  { id: 'MC', label: 'Zementstein (MC)', fxk: 5.0, fyk: 1.5, KE: 1000, gamma: 16, mu: 0.6, fvk0: 0.15, fb: 15, phi: 1.5, solid: false, course: 0.2, unit: 0.4 },
  { id: 'MCL', label: 'Leichtzementstein (MCL)', fxk: 3.0, fyk: 0.9, KE: 1000, gamma: 11, mu: 0.6, fvk0: 0.15, fb: 6, phi: 1.5, solid: false, course: 0.2, unit: 0.4 },
  { id: 'MP', label: 'Porenbeton (MP)', fxk: 2.5, fyk: 0.8, KE: 1000, gamma: 6, mu: 0.6, fvk0: 0.15, fb: 4, phi: 1.0, solid: true, course: 0.25, unit: 0.6 },
  { id: 'USER', label: 'Benutzerdefiniert', fxk: 4.0, fyk: 1.2, KE: 1000, gamma: 14, mu: 0.6, fvk0: 0.15, fb: 12, phi: 1.0, solid: false, course: 0.2, unit: 0.3 },
];

export const typeById = (id) => MASONRY_TYPES.find((t) => t.id === id) || MASONRY_TYPES[MASONRY_TYPES.length - 1];

/** Neuer Materialdatensatz mit den Standardwerten einer Mauerwerksart. */
export function defaultMaterial(id = 'MB') {
  const t = typeById(id);
  return {
    type: t.id,
    fxk: t.fxk, fyk: t.fyk, Exk: t.KE * t.fxk, exkAuto: true,
    gamma: t.gamma, mu: t.mu, fvk0: t.fvk0, fb: t.fb, phi: t.phi, solid: t.solid,
    gammaM: 2.0, // SIA 266 (2015) 2.2.5: Widerstandsbeiwert γM = 2.0
    gammaE: 2.0, // E-Modul für Th. 2. Ordnung: Exd = Exk / γE (Standard: γE = γM)
  };
}

/** Übernimmt die Standardwerte einer Mauerwerksart in einen bestehenden Datensatz (γM, γE bleiben). */
export function applyTypeDefaults(m, id) {
  const d = defaultMaterial(id);
  for (const k of ['type', 'fxk', 'fyk', 'Exk', 'exkAuto', 'gamma', 'mu', 'fvk0', 'fb', 'phi', 'solid']) m[k] = d[k];
  return m;
}

/** Abweichungen von den Standardwerten (für Hinweise in Oberfläche und Bericht). */
export function changedFromDefaults(m) {
  const t = typeById(m.type);
  if (t.id === 'USER') return [];
  const out = [];
  const cmp = [['fxk', t.fxk], ['fyk', t.fyk], ['Exk', t.KE * t.fxk], ['gamma', t.gamma], ['mu', t.mu], ['fvk0', t.fvk0], ['fb', t.fb], ['phi', t.phi]];
  for (const [k, v] of cmp) if (Math.abs((m[k] ?? v) - v) > 1e-9) out.push(k);
  return out;
}

/**
 * Bemessungswerte des Mauerwerks (SIA 266 2.2.5: fxd = fxk/γM, fyd = fyk/γM).
 * Rückgabe in MPa (Festigkeiten) bzw. kN/m³.
 */
export function designValues(m) {
  const gM = m.gammaM > 0 ? m.gammaM : 2.0;
  const gE = m.gammaE > 0 ? m.gammaE : gM;
  const Exk = m.exkAuto ? typeById(m.type).KE * m.fxk : m.Exk;
  return {
    fxk: m.fxk, fyk: m.fyk, Exk, gammaM: gM, gammaE: gE,
    fxd: m.fxk / gM,
    fyd: m.fyk / gM,
    Exd: Exk / gE,
    fvk0: m.fvk0,
    fvlt: 0.065 * m.fb,
    mu: m.mu,
    gamma: m.gamma,
    phi: m.phi,
    solid: !!m.solid,
  };
}

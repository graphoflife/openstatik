// Querschnitt – Standardprojekt und Beispiele (DOM-frei)
import { defaultShapes, barsLayers, barsCircular, barsRow, projectGeometry, circlePts, ptsToRows } from './shapes.js';

/** Grundgerüst eines Projekts mit sinnvollen Standardwerten. */
export function baseProject() {
  return {
    shape: defaultShapes(),
    openings: [],
    bars: [],
    material: { norm: 'SIA', concrete: 'C30/37', steel: 'B500B', gammaC: 1.5, gammaS: 1.15, alphaCC: 1.0, hardening: false },
    calc: { ref: 'gross', creep: 0, nMode: 'auto', n: 15, mkLaws: 'both' },
    sls: { req: 'normal', sigmaAdm: 300, spacingAuto: true, spacing: 150 },
    shear: { active: false, dw: 10, s: 200, legs: 2, angle: 30, bwAuto: true, bw: 300, dAuto: true, d: 450, zAuto: true, z: 400, side: 'unten', epsMode: 'elastic', Dmax: 32 },
    loads: [],
  };
}

/** Stäbe nach Vorlage für ein Projekt erzeugen. */
function layers(p, o) {
  return barsLayers(projectGeometry(p), o);
}

/**
 * Neues, leeres Projekt: kein Betonumriss («Polygon frei» ohne Eckpunkte), keine Bewehrung, keine Lastfälle.
 * Die Vorlagen behalten ihre Standardmasse, damit die Formauswahl sofort brauchbare Querschnitte liefert.
 */
export function defaultProject() {
  const p = baseProject();
  p.shape.type = 'poly';
  p.shape.poly = [];
  return p;
}

function rectBeam() {
  const p = baseProject();
  p.shape.type = 'rect';
  p.shape.rect = { b: 300, h: 600 };
  p.bars = layers(p, { nBot: 4, dBot: 20, nTop: 2, dTop: 14, c: 30, dw: 8 });
  p.sls.req = 'erhoeht';
  p.shear = { ...p.shear, active: true, dw: 8, s: 200, legs: 2, angle: 30 };
  p.loads = [
    { name: 'Feldmoment', type: 'GZT', N: 0, My: 220, Mz: 0, V: 160 },
    { name: 'Mit Druckkraft', type: 'GZT', N: -300, My: 180, Mz: 0, V: 120 },
    { name: 'Stützmoment', type: 'GZT', N: 0, My: -60, Mz: 0, V: 170 },
    { name: 'Gebrauch (häufig)', type: 'GZG', N: 0, My: 140, Mz: 0, V: 0 },
  ];
  return p;
}

function tBeam() {
  const p = baseProject();
  p.shape.type = 'T';
  p.shape.T = { b: 1500, hf: 200, bw: 350, h: 900 };
  // untere Lage 5Ø26 (a = 30 + 10 + 13 = 53 mm), zweite Lage 3Ø26 im Abstand 60 mm, Platte oben 10Ø12
  const a = 53;
  p.bars = [
    ...layers(p, { nBot: 5, dBot: 26, nTop: 10, dTop: 12, c: 30, dw: 10 }),
    ...barsRow(-175 + a, a + 60, 175 - a, a + 60, 3, 26),
  ];
  p.sls.req = 'erhoeht';
  p.shear = { ...p.shear, active: true, dw: 10, s: 150, legs: 2, angle: 30 };
  p.loads = [
    { name: 'Feld GZT', type: 'GZT', N: 0, My: 1250, Mz: 0, V: 420 },
    { name: 'Stütze GZT', type: 'GZT', N: 0, My: -320, Mz: 0, V: 520 },
    { name: 'Feld GZG häufig', type: 'GZG', N: 0, My: 820, Mz: 0, V: 0 },
  ];
  return p;
}

function roundColumn() {
  const p = baseProject();
  p.shape.type = 'circle';
  p.shape.circle = { D: 500 };
  p.bars = barsCircular(p.shape, { n: 10, d: 20, c: 30, dw: 10 });
  p.calc.mkLaws = 'both';
  p.loads = [
    { name: 'Druck + Biegung 2-achsig', type: 'GZT', N: -2000, My: 170, Mz: 110, V: 0 },
    { name: 'Wind', type: 'GZT', N: -800, My: 190, Mz: -90, V: 0 },
    { name: 'Gebrauch quasi-ständig', type: 'GZG', N: -1400, My: 55, Mz: 35, V: 0 },
  ];
  return p;
}

function boxGirder() {
  const p = baseProject();
  p.shape.type = 'box';
  p.shape.box = { bo: 4000, bu: 2400, h: 1600, to: 250, tu: 220, tw: 350 };
  p.material.concrete = 'C35/45';
  p.bars = layers(p, { nBot: 24, dBot: 26, nTop: 36, dTop: 16, c: 35, dw: 12 });
  p.sls.req = 'erhoeht';
  p.loads = [
    { name: 'Feld GZT', type: 'GZT', N: 0, My: 7000, Mz: 0, V: 0 },
    { name: 'Stütze GZT', type: 'GZT', N: 0, My: -3500, Mz: 0, V: 0 },
    { name: 'Feld GZG', type: 'GZG', N: 0, My: 4800, Mz: 0, V: 0 },
  ];
  return p;
}

function polygonWithDuct() {
  const p = baseProject();
  p.shape.type = 'poly';
  p.shape.poly = [{ y: -200, z: 0 }, { y: 200, z: 0 }, { y: 125, z: 700 }, { y: -125, z: 700 }];
  const duct = { y: 0, z: 420, D: 150 };
  p.openings = [{ name: 'Hüllrohr Ø150', pts: ptsToRows(circlePts(duct.y, duct.z, duct.D / 2, 32, true), 1), circle: duct }];
  p.bars = layers(p, { nBot: 4, dBot: 22, nTop: 2, dTop: 12, c: 30, dw: 8 });
  p.loads = [
    { name: 'Feld GZT', type: 'GZT', N: 0, My: 380, Mz: 0, V: 0 },
    { name: 'Schief', type: 'GZT', N: -150, My: 300, Mz: 40, V: 0 },
    { name: 'Gebrauch', type: 'GZG', N: 0, My: 250, Mz: 0, V: 0 },
  ];
  return p;
}

export const EXAMPLES = [
  { name: 'Rechteckbalken 300×600', desc: '4Ø20 unten, 2Ø14 oben, C30/37 – Biegung, Querkraft, GZG', project: rectBeam },
  { name: 'Plattenbalken', desc: 'Platte 1500×200, Steg 350×700, 8Ø26 – positives und negatives Moment', project: tBeam },
  { name: 'Rundstütze Ø500', desc: '10Ø20, Normalkraft mit zweiachsiger Biegung', project: roundColumn },
  { name: 'Hohlkasten', desc: 'Brückenquerschnitt 4.0 × 1.6 m, C35/45', project: boxGirder },
  { name: 'Polygon mit Aussparung', desc: 'Trapez mit Hüllrohr Ø150 – freie Geometrie', project: polygonWithDuct },
];

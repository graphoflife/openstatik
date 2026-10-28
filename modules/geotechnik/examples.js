// Standardprojekt und Beispiele (DOM-frei)
import { normPreset } from './soil.js';

const L = (name, z, gamma, gammaP, phi, c, cu, ME, dr, col) => ({ name, z, gamma, gammaP, phi, c, cu, ME, dr, col });

/** Vollständiges Projekt mit sinnvollen Vorgaben für alle Analysearten. */
export function baseProject() {
  return {
    analysis: 'erddruck',
    soil: {
      layers: [
        L('Kies, sandig', 0, 21, 12, 35, 0, 0, 60, 2 / 3, 1),
      ],
      gw: { on: false, z: 5 },
      gammaW: 10,
    },
    norm: normPreset('SIA'),
    ep: {
      H: 4, alpha: 0, beta: 0, kind: 'active', method: 'coulomb', passiveMethod: 'curved', dpRatio: 0.5,
      mu: 0.5, ocr: 1, q: 10, loads: [], water: true, minPressure: false,
    },
    bc: {
      shape: 'rect', B: 2, L: 2.5, D: 1, t: 0.5, selfWeight: true, gammaC: 25, alphaBase: 0,
      loads: { G: { V: 800, HB: 40, HL: 0, MB: 60, ML: 0 }, Q: { V: 300, HB: 30, HL: 0, MB: 40, ML: 0 } },
      drainage: 'drained', interface: 'cast',
    },
    st: { shape: 'rect', B: 2.5, L: 2.5, D: 1, loadMode: 'p', p0: 200, V: 1250, unload: true, limitFactor: 0.2, rigid: true, sAllow: 30 },
    sl: {
      surface: [{ x: 0, y: 6 }, { x: 10, y: 6 }, { x: 22, y: 0 }, { x: 36, y: 0 }],
      waterMode: 'none', water: [{ x: 0, y: 3 }, { x: 36, y: 0 }],
      q: { p: 0, x1: 2, x2: 8 },
      drainage: 'drained', nSlices: 30, tMin: 0.5, depthBelow: 6,
      grid: { auto: true, x0: 0, x1: 24, y0: 7, y1: 20, nx: 12, ny: 12, nr: 12 },
    },
    rw: {
      hs: 3.6, tTop: 0.25, tBot: 0.35, toe: 0.6, heel: 1.65, d: 0.4, Df: 0.8, beta: 0, q: 10,
      method: 'rankine', water: false, gammaC: 25, key: { on: false, depth: 0.4, width: 0.4, x: 1.0 },
      interface: 'cast', drainage: 'drained',
    },
  };
}

export function defaultProject() {
  return baseProject();
}

export const EXAMPLES = [
  {
    name: 'Kellerwand in Kies mit Auflast',
    desc: 'Erddruck: erhöhter aktiver Erddruck, zwei Schichten, Nutzlast 10 kN/m²',
    project: () => {
      const p = baseProject();
      p.analysis = 'erddruck';
      p.soil.layers = [
        L('Auffüllung, siltig', 0, 19, 10, 30, 2, 0, 15, 2 / 3, 2),
        L('Kies, sandig', 1.2, 21, 12, 35, 0, 0, 60, 2 / 3, 1),
      ];
      p.soil.gw = { on: true, z: 3.2 };
      p.ep = { ...p.ep, H: 3.8, kind: 'increased', mu: 0.5, q: 10, water: true, loads: [{ type: 'strip', p: 20, a: 1.0, b: 2.0 }] };
      return p;
    },
  },
  {
    name: 'Streifenfundament auf siltigem Ton',
    desc: 'Grundbruch drainiert und undrainiert, Horizontallast und Moment, Grundwasser',
    project: () => {
      const p = baseProject();
      p.analysis = 'grundbruch';
      p.soil.layers = [
        L('Deckschicht', 0, 18.5, 9, 27, 0, 0, 6, 2 / 3, 5),
        L('Siltiger Ton', 0.8, 19.5, 9.5, 26, 5, 80, 8, 2 / 3, 2),
        L('Moräne', 6, 22, 12, 34, 5, 0, 80, 2 / 3, 6),
      ];
      p.soil.gw = { on: true, z: 2 };
      p.bc = {
        ...p.bc, shape: 'strip', B: 1.6, D: 1.0, t: 0.4,
        loads: { G: { V: 150, HB: 12, HL: 0, MB: 8, ML: 0 }, Q: { V: 60, HB: 8, HL: 0, MB: 4, ML: 0 } },
        drainage: 'both',
      };
      return p;
    },
  },
  {
    name: 'Einzelfundament – Setzung auf geschichtetem Boden',
    desc: 'Quadratfundament 2.5 × 2.5 m, Kies über Silt über Moräne (Steinbrenner)',
    project: () => {
      const p = baseProject();
      p.analysis = 'setzung';
      p.soil.layers = [
        L('Kies, sandig', 0, 21, 12, 35, 0, 0, 60, 2 / 3, 1),
        L('Silt, tonig', 3, 19.5, 9.5, 27, 5, 40, 8, 2 / 3, 2),
        L('Moräne', 7, 22, 12, 34, 5, 0, 80, 2 / 3, 6),
      ];
      p.soil.gw = { on: true, z: 2.5 };
      p.st = { ...p.st, shape: 'rect', B: 2.5, L: 2.5, D: 1.2, loadMode: 'p', p0: 250, unload: true };
      p.bc = { ...p.bc, B: 2.5, L: 2.5, D: 1.2 };
      return p;
    },
  },
  {
    name: 'Böschung 2:1 in tonigem Silt mit Grundwasser',
    desc: 'Bishop mit Suchraster, Sickerlinie, Auflast an der Krone',
    project: () => {
      const p = baseProject();
      p.analysis = 'boeschung';
      p.soil.layers = [
        L('Toniger Silt', 0, 20, 10, 27, 5, 40, 10, 2 / 3, 2),
        L('Moräne', 10, 22, 12, 33, 10, 0, 80, 2 / 3, 6),
      ];
      p.soil.gw = { on: false, z: 3 };
      p.sl = {
        ...p.sl,
        surface: [{ x: 0, y: 6 }, { x: 12, y: 6 }, { x: 24, y: 0 }, { x: 40, y: 0 }],
        waterMode: 'line', water: [{ x: 0, y: 3.2 }, { x: 12, y: 2.8 }, { x: 20, y: 1.2 }, { x: 24, y: 0 }, { x: 40, y: 0 }],
        q: { p: 15, x1: 3, x2: 10 }, depthBelow: 6,
      };
      return p;
    },
  },
  {
    name: 'Winkelstützmauer 4 m',
    desc: 'Hinterfüllung Kies, Nutzlast 10 kN/m², Sporn, Fundation auf Moräne',
    project: () => {
      const p = baseProject();
      p.analysis = 'stuetzmauer';
      p.soil.layers = [
        L('Hinterfüllung Kies', 0, 20, 11, 32, 0, 0, 40, 2 / 3, 1),
        L('Moräne', 4, 21.5, 11.5, 33, 5, 0, 80, 2 / 3, 6),
      ];
      p.soil.gw = { on: false, z: 6 };
      p.rw = { ...p.rw, key: { on: true, depth: 0.4, width: 0.4, x: 1.0 } };
      return p;
    },
  },
  {
    name: 'Erdwiderstand vor einer Baugrubenwand',
    desc: 'Passiver Erddruck mit gekrümmter Gleitfläche, Sand über Ton',
    project: () => {
      const p = baseProject();
      p.analysis = 'erddruck';
      p.soil.layers = [
        L('Sand, kiesig', 0, 20, 11, 32, 0, 0, 40, 2 / 3, 3),
        L('Ton, steif', 2.5, 19.5, 9.5, 24, 10, 80, 12, 0.5, 2),
      ];
      p.soil.gw = { on: true, z: 1.0 };
      p.ep = { ...p.ep, H: 4, kind: 'passive', passiveMethod: 'curved', dpRatio: 0.5, q: 0, water: true, loads: [] };
      return p;
    },
  },
];

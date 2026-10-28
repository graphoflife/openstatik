// Standardprojekt und Beispiele (DOM-frei, auch in Tests verwendet)
import { defaultMaterial } from './materials.js';
import { loadFactors } from '../../js/core/materials.js';

const LF = loadFactors('SIA');
const psi0Q = LF.psi.Nutzlast[0]; // 0.7
const psi2Q = LF.psi.Nutzlast[2]; // 0.3
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Standard-Lastkombinationen nach SIA 260 (γG = 1.35 / 0.80, γQ = 1.5, ψ0 = 0.7, ψ2 = 0.3).
 * Spalten: g (ständig inkl. Eigengewicht), q (Nutzlast), w (Wind), e (Erddruck), ae (Erdbeben, Bemessungswert).
 */
export function defaultCombos(opts = {}) {
  const list = [
    { on: true, name: 'Nutzlast dominant', type: 'ULS', g: LF.gG, q: LF.gQ, w: opts.wind ? r2(LF.gQ * LF.psi.Wind[0]) : 0, e: opts.earth ? LF.gG : 0, ae: 0 },
  ];
  if (opts.wind) {
    list.push({ on: true, name: 'Wind dominant', type: 'ULS', g: LF.gG, q: r2(LF.gQ * psi0Q), w: LF.gQ, e: opts.earth ? LF.gG : 0, ae: 0 });
    list.push({ on: true, name: 'Wind, min. Normalkraft', type: 'ULS', g: LF.gGinf, q: 0, w: LF.gQ, e: opts.earth ? LF.gG : 0, ae: 0 });
  }
  if (opts.earth && !opts.wind) {
    list.push({ on: true, name: 'Erddruck, min. Normalkraft', type: 'ULS', g: LF.gGinf, q: 0, w: 0, e: LF.gG, ae: 0 });
  }
  if (opts.quake) {
    list.push({ on: true, name: 'Erdbeben', type: 'ULS', g: 1.0, q: psi2Q, w: 0, e: opts.earth ? 1.0 : 0, ae: 1.0 });
  }
  list.push({ on: true, name: 'Gebrauch (charakteristisch)', type: 'SLS', g: 1.0, q: 1.0, w: 0, e: opts.earth ? 1.0 : 0, ae: 0 });
  return list;
}

/** Neues, leeres Projekt mit sinnvollen Standardwerten. */
export function defaultProject() {
  return {
    wall: { h: 2.6, t: 150, l: 4.0, support: 'slab', rhoManual: 1.0, sides: 0, ls: 4.0, openings: [] },
    material: defaultMaterial('MB'),
    loads: {
      gW: 60, qW: 15, gD: 25, qD: 10,
      eMode: 'centric', aD: 150, eD: 0, eU: 0,
      wind: 0,
      earth: { on: false, he: 2.0, gs: 19, K: 0.5, qs: 5 },
      Vw: 0, Ve: 0, hV: 2.6, topFixed: false,
      conc: { on: false, G: 30, Q: 10, a: 200, b: 150, x: 1.0, ec: 0 },
    },
    combos: defaultCombos(),
    settings: { method: 'SIA', shearMethod: 'SIA', impN: 450, creep: true, arching: true, sls: true, lambdaLim: 27, basementEN: true, bc: 6.0, openingConc: true },
  };
}

export const EXAMPLES = [
  {
    name: 'Innenwand MB 15 cm unter Deckenlasten',
    desc: 'Tragende Innenwand Backstein, h = 2.60 m, Auflast aus 3 Geschossen, Unterzug-Auflager',
    project: () => {
      const p = defaultProject();
      p.wall = { h: 2.6, t: 150, l: 5.0, support: 'slab', rhoManual: 1.0, sides: 0, ls: 5.0, openings: [{ x: 3.6, b: 0.9, y: 0, hgt: 2.1 }] };
      p.material = defaultMaterial('MB');
      Object.assign(p.loads, {
        gW: 85, qW: 22, gD: 22, qD: 8, eMode: 'manual', eD: 15, eU: 0,
        conc: { on: true, G: 35, Q: 12, a: 200, b: 150, x: 1.2, ec: 0 },
      });
      p.combos = defaultCombos();
      p.meta = { name: 'Innenwand MB 15 cm', comment: 'Beispiel 1: Tragende Innenwand im 1. OG eines Mehrfamilienhauses. Durchlaufende Stahlbetondecken (Spannweiten 4.8 m und 5.4 m), Auflager eines Unterzugs.' };
      return p;
    },
  },
  {
    name: 'Kellerwand MK 25 cm mit Erddruck',
    desc: 'Kelleraussenwand Kalksandstein, Anschüttung 2.0 m, Zentrierstreifen am Wandkopf',
    project: () => {
      const p = defaultProject();
      p.wall = { h: 2.5, t: 250, l: 6.0, support: 'slab', rhoManual: 1.0, sides: 0, ls: 6.0, openings: [] };
      p.material = defaultMaterial('MK');
      Object.assign(p.loads, {
        gW: 80, qW: 20, gD: 18, qD: 6, eMode: 'centric', aD: 250, eD: 0, eU: 0,
        earth: { on: true, he: 2.0, gs: 19, K: 0.5, qs: 5 },
      });
      p.loads.hV = p.wall.h;
      p.combos = defaultCombos({ earth: true });
      p.settings.bc = 5.0;
      p.meta = { name: 'Kellerwand MK 25 cm', comment: 'Beispiel 2: Kelleraussenwand mit Erdanschüttung, Decke über UG als Scheibe, Zentrierstreifen am Wandkopf. Querwände im Abstand von 5.0 m.' };
      return p;
    },
  },
  {
    name: 'Schubwand MB 17.5 cm, l = 4 m',
    desc: 'Aussteifende Wandscheibe Backstein unter Wind und Erdbeben',
    project: () => {
      const p = defaultProject();
      p.wall = { h: 2.7, t: 175, l: 4.0, support: 'slab', rhoManual: 1.0, sides: 2, ls: 4.0, openings: [] };
      p.material = defaultMaterial('MB');
      Object.assign(p.loads, {
        gW: 45, qW: 10, gD: 20, qD: 8, eMode: 'centric', eD: 0, eU: 0,
        Vw: 35, Ve: 95, hV: 2.7, topFixed: false,
      });
      p.combos = defaultCombos({ wind: true, quake: true });
      p.meta = { name: 'Schubwand MB 17.5 cm', comment: 'Beispiel 3: Aussteifende Wand im EG eines 3-geschossigen Gebäudes. Horizontalkräfte aus Wind (charakteristisch) und Erdbeben (Bemessungswert nach SIA 261) am Wandkopf.' };
      return p;
    },
  },
  {
    name: 'Aussenwand mit Deckenverdrehung',
    desc: 'Endauflager der Decke (a = t), Wind quer zur Wand, MB 17.5 cm',
    project: () => {
      const p = defaultProject();
      p.wall = { h: 2.6, t: 175, l: 4.5, support: 'hinged', rhoManual: 1.0, sides: 0, ls: 4.5, openings: [{ x: 1.0, b: 1.2, y: 0.9, hgt: 1.3 }] };
      p.material = defaultMaterial('MB');
      Object.assign(p.loads, { gW: 40, qW: 8, gD: 20, qD: 9, eMode: 'slab', aD: 175, eU: 0, wind: 0.9, hV: 2.6 });
      p.combos = defaultCombos({ wind: true });
      p.meta = { name: 'Aussenwand Endauflager', comment: 'Beispiel 4: Aussenwand im obersten Geschoss mit Endauflager der Dachdecke; Deckenverdrehung erzeugt die Exzentrizität am Wandkopf.' };
      return p;
    },
  },
];

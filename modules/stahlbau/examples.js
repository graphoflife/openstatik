// Standardprojekt und Beispiele (DOM-frei)

const stabDefaults = () => ({
  betaY: 1, betaZ: 1, swayY: false, swayZ: false,
  ltb: true, contRestraint: false, restraints: [],
  loadPos: 'top', k: 1, kw: 1, mcr: 'formula', cAuto: true, C1: 1, C2: 0, chiLT: 'auto',
});

const base = () => ({
  version: 1,
  norm: 'SIA',
  steel: 'S235',
  gamma: { auto: true, M0: 1.05, M1: 1.05 },
  section: {
    series: 'IPE', name: 'IPE 300',
    welded: { h: 500, b: 250, tw: 10, tf: 20, a: 5 },
    custom: { name: 'Eigener Querschnitt', h: 300, b: 150, A: 53.8, Iy: 8356, Iz: 604, Wely: 557, Welz: 80.5, Wply: 628, Wplz: 125, It: 20.1, Iw: 126000, Avz: 25.7, Avy: 32.1, cls: 1, curveY: 'a', curveZ: 'b', ltbCurve: 'b' },
  },
  mode: 'beam',
  beam: {
    system: 'ss', spans: [6], overhang: 1.5, length: 6, supports: [], selfWeight: true, activeLC: 'G',
    loadCases: [{ id: 'G', name: 'Ausbaulast', cat: 'G' }, { id: 'Q1', name: 'Nutzlast', cat: 'Nutzlast' }],
    loads: [],
  },
  forces: { L: 4, orient: 'h', cases: [] },
  combos: { auto: true, factors: null, manual: [] },
  sls: { limitChar: 300, limitQp: 250 },
  stab: stabDefaults(),
  suggestSeries: 'IPE',
});

/** Neues Projekt: Einfeldträger IPE 300, S235, L = 6 m – noch ohne Lasten (die Grafik ist der Einstieg). */
export function defaultProject() {
  return base();
}

export const EXAMPLES = [
  {
    name: 'Deckenträger IPE 300 (S235)',
    desc: 'Einfeldträger 6 m, Gleichlasten g/q, Kippen nur an den Auflagern gehalten, Last auf Obergurt',
    project: () => {
      const p = base();
      p.beam.loads = [
        { lc: 'G', kind: 'qz', v1: 4, v2: null, x1: null, x2: null },
        { lc: 'Q1', kind: 'qz', v1: 4, v2: null, x1: null, x2: null },
      ];
      p.meta = { name: 'Deckenträger Pos. 1', comment: 'Einfeldträger IPE 300, S235, Spannweite 6.00 m, Trägerabstand 2.00 m. Ausbau 2.0 kN/m², Nutzlast 2.0 kN/m² (Wohnen).' };
      return p;
    },
  },
  {
    name: 'Stütze HEB 200 (S355) mit Exzentrizität',
    desc: 'Pendelstütze 4.5 m, N = 600 kN, Kopfmoment aus exzentrischem Trägeranschluss (ψ = 0)',
    project: () => {
      const p = base();
      p.meta = { name: 'Stütze Pos. 12', comment: 'Pendelstütze HEB 200, S355. Trägerauflagerkraft 150 kN mit Exzentrizität 0.20 m am Stützenkopf → My = 30 kNm, am Fuss gelenkig (ψ = 0).' };
      p.steel = 'S355';
      p.section = { ...p.section, series: 'HEB', name: 'HEB 200' };
      p.mode = 'forces';
      p.forces = {
        L: 4.5, orient: 'v',
        cases: [
          { name: 'Volllast', N: 600, My: 30, Mz: 0, Vz: 6.7, Vy: 0, shapeY: 'lin', psiY: 0, shapeZ: 'lin', psiZ: 1 },
          { name: 'Nur Stützenlast', N: 750, My: 0, Mz: 0, Vz: 0, Vy: 0, shapeY: 'lin', psiY: 1, shapeZ: 'lin', psiZ: 1 },
        ],
      };
      p.stab = { ...stabDefaults(), loadPos: 'centroid' };
      p.suggestSeries = 'HEB';
      return p;
    },
  },
  {
    name: 'Dachpfette HEA 200 (S355), N + My + Mz',
    desc: 'Pfette als Druckriegel 5 m: Normalkraft aus Verband, Biegung um beide Achsen (Dachneigung), EN 1993-1-1',
    project: () => {
      const p = base();
      p.meta = { name: 'Dachpfette Pos. 4', comment: 'Pfette HEA 200, S355, Spannweite 5.00 m, zugleich Druckriegel des Dachverbands (N = 120 kN). Dachneigung → Biegung um y und z.' };
      p.norm = 'EC';
      p.steel = 'S355';
      p.gamma = { auto: true, M0: 1.0, M1: 1.0 };
      p.section = { ...p.section, series: 'HEA', name: 'HEA 200' };
      p.mode = 'forces';
      p.forces = {
        L: 5, orient: 'h',
        cases: [
          { name: 'Schnee + Wind (Druck)', N: 120, My: 42, Mz: 4.5, Vz: 34, Vy: 3.6, shapeY: 'q', psiY: 1, shapeZ: 'q', psiZ: 1 },
          { name: 'Eigengewicht + Schnee', N: 40, My: 48, Mz: 5.2, Vz: 38, Vy: 4.2, shapeY: 'q', psiY: 1, shapeZ: 'q', psiZ: 1 },
        ],
      };
      p.stab = { ...stabDefaults(), loadPos: 'top' };
      p.suggestSeries = 'HEA';
      return p;
    },
  },
  {
    name: 'Kragarm IPE 240 (S235)',
    desc: 'Balkonträger 2.5 m mit Gleichlast und Randlast, Kippen über Eigenwertanalyse',
    project: () => {
      const p = base();
      p.meta = { name: 'Balkonträger Pos. 7', comment: 'Kragarm IPE 240, S235, Auskragung 2.50 m, Einspannung seitlich und wölbbehindert. Geländerlast als Einzellast am Kragende.' };
      p.section = { ...p.section, series: 'IPE', name: 'IPE 240' };
      p.beam = {
        system: 'cant', spans: [2.5], overhang: 1.5, selfWeight: true,
        loadCases: [{ id: 'G', name: 'Ausbau + Geländer', cat: 'G' }, { id: 'Q1', name: 'Nutzlast Balkon', cat: 'Nutzlast' }],
        loads: [
          { lc: 'G', kind: 'qz', v1: 3, v2: null, x1: null, x2: null },
          { lc: 'G', kind: 'Pz', v1: 2, v2: null, x1: 2.5, x2: null },
          { lc: 'Q1', kind: 'qz', v1: 4, v2: null, x1: null, x2: null },
        ],
      };
      p.stab = { ...stabDefaults(), betaY: 2, betaZ: 2, swayY: true, swayZ: true, k: 0.7, kw: 0.7, mcr: 'fe' };
      p.sls = { limitChar: 300, limitQp: 250 };
      return p;
    },
  },
  {
    name: 'Durchlaufträger IPE 270 (S355)',
    desc: 'Zweifeldträger 2 × 5 m mit feldweiser Nutzlast und seitlichen Halterungen in Feldmitte',
    project: () => {
      const p = base();
      p.meta = { name: 'Unterzug Pos. 9', comment: 'Zweifeldträger IPE 270, S355, Felder je 5.00 m. Nutzlast feldweise (Schachbrett) als getrennte Lastfälle. Querträger halten den Obergurt in Feldmitte seitlich.' };
      p.norm = 'EC';
      p.steel = 'S355';
      p.gamma = { auto: true, M0: 1.0, M1: 1.0 };
      p.section = { ...p.section, series: 'IPE', name: 'IPE 270' };
      p.beam = {
        system: 'cont', spans: [5, 5], overhang: 1.5, selfWeight: true,
        loadCases: [
          { id: 'G', name: 'Ausbau', cat: 'G' },
          { id: 'Q1', name: 'Nutzlast Feld 1', cat: 'Nutzlast' },
          { id: 'Q2', name: 'Nutzlast Feld 2', cat: 'Nutzlast' },
        ],
        loads: [
          { lc: 'G', kind: 'qz', v1: 6, v2: null, x1: null, x2: null },
          { lc: 'Q1', kind: 'qz', v1: 9, v2: null, x1: 0, x2: 5 },
          { lc: 'Q2', kind: 'qz', v1: 9, v2: null, x1: 5, x2: 10 },
        ],
      };
      p.stab = { ...stabDefaults(), restraints: [{ x: 2.5 }, { x: 7.5 }] };
      p.suggestSeries = 'IPE';
      return p;
    },
  },
];

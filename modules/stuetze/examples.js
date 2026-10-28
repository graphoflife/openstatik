// Stütze – Beispiele (DOM-frei)
import { defaultProject, newLoadCase } from './calc.js';

const base = () => defaultProject();
const lc = (i, o) => ({ ...newLoadCase(i), ...o });

export const EXAMPLES = [
  {
    name: 'Gebäudestütze 30 × 30 cm',
    desc: 'Pendelstütze L = 3.20 m, N = 1500 kN mit kleinen Endmomenten, SIA 262',
    project: () => ({
      ...base(),
      meta: { name: 'Gebäudestütze 30 × 30 cm', comment: 'Innenstütze im Geschossbau, unverschieblich ausgesteift.' },
      norm: 'SIA', L: 3.2, support: 'pinned',
      section: { ...base().section, shape: 'rect', b: 300, h: 300, nb: 3, nh: 3, dia: 18, coverMode: 'nominal', cover: 30, stirrup: 8 },
      concrete: 'C30/37', steel: 'B500B',
      creep: { phi: 2.0, ratio: 0.7 },
      loadCases: [
        lc(1, { name: 'max N', N: 1500, Myt: 15, Myb: 10 }),
        lc(2, { name: 'max M', N: 1100, Myt: 32, Myb: -12 }),
      ],
    }),
  },
  {
    name: 'Hallenstütze 40 × 40 cm (Kragstütze)',
    desc: 'Eingespannte Kragstütze L = 6.00 m, N = 800 kN, H = 25 kN aus Wind, SIA 262',
    project: () => ({
      ...base(),
      meta: { name: 'Hallenstütze 40 × 40 cm', comment: 'Kragstütze im Köcherfundament, Horizontallast aus Wind am Stützenkopf.' },
      norm: 'SIA', L: 6.0, support: 'cantilever',
      section: { ...base().section, shape: 'rect', b: 400, h: 400, nb: 4, nh: 4, dia: 22, coverMode: 'nominal', cover: 30, stirrup: 8 },
      concrete: 'C30/37', steel: 'B500B',
      creep: { phi: 2.0, ratio: 0.3 },
      loadCases: [
        lc(1, { name: 'Wind', N: 800, Hz: 25 }),
        lc(2, { name: 'Schnee', N: 980, Hz: 12 }),
      ],
    }),
  },
  {
    name: 'Rundstütze Ø 400 mm, zweiachsig',
    desc: 'Pendelstütze L = 5.00 m, N = 2000 kN, Endmomente um beide Achsen, SIA 262',
    project: () => ({
      ...base(),
      meta: { name: 'Rundstütze Ø 400 mm', comment: 'Randstütze mit Lastausmitten in beiden Richtungen.' },
      norm: 'SIA', L: 5.0, support: 'pinned', biaxial: true,
      section: { ...base().section, shape: 'circle', D: 400, n: 8, dia: 20, coverMode: 'nominal', cover: 30, stirrup: 8 },
      concrete: 'C30/37', steel: 'B500B',
      creep: { phi: 2.0, ratio: 0.7 },
      loadCases: [lc(1, { name: 'LF 1', N: 2000, Myt: 40, Myb: 20, Mzt: 30, Mzb: 30 })],
    }),
  },
  {
    name: 'Rahmenstütze mit Drehfedern (EC2)',
    desc: 'Elastisch eingespannte Stütze L = 4.00 m, unverschieblich, EN 1992-1-1',
    project: () => ({
      ...base(),
      meta: { name: 'Rahmenstütze mit Drehfedern', comment: 'Innenstütze, Einspannung durch Decken und Fundament als Drehfedern.' },
      norm: 'EC', L: 4.0, support: 'custom',
      custom: { bot: 'spring', top: 'spring', sway: false, kBot: 20, kTop: 10 },
      section: { ...base().section, shape: 'rect', b: 350, h: 350, nb: 3, nh: 3, dia: 20, coverMode: 'nominal', cover: 30, stirrup: 8 },
      concrete: 'C35/45', steel: 'B500B',
      creep: { phi: 2.2, ratio: 0.65 },
      loadCases: [lc(1, { name: 'LF 1', N: 2600, Myt: 20, Myb: -10 })],
    }),
  },
];

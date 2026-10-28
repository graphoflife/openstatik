// Beispielprojekte für das Modul Stabwerk
import { LC_KINDS } from './calc.js';

const lc = (name, kind, extra = {}) => ({ name, kind, selfWeight: false, psi: [...LC_KINDS[kind].psi], nodal: [], dist: [], point: [], temp: [], settle: [], ...extra });
const sup = (node, ux, uy, rz) => ({ node, ux, uy, rz, kx: 0, ky: 0, kr: 0 });
const sec = (name, type, mat, o = {}) => ({ name, type, mat, b: 300, h: 500, d: 400, profile: 'HEB 200', A: 100, I: 10000, E: 30000, gamma: 25, ...o });
const analysis = (o = {}) => ({ secondOrder: false, imperfection: 200, buckling: true, nSub: 4, ...o });

export const EXAMPLES = [
  {
    name: 'Zweigelenkrahmen Halle',
    desc: 'Stahlrahmen 12 × 6 m mit Dach-, Schnee- und Windlast, Theorie 2. Ordnung',
    project: () => ({
      nodes: [{ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 12, y: 6 }, { x: 12, y: 0 }],
      members: [{ i: 1, j: 2, sec: 1, hi: false, hj: false }, { i: 2, j: 3, sec: 2, hi: false, hj: false }, { i: 3, j: 4, sec: 1, hi: false, hj: false }],
      sections: [sec('Stütze HEB 300', 'profile', 'S355', { profile: 'HEB 300' }), sec('Riegel IPE 450', 'profile', 'S355', { profile: 'IPE 450' })],
      supports: [sup(1, true, true, false), sup(4, true, true, false)],
      loadCases: [
        lc('Eigengewicht + Dach', 'G', { selfWeight: true, dist: [{ member: 2, dir: 'g', q1: 3.6, q2: null, a: null, b: null }] }),
        lc('Schnee', 'S', { dist: [{ member: 2, dir: 'gp', q1: 5.4, q2: null, a: null, b: null }] }),
        lc('Wind von links', 'W', { dist: [{ member: 1, dir: 'x', q1: 3.2, q2: null, a: null, b: null }, { member: 3, dir: 'x', q1: 2.0, q2: null, a: null, b: null }] }),
      ],
      combinations: [], autoCombos: true,
      analysis: analysis({ secondOrder: true }),
      activeLC: 0,
    }),
  },
  {
    name: 'Durchlaufträger 3 Felder',
    desc: 'Stahlbetonbalken 5 – 6 – 5 m mit feldweiser Nutzlast und Umhüllender',
    project: () => ({
      nodes: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 11, y: 0 }, { x: 16, y: 0 }],
      members: [{ i: 1, j: 2, sec: 1, hi: false, hj: false }, { i: 2, j: 3, sec: 1, hi: false, hj: false }, { i: 3, j: 4, sec: 1, hi: false, hj: false }],
      sections: [sec('Balken 30/60', 'rect', 'C30/37', { b: 300, h: 600 })],
      supports: [sup(1, true, true, false), sup(2, false, true, false), sup(3, false, true, false), sup(4, false, true, false)],
      loadCases: [
        lc('Eigengewicht + Ausbau', 'G', { selfWeight: true, dist: [{ member: 1, dir: 'g', q1: 18, q2: null, a: null, b: null }, { member: 2, dir: 'g', q1: 18, q2: null, a: null, b: null }, { member: 3, dir: 'g', q1: 18, q2: null, a: null, b: null }] }),
        lc('Nutzlast Felder 1+3', 'Q', { dist: [{ member: 1, dir: 'g', q1: 12, q2: null, a: null, b: null }, { member: 3, dir: 'g', q1: 12, q2: null, a: null, b: null }] }),
        lc('Nutzlast Feld 2', 'Q', { dist: [{ member: 2, dir: 'g', q1: 12, q2: null, a: null, b: null }] }),
      ],
      combinations: [
        { name: 'GZT: max. Feldmomente 1/3', type: 'GZT', factors: [1.35, 1.5, 0] },
        { name: 'GZT: max. Feldmoment 2', type: 'GZT', factors: [1.35, 0, 1.5] },
        { name: 'GZT: Vollast (Stützmomente)', type: 'GZT', factors: [1.35, 1.5, 1.5] },
        { name: 'GZG quasi-ständig', type: 'QP', factors: [1, 0.3, 0.3] },
      ],
      autoCombos: false,
      analysis: analysis({ buckling: false }),
      activeLC: 1,
    }),
  },
  {
    name: 'Fachwerkträger 12 m',
    desc: 'Parallelgurtträger mit Pfosten und Diagonalen, alle Stäbe gelenkig',
    project: () => {
      const nodes = [];
      for (let i = 0; i <= 6; i++) nodes.push({ x: 2 * i, y: 0 });
      for (let i = 0; i <= 6; i++) nodes.push({ x: 2 * i, y: 1.6 });
      const mem = (i, j, s) => ({ i, j, sec: s, hi: true, hj: true });
      const members = [];
      for (let i = 1; i <= 6; i++) members.push(mem(i, i + 1, 1));
      for (let i = 8; i <= 13; i++) members.push(mem(i, i + 1, 1));
      for (let i = 1; i <= 7; i++) members.push(mem(i, i + 7, 2));
      members.push(mem(8, 2, 2), mem(9, 3, 2), mem(10, 4, 2), mem(12, 4, 2), mem(13, 5, 2), mem(14, 6, 2));
      const top = [8, 9, 10, 11, 12, 13, 14];
      return {
        nodes, members,
        sections: [sec('Gurt RRW 160·8', 'values', 'S355', { A: 46.4, I: 1700, h: 160 }), sec('Füllstab RRW 100·5', 'values', 'S355', { A: 18.4, I: 271, h: 100 })],
        supports: [sup(1, true, true, false), sup(7, false, true, false)],
        loadCases: [
          lc('Eigengewicht + Dach', 'G', { selfWeight: true, nodal: top.map((n, k) => ({ node: n, fx: 0, fy: k === 0 || k === 6 ? -9 : -18, m: 0 })) }),
          lc('Schnee', 'S', { nodal: top.map((n, k) => ({ node: n, fx: 0, fy: k === 0 || k === 6 ? -7 : -14, m: 0 })) }),
        ],
        combinations: [], autoCombos: true,
        analysis: analysis(),
        activeLC: 0,
      };
    },
  },
  {
    name: 'Kragstütze Theorie 2. Ordnung',
    desc: 'Eingespannte Stahlstütze 8 m mit Normalkraft und Windlast, Knicklänge',
    project: () => ({
      nodes: [{ x: 0, y: 0 }, { x: 0, y: 8 }],
      members: [{ i: 1, j: 2, sec: 1, hi: false, hj: false }],
      sections: [sec('HEB 300', 'profile', 'S355', { profile: 'HEB 300' })],
      supports: [sup(1, true, true, true)],
      loadCases: [
        lc('Eigengewicht + Dach', 'G', { selfWeight: true, nodal: [{ node: 2, fx: 0, fy: -420, m: 0 }] }),
        lc('Schnee', 'S', { nodal: [{ node: 2, fx: 0, fy: -260, m: 0 }] }),
        lc('Wind', 'W', { nodal: [{ node: 2, fx: 12, fy: 0, m: 0 }], dist: [{ member: 1, dir: 'x', q1: 1.8, q2: null, a: null, b: null }] }),
      ],
      combinations: [], autoCombos: true,
      analysis: analysis({ secondOrder: true, nSub: 6 }),
      activeLC: 2,
    }),
  },
  {
    name: 'Zweigeschossiger Betonrahmen',
    desc: 'Rahmen 7 m mit eingespannten Stützen, Decken- und Windlasten',
    project: () => ({
      nodes: [{ x: 0, y: 0 }, { x: 0, y: 3.4 }, { x: 0, y: 6.6 }, { x: 7, y: 0 }, { x: 7, y: 3.4 }, { x: 7, y: 6.6 }],
      members: [
        { i: 1, j: 2, sec: 1, hi: false, hj: false }, { i: 2, j: 3, sec: 1, hi: false, hj: false },
        { i: 4, j: 5, sec: 1, hi: false, hj: false }, { i: 5, j: 6, sec: 1, hi: false, hj: false },
        { i: 2, j: 5, sec: 2, hi: false, hj: false }, { i: 3, j: 6, sec: 2, hi: false, hj: false },
      ],
      sections: [sec('Stütze 35/35', 'rect', 'C30/37', { b: 350, h: 350 }), sec('Unterzug 30/65', 'rect', 'C30/37', { b: 300, h: 650 })],
      supports: [sup(1, true, true, true), sup(4, true, true, true)],
      loadCases: [
        lc('Eigengewicht + Decke', 'G', { selfWeight: true, dist: [{ member: 5, dir: 'g', q1: 32, q2: null, a: null, b: null }, { member: 6, dir: 'g', q1: 26, q2: null, a: null, b: null }] }),
        lc('Nutzlast', 'Q', { dist: [{ member: 5, dir: 'g', q1: 15, q2: null, a: null, b: null }, { member: 6, dir: 'g', q1: 6, q2: null, a: null, b: null }] }),
        lc('Wind', 'W', { nodal: [{ node: 2, fx: 14, fy: 0, m: 0 }, { node: 3, fx: 8, fy: 0, m: 0 }] }),
        lc('Temperatur Dach', 'T', { temp: [{ member: 6, dT: 15, dTg: 10 }] }),
      ],
      combinations: [], autoCombos: true,
      analysis: analysis({ secondOrder: true }),
      activeLC: 0,
    }),
  },
];

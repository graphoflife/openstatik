// Standardprojekt und Beispiele des Plattenmoduls (DOM-frei, auch in Tests verwendet)
import { defaultDesign, defaultCombos } from './calc.js';

const P = (x, y) => ({ x, y });
const rect = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];

function lc(id, name, type, opts = {}) {
  const base = { id, name, type, sw: false, cat: type === 'Q' ? 'B' : '', psi0: type === 'Q' ? 0.7 : null, psi1: type === 'Q' ? 0.5 : null, psi2: type === 'Q' ? 0.3 : null };
  return { ...base, ...opts };
}

function wallsAround(outline, skip = []) {
  const out = [];
  for (let i = 0; i < outline.length; i++) {
    if (skip.includes(i)) continue;
    const a = outline[i], b = outline[(i + 1) % outline.length];
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, clamped: false });
  }
  return out;
}

function slab(id, name, outline, h, concrete = '') {
  return { id, name, outline, h, concrete };
}

function finish(p) {
  if (!p.combos) p.combos = defaultCombos(p.loadCases);
  p.design = { ...defaultDesign(), ...(p.design || {}) };
  return p;
}

/**
 * Neues, leeres Projekt: keine Geometrie, keine Lager, keine Lasten – nur sinnvolle Baustoff- und
 * Bemessungsvorgaben sowie die üblichen Lastfälle (Eigengewicht wird automatisch angesetzt).
 */
export function defaultProject() {
  return finish({
    norm: 'SIA',
    slabs: [],
    openings: [],
    h: 0.25, concrete: 'C30/37', nu: 0.2, meshSize: 0.4,
    pointSupports: [],
    lineSupports: [],
    loadCases: [
      lc('LF1', 'Eigengewicht', 'G', { sw: true }),
      lc('LF2', 'Auflast', 'G'),
      lc('LF3', 'Nutzlast', 'Q', { cat: 'B', psi0: 0.7, psi1: 0.5, psi2: 0.3 }),
    ],
    areaLoads: [],
    loadAreas: [],
    lineLoads: [],
    pointLoads: [],
  });
}

function example1() {
  const outline = rect(0, 0, 6, 4);
  return finish({
    norm: 'SIA',
    slabs: [slab('P1', 'Decke', outline, 0.20)],
    openings: [],
    h: 0.20, concrete: 'C25/30', nu: 0.2, meshSize: 0.25,
    pointSupports: [],
    lineSupports: wallsAround(outline),
    loadCases: [
      lc('LF1', 'Eigengewicht', 'G', { sw: true }),
      lc('LF2', 'Bodenaufbau', 'G'),
      lc('LF3', 'Nutzlast Wohnen', 'Q', { cat: 'A', psi0: 0.7, psi1: 0.5, psi2: 0.3 }),
    ],
    areaLoads: [{ lc: 'LF2', q: 1.6, region: 'all' }, { lc: 'LF3', q: 2.0, region: 'all' }],
    loadAreas: [],
    lineLoads: [],
    pointLoads: [],
    design: { cBot: 25, cTop: 25, dBot: 10, dTop: 10 },
  });
}

function example2() {
  const L = 6.5, o = 0.25;
  const outline = rect(-o, -o, 3 * L + o, 2 * L + o);
  const cols = [];
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= 3; i++) {
      const inner = i > 0 && i < 3 && j === 1;
      cols.push({ x: i * L, y: j * L, b: inner ? 0.45 : 0.40, hc: inner ? 0.45 : 0.40, kz: null, kr: null });
    }
  }
  // Stützenkopfverstärkungen (h = 0.40 m) über den beiden Innenstützen: Platten innerhalb der Decke
  const drop = (cx, cy, a) => rect(cx - a / 2, cy - a / 2, cx + a / 2, cy + a / 2);
  return finish({
    norm: 'SIA',
    slabs: [
      slab('P1', 'Flachdecke', outline, 0.30),
      slab('P2', 'Verstärkung S6', drop(L, L, 2.6), 0.40),
      slab('P3', 'Verstärkung S7', drop(2 * L, L, 2.6), 0.40),
    ],
    openings: [],
    h: 0.30, concrete: 'C30/37', nu: 0.2, meshSize: 0.45,
    pointSupports: cols,
    lineSupports: [],
    loadCases: [
      lc('LF1', 'Eigengewicht', 'G', { sw: true }),
      lc('LF2', 'Bodenaufbau + Trennwände', 'G'),
      lc('LF3', 'Nutzlast Büro', 'Q', { cat: 'B', psi0: 0.7, psi1: 0.5, psi2: 0.3 }),
    ],
    areaLoads: [{ lc: 'LF2', q: 2.0, region: 'all' }, { lc: 'LF3', q: 3.0, region: 'all' }],
    loadAreas: [],
    lineLoads: [
      { lc: 'LF2', x1: -o, y1: -o, x2: 3 * L + o, y2: -o, p1: 3.0, p2: 3.0 },
      { lc: 'LF2', x1: -o, y1: 2 * L + o, x2: 3 * L + o, y2: 2 * L + o, p1: 3.0, p2: 3.0 },
    ],
    pointLoads: [],
    design: { cBot: 30, cTop: 30, dBot: 12, dTop: 16, Lspan: 6.5, basic: [
      { layer: 'bx', d: 12, s: 150 }, { layer: 'by', d: 12, s: 150 },
      { layer: 'tx', d: 12, s: 150 }, { layer: 'ty', d: 12, s: 150 },
    ] },
  });
}

function example3() {
  const main = [P(0, 0), P(12, 0), P(12, 5), P(6, 5), P(6, 9), P(0, 9)];
  return finish({
    norm: 'SIA',
    slabs: [
      slab('P1', 'Wohnungsdecke', main, 0.24),
      slab('P2', 'Balkon', rect(2, -1.8, 8, 0), 0.20),
    ],
    openings: [{ name: 'Treppenauge', pts: rect(1.0, 6.2, 3.6, 7.6) }],
    h: 0.24, concrete: 'C30/37', nu: 0.2, meshSize: 0.35,
    pointSupports: [
      { x: 6.0, y: 4.6, b: 0.4, hc: 0.4, kz: null, kr: null },
      { x: 6.0, y: 1.0, b: 0.3, hc: 0.3, kz: null, kr: null },
    ],
    lineSupports: [
      { x1: 0, y1: 0, x2: 0, y2: 9, clamped: false },
      { x1: 0, y1: 0, x2: 12, y2: 0, clamped: false },
      { x1: 12, y1: 0, x2: 12, y2: 5, clamped: false },
      { x1: 0, y1: 9, x2: 6, y2: 9, clamped: false },
    ],
    loadCases: [
      lc('LF1', 'Eigengewicht', 'G', { sw: true }),
      lc('LF2', 'Bodenaufbau', 'G'),
      lc('LF3', 'Nutzlast Wohnen', 'Q', { cat: 'A', psi0: 0.7, psi1: 0.5, psi2: 0.3 }),
      lc('LF4', 'Nutzlast Balkon', 'Q', { cat: 'A', psi0: 0.7, psi1: 0.5, psi2: 0.3 }),
    ],
    areaLoads: [
      { lc: 'LF2', q: 1.5, region: 'all' },
      { lc: 'LF3', q: 2.0, region: 'P1' },
      { lc: 'LF4', q: 3.0, region: 'P2' },
    ],
    loadAreas: [],
    lineLoads: [
      { lc: 'LF2', x1: 2, y1: -1.8, x2: 8, y2: -1.8, p1: 1.5, p2: 1.5 },
      { lc: 'LF2', x1: 6.6, y1: 5, x2: 6.6, y2: 0.5, p1: 6.0, p2: 6.0 },
    ],
    pointLoads: [{ lc: 'LF2', x: 10, y: 3, P: 25 }],
    design: { cBot: 30, cTop: 30, dBot: 10, dTop: 12, Lspan: 6 },
  });
}

export const EXAMPLES = [
  { name: 'Rechteckplatte 6 × 4 m', desc: 'Allseitig gelenkig gelagerte Decke, Wohnnutzung', project: example1 },
  { name: 'Flachdecke 3 × 2 Felder', desc: 'Spannweiten 6.5 m auf 12 Stützen, verstärkte Stützenköpfe – zeigt, wo Durchstanzbewehrung nötig wird', project: example2 },
  { name: 'L-Platte mit Balkon', desc: 'Zwei Platten (Decke 24 cm, Balkon 20 cm), Öffnung, Wände, Lasten je Platte', project: example3 },
];

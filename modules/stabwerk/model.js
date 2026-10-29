// Projektmodell Stabwerk: Grundstruktur und Bearbeitungsfunktionen (DOM-frei)
import { LC_KINDS, generateCombinations } from './calc.js';
import { newMaterial, newSection } from './sections.js';

export function emptyLC(name = 'Eigengewicht', kind = 'G') {
  return { name, kind, selfWeight: kind === 'G', psi: [...LC_KINDS[kind].psi], nodal: [], dist: [], point: [], temp: [], settle: [] };
}

/** Leeres Projekt: Standardmaterialien, ein Standardquerschnitt und ein Lastfall «Eigengewicht». */
export function defaultProject() {
  return {
    nodes: [],
    members: [],
    materials: [newMaterial('Beton', 'C25/30'), newMaterial('Baustahl', 'S235')],
    sections: [newSection('rect')],
    activeMat: 1,
    supports: [],
    loadCases: [emptyLC('Eigengewicht', 'G')],
    combinations: [],
    autoCombos: true,
    analysis: { secondOrder: false, imperfection: 200, buckling: true, nSub: 4 },
    activeLC: 0,
    activeSec: 1,
  };
}

export function syncCombos(p) {
  if (p.autoCombos) p.combinations = generateCombinations(p.loadCases);
  for (const c of p.combinations) {
    c.factors = p.loadCases.map((_, i) => (c.factors && c.factors[i] !== undefined ? c.factors[i] : 0));
  }
}

// Umnummerierung nach dem Löschen eines Knotens bzw. Stabes (Indizes 0-basiert).
// Der Eintrag selbst wird vom Aufrufer entfernt (vorher oder nachher, die Referenzen zählen ab 1).
export function removeNodeRefs(p, idx) {
  const n = idx + 1;
  const fix = (v) => (v > n ? v - 1 : v);
  const removed = [];
  p.members.forEach((m, k) => { if (m.i === n || m.j === n) removed.push(k); });
  for (const k of removed.reverse()) removeMemberRefs(p, k);
  p.members = p.members.filter((m) => m.i !== n && m.j !== n).map((m) => ({ ...m, i: fix(m.i), j: fix(m.j) }));
  p.supports = p.supports.filter((s) => s.node !== n).map((s) => ({ ...s, node: fix(s.node) }));
  for (const lc of p.loadCases) {
    lc.nodal = lc.nodal.filter((l) => l.node !== n).map((l) => ({ ...l, node: fix(l.node) }));
    lc.settle = lc.settle.filter((l) => l.node !== n).map((l) => ({ ...l, node: fix(l.node) }));
  }
}
export function removeMemberRefs(p, idx) {
  const n = idx + 1;
  const fix = (v) => (v > n ? v - 1 : v);
  for (const lc of p.loadCases) for (const key of ['dist', 'point', 'temp']) lc[key] = lc[key].filter((l) => l.member !== n).map((l) => ({ ...l, member: fix(l.member) }));
}
export function removeSectionRefs(p, idx) {
  const n = idx + 1;
  for (const m of p.members) { if (m.sec === n) m.sec = 1; else if (m.sec > n) m.sec -= 1; }
}

export const SUPPORT_KINDS = [
  { value: 'none', label: 'Kein Lager', flags: null },
  { value: 'pinned', label: 'Gelenkig fest', flags: [true, true, false] },
  { value: 'rollerY', label: 'Rolle (vertikal gehalten)', flags: [false, true, false] },
  { value: 'rollerX', label: 'Rolle (horizontal gehalten)', flags: [true, false, false] },
  { value: 'fixed', label: 'Eingespannt', flags: [true, true, true] },
  { value: 'slide', label: 'Einspannung, horizontal verschieblich', flags: [false, true, true] },
  { value: 'spring', label: 'Nur Federn', flags: [false, false, false] },
  { value: 'custom', label: 'Benutzerdefiniert', flags: null },
];
export function supportKind(sp) {
  if (!sp) return 'none';
  const k = SUPPORT_KINDS.find((q) => q.flags && q.flags[0] === !!sp.ux && q.flags[1] === !!sp.uy && q.flags[2] === !!sp.rz);
  return k ? k.value : 'custom';
}

/** Index (0-basiert) eines Knotens an p oder -1. */
export function nodeAt(p, [x, y], tol = 1e-6) {
  return p.nodes.findIndex((n) => Math.abs(n.x - x) <= tol && Math.abs(n.y - y) <= tol);
}

/** Knoten an p suchen oder anlegen; gibt Index (0-basiert) zurück. */
export function ensureNode(p, pt) {
  const i = nodeAt(p, pt);
  if (i >= 0) return i;
  p.nodes.push({ x: +pt[0].toFixed(6), y: +pt[1].toFixed(6) });
  return p.nodes.length - 1;
}

/**
 * Fügt zusammenfallende Knoten zusammen (nach dem Verschieben). Stäbe mit gleichem Anfangs- und Endknoten
 * werden entfernt, doppelte Lager zusammengeführt. Gibt eine Abbildung alt→neu (0-basiert) zurück.
 */
export function mergeNodes(p, tol = 1e-6) {
  const map = p.nodes.map((_, i) => i);
  for (let i = 0; i < p.nodes.length; i++) {
    if (map[i] !== i) continue;
    for (let j = i + 1; j < p.nodes.length; j++) {
      if (map[j] === j && Math.abs(p.nodes[i].x - p.nodes[j].x) <= tol && Math.abs(p.nodes[i].y - p.nodes[j].y) <= tol) map[j] = i;
    }
  }
  if (map.every((v, i) => v === i)) return map;
  // Referenzen auf Duplikate umbiegen, dann Duplikate (von hinten) löschen
  const re = (n) => map[n - 1] + 1;
  for (const m of p.members) { m.i = re(m.i); m.j = re(m.j); }
  for (const s of p.supports) s.node = re(s.node);
  for (const lc of p.loadCases) { for (const l of lc.nodal) l.node = re(l.node); for (const l of lc.settle) l.node = re(l.node); }
  // Stäbe der Länge null entfernen
  for (let k = p.members.length - 1; k >= 0; k--) if (p.members[k].i === p.members[k].j) { removeMemberRefs(p, k); p.members.splice(k, 1); }
  // doppelte Lager zusammenführen
  const seen = new Map();
  p.supports = p.supports.filter((s) => {
    const o = seen.get(s.node);
    if (!o) { seen.set(s.node, s); return true; }
    o.ux ||= s.ux; o.uy ||= s.uy; o.rz ||= s.rz;
    return false;
  });
  const dups = map.map((v, i) => (v !== i ? i : -1)).filter((i) => i >= 0).sort((a, b) => b - a);
  for (const d of dups) { removeNodeRefs(p, d); p.nodes.splice(d, 1); }
  // neue Indizes
  const out = [];
  let shift = 0;
  for (let i = 0; i < map.length; i++) {
    if (map[i] !== i) { out.push(-1); shift++; } else out.push(i - shift);
  }
  return map.map((v) => out[v]);
}

// ------------------------------------------------------------------ Stäbe teilen

function memberGeom(p, m) {
  const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  return { a, b, dx, dy, L };
}

/** Lage von Knoten n (0-basiert) auf Stab k: Parameter t ∈ (0,1) oder null, wenn nicht im Inneren. */
export function nodeOnMember(p, k, n, tol = 1e-6) {
  const m = p.members[k];
  if (!m || m.i === n + 1 || m.j === n + 1) return null;
  const { a, dx, dy, L } = memberGeom(p, m);
  if (L < 1e-9) return null;
  const q = p.nodes[n];
  const t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / (L * L);
  if (t <= 1e-9 || t >= 1 - 1e-9) return null;
  const d = Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / L;
  return d <= tol * Math.max(1, L) ? t : null;
}

/**
 * Teilt Stab k (0-basiert) am Knoten n (0-basiert). Gelenke und Lasten werden aufgeteilt;
 * der neue zweite Teil wird hinten angefügt. Gibt den Index des neuen Stabes zurück.
 */
export function splitMember(p, k, n) {
  const m = p.members[k];
  const { L } = memberGeom(p, m);
  const t = nodeOnMember(p, k, n, 1e-3);
  if (t === null) return -1;
  const s = t * L;
  const second = { ...m, i: n + 1, j: m.j, hi: false, hj: m.hj };
  m.j = n + 1; m.hj = false;
  p.members.push(second);
  const k2 = p.members.length; // 1-basiert
  const blank = (v) => v === null || v === undefined || v === '';
  for (const lc of p.loadCases) {
    const add = [];
    for (const l of lc.dist) {
      if (l.member !== k + 1) continue;
      const a = blank(l.a) ? 0 : +l.a;
      const b = blank(l.b) || +l.b <= 0 ? L : Math.min(L, +l.b);
      const q1 = +l.q1 || 0, q2 = blank(l.q2) ? q1 : +l.q2;
      const constant = Math.abs(q2 - q1) < 1e-12;
      const qAt = (x) => (b > a ? q1 + (q2 - q1) * (x - a) / (b - a) : q1);
      if (b <= s + 1e-9) continue; // ganz im ersten Teil
      if (a >= s - 1e-9) { // ganz im zweiten Teil
        l.member = k2;
        l.a = a - s > 1e-9 ? +(a - s).toFixed(6) : null;
        l.b = blank(l.b) ? null : +(b - s).toFixed(6);
        continue;
      }
      // Last überdeckt die Teilungsstelle: erster Teil bis zum Stabende, zweiter ab Stabanfang
      const qs = qAt(s);
      add.push({ ...l, member: k2, a: null, b: blank(l.b) ? null : +(b - s).toFixed(6), q1: qs, q2: constant ? null : q2 });
      l.b = null;
      l.q2 = constant ? null : qs;
    }
    lc.dist.push(...add);
    for (const l of lc.point) if (l.member === k + 1 && +l.a >= s - 1e-9) { l.member = k2; l.a = +(l.a - s).toFixed(6); }
    const temps = lc.temp.filter((l) => l.member === k + 1).map((l) => ({ ...l, member: k2 }));
    lc.temp.push(...temps);
  }
  return k2 - 1;
}

/** Teilt alle Stäbe, in deren Innerem Knoten n liegt. */
export function connectNode(p, n) {
  let changed = false;
  for (let k = 0; k < p.members.length; k++) {
    if (nodeOnMember(p, k, n) !== null) { splitMember(p, k, n); changed = true; }
  }
  return changed;
}

/** Teilt Stab k an allen Knoten, die in seinem Inneren liegen. Gibt die Indizes der Teilstäbe zurück. */
export function splitAtInnerNodes(p, k) {
  const parts = [k];
  const inner = p.nodes.map((_, n) => ({ n, t: nodeOnMember(p, k, n) })).filter((x) => x.t !== null).sort((a, b) => b.t - a.t);
  // von hinten teilen: der vordere Teil behält den Index k
  for (const { n } of inner) {
    const k2 = splitMember(p, k, n);
    if (k2 >= 0) parts.push(k2);
  }
  return parts;
}

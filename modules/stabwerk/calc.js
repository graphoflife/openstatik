// Rechenkern Stabwerk: ebene Stabtragwerke nach der Weggrössenmethode (DOM-frei)
//
// Einheiten: kN, m, kNm, rad. Globale Achsen: X nach rechts, Y nach oben, Drehung im Gegenuhrzeigersinn positiv.
// Lokale Stabachsen: x von Knoten i nach j, y = x um 90° im Gegenuhrzeigersinn gedreht.
// Schnittgrössen: N Zug positiv; M positiv bei Zug auf der Seite −y (bei waagrechtem Stab von links nach rechts:
// Zug unten); V positiv, wenn es am positiven Schnittufer in −y-Richtung wirkt (V = dM/dx).
import { SkylineMatrix, rcm, eigGeneral, SingularError, GAUSS } from '../../js/core/linalg.js';
import { sectionProps } from './sections.js';

export const LC_KINDS = {
  G: { label: 'Ständig', short: 'G', variable: false, psi: [1, 1, 1] },
  Q: { label: 'Nutzlast', short: 'Q', variable: true, psi: [0.7, 0.5, 0.3] },
  S: { label: 'Schnee', short: 'S', variable: true, psi: [0.6, 0.5, 0.2] },
  W: { label: 'Wind', short: 'W', variable: true, psi: [0.6, 0.5, 0.0] },
  T: { label: 'Temperatur', short: 'T', variable: true, psi: [0.6, 0.5, 0.0] },
  A: { label: 'Aussergewöhnlich', short: 'A', variable: false, psi: [1, 1, 1] },
};

export const COMBO_TYPES = {
  GZT: 'Tragsicherheit (GZT)',
  CHAR: 'Gebrauch charakteristisch',
  FREQ: 'Gebrauch häufig',
  QP: 'Gebrauch quasi-ständig',
};

export const LOAD_DIRS = [
  { value: 'g', label: '↓ vertikal' },
  { value: 'gp', label: '↓ vertikal, projiziert' },
  { value: 'x', label: '→ horizontal' },
  { value: 'n', label: '⊥ senkrecht zum Stab' },
  { value: 'l', label: '∥ in Stabrichtung' },
];

const G3 = GAUSS[3];

// ------------------------------------------------------------------ Kombinationen

/** Erzeugt Lastfallkombinationen nach SIA 260 (Typ 2) bzw. EN 1990 (6.10). */
export function generateCombinations(loadCases, norm = 'SIA') {
  const gG = 1.35, gQ = 1.5;
  const perm = loadCases.map((lc, i) => (!LC_KINDS[lc.kind]?.variable ? i : -1)).filter((i) => i >= 0 && loadCases[i].kind !== 'A');
  const vars = loadCases.map((lc, i) => (LC_KINDS[lc.kind]?.variable ? i : -1)).filter((i) => i >= 0);
  const psi = (i, k) => loadCases[i].psi?.[k] ?? LC_KINDS[loadCases[i].kind].psi[k];
  const combos = [];
  const base = () => loadCases.map(() => 0);
  const nm = (i) => loadCases[i].name;
  if (!vars.length) {
    const f = base(); perm.forEach((i) => { f[i] = gG; });
    combos.push({ name: `GZT: ${fmtF(gG)}·G`, type: 'GZT', factors: f });
  }
  for (const lead of vars) {
    const f = base();
    perm.forEach((i) => { f[i] = gG; });
    vars.forEach((i) => { f[i] = i === lead ? gQ : gQ * psi(i, 0); });
    combos.push({ name: `GZT: ${fmtF(gG)}·G + ${fmtF(gQ)}·${nm(lead)}${vars.length > 1 ? ' + Begl.' : ''}`, type: 'GZT', factors: f });
  }
  if (vars.length) {
    const f = base(); perm.forEach((i) => { f[i] = gG; });
    combos.push({ name: `GZT: ${fmtF(gG)}·G (nur ständig)`, type: 'GZT', factors: f });
  }
  for (const lead of vars) {
    const f = base();
    perm.forEach((i) => { f[i] = 1; });
    vars.forEach((i) => { f[i] = i === lead ? 1 : psi(i, 0); });
    combos.push({ name: `GZG char.: G + ${nm(lead)}`, type: 'CHAR', factors: f });
  }
  {
    const f = base(); perm.forEach((i) => { f[i] = 1; });
    vars.forEach((i) => { f[i] = psi(i, 2); });
    combos.push({ name: 'GZG quasi-ständig: G + ψ2·Q', type: 'QP', factors: f });
  }
  void norm;
  return combos;
}

function fmtF(v) { return String(+v.toFixed(3)); }

// ------------------------------------------------------------------ Modellaufbau

/**
 * Baut das FE-Modell aus der Projektdefinition.
 * opts: {nSub: Unterteilung je Stab, imperfection: Schiefstellung φ (rad) für Theorie 2. Ordnung}
 */
export function buildModel(p, opts = {}) {
  const nSub = Math.max(1, Math.round(opts.nSub || 1));
  const nodes = p.nodes.map((n, i) => ({ x: +n.x, y: +n.y, id: i }));
  if (nodes.length < 2) throw new Error('Mindestens zwei Knoten erforderlich.');
  if (!p.members.length) throw new Error('Keine Stäbe definiert.');
  const secs = p.sections.map((s) => sectionProps(s));
  const members = p.members.map((m, k) => {
    const i = Math.round(m.i) - 1, j = Math.round(m.j) - 1;
    if (!(i >= 0 && i < nodes.length && j >= 0 && j < nodes.length)) throw new Error(`Stab ${k + 1}: Knotennummer ungültig.`);
    if (i === j) throw new Error(`Stab ${k + 1}: Anfangs- und Endknoten identisch.`);
    const si = Math.round(m.sec) - 1;
    const sp = secs[si];
    if (!sp) throw new Error(`Stab ${k + 1}: Querschnitt ${m.sec} existiert nicht.`);
    if (!(sp.A > 0 && sp.I > 0 && sp.E > 0)) throw new Error(`Stab ${k + 1}: Querschnittswerte unvollständig (A, I, E > 0).`);
    const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y, L = Math.hypot(dx, dy);
    if (L < 1e-9) throw new Error(`Stab ${k + 1}: Länge null.`);
    return { k, i, j, L, c: dx / L, s: dy / L, sec: sp, secIndex: si, hi: !!m.hi, hj: !!m.hj };
  });

  // FE-Knoten: Benutzerknoten + Zwischenknoten
  const fe = nodes.map((n) => ({ x: n.x, y: n.y, user: n.id }));
  const elems = [];
  for (const m of members) {
    let prev = m.i;
    for (let q = 0; q < nSub; q++) {
      let next;
      if (q === nSub - 1) next = m.j;
      else {
        const t = (q + 1) / nSub;
        fe.push({ x: nodes[m.i].x + t * (nodes[m.j].x - nodes[m.i].x), y: nodes[m.i].y + t * (nodes[m.j].y - nodes[m.i].y), user: -1, member: m.k });
        next = fe.length - 1;
      }
      elems.push({ m: m.k, n1: prev, n2: next, a: m.L * q / nSub, L: m.L / nSub, c: m.c, s: m.s, E: m.sec.E, A: m.sec.A, I: m.sec.I, alphaT: m.sec.alphaT, h: m.sec.h,
        hinge1: q === 0 && m.hi, hinge2: q === nSub - 1 && m.hj });
      prev = next;
    }
    m.elems = elems.slice(elems.length - nSub);
  }

  // Imperfektion (Schiefstellung) auf die Rechengeometrie
  const ymin = Math.min(...nodes.map((n) => n.y));
  const phi = opts.imperfection || 0;
  const geo = fe.map((n) => ({ x: n.x + phi * (n.y - ymin), y: n.y }));
  for (const e of elems) {
    const dx = geo[e.n2].x - geo[e.n1].x, dy = geo[e.n2].y - geo[e.n1].y, L = Math.hypot(dx, dy);
    e.Lg = L; e.cg = dx / L; e.sg = dy / L;
  }

  // Lager
  const sup = new Map();
  for (const s of p.supports || []) {
    const n = Math.round(s.node) - 1;
    if (!(n >= 0 && n < nodes.length)) continue;
    const o = sup.get(n) || { ux: false, uy: false, rz: false, kx: 0, ky: 0, kr: 0 };
    o.ux ||= !!s.ux; o.uy ||= !!s.uy; o.rz ||= !!s.rz;
    o.kx += +s.kx || 0; o.ky += +s.ky || 0; o.kr += +s.kr || 0;
    sup.set(n, o);
  }

  // Freiheitsgrade: 3 je FE-Knoten, zusätzlich je Gelenkende ein eigener Drehfreiheitsgrad
  const adj = fe.map(() => new Set());
  for (const e of elems) { adj[e.n1].add(e.n2); adj[e.n2].add(e.n1); }
  const perm = rcm(adj.map((s) => [...s]));
  const order = Array.from({ length: fe.length }, (_, i) => i).sort((a, b) => perm[a] - perm[b]);
  const rotUsed = new Uint8Array(fe.length);
  const transUsed = new Uint8Array(fe.length);
  for (const e of elems) {
    transUsed[e.n1] = transUsed[e.n2] = 1;
    if (!e.hinge1) rotUsed[e.n1] = 1;
    if (!e.hinge2) rotUsed[e.n2] = 1;
  }
  const dofOf = fe.map(() => [-1, -1, -1]);
  const hingeDofs = [];
  let nd = 0;
  const elemsAt = fe.map(() => []);
  elems.forEach((e, k) => { elemsAt[e.n1].push(k); elemsAt[e.n2].push(k); });
  for (const n of order) {
    dofOf[n] = [nd, nd + 1, nd + 2];
    nd += 3;
    for (const k of elemsAt[n]) {
      const e = elems[k];
      if (e.n1 === n && e.hinge1) { e.dof1 = nd; hingeDofs.push(nd); nd++; }
      if (e.n2 === n && e.hinge2) { e.dof2 = nd; hingeDofs.push(nd); nd++; }
    }
  }
  for (const e of elems) {
    e.dofs = [dofOf[e.n1][0], dofOf[e.n1][1], e.hinge1 ? e.dof1 : dofOf[e.n1][2], dofOf[e.n2][0], dofOf[e.n2][1], e.hinge2 ? e.dof2 : dofOf[e.n2][2]];
  }
  // Randbedingungen
  const fixed = new Uint8Array(nd);
  const springs = new Float64Array(nd);
  const warnings = [];
  fe.forEach((n, i) => {
    const d = dofOf[i];
    if (!transUsed[i]) { fixed[d[0]] = fixed[d[1]] = fixed[d[2]] = 1; if (n.user >= 0) warnings.push(`Knoten ${n.user + 1} ist mit keinem Stab verbunden.`); return; }
    const s = n.user >= 0 ? sup.get(n.user) : null;
    if (s) {
      if (s.ux) fixed[d[0]] = 1; else springs[d[0]] = s.kx;
      if (s.uy) fixed[d[1]] = 1; else springs[d[1]] = s.ky;
      if (s.rz) fixed[d[2]] = 1; else springs[d[2]] = s.kr;
    }
    if (!rotUsed[i] && !(s && (s.rz || s.kr > 0))) fixed[d[2]] = 1; // alle Stäbe gelenkig angeschlossen
  });
  for (const e of elems) e.ke = localStiffness(e);
  return { p, nodes, fe, geo, elems, members, dofOf, nd, fixed, springs, sup, warnings, nSub, phi };
}

function localStiffness(e) {
  const L = e.Lg, EA = e.E * e.A / L, EI = e.E * e.I;
  const a = 12 * EI / L ** 3, b = 6 * EI / L ** 2, c = 4 * EI / L, d = 2 * EI / L;
  return [
    [EA, 0, 0, -EA, 0, 0],
    [0, a, b, 0, -a, b],
    [0, b, c, 0, -b, d],
    [-EA, 0, 0, EA, 0, 0],
    [0, -a, -b, 0, a, -b],
    [0, b, d, 0, -b, c],
  ];
}

function geometricStiffness(L, N) {
  const f = N / L;
  return [
    [0, 0, 0, 0, 0, 0],
    [0, 1.2 * f, 0.1 * N, 0, -1.2 * f, 0.1 * N],
    [0, 0.1 * N, 2 * N * L / 15, 0, -0.1 * N, -N * L / 30],
    [0, 0, 0, 0, 0, 0],
    [0, -1.2 * f, -0.1 * N, 0, 1.2 * f, -0.1 * N],
    [0, 0.1 * N, -N * L / 30, 0, -0.1 * N, 2 * N * L / 15],
  ];
}

function toGlobal(kl, c, s) {
  // T = [[c, s, 0], [−s, c, 0], [0, 0, 1]] je Knoten; K_g = Tᵀ K_l T
  const T = [[c, s, 0, 0, 0, 0], [-s, c, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0], [0, 0, 0, c, s, 0], [0, 0, 0, -s, c, 0], [0, 0, 0, 0, 0, 1]];
  const KT = Array.from({ length: 6 }, () => new Float64Array(6));
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { let v = 0; for (let k = 0; k < 6; k++) v += kl[i][k] * T[k][j]; KT[i][j] = v; }
  const G = Array.from({ length: 6 }, () => new Float64Array(6));
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { let v = 0; for (let k = 0; k < 6; k++) v += T[k][i] * KT[k][j]; G[i][j] = v; }
  return G;
}

const vecToGlobal = (f, c, s) => [c * f[0] - s * f[1], s * f[0] + c * f[1], f[2], c * f[3] - s * f[4], s * f[3] + c * f[4], f[5]];
const vecToLocal = (g, c, s) => [c * g[0] + s * g[1], -s * g[0] + c * g[1], g[2], c * g[3] + s * g[4], -s * g[3] + c * g[4], g[5]];

// ------------------------------------------------------------------ Lasten

/**
 * Lokale Elementlasten aus einem Lastfall bzw. einer Kombination (Liste [{lc, f}]).
 * Ergebnis: je Element {dist:[{a,b,px1,px2,py1,py2}], pts:[{a,px,py,m}], kT, eT} (Element-lokal, a/b ab Elementanfang),
 * sowie Knotenlasten (global) und vorgeschriebene Verschiebungen.
 */
export function collectLoads(model, parts) {
  const { p, elems, members } = model;
  const el = elems.map(() => ({ dist: [], pts: [], kT: 0, eT: 0 }));
  const nodal = new Map();
  const presc = new Map();
  let sumFx = 0, sumFy = 0;
  const addNodal = (n, fx, fy, m) => {
    const o = nodal.get(n) || [0, 0, 0];
    o[0] += fx; o[1] += fy; o[2] += m;
    nodal.set(n, o);
  };
  // Verteilte Last auf Stab (Stabkoordinaten s ∈ [s1,s2]) auf Teilelemente verteilen.
  // Globale Lastrichtungen werden mit der Rechengeometrie des Teilelements (inkl. Schiefstellung) transformiert,
  // damit die Lastresultierende ihre Richtung behält.
  const distOnMember = (m, s1, s2, q1, q2, dir) => {
    if (s2 <= s1) return;
    const at = (s) => q1 + (s - s1) / (s2 - s1) * (q2 - q1);
    for (const e of m.elems) {
      const a = Math.max(s1, e.a), b = Math.min(s2, e.a + e.L);
      if (b - a <= 1e-12) continue;
      const geo = { c: e.cg, s: e.sg, cProj: m.c };
      const [ax, ay] = dirToLocal(dir, at(a), geo), [bx, by] = dirToLocal(dir, at(b), geo);
      el[elems.indexOf(e)].dist.push({ a: a - e.a, b: b - e.a, px1: ax, py1: ay, px2: bx, py2: by });
    }
  };
  for (const { lc, f } of parts) {
    if (!f) continue;
    if (lc.selfWeight) {
      for (const m of members) {
        const q = m.sec.gamma * m.sec.A * f; // nach unten, je Stablänge
        distOnMember(m, 0, m.L, q, q, 'g');
        sumFy -= q * m.L;
      }
    }
    for (const l of lc.nodal || []) {
      const n = Math.round(l.node) - 1;
      if (!(n >= 0 && n < model.nodes.length)) throw new Error(`Knotenlast auf nicht vorhandenen Knoten ${l.node}.`);
      addNodal(n, (+l.fx || 0) * f, (+l.fy || 0) * f, (+l.m || 0) * f);
      sumFx += (+l.fx || 0) * f; sumFy += (+l.fy || 0) * f;
    }
    for (const l of lc.dist || []) {
      const m = members[Math.round(l.member) - 1];
      if (!m) throw new Error(`Stablast auf nicht vorhandenen Stab ${l.member}.`);
      const s1 = l.a !== undefined && l.a !== null && l.a !== '' ? Math.max(0, +l.a) : 0;
      const s2 = l.b !== undefined && l.b !== null && l.b !== '' && +l.b > 0 ? Math.min(m.L, +l.b) : m.L;
      const q1 = (+l.q1 || 0) * f, q2 = (l.q2 === undefined || l.q2 === null || l.q2 === '' ? +l.q1 || 0 : +l.q2) * f;
      distOnMember(m, s1, s2, q1, q2, l.dir);
      const R = (q1 + q2) / 2 * (s2 - s1);
      const [gx, gy] = dirToGlobal(l.dir, R, m);
      sumFx += gx; sumFy += gy;
    }
    for (const l of lc.point || []) {
      const m = members[Math.round(l.member) - 1];
      if (!m) throw new Error(`Einzellast auf nicht vorhandenen Stab ${l.member}.`);
      const s = Math.min(m.L, Math.max(0, +l.a || 0));
      const P = (+l.P || 0) * f;
      const mm = (+l.m || 0) * f;
      const e = m.elems.find((q) => s >= q.a - 1e-12 && s <= q.a + q.L + 1e-12);
      const [px, py] = dirToLocal(l.dir === 'gp' ? 'g' : l.dir, P, { c: e.cg, s: e.sg, cProj: m.c });
      el[elems.indexOf(e)].pts.push({ a: s - e.a, px, py, m: mm });
      const [gx, gy] = dirToGlobal(l.dir === 'gp' ? 'g' : l.dir, P, m);
      sumFx += gx; sumFy += gy;
    }
    for (const l of lc.temp || []) {
      const m = members[Math.round(l.member) - 1];
      if (!m) throw new Error(`Temperaturlast auf nicht vorhandenen Stab ${l.member}.`);
      for (const e of m.elems) {
        const o = el[elems.indexOf(e)];
        o.eT += m.sec.alphaT * (+l.dT || 0) * f;
        o.kT += m.sec.h > 0 ? m.sec.alphaT * (+l.dTg || 0) / m.sec.h * f : 0;
      }
    }
    for (const l of lc.settle || []) {
      const n = Math.round(l.node) - 1;
      if (!(n >= 0 && n < model.nodes.length)) continue;
      const d = model.dofOf[n];
      const o = presc.get(n) || [0, 0, 0];
      o[0] += (+l.ux || 0) / 1000 * f; o[1] += (+l.uy || 0) / 1000 * f; o[2] += (+l.rz || 0) / 1000 * f;
      presc.set(n, o);
      void d;
    }
  }
  return { el, nodal, presc, sumFx, sumFy };
}

/** Lastwert q in Richtung dir → lokale Komponenten (px, py) für Orientierung g = {c, s, cProj}. */
function dirToLocal(dir, q, g) {
  switch (dir) {
    case 'x': return [q * g.c, -q * g.s];
    case 'n': return [0, -q];
    case 'l': return [q, 0];
    case 'gp': { const qq = q * Math.abs(g.cProj ?? g.c); return [-qq * g.s, -qq * g.c]; }
    default: return [-q * g.s, -q * g.c]; // vertikal nach unten: global (0, −q)
  }
}

function dirToGlobal(dir, R, m) {
  switch (dir) {
    case 'x': return [R, 0];
    case 'n': return [R * m.s, -R * m.c];
    case 'l': return [R * m.c, R * m.s];
    case 'gp': return [0, -R * Math.abs(m.c)];
    default: return [0, -R];
  }
}

// Hermite-Formfunktionen (lokal), ξ = x/L
function shape(x, L) {
  const t = x / L;
  return {
    u: [1 - t, t],
    v: [1 - 3 * t * t + 2 * t ** 3, L * (t - 2 * t * t + t ** 3), 3 * t * t - 2 * t ** 3, L * (-t * t + t ** 3)],
    dv: [(-6 * t + 6 * t * t) / L, 1 - 4 * t + 3 * t * t, (6 * t - 6 * t * t) / L, -2 * t + 3 * t * t],
  };
}

/** Äquivalente Knotenlasten (lokal) eines Elements. */
function equivalentLoads(e, ld) {
  const P = new Float64Array(6);
  const L = e.Lg;
  for (const d of ld.dist) {
    const len = d.b - d.a;
    for (let g = 0; g < G3[0].length; g++) {
      const t = (G3[0][g] + 1) / 2, w = G3[1][g] / 2 * len;
      const x = d.a + t * len;
      const px = d.px1 + t * (d.px2 - d.px1), py = d.py1 + t * (d.py2 - d.py1);
      const N = shape(x * L / e.L, L);
      P[0] += N.u[0] * px * w; P[3] += N.u[1] * px * w;
      P[1] += N.v[0] * py * w; P[2] += N.v[1] * py * w; P[4] += N.v[2] * py * w; P[5] += N.v[3] * py * w;
    }
  }
  for (const pt of ld.pts) {
    const N = shape(pt.a * L / e.L, L);
    P[0] += N.u[0] * pt.px; P[3] += N.u[1] * pt.px;
    P[1] += N.v[0] * pt.py; P[2] += N.v[1] * pt.py; P[4] += N.v[2] * pt.py; P[5] += N.v[3] * pt.py;
    P[1] += N.dv[0] * pt.m; P[2] += N.dv[1] * pt.m; P[4] += N.dv[2] * pt.m; P[5] += N.dv[3] * pt.m;
  }
  if (ld.eT) { const f = e.E * e.A * ld.eT; P[0] -= f; P[3] += f; }
  if (ld.kT) { const f = e.E * e.I * ld.kT; P[2] -= f; P[5] += f; }
  return P;
}

// ------------------------------------------------------------------ Lösung

/**
 * Löst das System für eine Liste von Lastzuständen.
 * cases: [{parts: [{lc, f}]}]; opts.secondOrder → iterativ mit geometrischer Steifigkeit.
 */
export function solveCases(model, cases, opts = {}) {
  return cases.map((cs) => solveOne(model, cs.parts, opts));
}

function assemble(model, Nel) {
  const { elems, nd, fixed, springs } = model;
  const K = SkylineMatrix.fromElements(nd, elems.map((e) => e.dofs.filter((d) => !fixed[d])));
  const kGlob = [];
  for (let k = 0; k < elems.length; k++) {
    const e = elems[k];
    let kl = e.ke;
    if (Nel) {
      const kg = geometricStiffness(e.Lg, Nel[k]);
      kl = kl.map((r, i) => r.map((v, j) => v + kg[i][j]));
    }
    const kg = toGlobal(kl, e.cg, e.sg);
    kGlob.push(kg);
    const d = e.dofs.map((x) => (fixed[x] ? -1 : x));
    K.assemble(kg, d);
  }
  for (let i = 0; i < nd; i++) if (!fixed[i] && springs[i] > 0) K.add(i, i, springs[i]);
  return { K, kGlob };
}

function solveOne(model, parts, opts) {
  const { elems, nd, fixed, dofOf, fe } = model;
  const loads = collectLoads(model, parts);
  const Peq = elems.map((e, k) => equivalentLoads(e, loads.el[k]));
  const F = new Float64Array(nd);
  for (const [n, v] of loads.nodal) { const d = dofOf[n]; F[d[0]] += v[0]; F[d[1]] += v[1]; F[d[2]] += v[2]; }
  elems.forEach((e, k) => {
    const g = vecToGlobal(Peq[k], e.cg, e.sg);
    e.dofs.forEach((d, i) => { F[d] += g[i]; });
  });
  const dPre = new Float64Array(nd);
  for (const [n, v] of loads.presc) {
    const d = dofOf[n];
    for (let i = 0; i < 3; i++) if (v[i]) {
      if (!fixed[d[i]]) throw new Error(`Lagerverschiebung an Knoten ${n + 1}: Freiheitsgrad ist nicht gelagert.`);
      dPre[d[i]] = v[i];
    }
  }
  let Nel = null, u = null, iter = 0, kGlob = null, converged = true, negPivots = 0;
  const maxIter = opts.secondOrder ? 40 : 1;
  for (iter = 0; iter < maxIter; iter++) {
    const as = assemble(model, Nel);
    kGlob = as.kGlob;
    const rhs = Float64Array.from(F);
    // vorgeschriebene Verschiebungen
    elems.forEach((e, k) => {
      const dp = e.dofs.map((d) => dPre[d]);
      if (!dp.some((v) => v)) return;
      for (let i = 0; i < 6; i++) {
        if (fixed[e.dofs[i]]) continue;
        let s = 0;
        for (let j = 0; j < 6; j++) s += kGlob[k][i][j] * dp[j];
        rhs[e.dofs[i]] -= s;
      }
    });
    for (let i = 0; i < nd; i++) if (fixed[i]) rhs[i] = 0;
    // feste Freiheitsgrade: Einheitsdiagonale
    for (let i = 0; i < nd; i++) if (fixed[i]) as.K.add(i, i, 1);
    try {
      as.K.factor();
    } catch (err) {
      if (err instanceof SingularError) throw new Error(mechanismMessage(model, err.index));
      throw err;
    }
    negPivots = as.K.negativePivots;
    if (opts.secondOrder && negPivots > 0) {
      throw new Error('Stabilitätsversagen nach Theorie 2. Ordnung: Die Belastung liegt über der kritischen Last (Steifigkeitsmatrix nicht mehr positiv definit).');
    }
    if (!opts.secondOrder && negPivots > 0) throw new Error(mechanismMessage(model, -1));
    u = as.K.solve(rhs);
    for (let i = 0; i < nd; i++) if (fixed[i]) u[i] = dPre[i];
    if (!opts.secondOrder) break;
    const Nnew = elems.map((e, k) => {
      const dl = vecToLocal(e.dofs.map((d) => u[d]), e.cg, e.sg);
      const kl = Nel ? e.ke.map((r, i) => r.map((v, j) => v + geometricStiffness(e.Lg, Nel[k])[i][j])) : e.ke;
      let f0 = 0, f3 = 0;
      for (let j = 0; j < 6; j++) { f0 += kl[0][j] * dl[j]; f3 += kl[3][j] * dl[j]; }
      return (-(f0 - Peq[k][0]) + (f3 - Peq[k][3])) / 2; // mittlere Normalkraft im Element
    });
    let dmax = 0, nmax = 1;
    for (let k = 0; k < elems.length; k++) { dmax = Math.max(dmax, Math.abs(Nnew[k] - (Nel ? Nel[k] : 0))); nmax = Math.max(nmax, Math.abs(Nnew[k])); }
    Nel = Nnew;
    if (iter > 0 && dmax < 1e-6 * nmax) break;
    if (iter === maxIter - 1) converged = false;
  }

  // Elementendkräfte (lokal) und Knotenreaktionen
  const elRes = elems.map((e, k) => {
    const dl = vecToLocal(e.dofs.map((d) => u[d]), e.cg, e.sg);
    const kl = Nel ? e.ke.map((r, i) => r.map((v, j) => v + geometricStiffness(e.Lg, Nel[k])[i][j])) : e.ke;
    const Fl = new Float64Array(6);
    for (let i = 0; i < 6; i++) { let s = 0; for (let j = 0; j < 6; j++) s += kl[i][j] * dl[j]; Fl[i] = s - Peq[k][i]; }
    return { dl, F: Fl, N2: Nel ? Nel[k] : 0, loads: loads.el[k] };
  });
  // Reaktionen = Σ Elementendkräfte (global) − äussere Knotenlasten, an gelagerten bzw. gefederten Freiheitsgraden
  const R = new Float64Array(nd);
  elems.forEach((e, k) => {
    const g = vecToGlobal(elRes[k].F, e.cg, e.sg);
    e.dofs.forEach((d, i) => { R[d] += g[i]; });
  });
  for (const [n, v] of loads.nodal) { const d = dofOf[n]; R[d[0]] -= v[0]; R[d[1]] -= v[1]; R[d[2]] -= v[2]; }
  const reactions = [];
  for (const [n, s] of model.sup) {
    const d = dofOf[n];
    const rx = s.ux || s.kx > 0 ? R[d[0]] : 0, ry = s.uy || s.ky > 0 ? R[d[1]] : 0, rm = s.rz || s.kr > 0 ? R[d[2]] : 0;
    reactions.push({ node: n, Rx: rx, Ry: ry, M: rm });
  }
  reactions.sort((a, b) => a.node - b.node);
  const disp = model.nodes.map((n, i) => { const d = dofOf[i]; return [u[d[0]], u[d[1]], u[d[2]]]; });
  const res = { u, disp, elRes, reactions, sumFx: loads.sumFx, sumFy: loads.sumFy, iter: iter + 1, converged, secondOrder: !!opts.secondOrder, Nel };
  res.members = opts.noMembers ? null : model.members.map((m, k) => memberResults(model, res, m, opts.xs?.[k]));
  res.sumRx = reactions.reduce((s, r) => s + r.Rx, 0);
  res.sumRy = reactions.reduce((s, r) => s + r.Ry, 0);
  void fe;
  return res;
}

function mechanismMessage(model, dof) {
  if (dof >= 0) {
    for (let n = 0; n < model.fe.length; n++) {
      const d = model.dofOf[n];
      const k = d.indexOf(dof);
      if (k >= 0) {
        const fe = model.fe[n];
        const where = fe.user >= 0 ? `Knoten ${fe.user + 1}` : `Stab ${fe.member + 1} (Zwischenpunkt)`;
        return `Das System ist kinematisch (verschieblich): ${where}, Richtung ${['x', 'y', 'φ'][k]}. Lagerung und Gelenke prüfen.`;
      }
    }
    for (const e of model.elems) if (e.dof1 === dof || e.dof2 === dof) return `Das System ist kinematisch: Gelenk an Stab ${e.m + 1}. Gelenke prüfen.`;
  }
  return 'Das System ist kinematisch (verschieblich). Lagerung und Gelenke prüfen.';
}

// ------------------------------------------------------------------ Schnittgrössen entlang der Stäbe

function loadIntegrals(ld, x) {
  // ∫0^x px, ∫0^x py, ∫0^x (x−ξ)·py, Einzellasten und -momente links von x
  let ipx = 0, ipy = 0, impy = 0;
  for (const d of ld.dist) {
    const b = Math.min(d.b, x);
    if (b <= d.a) continue;
    const len = d.b - d.a, seg = b - d.a;
    for (let g = 0; g < G3[0].length; g++) {
      const t = (G3[0][g] + 1) / 2, w = G3[1][g] / 2 * seg;
      const xi = d.a + t * seg;
      const r = (xi - d.a) / len;
      const px = d.px1 + r * (d.px2 - d.px1), py = d.py1 + r * (d.py2 - d.py1);
      ipx += px * w; ipy += py * w; impy += (x - xi) * py * w;
    }
  }
  for (const p of ld.pts) {
    if (p.a < x - 1e-12) { ipx += p.px; ipy += p.py; impy += (x - p.a) * p.py - p.m; }
  }
  return { ipx, ipy, impy };
}

/** Schnittgrössen im Element an der Stelle x (0…e.L). */
function elementForces(e, er, x, secondOrder) {
  const F = er.F;
  const li = loadIntegrals(er.loads, x);
  const N = -F[0] - li.ipx;
  const V = F[1] + li.ipy;
  let M = -F[2] + x * F[1] + li.impy;
  if (secondOrder) {
    const sh = shape(x * e.Lg / e.L, e.Lg);
    const v = sh.v[0] * er.dl[1] + sh.v[1] * er.dl[2] + sh.v[2] * er.dl[4] + sh.v[3] * er.dl[5];
    M += er.N2 * (v - er.dl[1]);
  }
  return { N, V, M };
}

/** Standard-Auswertestellen eines Stabes (Stabkoordinate ab Knoten i) inkl. Lastunstetigkeiten. */
export function stationsFor(m, loadSets) {
  const xs = new Set();
  const n = 20;
  for (let q = 0; q <= n; q++) xs.add(+(m.L * q / n).toFixed(9));
  for (const { e, ld } of loadSets) {
    for (const p of ld.pts) { xs.add(+(e.a + p.a - 1e-7).toFixed(9)); xs.add(+(e.a + p.a + 1e-7).toFixed(9)); }
    for (const d of ld.dist) { xs.add(+(e.a + d.a).toFixed(9)); xs.add(+(e.a + d.b).toFixed(9)); }
  }
  return [...xs].filter((x) => x >= 0 && x <= m.L + 1e-12).map((x) => Math.min(x, m.L)).sort((a, b) => a - b);
}

function elemIndexAt(m, x) {
  for (let q = 0; q < m.elems.length; q++) if (x <= m.elems[q].a + m.elems[q].L + 1e-9) return q;
  return m.elems.length - 1;
}

function memberResults(model, res, m, xs) {
  const k0 = model.elems.indexOf(m.elems[0]);
  if (!xs) xs = stationsFor(m, m.elems.map((e, q) => ({ e, ld: res.elRes[k0 + q].loads })));
  // Verformungen je Teilelement über Krümmungsintegration: v'' = M/EI + κT mit v(0) = v1, v(L) = v2
  const defl = m.elems.map((e, q) => {
    const er = res.elRes[k0 + q];
    const g = new Set();
    for (let r = 0; r <= 16; r++) g.add(e.L * r / 16);
    for (const x of xs) if (x > e.a && x < e.a + e.L) g.add(x - e.a);
    const grid = [...g].sort((a, b) => a - b);
    const EI = e.E * e.I;
    const kap = grid.map((x) => elementForces(e, er, x, res.secondOrder).M / EI + er.loads.kT);
    const w = [0];
    let w1 = 0, ww = 0;
    for (let r = 1; r < grid.length; r++) {
      const h = grid[r] - grid[r - 1];
      ww += w1 * h + h * h * (2 * kap[r - 1] + kap[r]) / 6;
      w1 += h * (kap[r - 1] + kap[r]) / 2;
      w.push(ww);
    }
    const dl = er.dl, wL = w[w.length - 1];
    const v = grid.map((x, r) => dl[1] + (dl[4] - dl[1] - wL) * x / e.L + w[r]);
    return { grid, v };
  });
  const st = xs.map((x) => {
    const q = elemIndexAt(m, x);
    const e = m.elems[q], er = res.elRes[k0 + q];
    const xl = Math.min(e.L, Math.max(0, x - e.a));
    const f = elementForces(e, er, xl, res.secondOrder);
    const { grid, v: vv } = defl[q];
    let r = 1;
    while (r < grid.length - 1 && grid[r] < xl) r++;
    const t = (xl - grid[r - 1]) / ((grid[r] - grid[r - 1]) || 1);
    const v = vv[r - 1] + t * (vv[r] - vv[r - 1]);
    const u = er.dl[0] + (er.dl[3] - er.dl[0]) * xl / e.L;
    return { x, ...f, u, v, ux: e.cg * u - e.sg * v, uy: e.sg * u + e.cg * v };
  });
  const ext = (key) => st.reduce((o, s) => ({ max: Math.max(o.max, s[key]), min: Math.min(o.min, s[key]) }), { max: -Infinity, min: Infinity });
  return { stations: st, N: ext('N'), V: ext('V'), M: ext('M'), uMax: Math.max(...st.map((s) => Math.hypot(s.ux, s.uy))) };
}

// ------------------------------------------------------------------ Stabilität

/**
 * Verzweigungslastfaktor α_cr für die Normalkräfte eines Lastzustandes (Unterraumiteration).
 * Rückgabe {alpha, mode (Verschiebungen je FE-Freiheitsgrad)} oder null (keine Druckkräfte).
 */
export function bucklingAnalysis(model, res) {
  const { elems, nd, fixed } = model;
  const Nel = elems.map((e, k) => (-res.elRes[k].F[0] + res.elRes[k].F[3]) / 2);
  if (!Nel.some((n) => n < -1e-6)) return null;
  const as = assemble(model, null);
  const kGlob = as.kGlob;
  for (let i = 0; i < nd; i++) if (fixed[i]) as.K.add(i, i, 1);
  as.K.factor();
  const gGlob = elems.map((e, k) => toGlobal(geometricStiffness(e.Lg, Nel[k]), e.cg, e.sg));
  const apply = (mats, x) => {
    const y = new Float64Array(nd);
    elems.forEach((e, k) => {
      const d = e.dofs;
      for (let i = 0; i < 6; i++) {
        if (fixed[d[i]]) continue;
        let s = 0;
        for (let j = 0; j < 6; j++) if (!fixed[d[j]]) s += mats[k][i][j] * x[d[j]];
        y[d[i]] += s;
      }
    });
    return y;
  };
  const springs = model.springs;
  const applyK = (x) => { const y = apply(kGlob, x); for (let i = 0; i < nd; i++) if (!fixed[i] && springs[i] > 0) y[i] += springs[i] * x[i]; return y; };
  const applyMG = (x) => apply(gGlob, x).map((v) => -v);
  const p = Math.min(8, Math.max(1, nd - fixed.reduce((a, b) => a + b, 0)));
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  let X = Array.from({ length: p }, () => { const v = new Float64Array(nd); for (let i = 0; i < nd; i++) if (!fixed[i]) v[i] = rnd(); return v; });
  let lambda = NaN, mode = null;
  for (let it = 0; it < 80; it++) {
    const Y = X.map((x) => as.K.solve(applyMG(x)).map((v, i) => (fixed[i] ? 0 : v)));
    const KY = Y.map(applyK), GY = Y.map(applyMG);
    const Kr = Y.map((yi) => KY.map((kyj) => dotv(yi, kyj)));
    const Gr = Y.map((yi) => GY.map((gyj) => dotv(yi, gyj)));
    for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) { const a = (Kr[i][j] + Kr[j][i]) / 2; Kr[i][j] = Kr[j][i] = a; const b = (Gr[i][j] + Gr[j][i]) / 2; Gr[i][j] = Gr[j][i] = b; }
    let eg;
    try { eg = eigGeneral(Gr, Kr); } catch { break; }
    // grösstes positives ν ↔ kleinstes λ = 1/ν
    let best = -1;
    for (let i = 0; i < p; i++) if (eg.values[i] > 1e-14 && (best < 0 || eg.values[i] > eg.values[best])) best = i;
    if (best < 0) return null;
    const lamNew = 1 / eg.values[best];
    X = eg.vectors.map((q) => { const v = new Float64Array(nd); for (let j = 0; j < p; j++) for (let i = 0; i < nd; i++) v[i] += q[j] * Y[j][i]; const n = Math.sqrt(dotv(v, v)) || 1; return v.map((t) => t / n); });
    mode = X[best];
    const conv = Number.isFinite(lambda) && Math.abs(lamNew - lambda) < 1e-7 * Math.abs(lamNew);
    lambda = lamNew;
    if (conv && it > 3) break;
  }
  if (!Number.isFinite(lambda)) return null;
  // Modus normieren (max. Verschiebung = 1)
  let mx = 0;
  model.fe.forEach((n, i) => { const d = model.dofOf[i]; mx = Math.max(mx, Math.hypot(mode[d[0]], mode[d[1]])); });
  const modeN = mode.map((v) => v / (mx || 1));
  // Knicklängen der gedrückten Stäbe
  const lcr = model.members.map((m) => {
    const N = Math.min(...m.elems.map((e) => Nel[elems.indexOf(e)]));
    if (N >= -1e-6) return null;
    const Ncr = lambda * -N;
    return { N, Ncr, Lcr: Math.PI * Math.sqrt(m.sec.E * m.sec.I / Ncr), beta: Math.PI * Math.sqrt(m.sec.E * m.sec.I / Ncr) / m.L };
  });
  return { alpha: lambda, mode: modeN, lcr };
}

function dotv(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// ------------------------------------------------------------------ Gesamtberechnung

/** Kombiniert Stabergebnisse linear (Theorie 1. Ordnung). */
function superpose(results, factors, model) {
  const out = { members: [], reactions: [], disp: [], sumFx: 0, sumFy: 0, sumRx: 0, sumRy: 0, secondOrder: false, superposed: true };
  const used = factors.map((f, i) => [f, results[i]]).filter(([f]) => f);
  out.disp = model.nodes.map((_, n) => [0, 1, 2].map((c) => used.reduce((s, [f, r]) => s + f * r.disp[n][c], 0)));
  out.members = model.members.map((m, k) => {
    const base = results[0].members[k].stations;
    const st = base.map((s, i) => {
      const o = { x: s.x, N: 0, V: 0, M: 0, ux: 0, uy: 0 };
      for (const [f, r] of used) { const t = r.members[k].stations[i]; o.N += f * t.N; o.V += f * t.V; o.M += f * t.M; o.ux += f * t.ux; o.uy += f * t.uy; }
      return o;
    });
    const ext = (key) => st.reduce((o, s) => ({ max: Math.max(o.max, s[key]), min: Math.min(o.min, s[key]) }), { max: -Infinity, min: Infinity });
    return { stations: st, N: ext('N'), V: ext('V'), M: ext('M'), uMax: Math.max(...st.map((s) => Math.hypot(s.ux, s.uy))) };
  });
  out.reactions = results[0].reactions.map((r0, i) => {
    const o = { node: r0.node, Rx: 0, Ry: 0, M: 0 };
    for (const [f, r] of used) { o.Rx += f * r.reactions[i].Rx; o.Ry += f * r.reactions[i].Ry; o.M += f * r.reactions[i].M; }
    return o;
  });
  for (const [f, r] of used) { out.sumFx += f * r.sumFx; out.sumFy += f * r.sumFy; }
  out.sumRx = out.reactions.reduce((s, r) => s + r.Rx, 0);
  out.sumRy = out.reactions.reduce((s, r) => s + r.Ry, 0);
  // Elementkräfte für Knickberechnung
  out.elRes = results[0].elRes.map((er, k) => ({ F: Float64Array.from({ length: 6 }, (_, i) => used.reduce((s, [f, r]) => s + f * r.elRes[k].F[i], 0)) }));
  return out;
}

/**
 * Vollständige Berechnung eines Projekts.
 * p.analysis: {secondOrder, imperfection (1/x, 0 = keine), buckling, nSub}
 */
export function analyze(p) {
  const an = p.analysis || {};
  if (!p.loadCases?.length) throw new Error('Mindestens ein Lastfall erforderlich.');
  const model1 = buildModel(p, { nSub: 1 });
  const lcRaw = p.loadCases.map((lc) => solveOne(model1, [{ lc, f: 1 }], { noMembers: true }));
  // gemeinsame Auswertestellen aller Lastfälle (für Überlagerung und Umhüllende)
  const xs = model1.members.map((m, k) => stationsFor(m, lcRaw.map((r) => ({ e: model1.elems[k], ld: r.elRes[k].loads }))));
  const lcResults = lcRaw.map((r) => { r.members = model1.members.map((m, k) => memberResults(model1, r, m, xs[k])); return r; });
  const combos = (p.combinations || []).filter((c) => c.factors?.some((f) => +f));
  const needSub = an.secondOrder || an.buckling;
  const nSub = Math.max(1, Math.round(an.nSub || 4));
  const modelS = needSub ? buildModel(p, { nSub }) : null;
  const phi = an.secondOrder && an.imperfection > 0 ? 1 / an.imperfection : 0;
  const modelImp = an.secondOrder && phi ? buildModel(p, { nSub, imperfection: phi }) : modelS;
  const comboResults = combos.map((c) => {
    const parts = p.loadCases.map((lc, i) => ({ lc, f: +c.factors[i] || 0 }));
    const lin = superpose(lcResults, p.loadCases.map((_, i) => +c.factors[i] || 0), model1);
    const out = { name: c.name, type: c.type, lin, res: lin };
    if (an.secondOrder && c.type === 'GZT') {
      try {
        const r2 = solveOne(modelImp, parts, { secondOrder: true, xs });
        out.res = r2;
        const m1 = Math.max(...lin.members.map((m) => Math.max(Math.abs(m.M.max), Math.abs(m.M.min))));
        const m2 = Math.max(...r2.members.map((m) => Math.max(Math.abs(m.M.max), Math.abs(m.M.min))));
        out.amplification = m1 > 1e-9 ? m2 / m1 : 1;
      } catch (e) {
        out.error = e.message;
      }
    }
    if (an.buckling && c.type === 'GZT') {
      try {
        const r1 = solveOne(modelS, parts, { noMembers: true });
        out.buckling = bucklingAnalysis(modelS, r1);
      } catch (e) {
        out.bucklingError = e.message;
      }
    }
    return out;
  });
  // Umhüllende über GZT-Kombinationen
  const uls = comboResults.filter((c) => c.type === 'GZT' && !c.error);
  let envelope = null;
  if (uls.length) {
    envelope = model1.members.map((m, k) => {
      const st0 = uls[0].lin.members[k].stations;
      return st0.map((s, i) => {
        const o = { x: s.x, Nmax: -Infinity, Nmin: Infinity, Vmax: -Infinity, Vmin: Infinity, Mmax: -Infinity, Mmin: Infinity };
        for (const c of uls) {
          const t = c.res.members[k].stations[i];
          o.Nmax = Math.max(o.Nmax, t.N); o.Nmin = Math.min(o.Nmin, t.N);
          o.Vmax = Math.max(o.Vmax, t.V); o.Vmin = Math.min(o.Vmin, t.V);
          o.Mmax = Math.max(o.Mmax, t.M); o.Mmin = Math.min(o.Mmin, t.M);
        }
        return o;
      });
    });
  }
  return { model: model1, modelS, lc: lcResults, combos: comboResults, envelope, warnings: model1.warnings };
}

/** Ergebnis eines Auswahlschlüssels ('lc:0', 'co:2', 'env'). */
export function pickResult(results, key) {
  if (!results) return null;
  const [t, i] = String(key || '').split(':');
  if (t === 'lc') return results.lc[+i] || null;
  if (t === 'co') { const c = results.combos[+i]; return c ? c.res : null; }
  return null;
}

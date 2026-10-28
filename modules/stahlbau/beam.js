// Träger mit Lasten: Statisches System, Lastfälle, Kombinationen, Schnittgrössen und Durchbiegungen (DOM-frei)
//
// Lineare Stabstatik (Euler-Bernoulli) mit Hermite-Elementen, getrennt für Lasten in z (→ My, Vz, wz)
// und in y (→ Mz, Vy, wy). Lasten in z positiv nach unten, Momente positiv bei Zug unten (Feldmoment).
// Einheiten: m, kN, kNm; Durchbiegung in mm.
import { solve } from '../../js/core/linalg.js';
import { loadFactors } from '../../js/core/materials.js';

export const SYSTEMS = [
  { value: 'ss', label: 'Einfeldträger (gelenkig)' },
  { value: 'cant', label: 'Kragarm (links eingespannt)' },
  { value: 'ss-cant', label: 'Einfeldträger mit Kragarm' },
  { value: 'cont', label: 'Durchlaufträger' },
  { value: 'fix-pin', label: 'Eingespannt – gelenkig' },
  { value: 'fix-fix', label: 'Beidseitig eingespannt' },
];

export const CATEGORIES = [
  { value: 'G', label: 'Ständig (G)' },
  { value: 'Nutzlast', label: 'Nutzlast (Q)' },
  { value: 'Schnee', label: 'Schnee (Q)' },
  { value: 'Wind', label: 'Wind (Q)' },
];

/** Geometrie des Systems: Gesamtlänge, Auflager, Felder. */
export function systemGeometry(beam) {
  const sys = beam.system || 'ss';
  const spans = (beam.spans || [6]).map(Number).filter((v) => v > 0);
  if (!spans.length) throw new Error('Bitte eine Spannweite grösser als 0 eingeben (Register «Belastung»).');
  const sup = [], fields = [];
  let L;
  const push = (x0, x1, cant = false) => fields.push({ x0, x1, L: x1 - x0, cant });
  switch (sys) {
    case 'cant': L = spans[0]; sup.push({ x: 0, type: 'fix' }); push(0, L, true); break;
    case 'ss-cant': {
      const a = Number(beam.overhang) || 0;
      if (!(a > 0)) throw new Error('Einfeldträger mit Kragarm: Bitte eine Kraglänge grösser als 0 eingeben.');
      L = spans[0] + a; sup.push({ x: 0, type: 'pin' }, { x: spans[0], type: 'pin' }); push(0, spans[0]); push(spans[0], L, true); break;
    }
    case 'cont': {
      if (spans.length < 2) throw new Error('Durchlaufträger: Bitte mindestens zwei Felder eingeben.');
      let x = 0; sup.push({ x: 0, type: 'pin' });
      for (const s of spans) { push(x, x + s); x += s; sup.push({ x, type: 'pin' }); }
      L = x; break;
    }
    case 'fix-pin': L = spans[0]; sup.push({ x: 0, type: 'fix' }, { x: L, type: 'pin' }); push(0, L); break;
    case 'fix-fix': L = spans[0]; sup.push({ x: 0, type: 'fix' }, { x: L, type: 'fix' }); push(0, L); break;
    default: L = spans[0]; sup.push({ x: 0, type: 'pin' }, { x: L, type: 'pin' }); push(0, L);
  }
  const freeEnds = [];
  if (!sup.some((s) => Math.abs(s.x) < 1e-9)) freeEnds.push(0);
  if (!sup.some((s) => Math.abs(s.x - L) < 1e-9)) freeEnds.push(L);
  return { system: sys, L, supports: sup, fields, freeEnds };
}

/** Normierte Last (fehlende Werte ergänzt). */
export function normLoad(ld, L) {
  // kind: 'qz' | 'Pz' | 'qy' | 'Py' | 'N' (kompakte Form aus der Eingabetabelle) oder type/dir
  const kind = ld.kind;
  const type = kind ? (kind === 'N' ? 'N' : kind[0]) : (ld.type || 'q');
  const dirK = kind ? (kind[1] === 'y' ? 'y' : 'z') : ld.dir;
  const x1 = Number.isFinite(ld.x1) ? ld.x1 : (type === 'P' ? L / 2 : 0);
  const x2 = Number.isFinite(ld.x2) ? ld.x2 : L;
  const v1 = Number(ld.v1) || 0;
  const v2 = Number.isFinite(ld.v2) ? ld.v2 : v1;
  return { ...ld, type, dir: dirK === 'y' ? 'y' : 'z', v1, v2, x1: Math.max(0, Math.min(L, x1)), x2: Math.max(0, Math.min(L, x2)) };
}

// ------------------------------------------------------------------ Kombinationen

/**
 * Kombinationen nach SIA 260 / EN 1990 (Grundkombination Typ 2 bzw. STR, Gebrauchstauglichkeit).
 * lcs: [{id, name, cat}], f: {gG, gGinf, gQ, psi:{cat:[ψ0,ψ1,ψ2]}}, opts.pattern: Begleitlasten einzeln weglassen.
 */
export function autoCombos(lcs, f, opts = {}) {
  const G = lcs.filter((l) => l.cat === 'G');
  const Q = lcs.filter((l) => l.cat !== 'G');
  const psi = (l, i) => (f.psi[l.cat] || [0.7, 0.5, 0.3])[i];
  const out = [];
  const label = (fac) => Object.entries(fac).filter(([, v]) => v).map(([id, v]) => `${fmtF(v)}·${lcs.find((l) => l.id === id)?.name || id}`).join(' + ');
  const gVariants = opts.pattern ? [f.gG, f.gGinf] : [f.gG];
  let n = 0;
  for (const gG of gVariants) {
    const base = Object.fromEntries(G.map((l) => [l.id, gG]));
    if (!Q.length) { out.push({ id: `U${++n}`, type: 'ULS', factors: { ...base } }); continue; }
    for (const lead of Q) {
      const others = Q.filter((l) => l !== lead);
      const subsets = opts.pattern && others.length <= 3 ? powerset(others) : [others];
      for (const sub of subsets) {
        const fac = { ...base, [lead.id]: f.gQ };
        for (const o of sub) fac[o.id] = f.gQ * psi(o, 0);
        out.push({ id: `U${++n}`, type: 'ULS', factors: fac });
      }
    }
  }
  // Gebrauchstauglichkeit
  const gBase = Object.fromEntries(G.map((l) => [l.id, 1]));
  if (Q.length) {
    for (const lead of Q) {
      const fac = { ...gBase, [lead.id]: 1 };
      for (const o of Q) if (o !== lead) fac[o.id] = psi(o, 0);
      out.push({ id: `C${out.filter((c) => c.type === 'SLS-char').length + 1}`, type: 'SLS-char', factors: fac });
    }
  } else out.push({ id: 'C1', type: 'SLS-char', factors: { ...gBase } });
  const qp = { ...gBase };
  for (const o of Q) qp[o.id] = psi(o, 2);
  out.push({ id: 'Q1', type: 'SLS-qp', factors: qp });
  // doppelte entfernen
  const seen = new Set();
  const uniq = out.filter((c) => { const k = c.type + JSON.stringify(Object.entries(c.factors).filter(([, v]) => v).sort()); if (seen.has(k)) return false; seen.add(k); return true; });
  let u = 0, c = 0;
  for (const cb of uniq) {
    cb.id = cb.type === 'ULS' ? `U${++u}` : cb.type === 'SLS-char' ? `C${++c}` : 'QS';
    cb.name = `${cb.type === 'ULS' ? 'Tragsicherheit' : cb.type === 'SLS-char' ? 'Gebrauch charakt.' : 'Gebrauch quasi-ständig'}: ${label(cb.factors) || '–'}`;
  }
  return uniq;
}

function powerset(arr) {
  const res = [[]];
  for (const a of arr) { const n = res.length; for (let i = 0; i < n; i++) res.push([...res[i], a]); }
  return res;
}
function fmtF(v) { return String(+v.toFixed(3)); }

export function defaultFactors(norm) {
  const lf = loadFactors(norm === 'EC' ? 'EC' : 'SIA');
  return { gG: lf.gG, gGinf: lf.gGinf, gQ: lf.gQ, psi: JSON.parse(JSON.stringify(lf.psi)) };
}

// ------------------------------------------------------------------ Stabstatik

/**
 * Analysiert alle Lastfälle für ein System.
 * beam: {system, spans, overhang}, loads: normierte Lasten mit lc-Zuordnung,
 * EIy, EIz [kNm²], extraNodes: zusätzliche Knoten (z.B. seitliche Halterungen)
 * Rückgabe: {geo, X (Knoten), el:[{x0,l}], lc: {id: {z:{M0,V0,qa,qb,w}, y:{…}, N}}}
 */
export function analyzeBeam(beam, lcs, loads, EIy, EIz, extraNodes = []) {
  const geo = systemGeometry(beam);
  const L = geo.L;
  // Knoten
  const xs = new Set([0, L]);
  for (const s of geo.supports) xs.add(s.x);
  for (const f of geo.fields) { const n = Math.max(8, Math.ceil(f.L / L * 60)); for (let i = 1; i < n; i++) xs.add(f.x0 + f.L * i / n); }
  for (const ld of loads) { if (ld.type === 'P') xs.add(ld.x1); if (ld.type === 'q') { xs.add(ld.x1); xs.add(ld.x2); } }
  for (const x of extraNodes) if (x >= 0 && x <= L) xs.add(x);
  let X = [...xs].sort((a, b) => a - b);
  X = X.filter((x, i) => i === 0 || x - X[i - 1] > 1e-7 * L);
  const nn = X.length, ne = nn - 1;
  const el = Array.from({ length: ne }, (_, e) => ({ x0: X[e], l: X[e + 1] - X[e] }));
  const nodeAt = (x) => { let best = 0; for (let i = 1; i < nn; i++) if (Math.abs(X[i] - x) < Math.abs(X[best] - x)) best = i; return best; };
  // Randbedingungen
  const fixed = new Set();
  for (const s of geo.supports) { const i = nodeAt(s.x); fixed.add(2 * i); if (s.type === 'fix') fixed.add(2 * i + 1); }
  const free = []; for (let i = 0; i < 2 * nn; i++) if (!fixed.has(i)) free.push(i);

  const solveDir = (EI, dirLoads) => {
    const n = 2 * nn;
    const K = Array.from({ length: n }, () => new Float64Array(n));
    const F = new Float64Array(n);
    const qa = new Float64Array(ne), qb = new Float64Array(ne);
    for (let e = 0; e < ne; e++) {
      const { x0, l } = el[e];
      const xm = x0 + l / 2;
      for (const ld of dirLoads) {
        if (ld.type !== 'q') continue;
        const a = Math.min(ld.x1, ld.x2), b = Math.max(ld.x1, ld.x2);
        if (xm < a || xm > b || b - a < 1e-9) continue;
        const at = (x) => ld.v1 + (ld.v2 - ld.v1) * (x - ld.x1) / ((ld.x2 - ld.x1) || 1);
        qa[e] += at(x0); qb[e] += at(x0 + l);
      }
      const k = EI / l ** 3;
      const ke = [[12, 6 * l, -12, 6 * l], [6 * l, 4 * l * l, -6 * l, 2 * l * l], [-12, -6 * l, 12, -6 * l], [6 * l, 2 * l * l, -6 * l, 4 * l * l]];
      const d = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) K[d[i]][d[j]] += k * ke[i][j];
      const fe = feq(qa[e], qb[e], l);
      for (let i = 0; i < 4; i++) F[d[i]] += fe[i];
    }
    for (const ld of dirLoads) if (ld.type === 'P') F[2 * nodeAt(ld.x1)] += ld.v1;
    const Kr = free.map((i) => Float64Array.from(free, (j) => K[i][j]));
    const Fr = Float64Array.from(free, (i) => F[i]);
    const ur = free.length ? solve(Kr, Fr) : new Float64Array(0);
    const u = new Float64Array(n);
    free.forEach((i, k) => { u[i] = ur[k]; });
    const M0 = new Float64Array(ne), V0 = new Float64Array(ne);
    for (let e = 0; e < ne; e++) {
      const { l } = el[e];
      const k = EI / l ** 3;
      const ke = [[12, 6 * l, -12, 6 * l], [6 * l, 4 * l * l, -6 * l, 2 * l * l]];
      const ue = [u[2 * e], u[2 * e + 1], u[2 * e + 2], u[2 * e + 3]];
      const fe = feq(qa[e], qb[e], l);
      const f0 = k * (ke[0][0] * ue[0] + ke[0][1] * ue[1] + ke[0][2] * ue[2] + ke[0][3] * ue[3]) - fe[0];
      const f1 = k * (ke[1][0] * ue[0] + ke[1][1] * ue[1] + ke[1][2] * ue[2] + ke[1][3] * ue[3]) - fe[1];
      V0[e] = -f0; M0[e] = f1;
    }
    const w = Float64Array.from({ length: nn }, (_, i) => u[2 * i] * 1000); // mm
    return { M0, V0, qa, qb, w };
  };

  const res = {};
  for (const lc of lcs) {
    const mine = loads.filter((l) => l.lc === lc.id);
    res[lc.id] = {
      z: solveDir(EIy, mine.filter((l) => l.dir === 'z' && l.type !== 'N')),
      y: solveDir(EIz, mine.filter((l) => l.dir === 'y' && l.type !== 'N')),
      N: mine.filter((l) => l.type === 'N').reduce((s, l) => s + l.v1, 0),
    };
  }
  return { geo, X, el, lc: res };
}

/** Äquivalente Knotenlasten für Trapezlast qa → qb auf Elementlänge l. */
function feq(qa, qb, l) {
  const d = qb - qa;
  return [qa * l / 2 + 3 * d * l / 20, qa * l * l / 12 + d * l * l / 30, qa * l / 2 + 7 * d * l / 20, -qa * l * l / 12 - d * l * l / 20];
}

/**
 * Überlagert Lastfälle mit Faktoren und liefert Auswertefunktionen.
 * Rückgabe {M(x), V(x, side), w[], N, stations:[{x, e, s}], q (z-Richtung)}
 */
export function combine(an, factors) {
  const ne = an.el.length;
  const sum = (dir, key) => {
    const out = new Float64Array(key === 'w' ? an.X.length : ne);
    for (const [id, f] of Object.entries(factors)) {
      if (!f || !an.lc[id]) continue;
      const src = an.lc[id][dir][key];
      for (let i = 0; i < out.length; i++) out[i] += f * src[i];
    }
    return out;
  };
  const mk = (dir) => {
    const M0 = sum(dir, 'M0'), V0 = sum(dir, 'V0'), qa = sum(dir, 'qa'), qb = sum(dir, 'qb'), w = sum(dir, 'w');
    const find = (x, side = 1) => {
      // Element mit x (bei Knoten: side > 0 → rechtes Element)
      let lo = 0, hi = ne - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (an.el[mid].x0 + an.el[mid].l < x - 1e-12) lo = mid + 1; else hi = mid; }
      let e = lo;
      if (side > 0 && e < ne - 1 && Math.abs(an.el[e].x0 + an.el[e].l - x) < 1e-9) e++;
      return e;
    };
    const evalAt = (e, s) => {
      const l = an.el[e].l, k = (qb[e] - qa[e]) / l;
      return {
        M: M0[e] + V0[e] * s - (qa[e] * s * s / 2 + k * s ** 3 / 6),
        V: V0[e] - (qa[e] * s + k * s * s / 2),
      };
    };
    return {
      M: (x, side = 1) => { const e = find(x, side); return evalAt(e, Math.max(0, Math.min(an.el[e].l, x - an.el[e].x0))).M; },
      V: (x, side = 1) => { const e = find(x, side); return evalAt(e, Math.max(0, Math.min(an.el[e].l, x - an.el[e].x0))).V; },
      q: (x) => { const e = find(x, 1); const s = Math.max(0, Math.min(an.el[e].l, x - an.el[e].x0)); return qa[e] + (qb[e] - qa[e]) * s / an.el[e].l; },
      w, evalAt, M0, V0, qa, qb,
    };
  };
  let N = 0;
  for (const [id, f] of Object.entries(factors)) if (f && an.lc[id]) N += f * an.lc[id].N;
  return { z: mk('z'), y: mk('y'), N };
}

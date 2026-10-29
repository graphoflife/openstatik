// Rechenkern des Plattenmoduls: Projekt → Netz → FE-Lösung → Kombinationen → Bemessung (DOM-frei)
import { generateMesh, nodesOnSegment, nearestNode, MeshError } from './mesh.js';
import { solvePlate, plateMoments, areaLoadVector, lineLoadVector } from './fe.js';
import {
  woodArmer, requiredAs, minReinforcement, effectiveDepths, controlPerimeter, punchingSIA, punchingEC,
  KE_SIA, BETA_EC, momentResistance, flexuralRigidity,
} from './design.js';
import { cleanPolygon, pointInPolygon, bboxOf, signedArea, distPointSeg, inDomain, inUnion, freeEdges } from './geom.js';
import { concrete, rebar, chooseBars, barAreaPerM } from '../../js/core/materials.js';

// ------------------------------------------------------------------ Stammdaten

/** Nutzungskategorien mit ψ-Beiwerten nach SIA 260 (Tab. 3) bzw. EN 1990 (Tab. A1.1). */
export const LOAD_CATEGORIES = [
  { value: 'A', label: 'A Wohnen', psi: [0.7, 0.5, 0.3] },
  { value: 'B', label: 'B Büro', psi: [0.7, 0.5, 0.3] },
  { value: 'C', label: 'C Versammlung', psi: [0.7, 0.7, 0.6] },
  { value: 'D', label: 'D Verkauf', psi: [0.7, 0.7, 0.6] },
  { value: 'E', label: 'E Lager', psi: [1.0, 0.9, 0.8] },
  { value: 'F', label: 'F Fahrzeuge ≤ 30 kN', psi: [0.7, 0.7, 0.6] },
  { value: 'G', label: 'G Fahrzeuge ≤ 160 kN', psi: [0.7, 0.5, 0.3] },
  { value: 'H', label: 'H Dächer', psi: [0, 0, 0] },
  { value: 'S', label: 'Schnee', psi: [0.6, 0.5, 0.2] },
  { value: 'W', label: 'Wind', psi: [0.6, 0.5, 0] },
  { value: 'X', label: 'frei (ψ von Hand)', psi: null },
];

export const COMBO_TYPES = [
  { value: 'ULS', label: 'Tragsicherheit' },
  { value: 'SLS', label: 'quasi-ständig' },
  { value: 'SLSf', label: 'häufig' },
  { value: 'SLSc', label: 'selten' },
];

export const comboTypeLabel = (t) => COMBO_TYPES.find((c) => c.value === t)?.label || t;

/** Steifigkeitsfaktor für Elemente im Stützenquerschnitt (starrer Stützenkopf). */
export const HEAD_FACTOR = 1000;

const num = (v, d = NaN) => (typeof v === 'number' && Number.isFinite(v) ? v : (v === null || v === undefined || v === '' ? d : (Number.isFinite(Number(v)) ? Number(v) : d)));

/** Ergänzt fehlende Felder eines Projekts mit Standardwerten (auch für ältere Dateien). */
export function withDefaults(p) {
  p = p || {};
  p.norm = p.norm === 'EC' ? 'EC' : 'SIA';
  p.h = num(p.h, 0.25);
  p.concrete = p.concrete || 'C30/37';
  // Platten: [{id, name, outline:[{x,y}], h, concrete ('' = Projektbeton)}]; ältere Dateien mit einem Umriss übernehmen
  if (!Array.isArray(p.slabs)) {
    p.slabs = [];
    if (Array.isArray(p.outline) && p.outline.length) p.slabs.push({ id: 'P1', name: 'Platte 1', outline: p.outline, h: p.h, concrete: '' });
  }
  delete p.outline;
  const usedIds = new Set();
  p.slabs.forEach((sl, i) => {
    if (!sl.id || usedIds.has(sl.id)) { let k = i + 1; while (usedIds.has(`P${k}`) || p.slabs.some((o) => o !== sl && o.id === `P${k}`)) k++; sl.id = `P${k}`; }
    usedIds.add(sl.id);
    sl.name = sl.name || `Platte ${i + 1}`;
    sl.outline = Array.isArray(sl.outline) ? sl.outline : [];
    sl.h = num(sl.h, p.h);
    sl.concrete = sl.concrete || '';
  });
  p.openings = Array.isArray(p.openings) ? p.openings : [];
  for (const o of p.openings) { o.pts = Array.isArray(o.pts) ? o.pts : []; o.name = o.name || 'Öffnung'; }
  p.nu = num(p.nu, 0.2);
  p.meshSize = num(p.meshSize, 0.5);
  p.pointSupports = Array.isArray(p.pointSupports) ? p.pointSupports : [];
  p.lineSupports = Array.isArray(p.lineSupports) ? p.lineSupports : [];
  p.loadCases = Array.isArray(p.loadCases) ? p.loadCases : [];
  p.areaLoads = Array.isArray(p.areaLoads) ? p.areaLoads : [];
  p.loadAreas = Array.isArray(p.loadAreas) ? p.loadAreas : [];
  for (const a of p.loadAreas) { a.pts = Array.isArray(a.pts) ? a.pts : []; }
  for (const al of p.areaLoads) { if (al.target && !al.region) al.region = al.target; delete al.target; al.region = al.region || 'all'; }
  p.lineLoads = Array.isArray(p.lineLoads) ? p.lineLoads : [];
  p.pointLoads = Array.isArray(p.pointLoads) ? p.pointLoads : [];
  p.combos = Array.isArray(p.combos) ? p.combos : [];
  p.autoCombos = p.autoCombos !== false;
  p.columnHeads = p.columnHeads !== false;
  p.refineColumns = p.refineColumns !== false;
  const d = p.design = { ...defaultDesign(), ...(p.design || {}) };
  if (!Array.isArray(d.basic) || d.basic.length !== 4) d.basic = defaultDesign().basic;
  return p;
}

export function defaultDesign() {
  return {
    steel: 'B500B', cBot: 30, cTop: 30, dBot: 12, dTop: 14, outerBot: 'x', outerTop: 'x',
    asMinMode: 'auto', rhoMin: 0.13,
    basic: [
      { layer: 'bx', d: 0, s: 150 }, { layer: 'by', d: 0, s: 150 },
      { layer: 'tx', d: 0, s: 150 }, { layer: 'ty', d: 0, s: 150 },
    ],
    Dmax: 32, asPunch: 0,
    creep: 3.0, limit: 300, Lspan: 0,
  };
}

/** Standardkombinationen nach SIA 260 (Gl. 4/5 bzw. 7 der Gebrauchstauglichkeit) bzw. EN 1990 (6.10, 6.16). */
export function defaultCombos(loadCases) {
  const G = loadCases.filter((l) => l.type !== 'Q');
  const Q = loadCases.filter((l) => l.type === 'Q');
  const combos = [];
  const mk = (name, type, fac) => {
    const c = { id: `K${combos.length + 1}`, name, type };
    for (const l of loadCases) c[`f_${l.id}`] = fac(l) ?? 0;
    combos.push(c);
  };
  if (!Q.length) {
    mk('GZT ständig', 'ULS', (l) => (l.type !== 'Q' ? 1.35 : 0));
  } else {
    for (const lead of Q) {
      mk(Q.length > 1 ? `GZT Leit: ${lead.name}` : 'GZT', 'ULS', (l) => (l.type !== 'Q' ? 1.35 : l === lead ? 1.5 : 1.5 * psiOf(l)[0]));
    }
  }
  mk('quasi-ständig', 'SLS', (l) => (l.type !== 'Q' ? 1.0 : psiOf(l)[2]));
  if (!G.length && !Q.length) return [];
  return combos;
}

export function psiOf(lc) {
  return [num(lc.psi0, 0.7), num(lc.psi1, 0.5), num(lc.psi2, 0.3)];
}

/** Lesbare Formel einer Kombination, z.B. «1.35·Eigengewicht + 1.50·Nutzlast». */
export function comboFormula(combo, loadCases) {
  const parts = [];
  for (const l of loadCases) {
    const f = num(combo[`f_${l.id}`], 0);
    if (f === 0) continue;
    parts.push(`${f.toFixed(2)}·${l.name || l.id}`);
  }
  return parts.length ? parts.join(' + ') : '–';
}

export function newId(prefix, list) {
  let k = list.length + 1;
  const used = new Set(list.map((x) => x.id));
  while (used.has(`${prefix}${k}`)) k++;
  return `${prefix}${k}`;
}

// ------------------------------------------------------------------ Hilfen

const ptsOf = (arr) => cleanPolygon((arr || []).map((p) => [num(p?.x), num(p?.y)]));
const validSeg = (s) => [s.x1, s.y1, s.x2, s.y2].every((v) => Number.isFinite(num(v))) && Math.hypot(num(s.x2) - num(s.x1), num(s.y2) - num(s.y1)) > 1e-6;
const validPt = (s) => Number.isFinite(num(s.x)) && Number.isFinite(num(s.y));

function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

function lin(sets, factors, key, len) {
  const out = new Float64Array(len);
  sets.forEach((s, k) => {
    const f = factors[k];
    if (!f) return;
    const a = s[key];
    for (let i = 0; i < len; i++) out[i] += f * a[i];
  });
  return out;
}

/**
 * Projektgeometrie aufbereiten (auch für die Darstellung):
 * {slabs:[{id, name, ring, h, concrete, area, idx}], outlines:[Ring], holes:[Ring], bb}
 * Nur Platten mit mindestens drei gültigen Eckpunkten zählen.
 */
export function geometryOf(p) {
  const slabs = [];
  (p.slabs || []).forEach((sl, idx) => {
    const ring = ptsOf(sl.outline);
    if (ring.length < 3) return;
    slabs.push({ id: sl.id, name: sl.name || `Platte ${idx + 1}`, ring, h: num(sl.h, num(p.h, 0.25)), concrete: sl.concrete || p.concrete || 'C30/37', ownConcrete: !!sl.concrete, area: Math.abs(signedArea(ring)), idx });
  });
  const outlines = slabs.map((s) => s.ring);
  const holes = (p.openings || []).map((o) => ptsOf(o.pts)).filter((h) => h.length >= 3);
  return { slabs, outlines, holes, bb: outlines.length ? bboxOf(outlines.flat()) : null };
}

/**
 * Massgebende Platte an einem Punkt: die kleinste Platte, die den Punkt enthält (innen liegende Platten
 * – Verstärkungen oder dünnere Bereiche – überschreiben die umgebende). Auf Rändern zwischen zwei Platten
 * (Abstand < tol) gilt die dünnere. → Index in geo.slabs oder −1
 */
export function slabIndexAt(geo, x, y, tol = 0) {
  let best = -1;
  for (let k = 0; k < geo.slabs.length; k++) {
    const s = geo.slabs[k];
    const inside = pointInPolygon(x, y, s.ring) || (tol > 0 && ringDist(x, y, s.ring) < tol);
    if (!inside) continue;
    if (best < 0) { best = k; continue; }
    const b = geo.slabs[best];
    const onEdge = tol > 0 && (ringDist(x, y, s.ring) < tol || ringDist(x, y, b.ring) < tol);
    if (onEdge ? s.h < b.h : s.area < b.area - 1e-12) best = k;
  }
  return best;
}

function ringDist(x, y, ring) {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    d = Math.min(d, distPointSeg(x, y, a[0], a[1], b[0], b[1]).d);
  }
  return d;
}

/** Nettofläche der Plattenvereinigung (innen liegende Platten zählen nicht doppelt). */
export function netArea(geo) {
  let A = 0;
  for (const s of geo.slabs) {
    const c = polygonCentroidOf(s.ring);
    if (!geo.slabs.some((o) => o !== s && o.area > s.area && pointInPolygon(c[0], c[1], o.ring))) A += s.area;
  }
  for (const h of geo.holes) A -= Math.abs(signedArea(h));
  return A;
}

function polygonCentroidOf(r) {
  let sx = 0, sy = 0;
  for (const q of r) { sx += q[0]; sy += q[1]; }
  return [sx / r.length, sy / r.length];
}

/** Grobe Knotenzahl-Abschätzung (für automatische Berechnung). */
export function estimateNodes(p) {
  const geo = geometryOf(p);
  if (!geo.slabs.length) return 0;
  const s = num(p.meshSize, 0.5);
  return s > 0 ? netArea(geo) / (0.866 * s * s) : Infinity;
}

// ------------------------------------------------------------------ Hauptberechnung

/**
 * Netz eines (mit withDefaults ergänzten) Projekts erzeugen – auch für die Netzvorschau ohne Berechnung.
 */
export function meshProject(p, warnings = []) {
  const geo = geometryOf(p);
  const { outlines, holes } = geo;
  if (!outlines.length) throw new Error('Es ist noch keine Platte vorhanden (mindestens 3 Eckpunkte) – Werkzeug «Platte» oder Register «Platten».');
  const bb = geo.bb;
  const Lref = Math.max(bb.w, bb.h);
  const tol = 1e-6 * Lref;
  let size = num(p.meshSize);
  if (!(size > 0)) throw new Error('Die Netzweite muss grösser als 0 sein (z.B. 0.5 m).');
  if (size < Lref / 400) { size = Lref / 400; warnings.push(`Netzweite auf ${size.toFixed(3)} m vergrössert (Rechenzeit).`); }
  if (size > Lref / 4) { size = Lref / 4; warnings.push(`Netzweite auf ${size.toFixed(2)} m verkleinert (mind. 4 Elemente über die Plattenabmessung).`); }
  const inDom = (x, y) => inUnion(x, y, outlines, holes);

  // Zwangslinien und -punkte
  const segments = [];
  const lineSup = p.lineSupports.map((s, i) => ({ ...s, i })).filter(validSeg);
  const lineLoads = p.lineLoads.map((s, i) => ({ ...s, i })).filter(validSeg);
  const pointSup = p.pointSupports.map((s, i) => ({ ...s, i })).filter(validPt);
  const pointLoads = p.pointLoads.map((s, i) => ({ ...s, i })).filter(validPt);
  for (const s of [...lineSup, ...lineLoads]) segments.push([[num(s.x1), num(s.y1)], [num(s.x2), num(s.y2)]]);
  const areas = p.loadAreas.map((a) => ({ id: a.id, name: a.name, poly: ptsOf(a.pts) })).filter((a) => a.poly.length >= 3);
  for (const a of areas) for (let k = 0; k < a.poly.length; k++) segments.push([a.poly[k], a.poly[(k + 1) % a.poly.length]]);
  const points = [...pointSup.map((s) => [num(s.x), num(s.y)]), ...pointLoads.map((s) => [num(s.x), num(s.y)])];
  // Stützenköpfe b × h als (nahezu) starre Bereiche: Rechteckränder als Zwangslinien
  const heads = p.columnHeads !== false;
  const headRects = [];
  if (heads) {
    for (const s of pointSup) {
      const b = num(s.b, 0), hc = num(s.hc, 0);
      if (!(b > 0 && hc > 0)) continue;
      const cx = num(s.x), cy = num(s.y);
      // Liegt ein freier Rand näher als ~0.6·h am Stützenrand, wird der starre Bereich bis zum Rand
      // verlängert (sonst entsteht ein schmaler, unrealistisch weicher Plattenstreifen mit Spannungsspitzen).
      const k = slabIndexAt(geo, cx, cy, 1e-6);
      const gap = Math.max(0.6 * (k >= 0 ? geo.slabs[k].h : num(p.h, 0.25)), 0.1);
      let x0 = cx - b / 2, x1 = cx + b / 2, y0 = cy - hc / 2, y1 = cy + hc / 2;
      if (!inDom(x0 - gap, cy)) x0 -= gap;
      if (!inDom(x1 + gap, cy)) x1 += gap;
      if (!inDom(cx, y0 - gap)) y0 -= gap;
      if (!inDom(cx, y1 + gap)) y1 += gap;
      const r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      headRects.push(r);
      for (let k = 0; k < 4; k++) segments.push([r[k], r[(k + 1) % 4]]);
    }
  }

  let mesh;
  try {
    const refine = p.refineColumns === false ? [] : pointSup.map((s) => {
      const b = num(s.b, 0), hc = num(s.hc, 0);
      const has = b > 0 && hc > 0;
      return {
        x: num(s.x), y: num(s.y),
        r0: has ? Math.hypot(b, hc) / 2 : 0,
        s0: has ? Math.min(size / 2, Math.max(size / 6, 0.6 * Math.max(b, hc))) : size / 3,
      };
    });
    mesh = generateMesh({ outlines, holes, segments, points, size, maxNodes: 20000, refine });
  } catch (e) {
    if (e instanceof MeshError) throw new Error(`Netzerzeugung: ${e.message}`);
    throw e;
  }
  return { mesh, geo, outlines, holes, bb, Lref, tol, size, lineSup, lineLoads, pointSup, pointLoads, areas, headRects };
}

/**
 * Vollständige Berechnung eines Plattenprojekts.
 * Rückgabe: siehe Ende der Funktion (mesh, sets, design, punching, sls, supports, warnings …).
 */
export function analyse(project) {
  const T0 = now();
  const p = withDefaults(JSON.parse(JSON.stringify(project)));
  const warnings = [];
  const norm = p.norm;
  const concCache = new Map();
  const concOf = (name) => {
    if (!concCache.has(name)) {
      let c;
      try { c = concrete(name, { norm }); } catch { c = null; }
      if (!c || !Number.isFinite(c.fck)) throw new Error(`Unbekannte Betonsorte «${name}» – bitte im Register «Platten» eine Betonsorte wählen.`);
      concCache.set(name, c);
    }
    return concCache.get(name);
  };
  const steel = rebar(p.design.steel, { norm });
  const nu = Math.min(0.45, Math.max(0, num(p.nu, 0.2)));
  for (const sl of geometryOf(p).slabs) {
    if (!(sl.h >= 0.05 && sl.h <= 3)) throw new Error(`Die Dicke von «${sl.name}» muss zwischen 0.05 m und 3 m liegen (Eingabe in Metern, z.B. 0.25).`);
  }

  const { mesh, geo, outlines, holes, bb, tol, lineSup, lineLoads, pointSup, pointLoads, areas, headRects } = meshProject(p, warnings);
  const free = freeEdges(outlines, holes);
  const dom = { outlines, holes, free };
  // Kennwerte je Platte
  const slabs = geo.slabs.map((sl) => {
    const c = concOf(sl.concrete);
    return { ...sl, conc: c, E: c.Ecm, D: flexuralRigidity(c.Ecm, sl.h, nu), nElem: 0, meshArea: 0 };
  });
  const Dref = slabs[0].D;
  const conc = slabs[0].conc, h = slabs[0].h, E = slabs[0].E, D = Dref;
  const T1 = now();
  const n = mesh.nNodes, nt = mesh.nTri, { x, y, tri } = mesh;
  const ntol = Math.max(10 * tol, 1e-6);

  // ---------------------------------------------------------------- Lager
  const fixW = new Uint8Array(n), springW = new Float64Array(n), springR = new Float64Array(n);
  const rotC = [];
  const owner = new Int32Array(n).fill(-1);
  const supports = [];
  for (const s of pointSup) {
    const { node, dist } = nearestNode(mesh, num(s.x), num(s.y));
    const name = `S${s.i + 1}`;
    if (node < 0 || dist > ntol) { warnings.push(`Punktlager ${name} liegt ausserhalb der Platte und wird ignoriert.`); continue; }
    const kz = num(s.kz, 0), kr = num(s.kr, 0);
    if (kz > 0) springW[node] += kz; else fixW[node] = 1;
    if (kr > 0) springR[node] += kr;
    const sup = { kind: 'point', i: s.i, name, node, x: x[node], y: y[node], b: Math.max(0, num(s.b, 0)), h: Math.max(0, num(s.hc, 0)), kz, kr, rigid: !(kz > 0) };
    if (owner[node] < 0) owner[node] = supports.length;
    supports.push(sup);
  }
  for (const s of lineSup) {
    const ax = num(s.x1), ay = num(s.y1), bx = num(s.x2), by = num(s.y2);
    const name = `W${s.i + 1}`;
    const nodes = nodesOnSegment(mesh, ax, ay, bx, by, ntol);
    if (nodes.length < 2) { warnings.push(`Linienlager ${name} liegt nicht auf der Platte und wird ignoriert.`); continue; }
    const L = Math.hypot(bx - ax, by - ay);
    const tx = (bx - ax) / L, ty = (by - ay) / L;
    for (const nd of nodes) {
      fixW[nd.node] = 1;
      springW[nd.node] = 0;
      if (s.clamped) rotC.push({ node: nd.node, cx: tx, cy: ty });
      if (owner[nd.node] < 0) owner[nd.node] = supports.length;
    }
    supports.push({ kind: 'line', i: s.i, name, nodes, x1: ax, y1: ay, x2: bx, y2: by, L, clamped: !!s.clamped });
  }
  for (const sp of supports) if (sp.kind === 'point' && fixW[sp.node]) { sp.rigid = true; }
  // Knoten, die zu mehreren Lagern gehören (Wandecken, Stütze am Wandende), werden anteilig zugeordnet
  const shareCount = new Int32Array(n);
  for (const sp of supports) {
    if (sp.kind === 'point') shareCount[sp.node]++;
    else for (const nd of sp.nodes) shareCount[nd.node]++;
  }
  if (!supports.length) throw new Error('Es sind keine Lager definiert. Bitte im Register «Lager» Punktlager (Stützen) oder Linienlager (Wände) eingeben – z.B. mit «Wände an allen Rändern».');
  // Kinematik-Vorprüfung: alle Lagerpunkte auf einer Geraden ohne Einspannung?
  {
    const pts = [];
    for (let i = 0; i < n; i++) if (fixW[i] || springW[i] > 0) pts.push([x[i], y[i]]);
    let collinear = true;
    if (pts.length >= 3) {
      const [a] = pts;
      let far = pts[0], fd = 0;
      for (const q of pts) { const d = Math.hypot(q[0] - a[0], q[1] - a[1]); if (d > fd) { fd = d; far = q; } }
      for (const q of pts) {
        const cr = Math.abs((far[0] - a[0]) * (q[1] - a[1]) - (far[1] - a[1]) * (q[0] - a[0]));
        if (cr > 1e-6 * fd * fd + 1e-12) { collinear = false; break; }
      }
    }
    const hasRot = rotC.length > 0 || springR.some((v) => v > 0);
    if (collinear && !(hasRot && pts.length >= 2)) {
      throw new Error('Die Platte ist kinematisch: alle Lager liegen auf einer Geraden. Bitte weitere Lager ergänzen oder ein Linienlager als «eingespannt» definieren (Kragplatte).');
    }
  }

  // ---------------------------------------------------------------- Lastfälle
  const lcs = p.loadCases.filter((l) => l && l.id);
  if (!lcs.length) throw new Error('Es ist kein Lastfall definiert. Bitte im Register «Lasten» mindestens einen Lastfall (z.B. Eigengewicht) anlegen.');
  const lcIds = new Set(lcs.map((l) => l.id));
  const eArea = new Float64Array(nt), ecx = new Float64Array(nt), ecy = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
    eArea[t] = ((x[b] - x[a]) * (y[c] - y[a]) - (x[c] - x[a]) * (y[b] - y[a])) / 2;
    ecx[t] = (x[a] + x[b] + x[c]) / 3; ecy[t] = (y[a] + y[b] + y[c]) / 3;
  }
  // Platte je Element (kleinste umschliessende Platte) und je Knoten (dünnste angrenzende Platte)
  const eSlab = new Int32Array(nt);
  for (let t = 0; t < nt; t++) {
    let k = slabIndexAt(geo, ecx[t], ecy[t]);
    if (k < 0) k = 0;
    eSlab[t] = k;
    slabs[k].nElem++;
    slabs[k].meshArea += eArea[t];
  }
  const nodeSlab = new Int32Array(n).fill(-1);
  for (let t = 0; t < nt; t++) {
    const k = eSlab[t];
    for (let j = 0; j < 3; j++) {
      const v = tri[3 * t + j];
      if (nodeSlab[v] < 0 || slabs[k].h < slabs[nodeSlab[v]].h) nodeSlab[v] = k;
    }
  }
  const slabMember = new Map();
  for (const sl of slabs) {
    const m = new Uint8Array(nt);
    for (let t = 0; t < nt; t++) if (pointInPolygon(ecx[t], ecy[t], sl.ring)) m[t] = 1;
    slabMember.set(sl.id, m);
  }
  const areaMember = new Map();
  for (const a of areas) {
    const m = new Uint8Array(nt);
    let any = false;
    for (let t = 0; t < nt; t++) if (pointInPolygon(ecx[t], ecy[t], a.poly)) { m[t] = 1; any = true; }
    if (!any) warnings.push(`Lastfläche «${a.name || a.id}» liegt ausserhalb der Platte.`);
    areaMember.set(a.id, m);
  }
  for (const al of p.areaLoads) if (al.lc && !lcIds.has(al.lc)) warnings.push('Eine Flächenlast verweist auf einen gelöschten Lastfall und wird ignoriert.');
  for (const al of [...p.lineLoads, ...p.pointLoads]) if (al.lc && !lcIds.has(al.lc)) { warnings.push('Eine Linien- oder Punktlast verweist auf einen gelöschten Lastfall und wird ignoriert.'); break; }

  const loads = [];
  const fe = new Float64Array(9);
  const gammaC = conc.gamma ?? 25;
  for (const lc of lcs) {
    const f = new Float64Array(3 * n);
    const qe = new Float64Array(nt);
    if (lc.sw) for (let t = 0; t < nt; t++) qe[t] = (slabs[eSlab[t]].conc.gamma ?? gammaC) * slabs[eSlab[t]].h;
    for (const al of p.areaLoads) {
      if (al.lc !== lc.id) continue;
      const q = num(al.q, 0);
      if (!q) continue;
      if (!al.region || al.region === 'all') { for (let t = 0; t < nt; t++) qe[t] += q; continue; }
      const m = slabMember.get(al.region) || areaMember.get(al.region);
      if (!m) { warnings.push('Eine Flächenlast verweist auf eine gelöschte Platte bzw. Lastfläche und wird ignoriert.'); continue; }
      for (let t = 0; t < nt; t++) if (m[t]) qe[t] += q;
    }
    for (let t = 0; t < nt; t++) {
      if (!qe[t]) continue;
      const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
      areaLoadVector(x[a], y[a], x[b], y[b], x[c], y[c], qe[t], fe);
      for (let k = 0; k < 3; k++) {
        const v = tri[3 * t + k];
        f[3 * v] += fe[3 * k]; f[3 * v + 1] += fe[3 * k + 1]; f[3 * v + 2] += fe[3 * k + 2];
      }
    }
    for (const ll of lineLoads) {
      if (ll.lc !== lc.id) continue;
      const ax = num(ll.x1), ay = num(ll.y1), bx = num(ll.x2), by = num(ll.y2);
      const p1 = num(ll.p1, 0), p2 = num(ll.p2, p1);
      if (!p1 && !p2) continue;
      const nodes = nodesOnSegment(mesh, ax, ay, bx, by, ntol);
      if (nodes.length < 2) { warnings.push(`Linienlast ${ll.i + 1} liegt nicht auf der Platte und wird ignoriert.`); continue; }
      for (let k = 0; k + 1 < nodes.length; k++) {
        const na = nodes[k], nb = nodes[k + 1];
        const pa = p1 + (p2 - p1) * na.t, pb = p1 + (p2 - p1) * nb.t;
        const v = lineLoadVector(x[na.node], y[na.node], x[nb.node], y[nb.node], pa, pb);
        for (let d = 0; d < 3; d++) { f[3 * na.node + d] += v[d]; f[3 * nb.node + d] += v[3 + d]; }
      }
    }
    for (const pl of pointLoads) {
      if (pl.lc !== lc.id) continue;
      const P = num(pl.P, 0);
      if (!P) continue;
      const { node, dist } = nearestNode(mesh, num(pl.x), num(pl.y));
      if (dist > ntol) { warnings.push(`Punktlast ${pl.i + 1} liegt ausserhalb der Platte und wird ignoriert.`); continue; }
      f[3 * node] += P;
    }
    loads.push(f);
  }

  // ---------------------------------------------------------------- Lösung
  // Steifigkeit je Element: D der Platte (Dicke, Beton) relativ zu D_ref, starre Stützenköpfe × HEAD_FACTOR
  const elemFactor = new Float64Array(nt);
  const headMask = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    elemFactor[t] = slabs[eSlab[t]].D / Dref;
    for (const r of headRects) {
      if (ecx[t] > r[0][0] && ecx[t] < r[1][0] && ecy[t] > r[0][1] && ecy[t] < r[2][1]) { elemFactor[t] *= HEAD_FACTOR; headMask[t] = 1; break; }
    }
  }
  const sol = solvePlate(mesh, { D: Dref, nu, fixW, springW, springR, rotConstraints: rotC, loads, elemFactor });
  const T2 = now();

  const sets = [];
  lcs.forEach((lc, k) => {
    const u = sol.U[k];
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = u[3 * i];
    const m = plateMoments(mesh, u, Dref, nu, elemFactor, headMask);
    let sumF = 0;
    for (let i = 0; i < n; i++) sumF += loads[k][3 * i];
    const R = sol.R[k];
    let sumR = 0;
    for (let i = 0; i < n; i++) sumR += R[i];
    sets.push({ key: `lc:${lc.id}`, id: lc.id, kind: 'lc', name: lc.name || lc.id, type: lc.type, w, ...m, R, sumF, sumR });
  });
  const lcSets = sets.slice();

  // Kombinationen
  let combos = p.autoCombos ? [] : p.combos.filter((c) => c && c.id);
  let autoCombos = false;
  if (!combos.length) { combos = defaultCombos(lcs); autoCombos = true; }
  const nArr = { w: n, mx: n, my: n, mxy: n, R: n, emx: nt, emy: nt, emxy: nt };
  for (const c of combos) {
    const fac = lcs.map((l) => num(c[`f_${l.id}`], 0));
    const s = { key: `co:${c.id}`, id: c.id, kind: 'combo', name: c.name || c.id, type: c.type || 'ULS', factors: fac, formula: comboFormula(c, lcs) };
    for (const [key, len] of Object.entries(nArr)) s[key] = lin(lcSets, fac, key, len);
    s.sumF = lcSets.reduce((a, l, k) => a + fac[k] * l.sumF, 0);
    s.sumR = lcSets.reduce((a, l, k) => a + fac[k] * l.sumR, 0);
    sets.push(s);
  }
  for (const s of sets) {
    let wmax = -Infinity, wmin = Infinity, iwmax = 0;
    for (let i = 0; i < n; i++) { if (s.w[i] > wmax) { wmax = s.w[i]; iwmax = i; } if (s.w[i] < wmin) wmin = s.w[i]; }
    s.wmax = wmax; s.wmin = wmin; s.iwmax = iwmax;
    s.mExt = {};
    for (const key of ['mx', 'my', 'mxy']) {
      let a = Infinity, b = -Infinity;
      for (let i = 0; i < n; i++) { const v = s[key][i]; if (v < a) a = v; if (v > b) b = v; }
      s.mExt[key] = [a, b];
    }
    s.supportForces = supports.map((sp) => supportForce(sp, s.R, shareCount));
  }

  // ---------------------------------------------------------------- Bemessung
  const dz = p.design;
  const LAY = ['bx', 'by', 'tx', 'ty'];
  const depBySlab = slabs.map((sl) => effectiveDepths(sl.h, num(dz.cBot, 30), num(dz.cTop, 30), num(dz.dBot, 12), num(dz.dTop, 14), dz.outerBot || 'x', dz.outerTop || 'x'));
  depBySlab.forEach((dep, k) => {
    for (const [lk, v] of Object.entries(dep)) if (!(v > 20)) throw new Error(`Die statische Höhe der Lage «${layerLabel(lk)}» in «${slabs[k].name}» ist zu klein (${v.toFixed(0)} mm). Bitte Überdeckung bzw. Stabdurchmesser im Register «Bemessung» prüfen.`);
  });
  const fsd = steel.fsd;
  const lambda = norm === 'SIA' ? 0.85 : 0.8;
  const asMinBySlab = slabs.map((sl, k) => {
    const o = {};
    for (const lk of LAY) o[lk] = minReinforcement(depBySlab[k][lk], sl.conc.fctm, steel.fsk, dz.asMinMode, num(dz.rhoMin, 0.13));
    return o;
  });
  const asBasic = {};
  for (const b of dz.basic) asBasic[b.layer] = num(b.d, 0) > 0 && num(b.s, 0) > 0 ? barAreaPerM(num(b.d), num(b.s)) : 0;
  const ulsSets = sets.filter((s) => s.kind === 'combo' && s.type === 'ULS');
  let design = null;
  if (!ulsSets.length) {
    warnings.push('Keine Kombination «Tragsicherheit» vorhanden – Bemessung und Durchstanznachweis entfallen.');
  } else {
    const mEd = { bx: new Float64Array(n), by: new Float64Array(n), tx: new Float64Array(n), ty: new Float64Array(n) };
    for (const s of ulsSets) {
      for (let i = 0; i < n; i++) {
        const wa = woodArmer(s.mx[i], s.my[i], s.mxy[i]);
        if (wa.bx > mEd.bx[i]) mEd.bx[i] = wa.bx;
        if (wa.by > mEd.by[i]) mEd.by[i] = wa.by;
        if (wa.tx > mEd.tx[i]) mEd.tx[i] = wa.tx;
        if (wa.ty > mEd.ty[i]) mEd.ty[i] = wa.ty;
      }
    }
    const as = {}, asMinNode = {}, layers = {};
    const bySlab = slabs.map((sl, k) => ({ id: sl.id, name: sl.name, h: sl.h, d: depBySlab[k], asMin: asMinBySlab[k], max: {} }));
    let failed = 0;
    for (const k of LAY) {
      const a = new Float64Array(n), amin = new Float64Array(n);
      let mx = 0, im = -1, mMax = 0, xdMax = 0, nFail = 0, reqMax = 0;
      for (const b of bySlab) b.max[k] = { as: 0, req: b.asMin[k], node: -1 };
      for (let i = 0; i < n; i++) {
        const ns = Math.max(0, nodeSlab[i]);
        amin[i] = asMinBySlab[ns][k];
        const r = requiredAs(mEd[k][i], depBySlab[ns][k], slabs[ns].conc.fcd, fsd, lambda);
        if (!r.ok) { a[i] = NaN; nFail++; continue; }
        a[i] = r.as;
        if (r.as > mx) { mx = r.as; im = i; }
        if (mEd[k][i] > mMax) mMax = mEd[k][i];
        if (r.xd > xdMax) xdMax = r.xd;
        const req = Math.max(r.as, amin[i]);
        if (req > reqMax) reqMax = req;
        const bs = bySlab[ns].max[k];
        if (r.as > bs.as) { bs.as = r.as; bs.node = i; }
        if (req > bs.req) bs.req = req;
      }
      if (im < 0) im = 0;
      failed += nFail;
      as[k] = a;
      asMinNode[k] = amin;
      for (const b of bySlab) b.max[k].bars = barSuggestion(b.max[k].req);
      const ns = Math.max(0, nodeSlab[im]);
      const req = Math.max(reqMax, mx, amin[im]);
      layers[k] = {
        key: k, label: layerLabel(k), d: depBySlab[ns][k], asMax: mx, node: im, x: x[im], y: y[im], mMax, xdMax, nFail,
        asMin: amin[im], asReq: req, minGoverns: reqMax > mx + 1e-9, bars: barSuggestion(req), asBasic: asBasic[k] || 0,
        slab: slabs[ns].name, slabIdx: ns, fcd: slabs[ns].conc.fcd, h: slabs[ns].h,
        extraArea: 0,
      };
    }
    // Flächenanteil mit Zulagen gegenüber Grundbewehrung
    for (const k of LAY) {
      const base = asBasic[k] || 0;
      if (!(base > 0)) continue;
      let A = 0, Aall = 0;
      for (let t = 0; t < nt; t++) {
        const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
        const v = Math.max(as[k][a], as[k][b], as[k][c], asMinNode[k][a], asMinNode[k][b], asMinNode[k][c]);
        Aall += eArea[t];
        if (v > base + 1e-9) A += eArea[t];
      }
      layers[k].extraArea = A;
      layers[k].extraShare = Aall > 0 ? A / Aall : 0;
    }
    if (failed) warnings.push(`An ${failed} Knoten ist die Biegedruckzone ungenügend (μ ≥ 0.5) – Platte verstärken oder Betonsorte erhöhen.`);
    const asMin = {};
    for (const k of LAY) asMin[k] = Math.min(...asMinBySlab.map((o) => o[k]));
    design = {
      mEd, as, layers, asMin, asMinNode, asMinBySlab, asBasic, depths: depBySlab[0], depBySlab, bySlab, fcd: slabs[0].conc.fcd, fsd, lambda, failed, combos: ulsSets.map((s) => s.key),
      inputs: { cBot: num(dz.cBot, 30), cTop: num(dz.cTop, 30), dBot: num(dz.dBot, 12), dTop: num(dz.dTop, 14), outerBot: dz.outerBot || 'x', outerTop: dz.outerTop || 'x', asMinMode: dz.asMinMode, rhoMin: num(dz.rhoMin, 0.13), Dmax: num(dz.Dmax, 32), asPunch: num(dz.asPunch, 0) },
    };
  }

  // ---------------------------------------------------------------- Durchstanzen
  const punching = [];
  if (design) {
    for (const sp of supports) {
      if (sp.kind !== 'point' || !(sp.b > 0 && sp.h > 0)) continue;
      const ks = Math.max(0, slabIndexAt(geo, sp.x, sp.y, 1e-6));
      const sl = slabs[ks], dep = depBySlab[ks], cs = sl.conc, asMin = asMinBySlab[ks], fcd = cs.fcd;
      const dMean = (dep.tx + dep.ty) / 2;
      let Vd = 0, gov = null;
      for (const s of ulsSets) { const r = s.R[sp.node]; if (r > Vd) { Vd = r; gov = s; } }
      const rs = spansAt(sp, supports, bb);
      const rec = { name: sp.name, node: sp.node, x: sp.x, y: sp.y, b: sp.b, h: sp.h, Vd, combo: gov?.name || '–', d: dMean, dv: dMean, dTx: dep.tx, dTy: dep.ty, Lx: rs.Lx, Ly: rs.Ly, slab: sl.name, hSlab: sl.h, conc: cs };
      if (!(Vd > 0)) { rec.skip = 'keine Druckkraft'; punching.push(rec); continue; }
      if (norm === 'SIA') {
        const r = dMean / 2 / 1000;
        const cp = controlPerimeter(sp, r, dom, holes, 5 * dMean / 1000);
        const type = cp.type;
        const ke = KE_SIA[type];
        const msd = Vd * (type === 'innen' ? 1 / 8 : type === 'rand' ? 1 / 4 : 1 / 2); // SIA 262 (64)–(67), eu = 0
        const asUser = num(dz.asPunch, 0);
        const provide = (dl, amin) => {
          if (asUser > 0) return { as: asUser, label: 'vorgegeben' };
          const req = Math.max(requiredAs(msd, dl, fcd, fsd, lambda).as || 0, amin);
          const bars = barSuggestion(req);
          return { as: bars.as, label: bars.label };
        };
        const px = provide(dep.tx, asMin.tx), py = provide(dep.ty, asMin.ty);
        const mRdx = momentResistance(px.as, dep.tx, fcd, fsd), mRdy = momentResistance(py.as, dep.ty, fcd, fsd);
        const res = punchingSIA({
          Vd, d: dMean, dv: dMean, u: cp.u, ke, rsx: 0.22 * rs.Lx, rsy: 0.22 * rs.Ly, msd, mRdx, mRdy,
          fsd, Es: steel.Es, tcd: cs.tcd, Dmax: num(dz.Dmax, 32),
        });
        Object.assign(rec, { type, ke, r, u: cp.u, uFull: cp.uFull, pieces: cp.pieces, msd, asx: px, asy: py, mRdx, mRdy, rsx: 0.22 * rs.Lx, rsy: 0.22 * rs.Ly, res, VRd: res.VRdc, eta: res.eta });
      } else {
        const r = 2 * dMean / 1000;
        const cp = controlPerimeter(sp, r, dom, holes, 6 * dMean / 1000);
        const type = cp.type;
        const beta = BETA_EC[type];
        const cp0 = controlPerimeter(sp, 1e-4, dom, holes, 0);
        const u0 = cp0.u;
        const asUser = num(dz.asPunch, 0);
        // ρl aus der erforderlichen oberen Bewehrung im Bereich c/2 + 3d um die Stütze (Mittelwert), mind. as,min
        const zoneR = Math.max(sp.b, sp.h) / 2 + 3 * dMean / 1000;
        const avgAs = (arr) => {
          let sum = 0, cnt = 0;
          for (let i = 0; i < n; i++) {
            if (Math.hypot(x[i] - sp.x, y[i] - sp.y) > zoneR || !Number.isFinite(arr[i])) continue;
            sum += arr[i]; cnt++;
          }
          return cnt ? sum / cnt : 0;
        };
        const ax = asUser > 0 ? asUser : barSuggestion(Math.max(asMin.tx, avgAs(design.as.tx))).as;
        const ay = asUser > 0 ? asUser : barSuggestion(Math.max(asMin.ty, avgAs(design.as.ty))).as;
        const rhoL = Math.sqrt((ax / (1000 * dep.tx)) * (ay / (1000 * dep.ty)));
        const res = punchingEC({ VEd: Vd, d: dMean, u1: cp.u, u0, beta, rhoL, fck: cs.fck, fcd, gammaC: cs.gammaC });
        Object.assign(rec, { type, beta, r, u: cp.u, uFull: cp.uFull, u0, pieces: cp.pieces, rhoL, asx: { as: ax }, asy: { as: ay }, res, VRd: res.VRdc, eta: res.eta });
      }
      punching.push(rec);
    }
  }

  // ---------------------------------------------------------------- Gebrauchstauglichkeit
  let sls = null;
  const slsSets = sets.filter((s) => s.kind === 'combo' && s.type === 'SLS');
  if (slsSets.length) {
    let gov = slsSets[0];
    for (const s of slsSets) if (s.wmax > gov.wmax) gov = s;
    const factor = Math.max(1, num(dz.creep, 3));
    const Lspan = num(dz.Lspan, 0) > 0 ? num(dz.Lspan) : autoSpan(supports, bb);
    const limit = Math.max(1, num(dz.limit, 300));
    const wEl = Math.max(0, gov.wmax);
    const wLong = factor * wEl;
    const wLim = Lspan / limit;
    sls = { combo: gov.name, key: gov.key, wEl, wLong, factor, Lspan, limit, wLim, eta: wLim > 0 ? wLong / wLim : Infinity, node: gov.iwmax, x: x[gov.iwmax], y: y[gov.iwmax], autoSpan: !(num(dz.Lspan, 0) > 0) };
  } else {
    warnings.push('Keine quasi-ständige Kombination vorhanden – Durchbiegungsnachweis entfällt.');
  }

  const T3 = now();
  return {
    mesh, owner, supports, sets, headRects, elemFactor, headMask, eSlab, nodeSlab, lcSets, combos, autoCombos, lcs,
    design, punching, sls, warnings: [...new Set(warnings)],
    slabs, geo, D, E, nu, h, conc, steel, norm, outlines, holes, free, bbox: bb,
    neq: sol.neq,
    time: { mesh: T1 - T0, solve: T2 - T1, post: T3 - T2, total: T3 - T0 },
  };
}

/** Praktische Bewehrungswahl (Ø 8–26, Abstände 100–250 mm). */
export function barSuggestion(as) {
  return chooseBars(as, { diameters: [8, 10, 12, 14, 16, 18, 20, 22, 26], spacings: [100, 125, 150, 200, 250] });
}

export function layerLabel(k) {
  return { bx: 'unten x', by: 'unten y', tx: 'oben x', ty: 'oben y' }[k] || k;
}

/** Lagerkraft bzw. Linienlagerverlauf eines Lagers aus Knotenreaktionen R. */
function supportForce(sp, R, shareCount) {
  if (sp.kind === 'point') return { total: R[sp.node] / Math.max(1, shareCount[sp.node]), value: R[sp.node] };
  let total = 0, maxR = -Infinity, minR = Infinity;
  const nodes = sp.nodes;
  const raw = [];
  for (let k = 0; k < nodes.length; k++) {
    const nd = nodes[k];
    total += R[nd.node] / Math.max(1, shareCount[nd.node]);
    const sPrev = k > 0 ? nodes[k - 1].s : nd.s, sNext = k + 1 < nodes.length ? nodes[k + 1].s : nd.s;
    const trib = (sNext - sPrev) / 2;
    raw.push(trib > 0 ? R[nd.node] / trib : 0);
  }
  // Darstellung: leichte Glättung (¼, ½, ¼) im Wandinnern gegen Knoten-zu-Knoten-Schwankungen; Enden unverändert
  const line = nodes.map((nd, k) => {
    const r = k > 0 && k + 1 < nodes.length ? 0.25 * raw[k - 1] + 0.5 * raw[k] + 0.25 * raw[k + 1] : raw[k];
    if (r > maxR) maxR = r;
    if (r < minR) minR = r;
    return [nd.s, r];
  });
  return { total, line, maxR, minR };
}

/** Spannweiten Lx, Ly an einer Stütze (Abstand zum nächsten Lager in x- bzw. y-Richtung). */
export function spansAt(sp, supports, bb) {
  const cand = { x: [], y: [] };
  const consider = (vx, vy) => {
    const d = Math.hypot(vx, vy);
    if (d < 0.5) return;
    if (Math.abs(vy) <= 0.5 * Math.abs(vx)) cand.x.push(Math.abs(vx));
    if (Math.abs(vx) <= 0.5 * Math.abs(vy)) cand.y.push(Math.abs(vy));
  };
  for (const o of supports) {
    if (o === sp) continue;
    if (o.kind === 'point') consider(o.x - sp.x, o.y - sp.y);
    else {
      // nächster Punkt auf der Wand in x- und y-Richtung (Schnitt der Achsen mit der Wand)
      const r = distPointSeg(sp.x, sp.y, o.x1, o.y1, o.x2, o.y2);
      consider(r.x - sp.x, r.y - sp.y);
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const ex = o.x2 - o.x1, ey = o.y2 - o.y1;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const wx = o.x1 - sp.x, wy = o.y1 - sp.y;
        const t = (wx * ey - wy * ex) / den;
        const u = (wx * dy - wy * dx) / den;
        if (u >= 0 && u <= 1) consider(dx * t, dy * t);
      }
    }
  }
  let Lx = cand.x.length ? Math.min(...cand.x) : NaN;
  let Ly = cand.y.length ? Math.min(...cand.y) : NaN;
  if (!Number.isFinite(Lx)) Lx = Number.isFinite(Ly) ? Ly : Math.max(bb.w, bb.h);
  if (!Number.isFinite(Ly)) Ly = Lx;
  return { Lx, Ly };
}

/** Automatische Bezugsspannweite für die Durchbiegungsgrenze. */
export function autoSpan(supports, bb) {
  const cols = supports.filter((s) => s.kind === 'point');
  if (cols.length >= 2) {
    let L = 0;
    for (const c of cols) {
      const r = spansAt(c, supports, bb);
      L = Math.max(L, r.Lx, r.Ly);
    }
    if (L > 0) return Math.min(L, Math.max(bb.w, bb.h));
  }
  return Math.min(bb.w, bb.h);
}

// ------------------------------------------------------------------ Abfragen für die Darstellung

/** Sucht das Dreieck, das (px,py) enthält, und liefert {t, l1, l2, l3} (Flächenkoordinaten). */
export function locate(mesh, px, py) {
  const { x, y, tri } = mesh;
  let best = null, bestNeg = -Infinity;
  for (let t = 0, nt = tri.length / 3; t < nt; t++) {
    const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
    const x0 = Math.min(x[a], x[b], x[c]), x1 = Math.max(x[a], x[b], x[c]);
    const y0 = Math.min(y[a], y[b], y[c]), y1 = Math.max(y[a], y[b], y[c]);
    if (px < x0 - 1e-9 || px > x1 + 1e-9 || py < y0 - 1e-9 || py > y1 + 1e-9) continue;
    const det = (y[b] - y[c]) * (x[a] - x[c]) + (x[c] - x[b]) * (y[a] - y[c]);
    const l1 = ((y[b] - y[c]) * (px - x[c]) + (x[c] - x[b]) * (py - y[c])) / det;
    const l2 = ((y[c] - y[a]) * (px - x[c]) + (x[a] - x[c]) * (py - y[c])) / det;
    const l3 = 1 - l1 - l2;
    const mn = Math.min(l1, l2, l3);
    if (mn >= -1e-9) return { t, nodes: [a, b, c], l: [l1, l2, l3] };
    if (mn > bestNeg) { bestNeg = mn; best = { t, nodes: [a, b, c], l: [l1, l2, l3] }; }
  }
  return bestNeg > -0.05 ? best : null;
}

export function interpolate(loc, arr) {
  if (!loc) return NaN;
  return loc.l[0] * arr[loc.nodes[0]] + loc.l[1] * arr[loc.nodes[1]] + loc.l[2] * arr[loc.nodes[2]];
}

export { inDomain };

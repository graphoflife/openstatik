// Bearbeitungslogik des Plattenmodells für den grafischen Editor (DOM-frei, testbar)
//
// Kennungen (IDs) der Elemente:
//   s:k           Platte k (Fläche)      sv:k:i    Eckpunkt i der Platte k          se:k:i Randkante i → i+1
//   h:k           Öffnung k              hv:k:i    Eckpunkt der Öffnung            he:k:i Kante der Öffnung
//   a:k           Lastfläche k           av:k:i    Eckpunkt der Lastfläche
//   c:i           Stütze / Punktlager    w:i       Wand / Linienlager              we:i:e Wandende (e = 0, 1)
//   ll:i          Linienlast             le:i:e    Ende der Linienlast              pl:i  Punktlast
//
// Verschieben wirkt auf die gewählten Punkte sowie auf alle Punkte, die mit ihnen zusammenfallen
// (z.B. Wandende auf einer Plattenecke) – so bleiben verbundene Elemente verbunden.
import { polygonSelfIntersects, pointInPolygon, distPointSeg, signedArea, freeEdges, cleanPolygon } from './geom.js';

const R6 = (v) => Math.round(v * 1e6) / 1e6;
const keyOf = (x, y) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));

export function parseId(id) {
  const [t, a, b] = String(id).split(':');
  return { t, a: a === undefined ? -1 : +a, b: b === undefined ? -1 : +b };
}

/** Alle verschiebbaren Koordinaten des Projekts mit ID und Setzfunktion. */
export function vertexRefs(p) {
  const out = [];
  const xy = (id, o, kx = 'x', ky = 'y') => out.push({ id, x: num(o[kx]), y: num(o[ky]), set: (x, y) => { o[kx] = x; o[ky] = y; } });
  (p.slabs || []).forEach((sl, k) => (sl.outline || []).forEach((q, i) => xy(`sv:${k}:${i}`, q)));
  (p.openings || []).forEach((o, k) => (o.pts || []).forEach((q, i) => xy(`hv:${k}:${i}`, q)));
  (p.loadAreas || []).forEach((a, k) => (a.pts || []).forEach((q, i) => xy(`av:${k}:${i}`, q)));
  (p.lineSupports || []).forEach((w, i) => { xy(`we:${i}:0`, w, 'x1', 'y1'); xy(`we:${i}:1`, w, 'x2', 'y2'); });
  (p.lineLoads || []).forEach((l, i) => { xy(`le:${i}:0`, l, 'x1', 'y1'); xy(`le:${i}:1`, l, 'x2', 'y2'); });
  (p.pointSupports || []).forEach((s, i) => xy(`c:${i}`, s));
  (p.pointLoads || []).forEach((l, i) => xy(`pl:${i}`, l));
  return out.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
}

/** Koordinaten-IDs, die zu einer Auswahl gehören (Kanten → Endpunkte, Flächen → alle Eckpunkte). */
export function vertexIdsOf(p, ids) {
  const out = new Set();
  for (const id of ids) {
    const { t, a, b } = parseId(id);
    if (['sv', 'hv', 'av', 'c', 'pl', 'we', 'le'].includes(t)) out.add(id);
    else if (t === 'se') { const n = p.slabs[a]?.outline.length || 1; out.add(`sv:${a}:${b}`); out.add(`sv:${a}:${(b + 1) % n}`); }
    else if (t === 's') (p.slabs[a]?.outline || []).forEach((_, i) => out.add(`sv:${a}:${i}`));
    else if (t === 'he') { const n = p.openings[a]?.pts.length || 1; out.add(`hv:${a}:${b}`); out.add(`hv:${a}:${(b + 1) % n}`); }
    else if (t === 'h') (p.openings[a]?.pts || []).forEach((_, i) => out.add(`hv:${a}:${i}`));
    else if (t === 'a') (p.loadAreas[a]?.pts || []).forEach((_, i) => out.add(`av:${a}:${i}`));
    else if (t === 'w') { out.add(`we:${a}:0`); out.add(`we:${a}:1`); }
    else if (t === 'll') { out.add(`le:${a}:0`); out.add(`le:${a}:1`); }
  }
  return out;
}

/** Verschiebt das ganze Projekt um d. */
export function translateAll(p, d) {
  for (const r of vertexRefs(p)) r.set(R6(r.x + d[0]), R6(r.y + d[1]));
}

/**
 * Verschiebt die Auswahl um d = [dx, dy]. Zusammenfallende Punkte anderer Elemente (Wandenden auf
 * Plattenecken, gemeinsame Ecken benachbarter Platten) werden mitgenommen, damit Verbundenes verbunden
 * bleibt. Gibt die Anzahl verschobener Koordinaten zurück.
 */
export function moveSelection(p, ids, d) {
  const refs = vertexRefs(p);
  const direct = vertexIdsOf(p, ids);
  const anchors = new Set(refs.filter((r) => direct.has(r.id)).map((r) => keyOf(r.x, r.y)));
  let n = 0;
  for (const r of refs) {
    if (direct.has(r.id) || anchors.has(keyOf(r.x, r.y))) { r.set(R6(r.x + d[0]), R6(r.y + d[1])); n++; }
  }
  return n;
}

const shiftPts = (pts, d) => pts.map((q) => ({ x: R6(num(q.x) + d[0]), y: R6(num(q.y) + d[1]) }));

export function nextSlabId(p) {
  let k = (p.slabs || []).length + 1;
  const used = new Set((p.slabs || []).map((a) => a.id));
  while (used.has(`P${k}`)) k++;
  return `P${k}`;
}

export function nextAreaId(p) {
  let k = (p.loadAreas || []).length + 1;
  const used = new Set((p.loadAreas || []).map((a) => a.id));
  while (used.has(`A${k}`)) k++;
  return `A${k}`;
}

/** Kopiert Stützen, Wände, Lasten, Öffnungen und Lastflächen der Auswahl um d versetzt. → neue IDs */
export function copySelection(p, ids, d) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const { t, a } = parseId(id);
    if (t === 'c' && p.pointSupports[a]) { const s = p.pointSupports[a]; p.pointSupports.push({ ...s, x: R6(s.x + d[0]), y: R6(s.y + d[1]) }); out.push(`c:${p.pointSupports.length - 1}`); }
    if (t === 'pl' && p.pointLoads[a]) { const s = p.pointLoads[a]; p.pointLoads.push({ ...s, x: R6(s.x + d[0]), y: R6(s.y + d[1]) }); out.push(`pl:${p.pointLoads.length - 1}`); }
    if (t === 'w' && p.lineSupports[a]) { const s = p.lineSupports[a]; p.lineSupports.push({ ...s, x1: R6(s.x1 + d[0]), y1: R6(s.y1 + d[1]), x2: R6(s.x2 + d[0]), y2: R6(s.y2 + d[1]) }); out.push(`w:${p.lineSupports.length - 1}`); }
    if (t === 'll' && p.lineLoads[a]) { const s = p.lineLoads[a]; p.lineLoads.push({ ...s, x1: R6(s.x1 + d[0]), y1: R6(s.y1 + d[1]), x2: R6(s.x2 + d[0]), y2: R6(s.y2 + d[1]) }); out.push(`ll:${p.lineLoads.length - 1}`); }
    if (t === 'h' && p.openings[a]) { const o = p.openings[a]; p.openings.push({ ...o, pts: shiftPts(o.pts, d) }); out.push(`h:${p.openings.length - 1}`); }
    if (t === 's' && p.slabs[a]) {
      const sl = p.slabs[a];
      const nid = nextSlabId(p);
      p.slabs.push({ ...sl, id: nid, name: `${sl.name || 'Platte'} (Kopie)`, outline: shiftPts(sl.outline, d) });
      for (const l of p.areaLoads.filter((q) => q.region === sl.id)) p.areaLoads.push({ ...l, region: nid });
      out.push(`s:${p.slabs.length - 1}`);
    }
    if (t === 'a' && p.loadAreas[a]) {
      const ar = p.loadAreas[a];
      const nid = nextAreaId(p);
      p.loadAreas.push({ ...ar, id: nid, name: `${ar.name || 'Fläche'} (Kopie)`, pts: shiftPts(ar.pts, d) });
      for (const l of p.areaLoads.filter((q) => q.region === ar.id)) p.areaLoads.push({ ...l, region: nid });
      out.push(`a:${p.loadAreas.length - 1}`);
    }
  }
  return out;
}

/**
 * Löscht die Auswahl. Eckpunkte werden nur entfernt, solange das Polygon mindestens drei Punkte behält
 * (sonst wird die ganze Öffnung bzw. Lastfläche entfernt). Rückgabe: Anzahl gelöschter Elemente.
 */
export function removeSelection(p, ids) {
  const parsed = ids.map(parseId);
  const of = (t) => [...new Set(parsed.filter((x) => x.t === t).map((x) => x.a))].sort((x, y) => y - x);
  let n = 0;
  // ganze Polygone
  const holes = new Set(of('h'));
  const areas = new Set(of('a'));
  const slabs = new Set(of('s'));
  // Eckpunkte von Platten, Öffnungen, Lastflächen (Polygon bleibt mit mindestens drei Punkten erhalten)
  const vtx = (t, list, whole, key = 'pts') => {
    const by = new Map();
    for (const x of parsed.filter((q) => q.t === t)) { if (!by.has(x.a)) by.set(x.a, new Set()); by.get(x.a).add(x.b); }
    for (const [k, set] of by) {
      if (whole.has(k) || !list[k]) continue;
      const keep = list[k][key].filter((_, i) => !set.has(i));
      if (keep.length >= 3) { n += list[k][key].length - keep.length; list[k][key] = keep; }
    }
  };
  vtx('hv', p.openings, holes);
  vtx('av', p.loadAreas, areas);
  vtx('sv', p.slabs, slabs, 'outline');
  for (const k of [...holes].sort((x, y) => y - x)) if (p.openings[k]) { p.openings.splice(k, 1); n++; }
  for (const k of [...areas].sort((x, y) => y - x)) {
    const ar = p.loadAreas[k];
    if (!ar) continue;
    p.areaLoads = p.areaLoads.filter((l) => l.region !== ar.id);
    p.loadAreas.splice(k, 1);
    n++;
  }
  for (const k of [...slabs].sort((x, y) => y - x)) {
    const sl = p.slabs[k];
    if (!sl) continue;
    p.areaLoads = p.areaLoads.filter((l) => l.region !== sl.id);
    p.slabs.splice(k, 1);
    n++;
  }
  // Einzelelemente (Wandenden / Lastenden löschen das ganze Element)
  const walls = new Set([...of('w'), ...of('we')]);
  const lls = new Set([...of('ll'), ...of('le')]);
  for (const k of [...walls].sort((x, y) => y - x)) if (p.lineSupports[k]) { p.lineSupports.splice(k, 1); n++; }
  for (const k of [...lls].sort((x, y) => y - x)) if (p.lineLoads[k]) { p.lineLoads.splice(k, 1); n++; }
  for (const k of of('c')) if (p.pointSupports[k]) { p.pointSupports.splice(k, 1); n++; }
  for (const k of of('pl')) if (p.pointLoads[k]) { p.pointLoads.splice(k, 1); n++; }
  return n;
}

/** Fügt in der Kante i eines Polygons (Punkte {x,y}) einen Mittelpunkt ein. → Index des neuen Punktes */
export function insertMidpoint(pts, i) {
  const a = pts[i], b = pts[(i + 1) % pts.length];
  pts.splice(i + 1, 0, { x: R6((num(a.x) + num(b.x)) / 2), y: R6((num(a.y) + num(b.y)) / 2) });
  return i + 1;
}

/** Prüft ein Polygon für Umriss bzw. Öffnung. → Fehlermeldung oder null */
export function polygonProblem(pts, what = 'Der Umriss') {
  const ring = pts.map((q) => (Array.isArray(q) ? q : [num(q.x), num(q.y)]));
  if (ring.length < 3) return `${what} braucht mindestens drei Punkte.`;
  if (polygonSelfIntersects(ring, 1e-9)) return `${what} überschneidet sich selbst – Punkte in der Reihenfolge entlang des Randes setzen.`;
  if (Math.abs(signedArea(ring)) < 1e-6) return `${what} umschliesst keine Fläche.`;
  return null;
}

const ringOf = (sl) => (sl.outline || []).map((q) => [num(q.x), num(q.y)]);

/** Liegt der Punkt auf oder innerhalb einer Platte? */
export function onSlab(p, x, y) {
  for (const sl of p.slabs || []) {
    const ring = ringOf(sl);
    if (ring.length < 3) continue;
    if (pointInPolygon(x, y, ring)) return true;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (distPointSeg(x, y, a[0], a[1], b[0], b[1]).d < 1e-6) return true;
    }
  }
  return false;
}

/** Index der Platte an einem Punkt (kleinste umschliessende) oder −1. */
export function slabAt(p, x, y) {
  let best = -1, bestA = Infinity;
  (p.slabs || []).forEach((sl, k) => {
    const ring = ringOf(sl);
    if (ring.length < 3 || !pointInPolygon(x, y, ring)) return;
    const A = Math.abs(signedArea(ring));
    if (A < bestA) { bestA = A; best = k; }
  });
  return best;
}

/** Flächenlast auf eine ganze Platte (bzw. alle Platten mit slabId = 'all') ergänzen. → neue Last */
export function addSlabLoad(p, slabId, lc, q = 2.0) {
  const l = { lc, q, region: slabId || 'all' };
  p.areaLoads.push(l);
  return l;
}

/** Lastfall für neue Lasten: gewählt (falls vorhanden), sonst erste veränderliche, sonst erste Last. */
export function activeLoadCase(p, wanted) {
  if (wanted && p.loadCases.some((l) => l.id === wanted)) return wanted;
  return (p.loadCases.find((l) => l.type === 'Q') || p.loadCases[0])?.id || null;
}

/**
 * Erzeugt ein Element aus gezeichneten Punkten ([[x,y],…]).
 * tool: 'outline' | 'opening' | 'column' | 'wall' | 'area' | 'lineload' | 'pointload'
 * Rückgabe {ids, msg, kind: 'ok'|'warn'}; wirft Error bei ungültiger Eingabe.
 */
export function createElement(p, tool, pts, opts = {}) {
  const P = pts.map(([x, y]) => ({ x: R6(x), y: R6(y) }));
  const lc = activeLoadCase(p, opts.lc);
  const needLc = () => { if (!lc) throw new Error('Zuerst im Register «Lastfälle» einen Lastfall anlegen.'); };
  switch (tool) {
    case 'outline':
    case 'slab': {
      const prob = polygonProblem(P, 'Der Plattenrand');
      if (prob) throw new Error(prob);
      p.slabs = p.slabs || [];
      const first = !p.slabs.length;
      const k = p.slabs.length;
      p.slabs.push({ id: nextSlabId(p), name: `Platte ${k + 1}`, outline: P, h: opts.h ?? p.h ?? 0.25, concrete: '' });
      const inner = !first && P.every((q) => slabAt({ slabs: p.slabs.slice(0, k) }, q.x, q.y) >= 0);
      return {
        ids: [`s:${k}`],
        msg: first ? `Platte mit ${P.length} Eckpunkten angelegt – als Nächstes Lager setzen (Wand W, Stütze S)`
          : inner ? `Platte ${k + 1} liegt innerhalb einer anderen Platte – dort gilt ihre Dicke (Verstärkung bzw. dünnerer Bereich)` : `Platte ${k + 1} angelegt – gemeinsame Ränder verbinden die Platten`,
        kind: 'ok',
      };
    }
    case 'opening': {
      const prob = polygonProblem(P, 'Die Öffnung');
      if (prob) throw new Error(prob);
      if (!P.every((q) => onSlab(p, q.x, q.y))) throw new Error('Die Öffnung muss vollständig innerhalb der Platte liegen.');
      p.openings.push({ name: '', pts: P });
      return { ids: [`h:${p.openings.length - 1}`], msg: `Öffnung ${p.openings.length} angelegt`, kind: 'ok' };
    }
    case 'column': {
      const q = P[0];
      p.pointSupports.push({ x: q.x, y: q.y, b: opts.b ?? 0.3, hc: opts.hc ?? 0.3, kz: null, kr: null });
      const on = onSlab(p, q.x, q.y);
      return { ids: [`c:${p.pointSupports.length - 1}`], msg: on ? `Stütze S${p.pointSupports.length} gesetzt (b × h im Eigenschaftsfenster)` : 'Stütze liegt ausserhalb der Platte und wird bei der Berechnung ignoriert', kind: on ? 'ok' : 'warn' };
    }
    case 'wall': {
      const [a, b] = P;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return { ids: [], msg: 'Wand ohne Länge', kind: 'warn' };
      p.lineSupports.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, clamped: false });
      return { ids: [`w:${p.lineSupports.length - 1}`], msg: `Wand W${p.lineSupports.length}, L = ${Math.hypot(b.x - a.x, b.y - a.y).toFixed(2)} m`, kind: 'ok' };
    }
    case 'area': {
      needLc();
      const prob = polygonProblem(P, 'Die Lastfläche');
      if (prob) throw new Error(prob);
      const id = nextAreaId(p);
      p.loadAreas.push({ id, name: `Fläche ${p.loadAreas.length + 1}`, pts: P });
      p.areaLoads.push({ lc, q: opts.q ?? 2.0, region: id });
      return { ids: [`a:${p.loadAreas.length - 1}`], msg: 'Lastfläche mit 2.0 kN/m² angelegt – Wert und Lastfall im Eigenschaftsfenster', kind: 'ok' };
    }
    case 'lineload': {
      needLc();
      const [a, b] = P;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return { ids: [], msg: 'Linienlast ohne Länge', kind: 'warn' };
      p.lineLoads.push({ lc, x1: a.x, y1: a.y, x2: b.x, y2: b.y, p1: opts.p ?? 5, p2: null });
      return { ids: [`ll:${p.lineLoads.length - 1}`], msg: 'Linienlast 5 kN/m angelegt – Wert im Eigenschaftsfenster', kind: 'ok' };
    }
    case 'pointload': {
      needLc();
      const q = P[0];
      p.pointLoads.push({ lc, x: q.x, y: q.y, P: opts.P ?? 10 });
      return { ids: [`pl:${p.pointLoads.length - 1}`], msg: 'Punktlast 10 kN angelegt – Wert im Eigenschaftsfenster', kind: 'ok' };
    }
    default:
      return { ids: [], msg: '', kind: 'ok' };
  }
}

const wallKey = (w) => `${keyOf(w.x1, w.y1)}|${keyOf(w.x2, w.y2)}`;
const hasWall = (p, a, b) => {
  const have = new Set(p.lineSupports.map(wallKey));
  return have.has(`${keyOf(a[0], a[1])}|${keyOf(b[0], b[1])}`) || have.has(`${keyOf(b[0], b[1])}|${keyOf(a[0], a[1])}`);
};

/** Wände entlang einzelner Randkanten der Platte k (Indizes) ergänzen, sofern noch nicht vorhanden. → Anzahl */
export function addWallsOnEdges(p, edges, k = 0) {
  const sl = p.slabs?.[k];
  if (!sl) return 0;
  const o = sl.outline, n = o.length;
  let cnt = 0;
  for (const i of edges) {
    const a = o[i], b = o[(i + 1) % n];
    if (!a || !b) continue;
    if (hasWall(p, [a.x, a.y], [b.x, b.y])) continue;
    p.lineSupports.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, clamped: false });
    cnt++;
  }
  return cnt;
}

/**
 * Wände auf allen freien Rändern ergänzen (gemeinsame Ränder benachbarter Platten und Ränder innen
 * liegender Platten ausgenommen). k: nur Ränder der Platte k. → Anzahl
 */
export function addWallsOnFreeEdges(p, k = null) {
  const rings = (p.slabs || []).map(ringOf).filter((r) => r.length >= 3).map((r) => cleanPolygon(r));
  const own = k === null ? null : cleanPolygon(ringOf(p.slabs[k] || {}));
  let cnt = 0;
  for (const [a, b] of freeEdges(rings)) {
    if (own) {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      let on = false;
      for (let i = 0; i < own.length && !on; i++) {
        const q = own[i], r = own[(i + 1) % own.length];
        if (distPointSeg(mx, my, q[0], q[1], r[0], r[1]).d < 1e-6) on = true;
      }
      if (!on) continue;
    }
    const A = [R6(a[0]), R6(a[1])], B = [R6(b[0]), R6(b[1])];
    if (hasWall(p, A, B)) continue;
    p.lineSupports.push({ x1: A[0], y1: A[1], x2: B[0], y2: B[1], clamped: false });
    cnt++;
  }
  return cnt;
}

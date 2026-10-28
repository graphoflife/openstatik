// Querschnitt – Bearbeitungsoperationen auf dem Projekt (DOM-frei, in Node testbar)
//
// Nummerierung für den grafischen Editor (alle Masse in mm, y nach rechts, z nach oben):
//   c          Betonquerschnitt (Fläche)
//   v:i        Eckpunkt i des Aussenrands          e:i       Kante i (Eckpunkt i → i+1)
//   o:k        Aussparung k                         ov:k:i    Eckpunkt i der Aussparung k     oe:k:i  Kante
//   b:i        Bewehrungsstab i
// Bei Vorlagen (Rechteck, Plattenbalken …) entspricht die Nummerierung derjenigen nach der Umwandlung in
// «Polygon frei»: zuerst die Hohlräume der Vorlage, danach die Aussparungen des Projekts. Jede Bearbeitung
// eines Eckpunkts oder einer Kante einer Vorlage wandelt diese deshalb zuerst in ein Polygon um.

import { SHAPE_TYPES, templateToPoly, rowsToPts, ptsToRows, orient, selfIntersects, signedArea, circlePts, barsRow, barsCircle } from './shapes.js';

const r1 = (v) => Math.round(v * 10) / 10;

/** ID zerlegen: 'ov:2:5' → {t: 'ov', a: 2, b: 5}. */
export const parseId = (id) => { const [t, a, b] = String(id).split(':'); return { t, a: +a, b: +b }; };

/** Ist ein Betonumriss vorhanden (Vorlage oder Polygon mit ≥ 3 Eckpunkten)? */
export function hasOutline(project) {
  const sh = project.shape || {};
  if (sh.type !== 'poly') return !!sh.type;
  return rowsToPts(sh.poly).length >= 3;
}

/** Bezeichnung der aktuellen Form. */
export const shapeLabel = (type) => SHAPE_TYPES.find((s) => s.id === type)?.label || type;

/**
 * Umriss und Aussparungen in der Nummerierung des Editors.
 * Rückgabe {template, invalid, outer: [[y,z]], openings: [{pts, name, user, template, circle}], nTpl}
 * user: Index in project.openings (−1 für Hohlräume einer Vorlage).
 */
export function editableOutline(project) {
  const sh = project.shape || {};
  const user = (project.openings || []).map((o, j) => ({ pts: rowsToPts(o.pts), name: o.name || `Aussparung ${j + 1}`, user: j, circle: o.circle || null }));
  if (sh.type === 'poly') return { template: false, invalid: false, outer: rowsToPts(sh.poly), openings: user, nTpl: 0 };
  let conv;
  try { conv = templateToPoly(sh); } catch { return { template: true, invalid: true, outer: [], openings: user, nTpl: 0 }; }
  const tpl = conv.openings.map((o) => ({ pts: rowsToPts(o.pts), name: o.name, user: -1, template: true, circle: null }));
  return { template: true, invalid: false, outer: rowsToPts(conv.poly), openings: [...tpl, ...user], nTpl: tpl.length };
}

/** Index in project.openings → Index in der Editor-Nummerierung. */
export function openingKey(project, userIndex) {
  return editableOutline(project).nTpl + userIndex;
}

/**
 * Wandelt eine Vorlage in «Polygon frei» um (Hohlräume der Vorlage → Aussparungen mit fromTemplate).
 * Rückgabe: Bezeichnung der umgewandelten Vorlage oder null (bereits Polygon).
 */
export function convertToPoly(project) {
  const sh = project.shape;
  if (sh.type === 'poly') return null;
  const conv = templateToPoly(sh);
  const label = shapeLabel(sh.type);
  sh.poly = conv.poly;
  project.openings = [...conv.openings.map((o) => ({ ...o, fromTemplate: true })), ...(project.openings || []).filter((o) => !o.fromTemplate)];
  sh.type = 'poly';
  return label;
}

/** Berühren die IDs Geometrie der Vorlage (Umriss, Kanten, Hohlräume der Vorlage)? */
export function touchesTemplate(project, ids) {
  if ((project.shape || {}).type === 'poly') return false;
  const nTpl = editableOutline(project).nTpl;
  return ids.map(parseId).some((x) => ['c', 'v', 'e'].includes(x.t) || (['o', 'ov', 'oe'].includes(x.t) && x.a < nTpl));
}

const validRow = (r) => Number.isFinite(r?.y) && Number.isFinite(r?.z);

/** Ungültige Tabellenzeilen entfernen, damit die Indizes der Editor-Nummerierung entsprechen. */
function normalize(project) {
  if (project.shape.type === 'poly') project.shape.poly = (project.shape.poly || []).filter(validRow);
  for (const o of project.openings || []) o.pts = (o.pts || []).filter(validRow);
  project.bars ||= [];
}

/** Aussparungsindex (Editor) → Objekt in project.openings (nach allfälliger Umwandlung). */
function openingAt(project, k) {
  const nTpl = editableOutline(project).nTpl;
  return project.openings[k - nTpl] || null;
}

// ------------------------------------------------------------------ Erzeugen

/**
 * Neuer Betonumriss aus Punkten [[y,z]] (mm). Ein achsparalleles Rechteck, das symmetrisch zur z-Achse auf
 * z = 0 steht, wird als Vorlage «Rechteck» gespeichert, sonst als Polygon. Ersetzt einen bestehenden Umriss.
 * Rückgabe {replaced, type}.
 */
export function createOutline(project, pts) {
  const P = pts.map(([y, z]) => [r1(y), r1(z)]);
  if (P.length < 3 || Math.abs(signedArea(P)) < 1) throw new Error('Der Umriss hat keine Fläche – mindestens drei nicht auf einer Geraden liegende Punkte setzen.');
  if (selfIntersects(P)) throw new Error('Der Umriss schneidet sich selbst – die Eckpunkte der Reihe nach entlang des Randes setzen.');
  const replaced = hasOutline(project);
  project.openings = (project.openings || []).filter((o) => !o.fromTemplate);
  const ys = P.map((p) => p[0]), zs = P.map((p) => p[1]);
  const ymin = Math.min(...ys), ymax = Math.max(...ys), zmin = Math.min(...zs), zmax = Math.max(...zs);
  const isRect = P.length === 4 && P.every(([y, z]) => (y === ymin || y === ymax) && (z === zmin || z === zmax));
  if (isRect && Math.abs(ymin + ymax) < 1e-9 && Math.abs(zmin) < 1e-9) {
    project.shape.type = 'rect';
    project.shape.rect = { b: r1(ymax - ymin), h: r1(zmax - zmin) };
  } else {
    project.shape.type = 'poly';
    project.shape.poly = ptsToRows(orient(P, true), 1);
  }
  return { replaced, type: project.shape.type };
}

/** Neue Aussparung als Polygon; Rückgabe Editor-Index k. */
export function addOpening(project, pts, name) {
  const P = pts.map(([y, z]) => [r1(y), r1(z)]);
  if (P.length < 3 || Math.abs(signedArea(P)) < 1) throw new Error('Die Aussparung hat keine Fläche.');
  if (selfIntersects(P)) throw new Error('Die Aussparung schneidet sich selbst – Eckpunkte der Reihe nach setzen.');
  project.openings ||= [];
  project.openings.push({ name: name || `Öffnung ${project.openings.length + 1}`, pts: ptsToRows(orient(P, true), 1) });
  return openingKey(project, project.openings.length - 1);
}

/** Kreisförmige Aussparung (Hüllrohr) als flächengleiches 32-Eck; Rückgabe Editor-Index k. */
export function addDuct(project, [y, z], D) {
  if (!(D > 0)) throw new Error('Der Durchmesser muss positiv sein.');
  project.openings ||= [];
  const circle = { y: r1(y), z: r1(z), D: r1(D) };
  project.openings.push({ name: `Hüllrohr Ø${fmt0(D)}`, pts: ductPts(circle), circle });
  return openingKey(project, project.openings.length - 1);
}

const fmt0 = (v) => String(Math.round(v * 10) / 10);
const ductPts = (c) => ptsToRows(circlePts(c.y, c.z, c.D / 2, 32, true), 1);

/** Kreisaussparung neu berechnen (nach Änderung von Mittelpunkt oder Durchmesser). */
export function setDuct(project, k, values) {
  const o = openingAt(project, k);
  if (!o?.circle) return;
  Object.assign(o.circle, values);
  if (!(o.circle.D > 0)) throw new Error('Der Durchmesser muss positiv sein.');
  o.pts = ductPts(o.circle);
  if (/^Hüllrohr Ø/.test(o.name || '')) o.name = `Hüllrohr Ø${fmt0(o.circle.D)}`;
}

/** Stäbe anfügen; Rückgabe ihre IDs. */
export function addBars(project, bars) {
  project.bars ||= [];
  const i0 = project.bars.length;
  for (const b of bars) project.bars.push({ y: r1(b.y), z: r1(b.z), d: b.d });
  return bars.map((_, j) => `b:${i0 + j}`);
}

/** Vorschlag für die Stabzahl einer Reihe der Länge L [mm] (Abstand ≈ 100 mm, mindestens 2). */
export const rowCount = (L) => Math.max(2, Math.min(60, Math.round(L / 100) + 1));
/** Vorschlag für die Stabzahl auf einem Kreis mit Radius r [mm] (Abstand ≈ 150 mm, mindestens 4). */
export const circleCount = (r) => Math.max(4, Math.min(60, Math.round(2 * Math.PI * r / 150)));

/** Stabgruppe (Reihe oder Kreis) erzeugen: {kind: 'row'|'circle', a, b, n, d} → Stäbe in mm. */
export function groupBars(g) {
  if (g.kind === 'circle') {
    const r = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
    const phi0 = Math.atan2(g.b[1] - g.a[1], g.b[0] - g.a[0]) * 180 / Math.PI;
    return barsCircle(g.a[0], g.a[1], r, g.n, g.d, phi0);
  }
  return barsRow(g.a[0], g.a[1], g.b[0], g.b[1], g.n, g.d);
}

// ------------------------------------------------------------------ Verschieben, Kopieren, Löschen

/** Betroffene Eckpunkte und Stäbe einer Auswahl (Editor-Nummerierung). */
function collect(project, ids) {
  const eo = editableOutline(project);
  const outer = new Set(), bars = new Set(), whole = new Set();
  const open = new Map(); // k → Set der Eckpunkte
  const addOpen = (k, i) => { if (!open.has(k)) open.set(k, new Set()); open.get(k).add(i); };
  for (const x of ids.map(parseId)) {
    if (x.t === 'c') { eo.outer.forEach((_, i) => outer.add(i)); eo.openings.forEach((o, k) => { whole.add(k); o.pts.forEach((_, i) => addOpen(k, i)); }); }
    else if (x.t === 'v') outer.add(x.a);
    else if (x.t === 'e') { outer.add(x.a); outer.add((x.a + 1) % Math.max(1, eo.outer.length)); }
    else if (x.t === 'o' && eo.openings[x.a]) { whole.add(x.a); eo.openings[x.a].pts.forEach((_, i) => addOpen(x.a, i)); }
    else if (x.t === 'ov') addOpen(x.a, x.b);
    else if (x.t === 'oe' && eo.openings[x.a]) { addOpen(x.a, x.b); addOpen(x.a, (x.b + 1) % eo.openings[x.a].pts.length); }
    else if (x.t === 'b') bars.add(x.a);
  }
  return { outer, open, whole, bars };
}

/**
 * Auswahl um d = [dy, dz] (mm) verschieben bzw. kopieren.
 * Rückgabe {ids, converted (Bezeichnung der umgewandelten Vorlage oder null), skipped (nicht kopierbare Teile)}.
 */
export function moveSelection(project, ids, d, copy = false) {
  const [dy, dz] = d;
  if (copy) {
    const sel = collect(project, ids);
    const eo = editableOutline(project);
    const out = [];
    const bars = [...sel.bars].filter((i) => project.bars[i]).map((i) => ({ ...project.bars[i], y: project.bars[i].y + dy, z: project.bars[i].z + dz }));
    out.push(...addBars(project, bars));
    const skipped = ids.map(parseId).some((x) => ['c', 'v', 'e', 'ov', 'oe'].includes(x.t));
    for (const x of ids.map(parseId)) {
      if (x.t !== 'o' || !eo.openings[x.a]) continue;
      const o = eo.openings[x.a];
      const nw = { name: `${o.name} (Kopie)`, pts: ptsToRows(o.pts.map(([y, z]) => [y + dy, z + dz]), 1) };
      if (o.circle) nw.circle = { ...o.circle, y: r1(o.circle.y + dy), z: r1(o.circle.z + dz) };
      project.openings.push(nw);
      out.push(`o:${openingKey(project, project.openings.length - 1)}`);
    }
    return { ids: out, converted: null, skipped };
  }
  const converted = touchesTemplate(project, ids) ? convertToPoly(project) : null;
  normalize(project);
  const sel = collect(project, ids);
  const mv = (r) => { r.y = r1(r.y + dy); r.z = r1(r.z + dz); };
  const rows = project.shape.type === 'poly' ? project.shape.poly : [];
  for (const i of sel.outer) if (rows[i]) mv(rows[i]);
  for (const [k, verts] of sel.open) {
    const o = openingAt(project, k);
    if (!o) continue;
    for (const i of verts) if (o.pts[i]) mv(o.pts[i]);
    if (o.circle) {
      if (sel.whole.has(k)) { o.circle.y = r1(o.circle.y + dy); o.circle.z = r1(o.circle.z + dz); } else delete o.circle;
    }
  }
  for (const i of sel.bars) if (project.bars[i]) mv(project.bars[i]);
  return { ids, converted, skipped: false };
}

/** Auswahl löschen. Rückgabe {converted, outline (Beton gelöscht), counts}. */
export function removeSelection(project, ids) {
  const P = ids.map(parseId);
  const res = { converted: null, outline: false, bars: 0, openings: 0, vertices: 0 };
  normalize(project);
  // Stäbe
  const bars = [...new Set(P.filter((x) => x.t === 'b').map((x) => x.a))].sort((a, b) => b - a);
  for (const i of bars) if (project.bars[i]) { project.bars.splice(i, 1); res.bars++; }
  // Ganzer Beton: Umriss und alle Aussparungen; die Bewehrung bleibt
  if (P.some((x) => x.t === 'c')) {
    project.shape.type = 'poly';
    project.shape.poly = [];
    project.openings = [];
    res.outline = true;
    return res;
  }
  const geomIds = P.filter((x) => ['v', 'e', 'o', 'ov', 'oe'].includes(x.t));
  if (!geomIds.length) return res;
  if (touchesTemplate(project, ids)) res.converted = convertToPoly(project);
  // Aussparungen ganz
  const wholeOpen = new Set(geomIds.filter((x) => x.t === 'o').map((x) => x.a));
  // Eckpunkte von Aussparungen
  const openVerts = new Map();
  for (const x of geomIds) if (x.t === 'ov' && !wholeOpen.has(x.a)) { if (!openVerts.has(x.a)) openVerts.set(x.a, new Set()); openVerts.get(x.a).add(x.b); }
  for (const [k, verts] of openVerts) {
    const o = openingAt(project, k);
    if (!o) continue;
    o.pts = o.pts.filter((_, i) => !verts.has(i));
    delete o.circle;
    res.vertices += verts.size;
    if (o.pts.length < 3) wholeOpen.add(k);
  }
  const nTpl = editableOutline(project).nTpl; // nach Umwandlung 0
  for (const k of [...wholeOpen].sort((a, b) => b - a)) {
    if (project.openings[k - nTpl]) { project.openings.splice(k - nTpl, 1); res.openings++; }
  }
  // Eckpunkte des Umrisses
  const verts = new Set(geomIds.filter((x) => x.t === 'v').map((x) => x.a));
  if (verts.size && project.shape.type === 'poly') {
    project.shape.poly = project.shape.poly.filter((_, i) => !verts.has(i));
    res.vertices += verts.size;
    if (project.shape.poly.length < 3) { project.shape.poly = []; project.openings = []; res.outline = true; }
  }
  return res;
}

/** Eckpunkt in der Mitte einer Kante einfügen ('e:i' bzw. 'oe:k:i'). Rückgabe {id, converted}. */
export function insertVertex(project, edgeId) {
  const x = parseId(edgeId);
  const converted = touchesTemplate(project, [edgeId]) ? convertToPoly(project) : null;
  normalize(project);
  const rows = x.t === 'e' ? project.shape.poly : openingAt(project, x.a)?.pts;
  const i = x.t === 'e' ? x.a : x.b;
  if (!rows || !rows[i] || rows.length < 2) return { id: null, converted };
  const a = rows[i], b = rows[(i + 1) % rows.length];
  rows.splice(i + 1, 0, { y: r1((a.y + b.y) / 2), z: r1((a.z + b.z) / 2) });
  if (x.t === 'oe') delete openingAt(project, x.a).circle;
  return { id: x.t === 'e' ? `v:${i + 1}` : `ov:${x.a}:${i + 1}`, converted };
}

/** Koordinaten eines Eckpunkts setzen ('v:i' bzw. 'ov:k:i'). Rückgabe Bezeichnung einer umgewandelten Vorlage oder null. */
export function setVertex(project, id, y, z) {
  const x = parseId(id);
  const converted = touchesTemplate(project, [id]) ? convertToPoly(project) : null;
  normalize(project);
  const row = x.t === 'v' ? project.shape.poly[x.a] : openingAt(project, x.a)?.pts[x.b];
  if (row) { row.y = r1(y); row.z = r1(z); }
  if (x.t === 'ov') delete openingAt(project, x.a)?.circle;
  return converted;
}

/** Querschnitt (Umriss, Aussparungen, Bewehrung) so verschieben, dass der Schwerpunkt [cy, cz] in (0/0) liegt. */
export function moveToOrigin(project, cy, cz) {
  convertToPoly(project);
  const dy = r1(cy), dz = r1(cz);
  const mv = (r) => { r.y = r1(r.y - dy); r.z = r1(r.z - dz); };
  project.shape.poly.forEach(mv);
  (project.openings || []).forEach((o) => { o.pts.forEach(mv); if (o.circle) { o.circle.y = r1(o.circle.y - dy); o.circle.z = r1(o.circle.z - dz); } });
  (project.bars || []).forEach(mv);
  return [dy, dz];
}

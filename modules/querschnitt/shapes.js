// Querschnitt – Geometrie: Vorlagen, Polygon-Hilfsfunktionen, Bewehrungsgeneratoren (DOM-frei)
//
// Alle Masse in diesem Modul in mm. Koordinaten: y nach rechts, z nach oben.
// Vorlagen (Rechteck, Plattenbalken, Doppel-T, Hohlkasten, L) liegen mit der Unterkante auf z = 0;
// symmetrische Formen sind zur z-Achse (y = 0) zentriert, Kreis und Kreisring haben den Mittelpunkt in (0/0),
// der L-Winkel hat die äussere Ecke in (0/0).

import { polygonProps, signedArea, pointInPolygon } from '../../js/core/rcsection.js';

export { polygonProps, signedArea, pointInPolygon };

/** Verfügbare Querschnittsformen. */
export const SHAPE_TYPES = [
  { id: 'rect', label: 'Rechteck' },
  { id: 'T', label: 'Plattenbalken' },
  { id: 'I', label: 'Doppel-T' },
  { id: 'box', label: 'Hohlkasten' },
  { id: 'circle', label: 'Kreis' },
  { id: 'ring', label: 'Kreisring' },
  { id: 'L', label: 'L-Winkel' },
  { id: 'poly', label: 'Polygon frei' },
];

/** Parameter der Vorlagen: [Schlüssel, Bezeichnung, Hilfetext]. */
export const SHAPE_PARAMS = {
  rect: [['b', 'Breite b'], ['h', 'Höhe h']],
  T: [['b', 'Plattenbreite b'], ['hf', 'Plattenstärke h_f'], ['bw', 'Stegbreite b_w'], ['h', 'Gesamthöhe h']],
  I: [['bo', 'Breite oben b_o'], ['to', 'Gurt oben t_o'], ['bu', 'Breite unten b_u'], ['tu', 'Gurt unten t_u'], ['bw', 'Stegbreite b_w'], ['h', 'Gesamthöhe h']],
  box: [['bo', 'Platte oben b_o'], ['bu', 'Kasten unten b_u'], ['h', 'Gesamthöhe h'], ['to', 'Dicke oben t_o'], ['tu', 'Dicke unten t_u'], ['tw', 'Stegdicke t_w']],
  circle: [['D', 'Durchmesser D']],
  ring: [['D', 'Aussen-Ø D'], ['t', 'Wandstärke t']],
  L: [['b', 'Schenkel unten b'], ['h', 'Schenkel links h'], ['tb', 'Dicke unten t_b'], ['th', 'Dicke links t_h']],
};

/** Standardparameter aller Vorlagen (mm). */
export function defaultShapes() {
  return {
    type: 'rect',
    rect: { b: 300, h: 600 },
    T: { b: 1500, hf: 200, bw: 350, h: 900 },
    I: { bo: 500, to: 150, bu: 500, tu: 180, bw: 160, h: 1000 },
    box: { bo: 4000, bu: 2400, h: 1600, to: 250, tu: 220, tw: 350 },
    circle: { D: 500 },
    ring: { D: 1000, t: 200 },
    L: { b: 600, h: 600, tb: 200, th: 200 },
    poly: [{ y: -150, z: 0 }, { y: 150, z: 0 }, { y: 150, z: 600 }, { y: -150, z: 600 }],
  };
}

/** Anzahl Polygonseiten für Kreise. */
export const CIRCLE_SEGMENTS = 72;

/**
 * Kreis als Polygon mit flächengleichem Radius (A_Polygon = π·r²), Gegenuhrzeigersinn.
 * Für n = 72 weicht der Radius um 0.06 % vom Nennradius ab; Iy, Iz stimmen auf < 0.1 %.
 */
export function circlePts(yc, zc, r, n = CIRCLE_SEGMENTS, equalArea = true) {
  const f = equalArea ? Math.sqrt(2 * Math.PI / (n * Math.sin(2 * Math.PI / n))) : 1;
  const R = r * f;
  return Array.from({ length: n }, (_, i) => {
    const a = 2 * Math.PI * i / n;
    return [yc + R * Math.cos(a), zc + R * Math.sin(a)];
  });
}

const pos = (v) => Number.isFinite(v) && v > 0;

/**
 * Polygone einer Vorlage: {outer: [[y,z],…], holes: [[[y,z],…],…]} in mm.
 * Wirft einen Error mit verständlicher Meldung bei unzulässigen Parametern.
 */
export function templatePolygons(type, p) {
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  switch (type) {
    case 'rect': {
      need(pos(p.b) && pos(p.h), 'Rechteck: Breite und Höhe müssen positiv sein.');
      return { outer: [[-p.b / 2, 0], [p.b / 2, 0], [p.b / 2, p.h], [-p.b / 2, p.h]], holes: [] };
    }
    case 'T': {
      need(pos(p.b) && pos(p.hf) && pos(p.bw) && pos(p.h), 'Plattenbalken: alle Abmessungen müssen positiv sein.');
      need(p.hf < p.h, 'Plattenbalken: Plattenstärke hf muss kleiner als die Gesamthöhe h sein.');
      need(p.bw <= p.b, 'Plattenbalken: Stegbreite bw darf die Plattenbreite b nicht überschreiten.');
      if (p.bw === p.b) return templatePolygons('rect', { b: p.b, h: p.h });
      const hw = p.h - p.hf;
      return {
        outer: [[-p.bw / 2, 0], [p.bw / 2, 0], [p.bw / 2, hw], [p.b / 2, hw], [p.b / 2, p.h], [-p.b / 2, p.h], [-p.b / 2, hw], [-p.bw / 2, hw]],
        holes: [],
      };
    }
    case 'I': {
      need(['bo', 'to', 'bu', 'tu', 'bw', 'h'].every((k) => pos(p[k])), 'Doppel-T: alle Abmessungen müssen positiv sein.');
      need(p.to + p.tu < p.h, 'Doppel-T: Gurtdicken to + tu müssen kleiner als die Gesamthöhe h sein.');
      need(p.bw <= p.bo && p.bw <= p.bu, 'Doppel-T: Stegbreite bw darf die Gurtbreiten nicht überschreiten.');
      const { bo, to, bu, tu, bw, h } = p;
      const pts = [[-bu / 2, 0], [bu / 2, 0], [bu / 2, tu], [bw / 2, tu], [bw / 2, h - to], [bo / 2, h - to], [bo / 2, h], [-bo / 2, h], [-bo / 2, h - to], [-bw / 2, h - to], [-bw / 2, tu], [-bu / 2, tu]];
      return { outer: dedupe(pts), holes: [] };
    }
    case 'box': {
      need(['bo', 'bu', 'h', 'to', 'tu', 'tw'].every((k) => pos(p[k])), 'Hohlkasten: alle Abmessungen müssen positiv sein.');
      need(p.bo >= p.bu, 'Hohlkasten: die obere Platte bo muss mindestens so breit wie der Kasten bu sein.');
      need(p.to + p.tu < p.h, 'Hohlkasten: Plattendicken to + tu müssen kleiner als die Gesamthöhe h sein.');
      need(2 * p.tw < p.bu, 'Hohlkasten: zwei Stegdicken 2·tw müssen kleiner als die Breite bu sein.');
      const { bo, bu, h, to, tu, tw } = p;
      const outer = bo > bu
        ? [[-bu / 2, 0], [bu / 2, 0], [bu / 2, h - to], [bo / 2, h - to], [bo / 2, h], [-bo / 2, h], [-bo / 2, h - to], [-bu / 2, h - to]]
        : [[-bu / 2, 0], [bu / 2, 0], [bu / 2, h], [-bu / 2, h]];
      const hole = [[-bu / 2 + tw, tu], [bu / 2 - tw, tu], [bu / 2 - tw, h - to], [-bu / 2 + tw, h - to]];
      return { outer, holes: [hole] };
    }
    case 'circle': {
      need(pos(p.D), 'Kreis: Durchmesser muss positiv sein.');
      return { outer: circlePts(0, 0, p.D / 2), holes: [] };
    }
    case 'ring': {
      need(pos(p.D) && pos(p.t), 'Kreisring: Durchmesser und Wandstärke müssen positiv sein.');
      need(2 * p.t < p.D, 'Kreisring: die Wandstärke muss kleiner als der halbe Durchmesser sein.');
      return { outer: circlePts(0, 0, p.D / 2), holes: [circlePts(0, 0, p.D / 2 - p.t)] };
    }
    case 'L': {
      need(['b', 'h', 'tb', 'th'].every((k) => pos(p[k])), 'L-Winkel: alle Abmessungen müssen positiv sein.');
      need(p.tb < p.h && p.th < p.b, 'L-Winkel: die Schenkeldicken müssen kleiner als die Schenkellängen sein.');
      return { outer: [[0, 0], [p.b, 0], [p.b, p.tb], [p.th, p.tb], [p.th, p.h], [0, p.h]], holes: [] };
    }
    default:
      throw new Error(`Unbekannte Querschnittsform «${type}».`);
  }
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) out.pop();
  }
  // kollineare Zwischenpunkte entfernen
  return out.filter((p, i) => {
    const a = out[(i + out.length - 1) % out.length], c = out[(i + 1) % out.length];
    return Math.abs((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) > 1e-9;
  });
}

/** Punkteliste [{y,z}] → [[y,z]] (ungültige Zeilen werden übersprungen). */
export function rowsToPts(rows) {
  return (rows || []).filter((r) => Number.isFinite(r?.y) && Number.isFinite(r?.z)).map((r) => [r.y, r.z]);
}

export function ptsToRows(pts, digits = 1) {
  const f = 10 ** digits;
  return pts.map(([y, z]) => ({ y: Math.round(y * f) / f, z: Math.round(z * f) / f }));
}

/** Orientierung setzen: ccw = true → Gegenuhrzeigersinn. */
export function orient(pts, ccw = true) {
  const a = signedArea(pts);
  return (a > 0) === ccw ? pts.slice() : pts.slice().reverse();
}

/** Prüft, ob sich zwei nicht benachbarte Polygonseiten schneiden. */
export function selfIntersects(pts) {
  const n = pts.length;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const segX = (p1, p2, p3, p4) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segX(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Begrenzungsrechteck mehrerer Punktlisten. */
export function bounds(...lists) {
  let ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const pts of lists) for (const [y, z] of pts) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
  return { ymin, ymax, zmin, zmax, b: ymax - ymin, h: zmax - zmin };
}

/**
 * Materialintervalle [y0, y1] auf der Höhe z (horizontaler Schnitt durch Aussenpolygon minus Löcher).
 */
export function chordIntervals(outer, holes, z) {
  const xs = (pts) => {
    const out = [];
    for (let i = 0, n = pts.length; i < n; i++) {
      const [y1, z1] = pts[i], [y2, z2] = pts[(i + 1) % n];
      if ((z1 > z) !== (z2 > z)) out.push(y1 + (z - z1) * (y2 - y1) / (z2 - z1));
    }
    return out;
  };
  const all = [...xs(outer), ...holes.flatMap((h) => xs(h))].sort((a, b) => a - b);
  const iv = [];
  for (let i = 0; i + 1 < all.length; i += 2) if (all[i + 1] - all[i] > 1e-9) iv.push([all[i], all[i + 1]]);
  return iv;
}

/** Summe der Materialbreiten auf der Höhe z. */
export function chordWidth(outer, holes, z) {
  return chordIntervals(outer, holes, z).reduce((s, [a, b]) => s + b - a, 0);
}

/**
 * Parallelverschiebung eines Polygons um a nach links der Laufrichtung
 * (bei Gegenuhrzeigersinn: nach innen). Ecken als Schnittpunkte der verschobenen Seiten.
 */
export function offsetPolygon(pts, a) {
  const n = pts.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const nx = -dy / L, ny = dx / L;
    lines.push({ p: [p[0] + nx * a, p[1] + ny * a], d: [dx / L, dy / L] });
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[(i + lines.length - 1) % lines.length], l2 = lines[i];
    const den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
    if (Math.abs(den) < 1e-9) { out.push(l2.p); continue; }
    const t = ((l2.p[0] - l1.p[0]) * l2.d[1] - (l2.p[1] - l1.p[1]) * l2.d[0]) / den;
    out.push([l1.p[0] + l1.d[0] * t, l1.p[1] + l1.d[1] * t]);
  }
  return out;
}

// ------------------------------------------------------------------ Projektgeometrie

/**
 * Geometrie eines Projekts in mm.
 * Rückgabe {outer, holes, bars:[{y,z,d,i}], b, errors[], warnings[]}
 */
export function projectGeometry(project) {
  const shape = project.shape || defaultShapes();
  const errors = [], warnings = [];
  let outer = [], holes = [];
  try {
    if (shape.type === 'poly') {
      outer = rowsToPts(shape.poly);
      if (outer.length < 3) throw new Error('Das Polygon benötigt mindestens 3 Eckpunkte – bitte in der Tabelle «Eckpunkte» ergänzen.');
      if (selfIntersects(outer)) throw new Error('Das Polygon schneidet sich selbst. Bitte die Eckpunkte der Reihe nach entlang des Randes eingeben (im oder gegen den Uhrzeigersinn).');
      if (Math.abs(signedArea(outer)) < 1e-6) throw new Error('Das Polygon hat keine Fläche. Bitte mindestens 3 nicht auf einer Geraden liegende Eckpunkte eingeben.');
    } else {
      const t = templatePolygons(shape.type, shape[shape.type] || {});
      outer = t.outer; holes = t.holes;
    }
  } catch (e) {
    errors.push(e.message);
  }
  outer = outer.length ? orient(outer, true) : outer;
  holes = holes.map((h) => orient(h, false));
  (project.openings || []).forEach((o, k) => {
    const pts = rowsToPts(o.pts);
    const name = o.name || `Aussparung ${k + 1}`;
    if (pts.length < 3) { warnings.push(`${name}: weniger als 3 Eckpunkte – nicht berücksichtigt.`); return; }
    if (selfIntersects(pts)) { warnings.push(`${name}: Polygon schneidet sich selbst – nicht berücksichtigt. Eckpunkte der Reihe nach entlang des Randes eingeben.`); return; }
    if (Math.abs(signedArea(pts)) < 1e-6) { warnings.push(`${name}: ohne Fläche – nicht berücksichtigt.`); return; }
    if (outer.length && !pts.every((p) => pointInPolygon(p, outer) || onBoundary(p, outer))) warnings.push(`${name} liegt nicht vollständig im Querschnitt.`);
    holes.push(orient(pts, false));
  });
  const bars = [];
  (project.bars || []).forEach((b, i) => {
    if (!Number.isFinite(b.y) || !Number.isFinite(b.z) || !(b.d > 0)) return;
    bars.push({ y: b.y, z: b.z, d: b.d, i });
  });
  if (outer.length) {
    for (const b of bars) {
      const inside = pointInPolygon([b.y, b.z], outer) && !holes.some((h) => pointInPolygon([b.y, b.z], h));
      if (!inside) warnings.push(`Stab ${b.i + 1} liegt ausserhalb des Betonquerschnitts.`);
    }
    for (let i = 0; i < bars.length; i++) for (let j = i + 1; j < bars.length; j++) {
      const a = bars[i], c = bars[j];
      if (Math.hypot(a.y - c.y, a.z - c.z) < (a.d + c.d) / 2 - 1e-6) warnings.push(`Stäbe ${a.i + 1} und ${c.i + 1} überlappen sich.`);
    }
  }
  return { type: shape.type, outer, holes, bars, errors, warnings: warnings.slice(0, 12) };
}

function onBoundary(p, pts, tol = 1e-6) {
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    if (Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) < tol * Math.max(1, Math.sqrt(L2))) return true;
  }
  return false;
}

/** Umwandlung der aktuellen Vorlage in ein freies Polygon (Aussparungen der Vorlage → Aussparungen). */
export function templateToPoly(shape) {
  const t = templatePolygons(shape.type, shape[shape.type]);
  const label = SHAPE_TYPES.find((s) => s.id === shape.type)?.label || shape.type;
  return {
    poly: ptsToRows(orient(t.outer, true), 2),
    openings: t.holes.map((h, k) => ({ name: `${label} innen${t.holes.length > 1 ? ' ' + (k + 1) : ''}`, pts: ptsToRows(orient(h, true), 2) })),
  };
}

// ------------------------------------------------------------------ Bewehrungsgeneratoren (mm)

const r1 = (v) => Math.round(v * 10) / 10;

/** n Stäbe gleichmässig zwischen zwei Punkten (inkl. Endpunkte). */
export function barsRow(y1, z1, y2, z2, n, d) {
  n = Math.max(1, Math.round(n));
  if (n === 1) return [{ y: r1((y1 + y2) / 2), z: r1((z1 + z2) / 2), d }];
  return Array.from({ length: n }, (_, i) => ({ y: r1(y1 + (y2 - y1) * i / (n - 1)), z: r1(z1 + (z2 - z1) * i / (n - 1)), d }));
}

/** n Stäbe auf einem Kreis, Startwinkel phi0 [°] (0° = +y, Gegenuhrzeigersinn). */
export function barsCircle(yc, zc, r, n, d, phi0 = 90) {
  n = Math.max(1, Math.round(n));
  return Array.from({ length: n }, (_, i) => {
    const a = (phi0 + 360 * i / n) * Math.PI / 180;
    return { y: r1(yc + r * Math.cos(a)), z: r1(zc + r * Math.sin(a)), d };
  });
}

/**
 * Lagen unten/oben für beliebige (nicht kreisförmige) Querschnitte.
 * opts: {nBot, dBot, nTop, dTop, c (Betonüberdeckung), dw (Bügeldurchmesser)}
 * Achsabstand a = c + dw + Ø/2. Die Lage wird im breitesten Materialintervall auf der Höhe zmin + a
 * (bzw. zmax − a) mit Randabstand a verteilt.
 */
export function barsLayers(geom, opts) {
  const { outer, holes } = geom;
  const bb = bounds(outer);
  const out = [];
  const layer = (n, d, z) => {
    if (!(n >= 1) || !(d > 0)) return;
    const a = (opts.c || 0) + (opts.dw || 0) + d / 2;
    const zz = z === 'bot' ? bb.zmin + a : bb.zmax - a;
    const iv = chordIntervals(outer, holes, zz);
    if (!iv.length) return;
    const [y0, y1] = iv.reduce((m, x) => (x[1] - x[0] > m[1] - m[0] ? x : m));
    if (y1 - y0 < 2 * a) { out.push({ y: r1((y0 + y1) / 2), z: r1(zz), d }); return; }
    out.push(...barsRow(y0 + a, zz, y1 - a, zz, n, d));
  };
  layer(opts.nBot, opts.dBot, 'bot');
  layer(opts.nTop, opts.dTop, 'top');
  return out;
}

/**
 * Umlaufende Randbewehrung entlang aller Ränder (auch Aussparungen) mit Achsabstand a = c + dw + Ø/2
 * und maximalem Stababstand s. Stäbe in allen Ecken.
 */
export function barsPerimeter(geom, opts) {
  const d = opts.d, s = Math.max(opts.s || 200, d * 2);
  const a = (opts.c || 0) + (opts.dw || 0) + d / 2;
  const out = [];
  const rings = [orient(geom.outer, true), ...geom.holes.map((h) => orient(h, false))];
  for (const ring of rings) {
    let pts = offsetPolygon(ring, a);
    // sehr kurze Seiten zusammenfassen (z.B. Kreise)
    const merged = [];
    for (const p of pts) {
      const q = merged[merged.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1.5 * d) merged.push(p);
    }
    if (merged.length > 2 && Math.hypot(merged[0][0] - merged[merged.length - 1][0], merged[0][1] - merged[merged.length - 1][1]) <= 1.5 * d) merged.pop();
    pts = merged;
    if (pts.length < 3 || Math.abs(signedArea(pts)) < 1e-6 || (signedArea(pts) > 0) !== (signedArea(ring) > 0)) continue; // zu klein
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const m = Math.max(1, Math.ceil(L / s - 1e-9));
      for (let k = 0; k < m; k++) out.push({ y: r1(p[0] + (q[0] - p[0]) * k / m), z: r1(p[1] + (q[1] - p[1]) * k / m), d });
    }
  }
  return out;
}

/**
 * Bewehrung nach Vorlage für Kreis/Kreisring: n Stäbe aussen, optional nInner Stäbe innen (Ring).
 * opts: {n, d, nInner, dInner, c, dw}
 */
export function barsCircular(shape, opts) {
  const p = shape[shape.type] || {};
  const R = p.D / 2;
  const out = [];
  const a = (d) => (opts.c || 0) + (opts.dw || 0) + d / 2;
  if (opts.n >= 1 && opts.d > 0) out.push(...barsCircle(0, 0, R - a(opts.d), opts.n, opts.d, 90));
  if (shape.type === 'ring' && opts.nInner >= 1 && (opts.dInner || opts.d) > 0) {
    const di = opts.dInner || opts.d;
    out.push(...barsCircle(0, 0, R - p.t + a(di), opts.nInner, di, 90 + 180 / opts.nInner));
  }
  return out;
}

/** Querschnittsfläche eines Stabes [mm²]. */
export const barAreaMm2 = (d) => Math.PI * d * d / 4;

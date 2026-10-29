// Eingaberegister des Plattenmoduls (Karten, Listen mit Detailansicht, Koordinatentabellen)
import {
  h, group, numField, selectField, checkField, textField, dataTable, button, modal, toast, parseNum, listEditor, badge, rich,
} from '../../js/core/ui.js';
import { subHtml as I } from '../../js/core/format.js';
import { fmt } from '../../js/core/format.js';
import { CONCRETE_CLASSES, REBAR_GRADES, NORMS, concrete, rebar, barAreaPerM } from '../../js/core/materials.js';
import {
  LOAD_CATEGORIES, COMBO_TYPES, defaultCombos, comboFormula, comboTypeLabel, newId, estimateNodes, layerLabel,
} from './calc.js';
import { effectiveDepths } from './design.js';
import { idForRow, concreteOptions, regionLoads } from './editing.js';
import { nextSlabId, nextAreaId, addWallsOnFreeEdges } from './model.js';
import { signedArea } from './geom.js';

const XY = [
  { key: 'x', label: 'x', unit: 'm' },
  { key: 'y', label: 'y', unit: 'm' },
];
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** Tabellenzeile → Auswahl in der Grafik (Editor). */
function sel(app, kind, i, j) {
  let ids;
  if (kind === 'al') {
    const reg = app.project.areaLoads[i]?.region;
    const ka = app.project.loadAreas.findIndex((a) => a.id === reg);
    const ks = app.project.slabs.findIndex((s) => s.id === reg);
    ids = ka >= 0 ? [`a:${ka}`] : ks >= 0 ? [`s:${ks}`] : [];
  } else ids = idForRow(kind, i, j);
  if (app.editor && ids.length) app.editor.select(ids);
}

const rectPts = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

function slabsBox(p) {
  const pts = p.slabs.flatMap((s) => s.outline).filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  if (!pts.length) return null;
  return {
    x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)),
    y0: Math.min(...pts.map((q) => q.y)), y1: Math.max(...pts.map((q) => q.y)),
  };
}

const lcOptions = (p) => () => p.loadCases.map((l) => ({ value: l.id, label: l.name || l.id }));

function defaultLc(p, prefer = 'Q') {
  return (p.loadCases.find((l) => l.type === prefer) || p.loadCases[0])?.id || '';
}

/** Nach Hinzufügen/Duplizieren bleibt der neue Eintrag geöffnet, nach Löschen keiner. */
const keepOpen = (e) => (e.type === 'add' || e.type === 'duplicate' ? e.index : null);

const polyArea = (pts) => Math.abs(signedArea(pts.map((q) => [num(q.x), num(q.y)])));

/** Ziele für Flächenlasten: alle Platten, einzelne Platten, Lastflächen. */
export function regionOptions(p) {
  return [
    { value: 'all', label: p.slabs.length > 1 ? 'alle Platten' : 'ganze Platte' },
    ...(p.slabs.length > 1 ? p.slabs.map((s) => ({ value: s.id, label: `Platte: ${s.name}` })) : p.slabs.map((s) => ({ value: s.id, label: `nur ${s.name}` }))),
    ...p.loadAreas.map((a, i) => ({ value: a.id, label: `Fläche: ${a.name || `Lastfläche ${i + 1}`}` })),
  ];
}

// ------------------------------------------------------------------ 1 Platten

export function geometryTab(el, app) {
  const p = app.project;
  const chIn = () => app.changed({ inputs: true });
  el.append(group(`Platten (${p.slabs.length})`, [
    listEditor(p.slabs, {
      active: app.openSlab ?? null,
      onActive: (i) => { app.openSlab = i; if (i !== null) sel(app, 'slab', i); },
      label: (s) => s.name,
      sub: (s) => `h = ${fmt(num(s.h), 2)} m · ${s.concrete || p.concrete} · ${fmt(polyArea(s.outline), 1)} m²`,
      swatch: () => 'var(--c-struct)',
      badge: (s) => { const n = p.areaLoads.filter((l) => l.region === s.id).length; return n ? badge(`${n} Last${n === 1 ? '' : 'en'}`, 'info') : null; },
      empty: 'Noch keine Platte – in der Grafik mit «Platte» (U) zeichnen oder unten ein Rechteck anlegen.',
      duplicate: (s) => {
        const b = slabsBox(p);
        const dx = b ? b.x1 - b.x0 + 1 : 0;
        return { ...JSON.parse(JSON.stringify(s)), id: nextSlabId(p), name: `${s.name} (Kopie)`, outline: s.outline.map((q) => ({ x: q.x + dx, y: q.y })) };
      },
      onRemove: (i) => { const id = p.slabs[i]?.id; p.areaLoads = p.areaLoads.filter((l) => l.region !== id); },
      onChange: (e) => { app.openSlab = keepOpen(e); app.editor?.select([]); chIn(); },
      detail: (d, s, i) => slabDetail(d, s, i, app),
      add: [
        { label: 'Rechteck …', icon: 'grid', create: () => { rectDialog(app); return null; } },
        { label: 'Zeichnen', icon: 'edit', create: () => { app.setViewMode?.('system'); app.editor?.setTool('slab'); app.status('Eckpunkte der Platte in die Grafik klicken – Klick auf den ersten Punkt schliesst.'); return null; } },
      ],
    }),
  ], { info: 'Eine oder mehrere Platten. Platten mit gemeinsamen Rändern sind biegesteif verbunden; eine Platte innerhalb einer anderen überschreibt dort Dicke und Beton (Verstärkung, dünnerer Bereich). Flächenlasten können je Platte zugeordnet werden.' }));

  el.append(group(`Öffnungen (${p.openings.length})`, [
    listEditor(p.openings, {
      active: app.openHole ?? null,
      onActive: (i) => { app.openHole = i; if (i !== null) sel(app, 'opening', i); },
      label: (o, i) => o.name && o.name !== 'Öffnung' ? o.name : `Öffnung ${i + 1}`,
      sub: (o) => `${o.pts.length} Punkte · ${fmt(polyArea(o.pts), 2)} m²`,
      swatch: () => 'var(--text-3)',
      empty: 'Keine Öffnungen.',
      onChange: (e) => { app.openHole = keepOpen(e); app.editor?.select([]); chIn(); },
      detail: (d, o, i) => {
        d.append(textField('Bezeichnung', o, 'name', { onChange: chIn }));
        d.append(dataTable(XY, o.pts, { minRows: 3, onChange: () => app.changed(), onSelect: (j) => sel(app, 'opening', i, j), newRow: (rows) => ({ ...rows[rows.length - 1] }) }));
      },
      add: [{ label: 'Rechteck 1 × 1 m', create: () => {
        const b = slabsBox(p);
        if (!b) { toast('Zuerst eine Platte anlegen.', 'warn'); return null; }
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        return { name: '', pts: rectPts(+(cx - 0.5).toFixed(2), +(cy - 0.5).toFixed(2), +(cx + 0.5).toFixed(2), +(cy + 0.5).toFixed(2)) };
      } }],
    }),
  ], { collapsed: !p.openings.length, info: 'Aussparungen (Treppen, Schächte), vollständig innerhalb der Platten. In der Grafik mit «Öffnung» (O) zeichnen. Öffnungen nahe bei Stützen verkürzen den Durchstanz-Nachweisschnitt automatisch.' }));

  const matInfo = h('div', { class: 'muted small' });
  const est = h('div', { class: 'muted small' });
  const upd = () => {
    try {
      const c = concrete(p.concrete, { norm: p.norm });
      matInfo.replaceChildren(rich(`E_cm = ${fmt(c.Ecm / 1000, 1)} GPa · f_cd = ${fmt(c.fcd, 1)} MPa${c.tcd ? ` · τ_cd = ${fmt(c.tcd, 2)} MPa` : ''}`));
    } catch { matInfo.replaceChildren(); }
    const n = estimateNodes(p);
    est.textContent = Number.isFinite(n) && n > 0 ? `≈ ${fmt(n, 0)} Knoten${n > 20000 ? ' – zu fein' : n > 6000 ? ' – Rechnung dauert einige Sekunden' : ''}` : '';
  };
  upd();
  const ch = () => { upd(); app.changed(); };
  el.append(group('Baustoff und Netz', [
    selectField('Norm', p, 'norm', NORMS, { onChange: ch, info: 'Betonkennwerte, Spannungsblock der Biegebemessung und Durchstanzverfahren nach SIA 262 bzw. EN 1992-1-1.' }),
    selectField('Beton', p, 'concrete', CONCRETE_CLASSES, { onChange: () => { upd(); chIn(); }, info: 'Projektbeton; einzelne Platten können eine eigene Sorte haben.' }),
    matInfo,
    numField('Netzweite', p, 'meshSize', { unit: 'm', min: 0.02, digits: 3, onChange: ch, info: 'Mittlere Elementgrösse; Richtwert Spannweite/12 … /20. Vorschau in der Ansicht «Netz».' }),
    est,
  ]));

  el.append(group('Erweitert', [
    numField('Querdehnzahl ν', p, 'nu', { min: 0, max: 0.45, digits: 2, onChange: ch, info: 'Ungerissen ν = 0.2; gerissen darf ν = 0 gesetzt werden (EN 1992-1-1, 3.1.3(4)).' }),
    numField('Dicke neuer Platten', p, 'h', { unit: 'm', min: 0.05, max: 3, digits: 3, onChange: ch, info: 'Vorgabe für neu gezeichnete Platten.' }),
    checkField('Netz bei Stützen verfeinern', p, 'refineColumns', { onChange: ch, info: 'Abgestufte Knotenringe um Punktlager für genauere Stützmomente.' }),
    checkField('Stützenkopf b × h starr', p, 'columnHeads', { onChange: ch, info: 'Die Platte wird über dem Stützenquerschnitt versteift; Momente am Stützenrand statt singulärer Spitze im Zentrum.' }),
  ], { collapsed: true }));
}

function slabDetail(d, s, i, app) {
  const p = app.project;
  const chIn = () => app.changed({ inputs: true });
  d.append(textField('Bezeichnung', s, 'name', { onChange: chIn }));
  d.append(h('div', { class: 'grid2' },
    numField('Dicke h', s, 'h', { unit: 'm', min: 0.05, max: 3, digits: 3, onChange: chIn, info: 'Richtwert h ≈ L/30 (zweiachsig) bzw. L/25 (Flachdecke).' }),
    selectField('Beton', s, 'concrete', concreteOptions(p), { onChange: chIn })));
  d.append(h('div', { class: 'ed-sub' }, 'Eckpunkte'));
  d.append(dataTable(XY, s.outline, {
    minRows: 3,
    onChange: () => app.changed(),
    onSelect: (j) => sel(app, 'slab', i, j),
    newRow: (rows) => ({ ...rows[rows.length - 1] }),
  }));
  d.append(h('div', { class: 'ed-sub' }, 'Flächenlasten auf dieser Platte'));
  d.append(...regionLoads(app, s.id, () => {}));
  d.append(h('div', { class: 'row' }, button('Wände an freien Rändern', { icon: 'plus', small: true, title: 'Linienlager auf allen freien Rändern dieser Platte', onClick: () => {
    const n = addWallsOnFreeEdges(p, i);
    toast(n ? `${n} Wände ergänzt` : 'Alle freien Ränder sind bereits gelagert', n ? 'ok' : 'info');
    chIn();
  } })));
}

function rectDialog(app) {
  const p = app.project;
  const b = slabsBox(p);
  const o = { x0: b ? +(b.x1).toFixed(3) : 0, y0: b ? +(b.y0).toFixed(3) : 0, lx: 8, ly: 6, h: p.h, walls: true };
  const body = h('div', {},
    h('div', { class: 'grid2' },
      numField('x_0', o, 'x0', { unit: 'm' }), numField('y_0', o, 'y0', { unit: 'm' }),
      numField('Länge L_x', o, 'lx', { unit: 'm', min: 0.1 }), numField('Breite L_y', o, 'ly', { unit: 'm', min: 0.1 }),
      numField('Dicke h', o, 'h', { unit: 'm', min: 0.05, max: 3 })),
    checkField('Wände an freien Rändern', o, 'walls'));
  modal('Rechteckige Platte', body, [
    { label: 'Abbrechen' },
    { label: 'Anlegen', primary: true, onClick: () => {
      if (!(o.lx > 0 && o.ly > 0)) { toast('Bitte positive Abmessungen eingeben.', 'warn'); return false; }
      const k = p.slabs.length;
      p.slabs.push({ id: nextSlabId(p), name: `Platte ${k + 1}`, outline: rectPts(o.x0, o.y0, o.x0 + o.lx, o.y0 + o.ly), h: o.h, concrete: '' });
      if (o.walls) addWallsOnFreeEdges(p, k);
      app.openSlab = k;
      app.view.fitted = false;
      app.changed({ inputs: true });
      app.editor?.select([`s:${k}`]);
      return true;
    } },
  ]);
}

// ------------------------------------------------------------------ 2 Lager

export function supportTab(el, app) {
  const p = app.project;
  el.append(group(`Stützen (${p.pointSupports.length})`, [
    dataTable([
      ...XY,
      { key: 'b', label: 'b', unit: 'm', digits: 3, min: 0, info: 'Abmessung in x-Richtung (Durchstanzen, starrer Stützenkopf); 0 = Punktlager ohne Nachweis.' },
      { key: 'hc', label: 'h', unit: 'm', digits: 3, min: 0, info: 'Abmessung in y-Richtung.' },
      { key: 'kz', label: 'k_z', unit: 'kN/m', allowEmpty: true, min: 0, info: I('Vertikale Feder; leer = starr. Stütze unten eingespannt: k_z ≈ E·A/L.') },
      { key: 'kr', label: 'k_φ', unit: 'kNm/rad', allowEmpty: true, min: 0, info: I('Drehfeder um x und y; leer = gelenkig. k_φ ≈ 4·E·I/L je Geschoss.') },
    ], p.pointSupports, {
      newRow: (rows) => ({ x: rows[rows.length - 1]?.x ?? 0, y: rows[rows.length - 1]?.y ?? 0, b: 0.3, hc: 0.3, kz: null, kr: null }),
      onChange: () => app.changed(),
      onSelect: (i) => sel(app, 'ps', i),
      extraButtons: [button('Raster …', { icon: 'grid', small: true, title: 'Stützen in einem Achsraster erzeugen', onClick: () => gridDialog(app) })],
    }),
  ], { info: 'Stützen S1, S2 … im Zentrum (x, y); in der Grafik mit «Stütze» (S). Auflagerkräfte positiv = Druck auf das Lager.' }));

  el.append(group(`Wände (${p.lineSupports.length})`, [
    dataTable([
      { key: 'x1', label: 'x_1', unit: 'm' }, { key: 'y1', label: 'y_1', unit: 'm' },
      { key: 'x2', label: 'x_2', unit: 'm' }, { key: 'y2', label: 'y_2', unit: 'm' },
      { key: 'clamped', label: 'eing.', type: 'check', info: 'Eingespannt: keine Verdrehung um die Wandachse (Kragplatte, steifer Anschluss). Sonst gelenkig.' },
    ], p.lineSupports, {
      newRow: (rows) => ({ x1: rows[rows.length - 1]?.x2 ?? 0, y1: rows[rows.length - 1]?.y2 ?? 0, x2: rows[rows.length - 1]?.x2 ?? 0, y2: rows[rows.length - 1]?.y2 ?? 0, clamped: false }),
      onChange: () => app.changed(),
      onSelect: (i) => sel(app, 'ls', i),
      extraButtons: [button('An freien Rändern', { icon: 'plus', small: true, title: 'Linienlager auf allen freien Plattenrändern ergänzen', onClick: () => {
        const n = addWallsOnFreeEdges(p);
        toast(n ? `${n} Wände ergänzt` : 'Alle freien Ränder sind bereits gelagert', n ? 'ok' : 'info');
        app.changed({ inputs: true });
      } })],
    }),
  ], { info: I('Linienlager von (x_1, y_1) nach (x_2, y_2), vertikal starr; in der Grafik mit «Wand» (W). Auch im Platteninnern möglich.') }));
}

function gridDialog(app) {
  const p = app.project;
  const o = { xs: '0; 6.5; 13', ys: '0; 6.5', b: 0.3, hc: 0.3, replace: true };
  const body = h('div', {},
    textField('Achsen x [m]', o, 'xs'),
    textField('Achsen y [m]', o, 'ys'),
    h('div', { class: 'grid2' }, numField('Stütze b', o, 'b', { unit: 'm', min: 0 }), numField('Stütze h', o, 'hc', { unit: 'm', min: 0 })),
    checkField('Vorhandene Stützen ersetzen', o, 'replace'),
    h('div', { class: 'muted small' }, 'Achsen durch Strichpunkt oder Leerzeichen trennen, z.B. «0; 6.5; 13». Nur Punkte innerhalb der Platten werden belegt.'));
  modal('Stützenraster', body, [
    { label: 'Abbrechen' },
    { label: 'Erzeugen', primary: true, onClick: () => {
      const parse = (s) => String(s).split(/[;\s]+/).map((v) => parseNum(v)).filter(Number.isFinite);
      const xs = parse(o.xs), ys = parse(o.ys);
      if (!xs.length || !ys.length) { toast('Bitte mindestens eine Achse in x und y angeben.', 'warn'); return false; }
      const rings = p.slabs.map((s) => s.outline.map((q) => [q.x, q.y]));
      const inside = (x, y) => rings.some((poly) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i], [xj, yj] = poly[j];
          if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
        }
        return c;
      });
      const cols = [];
      for (const y of ys) for (const x of xs) if (inside(x, y)) cols.push({ x, y, b: o.b, hc: o.hc, kz: null, kr: null });
      if (!cols.length) { toast('Kein Rasterpunkt liegt innerhalb einer Platte.', 'warn'); return false; }
      if (o.replace) p.pointSupports.length = 0;
      p.pointSupports.push(...cols);
      toast(`${cols.length} Stützen erzeugt`, 'ok');
      app.changed({ inputs: true });
      return true;
    } },
  ]);
}

// ------------------------------------------------------------------ 3 Lasten

function ensurePsi(l) {
  if (l.type !== 'Q') return;
  if (!l.cat) l.cat = 'B';
  const c = LOAD_CATEGORIES.find((k) => k.value === l.cat);
  if (!Number.isFinite(l.psi0) && c?.psi) [l.psi0, l.psi1, l.psi2] = c.psi;
}

export function loadTab(el, app) {
  const p = app.project;
  const chIn = () => app.changed({ inputs: true });
  p.loadCases.forEach(ensurePsi);
  el.append(group(`Lastfälle (${p.loadCases.length})`, [
    listEditor(p.loadCases, {
      active: app.openLc ?? null,
      onActive: (i) => { app.openLc = i; },
      label: (l) => l.name || l.id,
      sub: (l) => (l.type === 'Q'
        ? `veränderlich · ${LOAD_CATEGORIES.find((c) => c.value === l.cat)?.label || ''} · ψ_0 ${fmt(num(l.psi0), 1)} / ψ_2 ${fmt(num(l.psi2), 1)}`
        : `ständig${l.sw ? ' · mit Eigengewicht' : ''}`),
      swatch: (l) => (l.type === 'Q' ? 'var(--c-load)' : 'var(--c-struct)'),
      badge: (l) => { const n = p.areaLoads.filter((x) => x.lc === l.id).length + p.lineLoads.filter((x) => x.lc === l.id).length + p.pointLoads.filter((x) => x.lc === l.id).length; return n ? badge(`${n} Last${n === 1 ? '' : 'en'}`, 'info') : null; },
      canRemove: () => p.loadCases.length > 1,
      duplicate: (l) => ({ ...JSON.parse(JSON.stringify(l)), id: newId('LF', p.loadCases), name: `${l.name} (Kopie)` }),
      onRemove: (i) => {
        const id = p.loadCases[i]?.id;
        let n = 0;
        for (const key of ['areaLoads', 'lineLoads', 'pointLoads']) { const b = p[key].length; p[key] = p[key].filter((l) => l.lc !== id); n += b - p[key].length; }
        if (n) toast(`${n} Last(en) des gelöschten Lastfalls entfernt`, 'info');
      },
      onChange: (e) => { app.openLc = keepOpen(e); chIn(); },
      detail: (d, l) => {
        d.append(textField('Bezeichnung', l, 'name', { onChange: chIn }));
        d.append(h('div', { class: 'grid2' },
          selectField('Art', l, 'type', [{ value: 'G', label: 'ständig (G)' }, { value: 'Q', label: 'veränderlich (Q)' }], { onChange: () => { ensurePsi(l); chIn(); }, info: I('G mit γ_G = 1.35, Q mit γ_Q = 1.5 bzw. ψ-Beiwerten kombiniert.') }),
          checkField('Eigengewicht', l, 'sw', { onChange: chIn, info: 'Eigengewicht aller Platten automatisch: 25 kN/m³ · h (je Platte).' })));
        if (l.type === 'Q') {
          d.append(selectField('Kategorie', l, 'cat', LOAD_CATEGORIES.map((c) => ({ value: c.value, label: c.label })), { wide: true, onChange: (v) => { const c = LOAD_CATEGORIES.find((k) => k.value === v); if (c?.psi) [l.psi0, l.psi1, l.psi2] = c.psi; chIn(); }, info: 'Setzt ψ nach SIA 260 Tab. 3 bzw. EN 1990 Tab. A1.1; die Werte lassen sich überschreiben.' }));
          d.append(h('div', { class: 'grid3' },
            numField('ψ_0', l, 'psi0', { min: 0, max: 1, digits: 2, onChange: () => app.changed(), info: 'Kombinationsbeiwert (Begleiteinwirkung, Tragsicherheit).' }),
            numField('ψ_1', l, 'psi1', { min: 0, max: 1, digits: 2, onChange: () => app.changed(), info: 'Häufiger Wert.' }),
            numField('ψ_2', l, 'psi2', { min: 0, max: 1, digits: 2, onChange: () => app.changed(), info: 'Quasi-ständiger Wert (Durchbiegung).' })));
        }
      },
      add: [
        { label: 'Ständig', create: () => ({ id: newId('LF', p.loadCases), name: `Auflast ${p.loadCases.length + 1}`, type: 'G', sw: false }) },
        { label: 'Veränderlich', create: () => ({ id: newId('LF', p.loadCases), name: `Nutzlast ${p.loadCases.length + 1}`, type: 'Q', sw: false, cat: 'B', psi0: 0.7, psi1: 0.5, psi2: 0.3 }) },
      ],
    }),
  ], { info: 'Jeder Lastfall wird separat berechnet und über die Kombinationen überlagert. Neue Lasten in der Grafik landen im Lastfall, der oben in der Werkzeugleiste («Neue Lasten in») gewählt ist.' }));

  if (!p.loadCases.length) return;
  const lcs = lcOptions(p);
  el.append(group(`Flächenlasten (${p.areaLoads.length})`, [
    dataTable([
      { key: 'lc', label: 'Lastfall', type: 'select', options: lcs, width: '34%' },
      { key: 'q', label: 'q', unit: 'kN/m²', digits: 2, info: 'Positiv nach unten. Typisch: Bodenaufbau 1.0–2.5, Trennwände 1.0, Wohnen 2.0, Büro 3.0 kN/m² (SIA 261).' },
      { key: 'region', label: 'auf', type: 'select', options: () => regionOptions(p), width: '38%', info: 'Alle Platten, eine einzelne Platte oder eine Lastfläche.' },
    ], p.areaLoads, {
      newRow: () => ({ lc: defaultLc(p), q: 2.0, region: 'all' }),
      onChange: () => app.changed(),
      onSelect: (i) => sel(app, 'al', i),
    }),
  ], { info: 'Gleichmässig verteilte Lasten in kN/m². In der Grafik: Werkzeug «Flächenlast» (F) und in eine Platte klicken. Das Eigengewicht ist im Lastfall mit «Eigengewicht» enthalten.' }));

  el.append(group(`Lastflächen (${p.loadAreas.length})`, [
    listEditor(p.loadAreas, {
      active: app.openArea ?? null,
      onActive: (i) => { app.openArea = i; if (i !== null) sel(app, 'area', i); },
      label: (a, i) => a.name || `Lastfläche ${i + 1}`,
      sub: (a) => { const ls = p.areaLoads.filter((l) => l.region === a.id); return `${fmt(polyArea(a.pts), 2)} m²${ls.length ? ' · ' + ls.map((l) => `${fmt(num(l.q), 1)} kN/m²`).join(', ') : ' · ohne Last'}`; },
      swatch: () => 'var(--c-load)',
      empty: 'Keine Lastflächen – Teilflächen in der Grafik mit «Lastfläche» (Z) zeichnen.',
      duplicate: false,
      onRemove: (i) => { const id = p.loadAreas[i]?.id; p.areaLoads = p.areaLoads.filter((l) => l.region !== id); },
      onChange: (e) => { app.openArea = keepOpen(e); chIn(); },
      detail: (d, a, i) => {
        d.append(textField('Bezeichnung', a, 'name', { onChange: chIn }));
        d.append(dataTable(XY, a.pts, { minRows: 3, onChange: () => app.changed(), onSelect: (j) => sel(app, 'area', i, j), newRow: (rows) => ({ ...rows[rows.length - 1] }) }));
        d.append(...regionLoads(app, a.id, () => {}));
      },
      add: [{ label: 'Rechteck 2 × 2 m', create: () => {
        const b = slabsBox(p);
        if (!b) { toast('Zuerst eine Platte anlegen.', 'warn'); return null; }
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        const id = nextAreaId(p);
        p.areaLoads.push({ lc: defaultLc(p), q: 2.0, region: id });
        return { id, name: `Fläche ${p.loadAreas.length + 1}`, pts: rectPts(+(cx - 1).toFixed(2), +(cy - 1).toFixed(2), +(cx + 1).toFixed(2), +(cy + 1).toFixed(2)) };
      } }],
    }),
  ], { collapsed: !p.loadAreas.length, info: 'Polygone für Teilflächenlasten (Balkon, Lagerzone, Schachbrett). Ihre Ränder werden im Netz abgebildet, die Lastsumme ist exakt.' }));

  el.append(group(`Linienlasten (${p.lineLoads.length})`, [
    dataTable([
      { key: 'lc', label: 'LF', type: 'select', options: lcs, width: '84px' },
      { key: 'x1', label: 'x_1', unit: 'm' }, { key: 'y1', label: 'y_1', unit: 'm' },
      { key: 'x2', label: 'x_2', unit: 'm' }, { key: 'y2', label: 'y_2', unit: 'm' },
      { key: 'p1', label: 'p_1', unit: 'kN/m', info: 'Linienlast am Anfangspunkt (positiv nach unten).' },
      { key: 'p2', label: 'p_2', unit: 'kN/m', allowEmpty: true, info: 'Am Endpunkt; leer = konstant.' },
    ], p.lineLoads, {
      newRow: () => ({ lc: defaultLc(p, 'G'), x1: 0, y1: 0, x2: 1, y2: 0, p1: 5, p2: null }),
      onChange: () => app.changed(),
      onSelect: (i) => sel(app, 'll', i),
    }),
  ], { collapsed: !p.lineLoads.length, info: 'Linear veränderliche Linienlasten (z.B. nichttragende Wände, Geländer); in der Grafik mit «Linienlast» (L).' }));

  el.append(group(`Punktlasten (${p.pointLoads.length})`, [
    dataTable([
      { key: 'lc', label: 'Lastfall', type: 'select', options: lcs, width: '36%' },
      ...XY,
      { key: 'P', label: 'P', unit: 'kN', info: 'Positiv nach unten. Unter Punktlasten sind die Momente singulär (netzabhängig).' },
    ], p.pointLoads, {
      newRow: () => ({ lc: defaultLc(p, 'G'), x: 0, y: 0, P: 10 }),
      onChange: () => app.changed(),
      onSelect: (i) => sel(app, 'pl', i),
    }),
  ], { collapsed: !p.pointLoads.length, info: 'Einzellasten in kN; in der Grafik mit «Punktlast» (P).' }));

  const comboBox = h('div');
  renderCombos(app, comboBox);
  el.append(group(`Kombinationen (${(p.autoCombos !== false ? defaultCombos(p.loadCases) : p.combos).length})`, [comboBox], {
    collapsed: true,
    info: 'Bemessung und Durchstanzen verwenden die Umhüllende aller Tragsicherheitskombinationen, die Durchbiegung die quasi-ständige Kombination.',
  }));
}

function renderCombos(app, box) {
  const p = app.project;
  box.replaceChildren();
  box.append(checkField('Automatisch (SIA 260 / EN 1990)', p, 'autoCombos', {
    onChange: (v) => { if (!v) p.combos = defaultCombos(p.loadCases); app.changed(); renderCombos(app, box); },
    info: I('Tragsicherheit: 1.35·G + 1.5·Q_1 + Σ 1.5·ψ_0·Q_i (jede veränderliche Last einmal als Leiteinwirkung). Quasi-ständig: G + Σ ψ_2·Q_i.'),
  }));
  if (p.autoCombos !== false) {
    const list = defaultCombos(p.loadCases);
    box.append(h('div', { class: 'dt-wrap' }, h('table', { class: 'rt' },
      h('tbody', {}, list.map((c) => h('tr', {}, h('td', {}, h('b', {}, c.name), h('div', { class: 'muted small' }, comboTypeLabel(c.type))), h('td', { class: 'small' }, comboFormula(c, p.loadCases))))))));
  } else {
    const cols = [
      { key: 'name', label: 'Bezeichnung', type: 'text' },
      { key: 'type', label: 'Art', type: 'select', options: COMBO_TYPES, width: '110px' },
      ...p.loadCases.map((l) => ({ key: `f_${l.id}`, label: (l.name || l.id).slice(0, 9), title: l.name, digits: 2, allowEmpty: true, info: `Faktor für «${l.name || l.id}» (leer = 0)` })),
    ];
    box.append(dataTable(cols, p.combos, {
      newRow: (rows) => ({ id: newId('K', rows), name: `Kombination ${rows.length + 1}`, type: 'ULS' }),
      onChange: () => app.changed(),
      extraButtons: [button('Standard', { icon: 'undo', small: true, title: 'Standardkombinationen neu erzeugen', onClick: () => { p.combos = defaultCombos(p.loadCases); app.changed(); renderCombos(app, box); } })],
    }));
  }
}

// ------------------------------------------------------------------ 4 Bemessung

export function designTab(el, app) {
  const p = app.project;
  const d = p.design;
  const depthInfo = h('div', { class: 'muted small' });
  const updDepth = () => {
    const hs = [...new Set(p.slabs.map((s) => num(s.h)).filter(Number.isFinite))].sort((a, b) => a - b);
    const parts = (hs.length ? hs : [p.h]).map((hh) => {
      const dep = effectiveDepths(hh, d.cBot, d.cTop, d.dBot, d.dTop, d.outerBot, d.outerTop);
      return `h ${fmt(hh, 2)}: d unten ${fmt(dep.bx, 0)}/${fmt(dep.by, 0)}, oben ${fmt(dep.tx, 0)}/${fmt(dep.ty, 0)} mm`;
    });
    depthInfo.replaceChildren(rich(`${parts.join(' · ')} (x/y) · f_sd = ${fmt(rebar(d.steel, { norm: p.norm }).fsd, 0)} MPa`));
  };
  updDepth();
  const chg = () => { updDepth(); app.changed(); };
  const dirOpts = [{ value: 'x', label: 'x aussen' }, { value: 'y', label: 'y aussen' }];
  el.append(group('Bewehrung', [
    selectField('Betonstahl', d, 'steel', REBAR_GRADES, { onChange: chg }),
    h('div', { class: 'grid2' },
      numField('c unten', d, 'cBot', { unit: 'mm', min: 0, max: 200, onChange: chg, info: 'Betonüberdeckung der äusseren unteren Lage (SIA 262 Tab. 17, z.B. 30 mm für XC3).' }),
      numField('c oben', d, 'cTop', { unit: 'mm', min: 0, max: 200, onChange: chg }),
      numField('Ø unten', d, 'dBot', { unit: 'mm', min: 6, max: 40, onChange: chg, info: 'Für d: äussere Lage d = h − c − Ø/2, innere d = h − c − 1.5·Ø.' }),
      numField('Ø oben', d, 'dTop', { unit: 'mm', min: 6, max: 40, onChange: chg }),
      selectField('Lagen unten', d, 'outerBot', dirOpts, { onChange: chg }),
      selectField('Lagen oben', d, 'outerTop', dirOpts, { onChange: chg })),
    depthInfo,
  ], { info: 'Orthogonale Bewehrung x/y oben und unten; Bemessungsmomente nach Wood–Armer, Fläche mit Rechteck-Spannungsblock. Die statische Höhe folgt der Dicke der jeweiligen Platte.' }));

  el.append(group('Durchstanzen', [
    h('div', { class: 'grid2' },
      numField('D_max', d, 'Dmax', { unit: 'mm', min: 4, max: 64, onChange: () => app.changed(), info: I('Grösstkorn für k_g = 48/(16 + D_max), SIA 262 Gl. (59).') }),
      numField('a_s oben', d, 'asPunch', { unit: 'mm²/m', min: 0, onChange: () => app.changed(), info: I('Vorhandene obere Bewehrung über den Stützen (für m_Rd bzw. ρ_l). 0 = automatisch aus m_sd (SIA 262 Gl. 64–67), mind. a_s,min.') })),
  ], { info: I('Für alle Stützen mit b × h > 0. SIA 262: Näherungsstufe 2, Nachweisschnitt im Abstand d_v/2; EN 1992-1-1: Rundschnitt im Abstand 2d. Die statische Höhe stammt aus der Platte an der Stütze.') }));

  el.append(group('Durchbiegung', [
    h('div', { class: 'grid3' },
      numField('Faktor k', d, 'creep', { min: 1, max: 10, digits: 2, onChange: () => app.changed(), info: I('w_{∞} ≈ k·w_el: Kriechen und Rissbildung vereinfacht, typisch 2.5–4.') }),
      numField('Grenze L/', d, 'limit', { min: 50, max: 2000, digits: 0, onChange: () => app.changed(), info: 'w ≤ L/300 (Erscheinungsbild, SIA 260 Anhang C) bzw. L/500 bei empfindlichen Trennwänden.' }),
      numField('L', d, 'Lspan', { unit: 'm', min: 0, digits: 2, onChange: () => app.changed(), info: '0 = automatisch (grösste Stützweite benachbarter Lager). Kragplatten: 2 × Auskragung.' })),
  ], { info: 'Vereinfachter Nachweis mit der elastischen Durchbiegung der quasi-ständigen Kombination.' }));

  el.append(group('Mindest- und Grundbewehrung', [
    selectField('Mindestbewehrung', d, 'asMinMode', [
      { value: 'auto', label: 'max(0.26·f_ctm/f_sk; 0.13 %)' },
      { value: 'user', label: 'ρ_min vorgeben' },
      { value: 'none', label: 'keine' },
    ], { wide: true, onChange: () => app.changed({ inputs: true }), info: 'Je Lage und Richtung bezogen auf b·d (Ansatz EN 1992-1-1 9.2.1.1, für SIA als Richtwert).' }),
    d.asMinMode === 'user' ? numField('ρ_min', d, 'rhoMin', { unit: '%', min: 0, max: 2, digits: 3, onChange: () => app.changed() }) : null,
    h('div', { class: 'ed-sub' }, 'Grundbewehrung'),
    dataTable([
      { key: 'layer', label: 'Lage', type: 'calc', width: '76px', calc: (r) => layerLabel(r.layer) },
      { key: 'd', label: 'Ø', unit: 'mm', min: 0, max: 40, info: '0 = keine Grundbewehrung in dieser Lage.' },
      { key: 's', label: 's', unit: 'mm', min: 50, max: 500 },
      { key: 'as', label: 'a_s', unit: 'mm²/m', type: 'calc', calc: (r) => (r.d > 0 && r.s > 0 ? fmt(barAreaPerM(r.d, r.s), 0) : '–') },
    ], d.basic, { canAdd: false, canRemove: false, onChange: () => app.changed() }),
  ], { collapsed: true, info: 'Mit einer Grundbewehrung zeigt die Ansicht «Bewehrung» nur noch die nötigen Zulagen.' }));
}

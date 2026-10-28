// Eingaberegister des Plattenmoduls
import {
  h, group, numField, selectField, checkField, textField, dataTable, button, note, emptyState, modal, toast, parseNum, kvTable,
} from '../../js/core/ui.js';
import { fmt } from '../../js/core/format.js';
import { CONCRETE_CLASSES, REBAR_GRADES, NORMS, concrete, rebar, barAreaPerM } from '../../js/core/materials.js';
import {
  LOAD_CATEGORIES, COMBO_TYPES, defaultCombos, comboFormula, comboTypeLabel, newId, estimateNodes, layerLabel,
} from './calc.js';
import { effectiveDepths } from './design.js';

const XY = [
  { key: 'x', label: 'x', unit: 'm' },
  { key: 'y', label: 'y', unit: 'm' },
];

function sel(app, kind, i) {
  app.selection = { kind, i };
  app.redraw();
}

function rectPts(x0, y0, x1, y1) {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

function slabBox(p) {
  const pts = (p.outline || []).filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  if (!pts.length) return { x0: 0, y0: 0, x1: 8, y1: 6 };
  return {
    x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)),
    y0: Math.min(...pts.map((q) => q.y)), y1: Math.max(...pts.map((q) => q.y)),
  };
}

const lcOptions = (p) => () => p.loadCases.map((l) => ({ value: l.id, label: l.name || l.id }));

function defaultLc(p, prefer = 'Q') {
  return (p.loadCases.find((l) => l.type === prefer) || p.loadCases[0])?.id || '';
}

/** Tabelle mit Hinweis bei leerer Liste (der Hinweis verschwindet beim ersten Eintrag). */
function tableWithEmpty(list, title, text, columns, _rows, opts) {
  const es = emptyState(title, text);
  const upd = () => { es.style.display = list.length ? 'none' : ''; };
  upd();
  const tbl = dataTable(columns, list, { ...opts, onChange: (e) => { upd(); opts.onChange?.(e); } });
  return h('div', {}, es, tbl);
}

/** Liste von Polygonen (Öffnungen, Lastflächen) mit je einer Punkttabelle. */
function polygonList(app, list, o) {
  const wrap = h('div');
  if (!list.length) wrap.append(emptyState(o.emptyTitle, o.emptyText));
  list.forEach((poly, i) => {
    const tbl = dataTable(XY, poly.pts, {
      minRows: 3,
      onChange: () => app.changed(),
      onSelect: (j) => { app.selection = { kind: o.kind, i, j }; app.redraw(); },
      newRow: (rows) => ({ x: rows[rows.length - 1]?.x ?? 0, y: rows[rows.length - 1]?.y ?? 0 }),
      hint: 'Eckpunkte, Einfügen aus Excel möglich',
    });
    wrap.append(group(`${o.itemName} ${i + 1}${poly.name ? ` – ${poly.name}` : ''}`, [
      textField('Bezeichnung', poly, 'name', { onChange: () => app.changed({ inputs: true }) }),
      tbl,
    ], {
      collapsible: true,
      actions: [button('', { icon: 'trash', small: true, ghost: true, title: `${o.itemName} löschen`, onClick: () => { o.onRemove?.(poly); list.splice(i, 1); app.selection = null; app.changed({ inputs: true }); } })],
    }));
  });
  return wrap;
}

// ------------------------------------------------------------------ 1 Geometrie

export function geometryTab(el, app) {
  const p = app.project;
  const derived = h('div');
  const updDerived = () => {
    derived.replaceChildren();
    try {
      const c = concrete(p.concrete, { norm: p.norm });
      const D = c.Ecm * 1000 * p.h ** 3 / (12 * (1 - p.nu * p.nu));
      derived.append(kvTable([
        ['E-Modul Ecm', c.Ecm / 1000, 'GPa', 1],
        ['Bemessungswert fcd', c.fcd, 'MPa', 1],
        ['Plattensteifigkeit D', D / 1000, 'MNm', 1],
        ['Eigengewicht g₀ = 25·h', 25 * p.h, 'kN/m²', 2],
      ]));
    } catch { /* ungültige Eingabe */ }
  };
  updDerived();
  const chD = () => { updDerived(); app.changed(); };
  el.append(group('Platte und Baustoff', [
    selectField('Norm', p, 'norm', NORMS, {
      onChange: chD,
      info: 'Bestimmt die Betonkennwerte (SIA 262 bzw. EN 1992-1-1), den Spannungsblock der Biegebemessung und das Durchstanzverfahren (SIA 262 Ziff. 4.3.6 bzw. EN 1992-1-1 Abschn. 6.4).',
    }),
    selectField('Betonsorte', p, 'concrete', CONCRETE_CLASSES, { onChange: chD, info: 'Festigkeitsklasse fck/fck,cube. Der E-Modul Ecm wird daraus ermittelt (ungerissen).' }),
    numField('Plattendicke h', p, 'h', {
      unit: 'm', min: 0.05, max: 3, digits: 3, onChange: chD,
      info: 'Konstante Plattendicke in Metern. Richtwert für Decken: h ≈ L/30 (zweiachsig) bzw. L/25 (Flachdecke).',
    }),
    numField('Querdehnzahl ν', p, 'nu', {
      unit: '–', min: 0, max: 0.45, digits: 2, onChange: chD,
      info: 'Ungerissener Beton: ν = 0.2; für gerissenen Beton darf ν = 0 gesetzt werden (EN 1992-1-1, 3.1.3(4)).',
    }),
    derived,
  ], { info: 'Alle Längen in Metern. Die Platte wird als schubstarre Kirchhoff-Platte mit konstanter Dicke berechnet.' }));

  el.append(group('Plattenrand', [
    dataTable(XY, p.outline, {
      minRows: 3,
      onChange: () => app.changed(),
      onSelect: (i) => sel(app, 'outline', i),
      newRow: (rows) => ({ x: rows[rows.length - 1]?.x ?? 0, y: rows[rows.length - 1]?.y ?? 0 }),
      extraButtons: [button('Rechteck …', { icon: 'grid', small: true, title: 'Rechteckige Platte erzeugen', onClick: () => rectDialog(app) })],
    }),
  ], { info: 'Eckpunkte des Plattenrandes der Reihe nach (im oder gegen den Uhrzeigersinn). Das Polygon wird automatisch geschlossen; L-, U- und beliebige polygonale Formen sind möglich.' }));

  el.append(group('Öffnungen', [
    polygonList(app, p.openings, {
      kind: 'opening', itemName: 'Öffnung',
      emptyTitle: 'Keine Öffnungen',
      emptyText: ' – mit «+ Öffnung» eine rechteckige Öffnung anlegen und die Eckpunkte anpassen.',
    }),
  ], {
    info: 'Aussparungen (Treppen, Schächte). Öffnungen müssen vollständig innerhalb der Platte liegen. Öffnungen nahe bei Stützen reduzieren den Durchstanz-Nachweisschnitt automatisch.',
    actions: [button('Öffnung', { icon: 'plus', small: true, title: 'Rechteckige Öffnung 1 × 1 m in Plattenmitte', onClick: () => {
      const b = slabBox(p);
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      p.openings.push({ name: '', pts: rectPts(+(cx - 0.5).toFixed(2), +(cy - 0.5).toFixed(2), +(cx + 0.5).toFixed(2), +(cy + 0.5).toFixed(2)) });
      app.changed({ inputs: true });
    } })],
  }));

  const est = h('div', { class: 'muted small', style: { margin: '2px 0 6px' } });
  const updEst = () => {
    const n = estimateNodes(p);
    est.textContent = Number.isFinite(n) && n > 0
      ? `≈ ${fmt(n, 0)} Knoten${n > 6000 ? ' – Berechnung kann einige Sekunden dauern' : n > 20000 ? ' – zu fein' : ''}`
      : '';
  };
  updEst();
  el.append(group('FE-Netz', [
    numField('Netzweite', p, 'meshSize', {
      unit: 'm', min: 0.02, digits: 3, onChange: () => { updEst(); app.changed(); },
      info: 'Mittlere Elementgrösse. Richtwert: Spannweite/12 bis /20 bzw. etwa 1–2 × Plattendicke. Ein feineres Netz ist genauer, rechnet aber länger (Begrenzung 20 000 Knoten).',
    }),
    est,
    checkField('Netz bei Stützen verfeinern', p, 'refineColumns', { onChange: () => app.changed(), info: 'Erzeugt um Punktlager konzentrische, abgestufte Knotenringe für genauere Stützmomente.' }),
    checkField('Stützenquerschnitt b × h als starren Bereich abbilden', p, 'columnHeads', {
      onChange: () => app.changed(),
      info: 'Die Platte wird über dem Stützenquerschnitt versteift (Stützenkopf). Die Momente werden dadurch am Stützenrand (Anschnitt) statt als singuläre Spitze im Stützenzentrum ausgegeben.',
    }),
  ], { info: 'Das Netz wird automatisch aus Rand, Öffnungen, Lagern und Lasten erzeugt (Delaunay-Triangulierung). Vorschau in der Ansicht «Netz».' }));
}

function rectDialog(app) {
  const p = app.project;
  const b = slabBox(p);
  const o = { x0: b.x0, y0: b.y0, lx: +(b.x1 - b.x0).toFixed(3) || 8, ly: +(b.y1 - b.y0).toFixed(3) || 6, walls: !p.pointSupports.length };
  const body = h('div', {},
    numField('Ursprung x₀', o, 'x0', { unit: 'm' }),
    numField('Ursprung y₀', o, 'y0', { unit: 'm' }),
    numField('Länge Lx', o, 'lx', { unit: 'm', min: 0.1 }),
    numField('Breite Ly', o, 'ly', { unit: 'm', min: 0.1 }),
    checkField('Wände an allen vier Rändern (ersetzt vorhandene Linienlager)', o, 'walls'));
  modal('Rechteckplatte erzeugen', body, [
    { label: 'Abbrechen' },
    { label: 'Übernehmen', primary: true, onClick: () => {
      if (!(o.lx > 0 && o.ly > 0)) { toast('Bitte positive Abmessungen eingeben.', 'warn'); return false; }
      p.outline = rectPts(o.x0, o.y0, o.x0 + o.lx, o.y0 + o.ly);
      if (o.walls) p.lineSupports = wallsAlong(p.outline);
      app.changed({ inputs: true });
      app.view.fitted = false;
      return true;
    } },
  ]);
}

function wallsAlong(outline) {
  const out = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, clamped: false });
  }
  return out;
}

// ------------------------------------------------------------------ 2 Lager

export function supportTab(el, app) {
  const p = app.project;
  el.append(group('Punktlager / Stützen', [
    tableWithEmpty(p.pointSupports, 'Keine Stützen', ' – mit «+ Zeile» einzeln oder mit «Stützenraster …» als Raster anlegen.', [
      ...XY,
      { key: 'b', label: 'b', unit: 'm', digits: 3, min: 0, info: 'Stützenabmessung in x-Richtung. Wird für den Durchstanznachweis und den starren Stützenkopf verwendet; 0 = reines Punktlager ohne Nachweis.' },
      { key: 'hc', label: 'h', unit: 'm', digits: 3, min: 0, info: 'Stützenabmessung in y-Richtung.' },
      { key: 'kz', label: 'kz', unit: 'kN/m', allowEmpty: true, min: 0, info: 'Vertikale Federsteifigkeit. Leer = starr. Für eine Stütze unten eingespannt: kz ≈ E·A/L.' },
      { key: 'kr', label: 'kφ', unit: 'kNm/rad', allowEmpty: true, min: 0, info: 'Drehfeder um x und y (Einspannung durch die Stütze). Leer = gelenkig. Für Stützen oben und unten: kφ ≈ 4·E·I/L je Geschoss.' },
    ], p.pointSupports, {
      newRow: (rows) => ({ x: rows[rows.length - 1]?.x ?? 0, y: rows[rows.length - 1]?.y ?? 0, b: 0.3, hc: 0.3, kz: null, kr: null }),
      onChange: () => app.changed(),
      onSelect: (i) => sel(app, 'ps', i),
      extraButtons: [button('Stützenraster …', { icon: 'grid', small: true, title: 'Stützen in einem Achsraster erzeugen', onClick: () => gridDialog(app) })],
    }),
  ], { info: 'Stützen bzw. punktförmige Lager im Zentrum (x, y). Sie werden als Knoten des Netzes erzwungen. Bezeichnung S1, S2 … in der Reihenfolge der Tabelle.' }));

  el.append(group('Linienlager / Wände', [
    tableWithEmpty(p.lineSupports, 'Keine Wände', ' – mit «+ Zeile» Anfangs- und Endpunkt eingeben oder «Wände an allen Rändern» wählen.', [
      { key: 'x1', label: 'x₁', unit: 'm' }, { key: 'y1', label: 'y₁', unit: 'm' },
      { key: 'x2', label: 'x₂', unit: 'm' }, { key: 'y2', label: 'y₂', unit: 'm' },
      { key: 'clamped', label: 'eing.', type: 'check', info: '«eingespannt»: Die Platte kann sich um die Wandachse nicht verdrehen (z.B. Kragplatte, durchlaufende Platte über einer steifen Wand). Sonst gelenkig.' },
    ], p.lineSupports, {
      newRow: (rows) => ({ x1: rows[rows.length - 1]?.x2 ?? 0, y1: rows[rows.length - 1]?.y2 ?? 0, x2: rows[rows.length - 1]?.x2 ?? 0, y2: rows[rows.length - 1]?.y2 ?? 0, clamped: false }),
      onChange: () => app.changed(),
      onSelect: (i) => sel(app, 'ls', i),
      extraButtons: [button('Wände an allen Rändern', { icon: 'plus', small: true, title: 'Für jede Randkante ein Linienlager ergänzen', onClick: () => {
        const have = new Set(p.lineSupports.map((w) => `${w.x1},${w.y1},${w.x2},${w.y2}`));
        let n = 0;
        for (const w of wallsAlong(p.outline)) {
          if (have.has(`${w.x1},${w.y1},${w.x2},${w.y2}`) || have.has(`${w.x2},${w.y2},${w.x1},${w.y1}`)) continue;
          p.lineSupports.push(w); n++;
        }
        toast(n ? `${n} Wände ergänzt` : 'Alle Ränder sind bereits gelagert', n ? 'ok' : 'info');
        app.changed({ inputs: true });
      } })],
    }),
  ], { info: 'Wände als Strecken von (x₁, y₁) nach (x₂, y₂); vertikal starr. Ein Linienzug wird aus mehreren Zeilen zusammengesetzt. Linienlager dürfen auch im Platteninnern liegen (Zwischenwände).' }));

  el.append(note('Vorzeichen: Auflagerkräfte positiv = Druck auf das Lager (nach oben auf die Platte wirkend).'));
}

function gridDialog(app) {
  const p = app.project;
  const o = { xs: '0; 6.5; 13', ys: '0; 6.5', b: 0.3, hc: 0.3, replace: true };
  const body = h('div', {},
    textField('Achsen x [m]', o, 'xs'),
    textField('Achsen y [m]', o, 'ys'),
    numField('Stütze b', o, 'b', { unit: 'm', min: 0 }),
    numField('Stütze h', o, 'hc', { unit: 'm', min: 0 }),
    checkField('Vorhandene Stützen ersetzen', o, 'replace'),
    h('div', { class: 'muted small' }, 'Achsen durch Strichpunkt oder Leerzeichen trennen, z.B. «0; 6.5; 13». Es werden nur Stützen innerhalb der Platte angelegt.'));
  modal('Stützenraster erzeugen', body, [
    { label: 'Abbrechen' },
    { label: 'Erzeugen', primary: true, onClick: () => {
      const parse = (s) => String(s).split(/[;\s]+/).map((v) => parseNum(v)).filter(Number.isFinite);
      const xs = parse(o.xs), ys = parse(o.ys);
      if (!xs.length || !ys.length) { toast('Bitte mindestens eine Achse in x und y angeben.', 'warn'); return false; }
      const poly = p.outline.map((q) => [q.x, q.y]);
      const inside = (x, y) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i], [xj, yj] = poly[j];
          if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
        }
        return c;
      };
      const cols = [];
      for (const y of ys) for (const x of xs) if (inside(x, y)) cols.push({ x, y, b: o.b, hc: o.hc, kz: null, kr: null });
      if (!cols.length) { toast('Kein Rasterpunkt liegt innerhalb der Platte.', 'warn'); return false; }
      if (o.replace) p.pointSupports.length = 0;
      p.pointSupports.push(...cols);
      toast(`${cols.length} Stützen erzeugt`, 'ok');
      app.changed({ inputs: true });
      return true;
    } },
  ]);
}

// ------------------------------------------------------------------ 3 Lasten: Lastfälle, Lasten, Kombinationen

export function loadTab(el, app) {
  const p = app.project;
  const psiBox = h('div');
  const loadsBox = h('div');
  const comboBox = h('div');
  const refresh = () => {
    ensurePsi(p);
    renderPsi(app, psiBox, () => renderCombos(app, comboBox));
    renderLoads(app, loadsBox);
    renderCombos(app, comboBox);
  };
  el.append(group('Lastfälle', [
    dataTable([
      { key: 'name', label: 'Bezeichnung', type: 'text' },
      { key: 'type', label: 'Art', type: 'select', width: '128px', options: [{ value: 'G', label: 'ständig (G)' }, { value: 'Q', label: 'veränderlich (Q)' }], info: 'Ständige Lasten (G) werden mit γG = 1.35 kombiniert, veränderliche (Q) mit γQ = 1.5 bzw. ψ-Beiwerten.' },
      { key: 'sw', label: 'EG', type: 'check', info: 'Eigengewicht der Platte automatisch ansetzen: 25 kN/m³ · h.' },
    ], p.loadCases, {
      minRows: 1,
      newRow: (rows) => ({ id: newId('LF', rows), name: `Lastfall ${rows.length + 1}`, type: 'Q', sw: false, cat: 'B', psi0: 0.7, psi1: 0.5, psi2: 0.3 }),
      onChange: (e) => {
        if (e.type === 'remove') {
          const ids = new Set(p.loadCases.map((l) => l.id));
          let n = 0;
          for (const key of ['areaLoads', 'lineLoads', 'pointLoads']) {
            const before = p[key].length;
            p[key] = p[key].filter((l) => ids.has(l.lc));
            n += before - p[key].length;
          }
          if (n) toast(`${n} Last(en) des gelöschten Lastfalls entfernt`, 'info');
        }
        app.changed();
        refresh();
      },
    }),
  ], { info: 'Jeder Lastfall wird separat berechnet und über die Kombinationen überlagert. Die Flächen-, Linien- und Punktlasten weiter unten werden je einem Lastfall zugeordnet.' }));
  el.append(psiBox, loadsBox, comboBox);
  refresh();
}

function ensurePsi(p) {
  for (const l of p.loadCases) {
    if (l.type !== 'Q') continue;
    if (!l.cat) l.cat = 'B';
    const c = LOAD_CATEGORIES.find((k) => k.value === l.cat);
    if (!Number.isFinite(l.psi0) && c?.psi) [l.psi0, l.psi1, l.psi2] = c.psi;
  }
}

function renderPsi(app, box, onPsi) {
  const p = app.project;
  box.replaceChildren();
  const qs = p.loadCases.filter((l) => l.type === 'Q');
  if (!qs.length) return;
  box.append(group('Veränderliche Lasten: Kategorie und ψ-Beiwerte', [
    dataTable([
      { key: 'name', label: 'Lastfall', type: 'calc', calc: (r) => r.name || r.id },
      { key: 'cat', label: 'Kategorie', type: 'select', options: LOAD_CATEGORIES.map((c) => ({ value: c.value, label: c.label })), rerender: true, width: '140px' },
      { key: 'psi0', label: 'ψ₀', digits: 2, min: 0, max: 1, info: 'Kombinationsbeiwert (Begleiteinwirkung im Tragsicherheitsnachweis).' },
      { key: 'psi1', label: 'ψ₁', digits: 2, min: 0, max: 1, info: 'Häufiger Wert.' },
      { key: 'psi2', label: 'ψ₂', digits: 2, min: 0, max: 1, info: 'Quasi-ständiger Wert (Durchbiegung, Langzeit).' },
    ], qs, {
      canAdd: false, canRemove: false, hint: 'ψ nach SIA 260 Tab. 3 bzw. EN 1990 Tab. A1.1',
      onChange: () => {
        for (const l of qs) {
          if (l._cat !== undefined && l._cat !== l.cat) {
            const c = LOAD_CATEGORIES.find((k) => k.value === l.cat);
            if (c?.psi) [l.psi0, l.psi1, l.psi2] = c.psi;
          }
          l._cat = l.cat;
        }
        app.changed();
        onPsi?.();
      },
    }),
  ], { info: 'Die Nutzungskategorie setzt die ψ-Beiwerte; die Werte können überschrieben werden («frei»).' }));
  for (const l of qs) l._cat = l.cat;
}

function renderCombos(app, box) {
  if (!box) return;
  const p = app.project;
  box.replaceChildren();
  const content = [];
  content.push(checkField('Kombinationen automatisch erzeugen (empfohlen)', p, 'autoCombos', {
    onChange: (v) => {
      if (!v) p.combos = defaultCombos(p.loadCases);
      app.changed();
      renderCombos(app, box);
    },
    info: 'Tragsicherheit: 1.35·G + 1.5·Q₁ + Σ 1.5·ψ₀·Qᵢ (jede veränderliche Last einmal als Leiteinwirkung, SIA 260 Gl. (4) / EN 1990 (6.10)). Gebrauchstauglichkeit quasi-ständig: G + Σ ψ₂·Qᵢ.',
  }));
  if (p.autoCombos !== false) {
    const list = defaultCombos(p.loadCases);
    content.push(h('div', { class: 'dt-wrap', style: { border: 0 } }, h('table', { class: 'rt' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Kombination'), h('th', {}, 'Art'), h('th', {}, 'Formel'))),
      h('tbody', {}, list.map((c) => h('tr', {}, h('td', {}, c.name), h('td', {}, comboTypeLabel(c.type)), h('td', { class: 'small' }, comboFormula(c, p.loadCases))))))));
  } else {
    const cols = [
      { key: 'name', label: 'Bezeichnung', type: 'text' },
      { key: 'type', label: 'Art', type: 'select', options: COMBO_TYPES, width: '118px', info: 'Tragsicherheit → Bemessung und Durchstanzen (Umhüllende); quasi-ständig → Durchbiegungsnachweis.' },
      ...p.loadCases.map((l) => ({ key: `f_${l.id}`, label: (l.name || l.id).slice(0, 10), title: l.name, digits: 2, allowEmpty: true, info: `Faktor für «${l.name || l.id}» (leer = 0)` })),
    ];
    content.push(dataTable(cols, p.combos, {
      newRow: (rows) => ({ id: newId('K', rows), name: `Kombination ${rows.length + 1}`, type: 'ULS' }),
      onChange: () => { app.changed(); },
      extraButtons: [button('Standard', { icon: 'undo', small: true, title: 'Standardkombinationen neu erzeugen', onClick: () => { p.combos = defaultCombos(p.loadCases); app.changed(); renderCombos(app, box); } })],
    }));
  }
  box.append(group('Lastkombinationen', content, { info: 'Die Ergebnisse jeder Kombination sind in der Grafik über die Auswahl «Lastfall» abrufbar. Bemessung und Durchstanzen verwenden die Umhüllende aller Tragsicherheitskombinationen.' }));
}

// ------------------------------------------------------------------ Lasten je Lastfall

function renderLoads(app, el) {
  el.replaceChildren();
  const p = app.project;
  const lcs = lcOptions(p);
  if (!p.loadCases.length) {
    el.append(note('Zuerst oben mindestens einen Lastfall anlegen.', 'warn'));
    return;
  }
  const regionOpts = () => [{ value: 'all', label: 'ganze Platte' }, ...p.loadAreas.map((a, i) => ({ value: a.id, label: a.name || `Lastfläche ${i + 1}` }))];
  el.append(group('Flächenlasten', [
    tableWithEmpty(p.areaLoads, 'Noch keine Flächenlasten', ' – mit «+ Zeile» hinzufügen. Das Eigengewicht der Platte wird im Lastfall mit «EG» automatisch berücksichtigt.', [
      { key: 'lc', label: 'Lastfall', type: 'select', options: lcs, width: '120px' },
      { key: 'q', label: 'q', unit: 'kN/m²', digits: 2, info: 'Positiv = nach unten (Schwerkraftrichtung). Typisch: Bodenaufbau 1.0–2.5, Trennwände 1.0, Nutzlast Wohnen 2.0, Büro 3.0 kN/m² (SIA 261).' },
      { key: 'region', label: 'Bereich', type: 'select', options: regionOpts, width: '120px', info: '«ganze Platte» oder eine Lastfläche (Polygon, siehe unten).' },
    ], p.areaLoads, {
      newRow: () => ({ lc: defaultLc(p), q: 2.0, region: 'all' }),
      onChange: () => app.changed(),
      onSelect: (i) => sel(app, 'al', i),
    }),
  ], { info: 'Gleichmässig verteilte Lasten in kN/m² auf die ganze Platte oder eine Lastfläche.' }));

  el.append(group('Lastflächen', [
    polygonList(app, p.loadAreas, {
      kind: 'area', itemName: 'Lastfläche',
      emptyTitle: 'Keine Lastflächen',
      emptyText: ' – für Teilflächenlasten (Balkon, Lagerzone, Schachbrett) mit «+ Lastfläche» ein Polygon anlegen.',
      onRemove: (poly) => { p.areaLoads = p.areaLoads.filter((a) => a.region !== poly.id); },
    }),
  ], {
    info: 'Polygone, auf die Flächenlasten wirken können. Die Ränder werden im Netz abgebildet, die Lastsumme ist daher exakt.',
    actions: [button('Lastfläche', { icon: 'plus', small: true, title: 'Rechteckige Lastfläche 2 × 2 m in Plattenmitte', onClick: () => {
      const b = slabBox(p);
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      p.loadAreas.push({ id: newId('A', p.loadAreas), name: `Fläche ${p.loadAreas.length + 1}`, pts: rectPts(+(cx - 1).toFixed(2), +(cy - 1).toFixed(2), +(cx + 1).toFixed(2), +(cy + 1).toFixed(2)) });
      app.changed({ inputs: true });
    } })],
  }));

  el.append(group('Linienlasten', [
    tableWithEmpty(p.lineLoads, 'Keine Linienlasten', ' – z.B. Wand- oder Geländerlasten mit «+ Zeile» eingeben.', [
      { key: 'lc', label: 'LF', type: 'select', options: lcs, width: '92px' },
      { key: 'x1', label: 'x₁', unit: 'm' }, { key: 'y1', label: 'y₁', unit: 'm' },
      { key: 'x2', label: 'x₂', unit: 'm' }, { key: 'y2', label: 'y₂', unit: 'm' },
      { key: 'p1', label: 'p₁', unit: 'kN/m', info: 'Linienlast am Anfangspunkt (positiv nach unten).' },
      { key: 'p2', label: 'p₂', unit: 'kN/m', allowEmpty: true, info: 'Linienlast am Endpunkt; leer = gleich p₁ (konstant).' },
    ], p.lineLoads, {
      newRow: () => ({ lc: defaultLc(p, 'G'), x1: 0, y1: 0, x2: 1, y2: 0, p1: 5, p2: null }),
      onChange: () => app.changed(),
      onSelect: (i) => sel(app, 'll', i),
    }),
  ], { info: 'Linear veränderliche Linienlasten entlang einer Strecke (z.B. nichttragende Wände: Wandgewicht je Meter). Die Strecke wird im Netz als Kantenzug abgebildet.' }));

  el.append(group('Punktlasten', [
    tableWithEmpty(p.pointLoads, 'Keine Punktlasten', ' – Einzellasten (z.B. Stützen aus dem Obergeschoss) mit «+ Zeile» eingeben.', [
      { key: 'lc', label: 'Lastfall', type: 'select', options: lcs, width: '120px' },
      ...XY,
      { key: 'P', label: 'P', unit: 'kN', info: 'Einzellast, positiv nach unten. Hinweis: Unter einer Punktlast sind die Momente singulär (netzabhängig).' },
    ], p.pointLoads, {
      newRow: () => ({ lc: defaultLc(p, 'G'), x: 0, y: 0, P: 10 }),
      onChange: () => app.changed(),
      onSelect: (i) => sel(app, 'pl', i),
    }),
  ], { info: 'Einzellasten in kN an beliebigen Punkten der Platte.' }));
}

// ------------------------------------------------------------------ 4 Bemessung

export function designTab(el, app) {
  const p = app.project;
  const d = p.design;
  const depthInfo = h('div');
  const updDepth = () => {
    depthInfo.replaceChildren();
    const dep = effectiveDepths(p.h, d.cBot, d.cTop, d.dBot, d.dTop, d.outerBot, d.outerTop);
    depthInfo.append(kvTable([
      ['Statische Höhe unten x / y', `${fmt(dep.bx, 0)} / ${fmt(dep.by, 0)}`, 'mm'],
      ['Statische Höhe oben x / y', `${fmt(dep.tx, 0)} / ${fmt(dep.ty, 0)}`, 'mm'],
      ['Stahl fsd', rebar(d.steel, { norm: p.norm }).fsd, 'MPa', 0],
    ]));
  };
  updDepth();
  const chg = () => { updDepth(); app.changed(); };
  const dirOpts = [{ value: 'x', label: 'x-Stäbe aussen' }, { value: 'y', label: 'y-Stäbe aussen' }];
  el.append(group('Biegebewehrung', [
    selectField('Betonstahl', d, 'steel', REBAR_GRADES, { onChange: chg }),
    numField('Überdeckung unten', d, 'cBot', { unit: 'mm', min: 0, max: 200, onChange: chg, info: 'Nominelle Betonüberdeckung der äusseren unteren Lage (SIA 262 Tab. 17: z.B. 30 mm für XC3).' }),
    numField('Überdeckung oben', d, 'cTop', { unit: 'mm', min: 0, max: 200, onChange: chg }),
    numField('Stab-Ø unten', d, 'dBot', { unit: 'mm', min: 6, max: 40, onChange: chg, info: 'Für die statische Höhe: äussere Lage d = h − c − Ø/2, innere Lage d = h − c − 1.5·Ø.' }),
    numField('Stab-Ø oben', d, 'dTop', { unit: 'mm', min: 6, max: 40, onChange: chg }),
    selectField('Lagenfolge unten', d, 'outerBot', dirOpts, { onChange: chg }),
    selectField('Lagenfolge oben', d, 'outerTop', dirOpts, { onChange: chg }),
    depthInfo,
  ], {
    info: 'Orthogonale Bewehrung in x- und y-Richtung. Bemessungsmomente nach Wood–Armer aus mx, my, mxy; erforderliche Fläche mit rechteckigem Spannungsblock (SIA 262 4.2/4.3.2, EN 1992-1-1 3.1.7).',
  }));

  el.append(group('Mindestbewehrung', [
    selectField('Ansatz', d, 'asMinMode', [
      { value: 'auto', label: 'ρ = max(0.26·fctm/fsk; 0.13 %)' },
      { value: 'user', label: 'ρmin vorgeben' },
      { value: 'none', label: 'keine' },
    ], { wide: true, onChange: () => { app.changed({ inputs: true }); } }),
    d.asMinMode === 'user' ? numField('ρmin', d, 'rhoMin', { unit: '%', min: 0, max: 2, digits: 3, onChange: () => app.changed() }) : null,
  ], { info: 'Mindestbewehrung je Lage und Richtung, bezogen auf b·d (Ansatz nach EN 1992-1-1 9.2.1.1; für SIA als Richtwert). Sie wird in der Bewehrungsgrafik und in der Zusammenstellung berücksichtigt.' }));

  el.append(group('Grundbewehrung (optional)', [
    dataTable([
      { key: 'layer', label: 'Lage', type: 'calc', width: '76px', calc: (r) => layerLabel(r.layer) },
      { key: 'd', label: 'Ø', unit: 'mm', min: 0, max: 40, info: '0 = keine Grundbewehrung in dieser Lage.' },
      { key: 's', label: 's', unit: 'mm', min: 50, max: 500 },
      { key: 'as', label: 'as', unit: 'mm²/m', type: 'calc', calc: (r) => (r.d > 0 && r.s > 0 ? fmt(barAreaPerM(r.d, r.s), 0) : '–') },
    ], d.basic, { canAdd: false, canRemove: false, hint: 'Die Grafik zeigt dann nur die Zulagen', onChange: () => app.changed() }),
  ], { info: 'Mit einer flächig verlegten Grundbewehrung zeigt die Ansicht «Bewehrung» nur noch die Bereiche, in denen Zulagen nötig sind, sowie deren Fläche.' }));

  el.append(group('Durchstanzen', [
    numField('Grösstkorn Dmax', d, 'Dmax', { unit: 'mm', min: 4, max: 64, onChange: () => app.changed(), info: 'Für kg = 48/(16 + Dmax) nach SIA 262 Gl. (59).' }),
    numField('as oben über Stützen', d, 'asPunch', { unit: 'mm²/m', min: 0, onChange: () => app.changed(), info: 'Vorhandene obere Biegebewehrung im Stützstreifen (für mRd bzw. ρl). 0 = automatisch: Bewehrung für msd nach SIA 262 (Gl. 64–67), mindestens die Mindestbewehrung.' }),
  ], { info: 'Nachweis für alle Punktlager mit Abmessungen b × h > 0. SIA 262: Näherungsstufe 2 (ψ mit rs = 0.22·L und msd), Nachweisschnitt im Abstand dv/2. EN 1992-1-1: kritischer Rundschnitt im Abstand 2d.' }));

  el.append(group('Gebrauchstauglichkeit', [
    numField('Langzeitfaktor k', d, 'creep', { unit: '–', min: 1, max: 10, digits: 2, onChange: () => app.changed(), info: 'w∞ ≈ k·w_el (quasi-ständige Kombination, elastisch ungerissen). Berücksichtigt Kriechen und Rissbildung vereinfacht; typisch k = 2.5–4 (z.B. (1 + φ) · Rissfaktor).' }),
    numField('Grenzwert L /', d, 'limit', { unit: '–', min: 50, max: 2000, digits: 0, onChange: () => app.changed(), info: 'Durchbiegungsgrenze w ≤ L/300 (Erscheinungsbild, SIA 260 Anhang C) bzw. L/500 bei empfindlichen Trennwänden.' }),
    numField('Spannweite L', d, 'Lspan', { unit: 'm', min: 0, digits: 2, onChange: () => app.changed(), info: '0 = automatisch (grösste Stützweite zwischen benachbarten Lagern bzw. kürzere Plattenabmessung). Bei Kragplatten 2 × Auskragung eingeben.' }),
  ], { info: 'Vereinfachter Durchbiegungsnachweis auf Basis der elastischen Lösung.' }));
}

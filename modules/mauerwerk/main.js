// Modul Mauerwerk – unbewehrtes Mauerwerk nach SIA 266
import { createApp, IncompleteInput } from '../../js/core/app.js';
import { h, group, numField, selectField, checkField, dataTable, button, note, emptyState, fmt } from '../../js/core/ui.js';
import { computeWall, effectiveHeight, hasLoads, loadFlags, sideFlags, setSides } from './calc.js';
import { MASONRY_TYPES, typeById, applyTypeDefaults, designValues, changedFromDefaults } from './materials.js';
import { defaultProject, defaultCombos, syncCombos, EXAMPLES } from './examples.js';
import { editorSpec, fitIntoWall } from './editing.js';
import { derivation } from './derivation.js';
import { drawAnsicht, drawSchnitt, drawSchub } from './view.js';
import { renderResults, ensureStyle } from './results.js';
import { buildReport, HELP, INTRO } from './bericht.js';

ensureStyle();

/** Änderung aus den Registern: neu rechnen und das Eigenschaftsfenster der Grafik nachführen. */
function upd(app, opts) {
  app.changed(opts);
  app.editor?.refreshPanel(true);
}

// ------------------------------------------------------------------ Hilfen

/** Kleine Live-Kennwertanzeige; gibt {el, update} zurück. */
function liveBox(fn) {
  const el = h('div', { class: 'mw-live' });
  const update = () => {
    let items;
    try { items = fn(); } catch { items = []; }
    el.replaceChildren(...items.filter(Boolean).map(([label, value, unit]) => h('div', {}, h('span', {}, label), h('b', {}, value, unit ? h('small', { class: 'muted' }, ` ${unit}`) : null))));
  };
  update();
  return { el, update };
}

/** Füllt fehlende Felder älterer Projektdateien mit Standardwerten. */
function migrate(p) {
  const d = defaultProject();
  const fill = (target, def) => {
    for (const [k, v] of Object.entries(def)) {
      if (target[k] === undefined || target[k] === null) target[k] = JSON.parse(JSON.stringify(v));
      else if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object') fill(target[k], v);
    }
  };
  const hadAuto = 'combosAuto' in p;
  fill(p, d);
  if (!hadAuto) p.combosAuto = false; // ältere Dateien: Kombinationen unverändert lassen
  if (!Array.isArray(p.combos) || !p.combos.length) { p.combos = defaultCombos(loadFlags(p)); p.combosAuto = true; }
  if (!Array.isArray(p.wall.openings)) p.wall.openings = [];
  return p;
}

// ------------------------------------------------------------------ Register 1: Wand

function tabWand(el, app) {
  const W = app.project.wall, S = app.project.settings;
  const live = liveBox(() => {
    const L = app.project.loads;
    const t = W.t / 1000;
    const sf = sideFlags(W);
    const eff = effectiveHeight({ h: W.h, t, mode: W.support, rhoManual: W.rhoManual, sides: (sf.L ? 1 : 0) + (sf.R ? 1 : 0), ls: W.ls > 0 ? W.ls : W.l, eTop: L.eMode === 'slab' ? t / 2 - L.aD / 3000 : 0 });
    return [['Knickbeiwert ρ', fmt(eff.rho, 3)], ['Knicklänge hef', fmt(eff.hef, 2), 'm'], ['Schlankheit hef/t', fmt(eff.hef / t, 1)]];
  });
  const ch = () => { live.update(); upd(app); };
  let oldH = W.h, oldL = W.l;
  const chGeo = () => {
    const L = app.project.loads;
    if (Math.abs((L.hV || 0) - oldH) < 1e-9) L.hV = W.h;
    if (Math.abs((W.ls || 0) - oldL) < 1e-9) W.ls = W.l;
    oldH = W.h; oldL = W.l;
    fitIntoWall(app.project);
    ch();
  };
  el.append(group('Abmessungen', [
    numField('Höhe h', W, 'h', { unit: 'm', min: 0.3, max: 20, onChange: chGeo, info: 'Lichte Wandhöhe zwischen den Decken (OK Rohdecke bis UK Decke). Üblich 2.40–3.00 m.' }),
    numField('Dicke t', W, 't', { unit: 'mm', min: 50, max: 1000, onChange: ch, info: 'Wanddicke ohne Verputz, z.B. 125, 150, 175 oder 250 mm. Die Nachweise aus der Ebene gelten je Meter Wandlänge.' }),
    numField('Länge l', W, 'l', { unit: 'm', min: 0.2, max: 50, onChange: chGeo, info: 'Wandlänge. Massgebend für den Schubnachweis (Scheibe), die Teilflächenbelastung und die Darstellung.' }),
  ], { info: 'Geometrie der Wand. Alle Nachweise aus der Wandebene beziehen sich auf einen 1 m breiten Wandstreifen.' }));

  const supportFields = [
    selectField('Halterung oben/unten', W, 'support', [
      { value: 'slab', label: 'Stahlbetondecken (ρ2 = 0.75)' },
      { value: 'hinged', label: 'gelenkig, z.B. Holzdecke (ρ2 = 1.0)' },
      { value: 'manual', label: 'Knickbeiwert ρ manuell' },
    ], { onChange: () => upd(app, { inputs: true }), info: 'Einspannung der Wand durch die Decken. Bei beidseitig aufliegenden Stahlbetondecken (bzw. Auflagertiefe ≥ 2/3 t) darf ρ2 = 0.75 angesetzt werden, sofern die Exzentrizität am Wandkopf ≤ 0.25·t ist (EN 1996-1-1, 5.5.1.2; sinngemäss SIA 266).' }),
  ];
  if (W.support === 'manual') supportFields.push(numField('Knickbeiwert ρ', W, 'rhoManual', { unit: '–', min: 0.1, max: 3, onChange: ch, info: 'hef = ρ·h. ρ = 1.0 für beidseitig gelenkige Lagerung.' }));
  const sf = sideFlags(W);
  const sideSel = { n: sf.L && sf.R ? 2 : sf.L || sf.R ? 1 : 0 };
  supportFields.push(selectField('Seitliche Halterung', sideSel, 'n', [
    { value: 0, label: 'keine (zweiseitig gehalten)' },
    { value: 1, label: 'eine Querwand (dreiseitig)' },
    { value: 2, label: 'zwei Querwände (vierseitig)' },
  ], { onChange: (n) => {
      const onlyR = sf.R && !sf.L;
      if (n === 0) setSides(W, false, false);
      else if (n === 2) setSides(W, true, true);
      else setSides(W, !onlyR, onlyR);
      upd(app, { inputs: true });
    }, info: 'In der Grafik mit dem Werkzeug «Querwand» (K) am linken bzw. rechten Wandrand setzen. Aussteifende Querwände an den vertikalen Rändern verkürzen die Knicklänge (ρ3, ρ4 nach EN 1996-1-1, 5.5.1.2). Wirksam nur bis zu einem Abstand von 15·t (dreiseitig) bzw. 30·t (vierseitig).' }));
  if (sideSel.n > 0) supportFields.push(numField('Abstand Querwände', W, 'ls', { unit: 'm', min: 0.2, max: 50, onChange: ch, info: 'Lichter Abstand zwischen den aussteifenden Querwänden (vierseitig) bzw. zwischen Querwand und freiem Rand (dreiseitig).' }));
  supportFields.push(live.el);
  el.append(group('Halterung und Knicklänge', supportFields, { info: 'Die Knicklänge hef = ρ·h bestimmt den Einfluss der Schlankheit auf den Tragwiderstand.' }));

  const empty = emptyState('Keine Öffnungen', 'Fenster und Türen mit «+ Zeile» erfassen (x ab linkem Wandende).');
  empty.classList.toggle('hidden', W.openings.length > 0);
  el.append(group('Öffnungen', [
    empty,
    dataTable([
      { key: 'x', label: 'x', unit: 'm', min: 0, info: 'Abstand des linken Öffnungsrands vom linken Wandende.' },
      { key: 'b', label: 'Breite', unit: 'm', min: 0 },
      { key: 'y', label: 'Brüstung', unit: 'm', min: 0, info: 'Höhe der Unterkante über dem Wandfuss (Türe: 0).' },
      { key: 'hgt', label: 'Höhe', unit: 'm', min: 0 },
    ], W.openings, {
      onChange: () => { empty.classList.toggle('hidden', W.openings.length > 0); upd(app); },
      newRow: (rows) => ({ x: Math.min(Math.max(0, W.l - 1.2), 0.8 + rows.length * 1.6), b: 0.9, y: 0, hgt: 2.1 }),
      hint: '',
    }),
    checkField('Auflast auf Pfeiler konzentrieren', S, 'openingConc', { onChange: () => upd(app), info: 'Die Vertikallasten aus dem Wandkopf werden mit dem Faktor l/(l − Σb) erhöht, weil die Stürze die Last über den Öffnungen auf die Pfeiler abgeben. Pfeiler, Stürze und Brüstungen sind gesondert nachzuweisen.' }),
  ], { info: 'Öffnungen werden in der Ansicht dargestellt und erhöhen die Auflast der Pfeiler. Der Scheibennachweis berücksichtigt Öffnungen nicht.' }));
}

// ------------------------------------------------------------------ Register 2: Material

function tabMaterial(el, app) {
  const M = app.project.material;
  const live = liveBox(() => {
    const d = designValues(M);
    return [['fxd = fxk/γM', fmt(d.fxd, 2), 'MPa'], ['fyd = fyk/γM', fmt(d.fyd, 2), 'MPa'], ['Exd = Exk/γE', fmt(d.Exd, 0), 'MPa']];
  });
  const ch = () => { if (M.exkAuto) M.Exk = typeById(M.type).KE * M.fxk; live.update(); upd(app); };
  const changed = changedFromDefaults(M);
  el.append(group('Mauerwerksart', [
    selectField('Mauerwerksart', M, 'type', MASONRY_TYPES.map((t) => ({ value: t.id, label: t.label })), {
      onChange: (id) => { applyTypeDefaults(M, id); upd(app, { inputs: true }); },
      info: 'Die Wahl setzt Standardwerte für alle Kennwerte. Die Werte sind Richtwerte für die Vorbemessung und müssen mit SIA 266 bzw. den Produktangaben geprüft werden.',
    }),
    changed.length
      ? h('div', { class: 'note warn' }, `Gegenüber den Standardwerten geändert: ${changed.join(', ')}. `,
        button('Standardwerte', { small: true, icon: 'undo', onClick: () => { applyTypeDefaults(M, M.type); upd(app, { inputs: true }); } }))
      : note('Standardwerte (Richtwerte) – bitte mit den Produktangaben bzw. SIA 266 prüfen.', ''),
  ]));
  el.append(group('Druckfestigkeit und E-Modul (charakteristisch)', [
    numField('fxk senkrecht zu Lagerfugen', M, 'fxk', { unit: 'MPa', min: 0.1, max: 50, onChange: ch, info: 'Charakteristische Druckfestigkeit des Mauerwerks senkrecht zu den Lagerfugen (vertikal). Massgebend für Normalkraft, Knicken und Teilflächenpressung.' }),
    numField('fyk parallel zu Lagerfugen', M, 'fyk', { unit: 'MPa', min: 0.05, max: 50, onChange: ch, info: 'Charakteristische Druckfestigkeit parallel zu den Lagerfugen (horizontal). Geht in das Spannungsfeld des Schubnachweises ein (SIA 266).' }),
    checkField('Exk = 1000 · fxk (automatisch)', M, 'exkAuto', { onChange: () => { ch(); app.renderInputs(); }, info: 'Elastizitätsmodul aus dem Verhältnis Exk/fxk = 1000 (EN 1996-1-1, 3.7.2). Ausschalten, um einen eigenen Wert einzugeben.' }),
    numField('Exk', M, 'Exk', { unit: 'MPa', min: 10, max: 100000, readonly: M.exkAuto, onChange: ch, info: 'Charakteristischer Elastizitätsmodul. Massgebend für die Verformungen nach Theorie 2. Ordnung (Knicken).' }),
  ]));
  el.append(group('Widerstandsbeiwerte', [
    numField('γM', M, 'gammaM', { unit: '–', min: 1, max: 5, onChange: ch, info: 'Widerstandsbeiwert für Mauerwerk nach SIA 266: γM = 2.0. Gilt für alle Festigkeiten (fxd, fyd, fvd).' }),
    numField('γE (E-Modul Th. 2. O.)', M, 'gammaE', { unit: '–', min: 1, max: 5, onChange: ch, info: 'Exd = Exk/γE für die Verformungsberechnung im Tragsicherheitsnachweis. Standard γE = γM, damit das Verhältnis Exd/fxd dem charakteristischen Verhältnis entspricht (vgl. EN 1996-1-1 Anhang G). Bitte gemäss SIA 266 prüfen.' }),
    live.el,
  ]));
  el.append(group('Weitere Kennwerte', [
    numField('Raumlast γ', M, 'gamma', { unit: 'kN/m³', min: 0, max: 30, onChange: ch, info: 'Raumlast des Mauerwerks inkl. Mörtel (ohne Verputz) für das Eigengewicht der Wand. Backstein ca. 11–13, Kalksandstein ca. 17–20, Porenbeton ca. 5–7 kN/m³.' }),
    numField('Reibungsbeiwert μ', M, 'mu', { unit: '–', min: 0, max: 1.5, onChange: ch, info: 'Reibungsbeiwert in der Lagerfuge (tan φ) für den Gleitnachweis der Wandscheibe. Üblich 0.6.' }),
    numField('Endkriechzahl φ∞', M, 'phi', { unit: '–', min: 0, max: 5, onChange: ch, info: 'Kriechzahl für die Langzeitverformung (EN 1996-1-1, Tab. 3.8): Backstein 0.5–1.5, Kalksandstein/Beton 1.0–2.0, Porenbeton 0.5–1.5. Wirkt nur, wenn «Kriechen» im Register «Nachweise» aktiv ist.' }),
    numField('Haftscherfestigkeit fvk0', M, 'fvk0', { unit: 'MPa', min: 0, max: 2, onChange: ch, info: 'Nur für den Schubnachweis nach EN 1996-1-1 (6.2). Normalmörtel: 0.15–0.30 MPa (EN 1996-1-1, Tab. 3.4).' }),
    numField('Steindruckfestigkeit fb', M, 'fb', { unit: 'MPa', min: 0, max: 100, onChange: ch, info: 'Normierte Steindruckfestigkeit; begrenzt die Schubfestigkeit nach EN 1996-1-1: fvk ≤ 0.065·fb.' }),
    checkField('Vollsteine (Steingruppe 1)', M, 'solid', { onChange: () => upd(app), info: 'Nur bei Vollsteinen darf die Teilflächenpressung mit dem Faktor β erhöht werden (EN 1996-1-1, 6.1.3). Loch- und Hohlsteine: β = 1.0.' }),
  ], { collapsible: true }));
}

// ------------------------------------------------------------------ Register 3: Lasten

function tabLasten(el, app) {
  const L = app.project.loads, W = app.project.wall;
  const ch = () => { live.update(); upd(app); };
  const live = liveBox(() => {
    const t = W.t / 1000;
    const eD = L.eMode === 'slab' ? (t / 2 - L.aD / 3000) * 1000 : L.eMode === 'centric' ? 0 : L.eD;
    const nW = (L.gW || 0) + (L.qW || 0), nD = (L.gD || 0) + (L.qD || 0);
    const eo = nW + nD > 0 ? nD * eD / (nW + nD) : 0;
    return [['Exzentrizität Decke eD', fmt(eD, 1), 'mm'], ['Wandkopf eo (gk + qk)', fmt(eo, 1), 'mm'], ['Eigengewicht γ·t', fmt(app.project.material.gamma * t, 2), 'kN/m²']];
  });

  const vert = [
    h('div', { class: 'mw-sub' }, 'Wand darüber (zentrisch)'),
    numField('ständig gk', L, 'gW', { unit: 'kN/m', min: 0, onChange: ch, info: 'Charakteristische ständige Last aus den Geschossen darüber (Wände, Decken), zentrisch auf die Wand. Je Meter Wandlänge.' }),
    numField('veränderlich qk', L, 'qW', { unit: 'kN/m', min: 0, onChange: ch, info: 'Charakteristische Nutz- und Schneelast aus den Geschossen darüber, zentrisch.' }),
    h('div', { class: 'mw-sub' }, 'Deckenauflager (exzentrisch)'),
    numField('ständig gk', L, 'gD', { unit: 'kN/m', min: 0, onChange: ch, info: 'Auflagerkraft der Decke direkt über der Wand (ständiger Anteil). Diese Last greift mit der Exzentrizität eD an.' }),
    numField('veränderlich qk', L, 'qD', { unit: 'kN/m', min: 0, onChange: ch, info: 'Auflagerkraft der Decke aus Nutzlast.' }),
    selectField('Lastangriff Decke', L, 'eMode', [
      { value: 'centric', label: 'zentrisch (Innenwand, Zentrierstreifen)' },
      { value: 'slab', label: 'Deckenverdrehung Endauflager' },
      { value: 'manual', label: 'Exzentrizität eingeben' },
    ], { onChange: () => upd(app, { inputs: true }), info: 'Endauflager: Durch die Deckenverdrehung liegt die Resultierende im Abstand a/3 vom Innenrand, also e = t/2 − a/3 (a = Auflagertiefe). Ein Zentrierstreifen (Elastomer- oder Filzstreifen in Wandmitte) zentriert die Last.' }),
  ];
  if (L.eMode === 'slab') vert.push(numField('Auflagertiefe a', L, 'aD', { unit: 'mm', min: 1, onChange: ch, info: 'Tiefe des Deckenauflagers ab Innenkante der Wand (≤ t). Volle Auflage a = t ergibt e = t/6.' }));
  if (L.eMode === 'manual') vert.push(numField('Exzentrizität eD', L, 'eD', { unit: 'mm', onChange: ch, info: 'Exzentrizität der Deckenauflagerkraft, positiv zur Raumseite.' }));
  vert.push(numField('Exzentrizität Wandfuss eu', L, 'eU', { unit: 'mm', onChange: ch, info: 'Exzentrizität der Resultierenden am Wandfuss (meist 0). Positiv zur Raumseite. Gleiches Vorzeichen wie am Kopf ergibt einfache Krümmung (ungünstig).' }));
  vert.push(live.el);
  el.append(group('Vertikallasten am Wandkopf', vert, { info: 'Charakteristische Werte je Meter Wandlänge. Das Eigengewicht der Wand wird automatisch aus Raumlast und Dicke berechnet.' }));

  const E = L.earth;
  const quer = [
    numField('Wind wk', L, 'wind', { unit: 'kN/m²', onChange: ch, info: 'Charakteristischer Winddruck senkrecht zur Wand (SIA 261), positiv zur Raumseite. Typisch 0.5–1.2 kN/m².' }),
    checkField('Erddruck (Kelleraussenwand)', E, 'on', { onChange: () => upd(app, { inputs: true }), info: 'Erddruck von aussen auf die Wand, dreieckförmig bis zur Anschütthöhe he plus Auflast auf dem Gelände.' }),
  ];
  if (E.on) {
    quer.push(
      numField('Anschütthöhe he', E, 'he', { unit: 'm', min: 0, onChange: ch, info: 'Höhe der Erdanschüttung über dem Wandfuss.' }),
      numField('Raumlast Boden γ', E, 'gs', { unit: 'kN/m³', min: 0, onChange: ch, info: 'Raumlast des Hinterfüllmaterials, üblich 19–20 kN/m³.' }),
      numField('Erddruckbeiwert K', E, 'K', { unit: '–', min: 0, max: 1.5, onChange: ch, info: 'Bei unverschieblichen Kellerwänden Ruhedruck K0 = 1 − sin φ\' ≈ 0.4–0.5.' }),
      numField('Auflast Gelände qk', E, 'qs', { unit: 'kN/m²', min: 0, onChange: ch, info: 'Gleichmässige Auflast auf dem Gelände, z.B. 5 kN/m² (Verkehr, Lagerung). Wird mit dem Faktor für Erddruck kombiniert.' }),
    );
  }
  el.append(group('Querbelastung (senkrecht zur Wand)', quer, { info: 'Lasten senkrecht zur Wandebene. Sie werden mit der Normalkraft zu einer Stützlinie kombiniert (Theorie 2. Ordnung).' }));

  el.append(group('Horizontalkraft in Wandebene', [
    numField('Wind Vw,k', L, 'Vw', { unit: 'kN', onChange: ch, info: 'Charakteristische Horizontalkraft aus Wind, die diese Wand als Aussteifungsscheibe aufnimmt (Anteil aus der Gebäudeaussteifung).' }),
    numField('Erdbeben VE,d', L, 'Ve', { unit: 'kN', onChange: ch, info: 'Bemessungswert der Erdbebenkraft auf diese Wand (z.B. Ersatzkraftverfahren SIA 261). Wird in der Erdbebenkombination mit dem Faktor 1.0 angesetzt.' }),
    numField('Angriffshöhe hV', L, 'hV', { unit: 'm', min: 0.1, onChange: ch, info: 'Höhe der Horizontalkraft über dem Wandfuss; meist Wandkopf (= h). Bei mehrgeschossigen Gebäuden effektive Höhe M/V verwenden.' }),
    checkField('Wandkopf eingespannt (h0 = hV/2)', L, 'topFixed', { onChange: () => upd(app), info: 'Ohne Einspannung wirkt die Wand als Kragscheibe (Schubspannweite h0 = hV). Mit steifer Decke und Einspannung am Kopf halbiert sich die Schubspannweite.' }),
  ], { info: 'Für den Nachweis als Schubwand (Aussteifung). Die zugehörige Normalkraft ergibt sich aus den Vertikallasten mal Wandlänge plus Eigengewicht.' }));

  const C = L.conc;
  const conc = [checkField('Einzellast am Wandkopf', C, 'on', { onChange: () => upd(app, { inputs: true }), info: 'Konzentrierte Last, z.B. Auflager eines Unterzugs oder Trägers. Nachweis der Teilflächenpressung (EN 1996-1-1, 6.1.3).' })];
  if (C.on) {
    conc.push(
      numField('ständig Gk', C, 'G', { unit: 'kN', min: 0, onChange: ch }),
      numField('veränderlich Qk', C, 'Q', { unit: 'kN', min: 0, onChange: ch }),
      numField('Länge der Lastfläche a', C, 'a', { unit: 'mm', min: 1, onChange: ch, info: 'Länge der Auflagerfläche entlang der Wand.' }),
      numField('Tiefe der Lastfläche b', C, 'b', { unit: 'mm', min: 1, onChange: ch, info: 'Tiefe der Auflagerfläche quer zur Wand (≤ t).' }),
      numField('Lage x (linker Rand)', C, 'x', { unit: 'm', min: 0, onChange: ch, info: 'Abstand des linken Rands der Lastfläche vom linken Wandende. Der Randabstand a1 bestimmt den Erhöhungsfaktor β.' }),
      numField('Exzentrizität quer ec', C, 'ec', { unit: 'mm', onChange: ch, info: 'Abstand des Lastschwerpunkts von der Wandachse; EN 1996-1-1 verlangt ec ≤ t/4.' }),
    );
  }
  el.append(group('Einzellast (Teilflächenbelastung)', conc));

  // Kombinationen
  const regen = () => {
    app.project.combosAuto = true;
    app.project.combos = defaultCombos(loadFlags(app.project));
    upd(app, { inputs: true });
  };
  el.append(group('Lastkombinationen', [
    checkField('Automatisch aus den erfassten Lasten (SIA 260)', app.project, 'combosAuto', { onChange: (on) => { if (on) regen(); else upd(app); }, info: 'Die Kombinationen werden nach SIA 260 passend zu den erfassten Einwirkungen (Nutzlast, Wind, Erddruck, Erdbeben) erzeugt. Eine Änderung in der Tabelle schaltet die Automatik aus.' }),
    dataTable([
      { key: 'on', label: '', type: 'check', width: '22px', title: 'aktiv' },
      { key: 'name', label: 'Bezeichnung', type: 'text', width: '34%' },
      { key: 'type', label: 'Art', type: 'select', options: [{ value: 'ULS', label: 'GZT' }, { value: 'SLS', label: 'GZG' }], info: 'GZT: Tragsicherheit (Bemessungswerte). GZG: Gebrauchstauglichkeit mit charakteristischen Lasten (Faktoren 1.0) für die klaffende Fuge.' },
      { key: 'g', label: 'G', info: 'Faktor auf ständige Lasten (Auflasten gk, Eigengewicht, Einzellast Gk): 1.35 ungünstig, 0.80 günstig (SIA 260).' },
      { key: 'q', label: 'Q', info: 'Faktor auf Nutzlasten: 1.5 als Leiteinwirkung, ψ0·1.5 = 1.05 als Begleiteinwirkung, ψ2 = 0.3 in der Erdbebenkombination.' },
      { key: 'w', label: 'W', info: 'Faktor auf Wind (quer und in Wandebene): 1.5 als Leiteinwirkung, ψ0·1.5 = 0.9 als Begleiteinwirkung.' },
      { key: 'e', label: 'Erd', info: 'Faktor auf Erddruck (inkl. Auflast auf dem Gelände): 1.35.' },
      { key: 'ae', label: 'Eb', info: 'Faktor auf die Erdbebenkraft VE,d (Bemessungswert): 1.0 in der Erdbebenkombination, sonst 0.' },
    ], app.project.combos, {
      numbered: false,
      onChange: () => { app.project.combosAuto = false; upd(app, { inputs: true }); },
      newRow: () => ({ on: true, name: 'Neue Kombination', type: 'ULS', g: 1.35, q: 1.5, w: 0, e: 0, ae: 0 }),
      hint: 'Haken = aktiv',
      extraButtons: [button('SIA-Standard', { small: true, icon: 'undo', title: 'Kombinationen passend zu den erfassten Lasten nach SIA 260 neu erzeugen', onClick: regen })],
    }),
  ], { info: 'Bemessungssituationen nach SIA 260: Jede Zeile multipliziert die charakteristischen Einwirkungen mit den angegebenen Lastbeiwerten. Für eine minimale Normalkraft (Querlast, Schub) eine Kombination mit G = 0.80 und Q = 0 vorsehen.' }));
}

// ------------------------------------------------------------------ Register 4: Nachweise

function tabNachweise(el, app) {
  const S = app.project.settings;
  const ch = () => upd(app);
  el.append(group('Normalkraft und Knicken', [
    selectField('Verfahren', S, 'method', [
      { value: 'SIA', label: 'SIA 266: Th. 2. Ordnung (numerisch)' },
      { value: 'EN', label: 'EN 1996-1-1: Φ-Verfahren (Anhang G)' },
    ], { onChange: ch, info: 'SIA 266: Spannungsblock nRd = fxd·(t − 2e) und numerische Berechnung nach Theorie 2. Ordnung (Werkstoff ohne Zugfestigkeit, elastisch-plastisch) mit Laststeigerung bis zum Versagen. EN: Abminderungsfaktoren Φi und Φm nach EN 1996-1-1, 6.1.2.2 und Anhang G.' }),
    numField('Vorverformung e0 = hef /', S, 'impN', { unit: '–', min: 50, max: 2000, onChange: ch, info: 'Ungewollte Ausmitte in Wandmitte (sinusförmig). EN 1996-1-1, 5.5.1.1: einit = hef/450. Wert gemäss SIA 266 prüfen.' }),
    checkField('Kriechen berücksichtigen', S, 'creep', { onChange: ch, info: 'Langzeiteinfluss über einen abgeminderten E-Modul Eeff = Exd/(1 + φ∞·nG/nd) (SIA-Verfahren) bzw. die Kriechausmitte ek (EN, für hef/t > 15).' }),
  ]));
  el.append(group('Querkraft in Wandebene', [
    selectField('Verfahren', S, 'shearMethod', [
      { value: 'SIA', label: 'SIA 266: Spannungsfeld' },
      { value: 'EN', label: 'EN 1996-1-1: fvk0 + 0.4·σd' },
    ], { onChange: ch, info: 'SIA 266: geneigtes Druckfeld über der Druckzone am Wandfuss mit den Fliessbedingungen nach Ganz/Thürlimann (ohne Kohäsion), Gleiten mit μ. EN 1996-1-1, 6.2: Schubfestigkeit aus Haftscherfestigkeit und Reibung über die überdrückte Länge.' }),
  ]));
  el.append(group('Querbelastung', [
    checkField('Bogenwirkung (Resultierende am Wandfuss frei)', S, 'arching', { onChange: ch, info: 'Bei Querlast darf die Resultierende am Wandfuss innerhalb der Druckzone auf die Gegenseite wandern; die Wand trägt dann wie ein Bogen zwischen Fuss und Kopf. Die günstigste Lage wird automatisch gesucht (statische Methode). Ausschalten für eine gelenkige Annahme mit der eingegebenen Exzentrizität eu.' }),
    checkField('Kellerwand vereinfacht (EN 1996-3, 4.5)', S, 'basementEN', { onChange: () => upd(app, { inputs: true }), info: 'Zusätzlicher Nachweis Nmin ≤ NEd ≤ t·fd/3 für Kelleraussenwände unter Erddruck. Anwendungsgrenzen: h ≤ 2.6 m, t ≥ 200 mm, Geländeauflast ≤ 5 kN/m².' }),
    S.basementEN !== false ? numField('Abstand Querwände bc', S, 'bc', { unit: 'm', min: 0.1, onChange: ch, info: 'Abstand der aussteifenden Querwände für den Beiwert β in EN 1996-3 (β = 20 für bc ≥ 2h, 40 für bc ≤ h).' }) : null,
  ]));
  el.append(group('Gebrauchstauglichkeit', [
    checkField('Klaffende Fuge prüfen (|e| ≤ t/3)', S, 'sls', { onChange: ch, info: 'Unter charakteristischen Lasten (Kombinationen der Art GZG) soll höchstens die halbe Lagerfuge klaffen. Empfehlung zur Rissbegrenzung.' }),
    numField('Grenzschlankheit hef/t', S, 'lambdaLim', { unit: '–', min: 5, max: 60, onChange: ch, info: 'EN 1996-1-1, 5.5.1.4: hef/t ≤ 27. Wert gemäss SIA 266 prüfen.' }),
  ]));
}

// ------------------------------------------------------------------ App

createApp({
  id: 'mauerwerk',
  title: 'Mauerwerk',
  subtitle: 'Nachweise nach SIA 266',
  version: 1,
  defaultProject,
  examples: EXAMPLES,
  migrate,
  intro: INTRO,
  inputTabs: [
    { id: 'wand', label: 'Wand', render: tabWand },
    { id: 'material', label: 'Material', render: tabMaterial },
    { id: 'lasten', label: 'Lasten', render: tabLasten },
    { id: 'nachweise', label: 'Nachweise', render: tabNachweise },
  ],
  viewModes: [
    { id: 'ansicht', label: 'Ansicht', title: 'Wandansicht mit Öffnungen, Lasten und Lastausbreitung' },
    { id: 'schnitt', label: 'Schnitt', title: 'Querschnitt mit Exzentrizitäten und Stützlinie' },
    { id: 'schub', label: 'Schub', title: 'Wandscheibe mit Druckfeld' },
  ],
  viewOptions: (app) => {
    const combos = (app.project?.combos || []).map((c, i) => ({ c, i })).filter(({ c }) => c.on !== false);
    const options = [{ value: 'gov', label: 'massgebend' }, ...combos.map(({ c, i }) => ({ value: String(i), label: c.name || `Kombination ${i + 1}` }))];
    if (app.viewOpts.lc !== undefined && !options.some((o) => o.value === String(app.viewOpts.lc))) app.viewOpts.lc = 'gov';
    return [
      { key: 'lc', label: 'Kombination', type: 'select', default: 'gov', options },
      { key: 'loads', label: 'Lasten', type: 'check', default: true },
      { key: 'dims', label: 'Masse', type: 'check', default: true },
    ];
  },
  renderView(view, app, mode) {
    if (mode === 'schnitt') drawSchnitt(view, app);
    else if (mode === 'schub') drawSchub(view, app);
    else drawAnsicht(view, app);
  },
  autoCompute: true,
  compute(project, app) {
    if (syncCombos(project, loadFlags(project)) && app?.activeTab === 'lasten') setTimeout(() => app.renderInputs(), 0);
    if (!hasLoads(project)) {
      throw new IncompleteInput('Noch keine Lasten erfasst – die Wand ist bereit.',
        'Werkzeug «Auflast» (Taste Q) wählen und die Deckenoberkante anklicken. Weitere Werkzeuge: «Einzellast» (F), «Horizontalkraft» (H), «Querlast» (W), «Öffnung» (O). Alternativ im Register «Lasten» eingeben oder unter «Beispiele» ein fertiges Projekt laden.');
    }
    return computeWall(project);
  },
  editor: editorSpec,
  derivation,
  renderResults,
  report: buildReport,
  help: HELP,
});

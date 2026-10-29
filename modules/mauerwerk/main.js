// Modul Mauerwerk – unbewehrtes Mauerwerk nach SIA 266
//
// Linke Spalte nach den Gestaltungsregeln: Register → Karten, Sammlungen (Öffnungen, Einwirkungen,
// Kombinationen) als Liste mit aufklappbarem Editor, selten Gebrauchtes in «Erweitert».
import { createApp, IncompleteInput } from '../../js/core/app.js';
import { h, group, numField, selectField, checkField, textField, button, kvTable, listEditor, badge, fmt } from '../../js/core/ui.js';
import { computeWall, effectiveHeight, hasLoads, loadFlags, sideFlags, setSides } from './calc.js';
import { MASONRY_TYPES, typeById, applyTypeDefaults, designValues, changedFromDefaults } from './materials.js';
import { defaultProject, defaultCombos, syncCombos, EXAMPLES } from './examples.js';
import { editorSpec, fitIntoWall, loadKinds } from './editing.js';
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

/** Abgeleitete Kennwerte (kompakte Tabelle), die sich bei Änderungen neu aufbauen. */
function liveStats(fn) {
  const el = h('div');
  const update = () => {
    let items = [];
    try { items = fn(); } catch { items = []; }
    el.replaceChildren(kvTable(items));
  };
  update();
  return { el, update };
}

/** Liste nach dem Verlassen des Editors auffrischen (Kurzinfo der Zeile), ohne den Fokus zu stören. */
function refreshLater(listEl) {
  setTimeout(() => { if (listEl.isConnected && !listEl.contains(document.activeElement)) listEl.refresh(); }, 0);
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

// ====================================================================== 1 Wand

function tabWand(el, app) {
  const p = app.project, W = p.wall, S = p.settings;
  const t = () => W.t / 1000;
  const live = liveStats(() => {
    const L = p.loads, sf = sideFlags(W);
    const eff = effectiveHeight({ h: W.h, t: t(), mode: W.support, rhoManual: W.rhoManual, sides: (sf.L ? 1 : 0) + (sf.R ? 1 : 0), ls: W.ls > 0 ? W.ls : W.l, eTop: L.eMode === 'slab' ? t() / 2 - L.aD / 3000 : 0 });
    return [['Knickbeiwert ρ', eff.rho, '', 3], ['Knicklänge h_ef', eff.hef, 'm', 2], ['Schlankheit h_ef/t', eff.hef / t(), '', 1]];
  });
  const ch = () => { live.update(); upd(app); };
  let oldH = W.h, oldL = W.l;
  const chGeo = () => {
    const L = p.loads;
    if (Math.abs((L.hV || 0) - oldH) < 1e-9) L.hV = W.h;
    if (Math.abs((W.ls || 0) - oldL) < 1e-9) W.ls = W.l;
    oldH = W.h; oldL = W.l;
    fitIntoWall(p);
    ch();
  };
  el.append(group('Abmessungen', [
    numField('Höhe h', W, 'h', { unit: 'm', min: 0.3, max: 20, onChange: chGeo, info: 'Lichte Wandhöhe zwischen den Decken. In der Grafik: Ecke oben rechts ziehen.' }),
    numField('Dicke t', W, 't', { unit: 'mm', min: 50, max: 1000, onChange: ch, info: 'Wanddicke ohne Verputz (125, 150, 175, 250 mm …). Nachweise aus der Ebene je m Wand.' }),
    numField('Länge l', W, 'l', { unit: 'm', min: 0.2, max: 50, onChange: chGeo, info: 'Massgebend für Scheibe, Teilflächenbelastung und Darstellung.' }),
  ]));

  const sf = sideFlags(W);
  const sides = { L: sf.L, R: sf.R };
  const chSides = () => { setSides(W, sides.L, sides.R); if (!(W.ls > 0)) W.ls = W.l; upd(app, { inputs: true }); };
  el.append(group('Halterung', [
    selectField('Decken', W, 'support', [
      { value: 'slab', label: 'Stahlbeton (ρ_2 = 0.75)' },
      { value: 'hinged', label: 'gelenkig (ρ_2 = 1.0)' },
      { value: 'manual', label: 'ρ manuell' },
    ], { onChange: () => upd(app, { inputs: true }), info: 'Einspannung durch die Decken oben und unten. Stahlbetondecken: ρ_2 = 0.75, sofern e_o ≤ 0.25·t (EN 1996-1-1, 5.5.1.2).' }),
    W.support === 'manual' ? numField('Knickbeiwert ρ', W, 'rhoManual', { min: 0.1, max: 3, onChange: ch, info: 'h_ef = ρ·h' }) : null,
    checkField('Querwand links', sides, 'L', { onChange: chSides, info: 'Aussteifende Querwand am Wandrand (dreiseitige bzw. vierseitige Halterung). In der Grafik: Werkzeug «Querwand» (K).' }),
    checkField('Querwand rechts', sides, 'R', { onChange: chSides }),
    sf.L || sf.R ? numField('Abstand l_s', W, 'ls', { unit: 'm', min: 0.2, max: 50, onChange: ch, info: 'Lichter Abstand der Querwände bzw. Querwand – freier Rand. Wirksam bis 15·t (dreiseitig) bzw. 30·t (vierseitig).' }) : null,
    live.el,
  ], { info: 'Die Knicklänge h_ef = ρ·h bestimmt den Einfluss der Schlankheit.' }));

  const lst = listEditor(W.openings, {
    active: app.mwOpenOpening ?? null,
    onActive: (i) => { app.mwOpenOpening = i; app.editor?.select(i === null ? [] : [`o:${i}`]); },
    label: (o, i) => `Öffnung ${i + 1}`,
    sub: (o) => `${fmt(o.b, 2)} × ${fmt(o.hgt, 2)} m · x = ${fmt(o.x, 2)} m · Brüstung ${fmt(o.y, 2)} m`,
    swatch: () => 'var(--c-mesh)',
    duplicate: (o) => ({ ...o, x: Math.min(Math.max(0, W.l - o.b), o.x + o.b + 0.5) }),
    empty: 'Keine Öffnungen. In der Grafik mit «Öffnung» (O) aufziehen oder hier hinzufügen.',
    onChange: () => { fitIntoWall(p); upd(app, { inputs: true }); },
    detail: (d, o) => {
      const chO = () => { fitIntoWall(p); upd(app); refreshLater(lst); };
      d.append(
        numField('Breite', o, 'b', { unit: 'm', min: 0.1, onChange: chO }),
        numField('Höhe', o, 'hgt', { unit: 'm', min: 0.1, onChange: chO }),
        numField('x links', o, 'x', { unit: 'm', min: 0, onChange: chO, info: 'Abstand vom linken Wandende.' }),
        numField('Brüstung', o, 'y', { unit: 'm', min: 0, onChange: chO, info: 'Unterkante über dem Wandfuss (Türe: 0).' }));
    },
    add: [
      { label: 'Türe', create: () => ({ x: Math.max(0, Math.min(W.l - 1.0, 0.5 + W.openings.length * 1.5)), b: 0.9, y: 0, hgt: Math.min(2.1, W.h - 0.2) }) },
      { label: 'Fenster', create: () => ({ x: Math.max(0, Math.min(W.l - 1.3, 0.5 + W.openings.length * 1.5)), b: 1.2, y: Math.min(0.9, W.h / 3), hgt: Math.min(1.3, W.h / 2) }) },
    ],
  });
  el.append(group(`Öffnungen (${W.openings.length})`, [
    lst,
    W.openings.length ? checkField('Auflast auf Pfeiler', S, 'openingConc', { onChange: () => upd(app), info: 'Vertikallasten am Wandkopf werden mit l/(l − Σb) auf die Pfeiler konzentriert. Pfeiler und Stürze separat nachweisen.' }) : null,
  ], { info: 'Fenster und Türen. Im Scheibennachweis nicht berücksichtigt.' }));
}

// ====================================================================== 2 Material

function tabMaterial(el, app) {
  const M = app.project.material;
  const live = liveStats(() => {
    const d = designValues(M);
    return [['f_xd = f_xk/γ_M', d.fxd, 'MPa', 2], ['f_yd = f_yk/γ_M', d.fyd, 'MPa', 2], ['E_xd = E_xk/γ_E', d.Exd, 'MPa', 0]];
  });
  const ch = () => { if (M.exkAuto) M.Exk = typeById(M.type).KE * M.fxk; live.update(); upd(app); };
  const changed = changedFromDefaults(M);
  el.append(group('Mauerwerk', [
    selectField('Art', M, 'type', MASONRY_TYPES.map((t) => ({ value: t.id, label: t.label })), {
      onChange: (id) => { applyTypeDefaults(M, id); upd(app, { inputs: true }); },
      info: 'Setzt Standardwerte (Richtwerte) für alle Kennwerte. Massgebend sind SIA 266 bzw. die Produktangaben – bitte prüfen.',
    }),
    numField('f_xk', M, 'fxk', { unit: 'MPa', min: 0.1, max: 50, onChange: ch, info: 'Druckfestigkeit senkrecht zu den Lagerfugen (charakteristisch). Normalkraft, Knicken, Teilflächenpressung.' }),
    numField('f_yk', M, 'fyk', { unit: 'MPa', min: 0.05, max: 50, onChange: ch, info: 'Druckfestigkeit parallel zu den Lagerfugen. Druckfeld im Schubnachweis (SIA 266).' }),
    checkField('E_xk = 1000·f_xk', M, 'exkAuto', { onChange: () => { ch(); app.renderInputs(); }, info: 'Elastizitätsmodul aus E_xk/f_xk = 1000 (EN 1996-1-1, 3.7.2). Ausschalten für einen eigenen Wert.' }),
    numField('E_xk', M, 'Exk', { unit: 'MPa', min: 10, max: 100000, readonly: M.exkAuto, onChange: ch, info: 'Für die Verformungen nach Theorie 2. Ordnung.' }),
    numField('Raumlast γ', M, 'gamma', { unit: 'kN/m³', min: 0, max: 30, onChange: ch, info: 'Eigengewicht inkl. Mörtel: Backstein 11–13, Kalksandstein 17–20, Porenbeton 5–7 kN/m³.' }),
  ], {
    info: changed.length ? `Gegenüber den Standardwerten geändert: ${changed.join(', ')}.` : 'Standardwerte (Richtwerte) der gewählten Mauerwerksart – mit SIA 266 bzw. Produktangaben prüfen.',
    actions: changed.length ? [button('Standard', { small: true, ghost: true, icon: 'undo', title: 'Standardwerte der Mauerwerksart wiederherstellen', onClick: () => { applyTypeDefaults(M, M.type); upd(app, { inputs: true }); } })] : null,
  }));
  el.append(group('Bemessungswerte', [
    numField('γ_M', M, 'gammaM', { min: 1, max: 5, onChange: ch, info: 'Widerstandsbeiwert für Mauerwerk nach SIA 266: γ_M = 2.0.' }),
    numField('γ_E', M, 'gammaE', { min: 1, max: 5, onChange: ch, info: 'E_xd = E_xk/γ_E für Theorie 2. Ordnung. Standard γ_E = γ_M (Verhältnis E/f wie charakteristisch). Gemäss SIA 266 prüfen.' }),
    live.el,
  ]));
  el.append(group('Erweitert', [
    numField('Reibung μ', M, 'mu', { min: 0, max: 1.5, onChange: ch, info: 'Reibungsbeiwert in der Lagerfuge (tan φ) für das Gleiten der Wandscheibe, üblich 0.6.' }),
    numField('Kriechzahl φ_{∞}', M, 'phi', { min: 0, max: 5, onChange: ch, info: 'Endkriechzahl (EN 1996-1-1, Tab. 3.8): Backstein 0.5–1.5, Kalksandstein/Beton 1.0–2.0.' }),
    numField('f_vk0', M, 'fvk0', { unit: 'MPa', min: 0, max: 2, onChange: ch, info: 'Haftscherfestigkeit, nur für den Schubnachweis nach EN 1996-1-1 (0.15–0.30 MPa).' }),
    numField('f_b', M, 'fb', { unit: 'MPa', min: 0, max: 100, onChange: ch, info: 'Normierte Steindruckfestigkeit; begrenzt f_vk ≤ 0.065·f_b (EN 1996-1-1).' }),
    checkField('Vollsteine (Gruppe 1)', M, 'solid', { onChange: () => upd(app), info: 'Nur Vollsteine erlauben die Erhöhung β der Teilflächenpressung (EN 1996-1-1, 6.1.3).' }),
  ], { collapsed: true, id: 'mw-mat-erweitert' }));
}

// ====================================================================== 3 Lasten

function comboSum(c) {
  const t = [['g', 'G'], ['q', 'Q'], ['w', 'W'], ['e', 'Erddruck'], ['ae', 'Erdbeben']].filter(([k]) => +c[k]).map(([k, s]) => `${fmt(+c[k], 2)}·${s}`);
  return t.join(' + ') || '–';
}

function tabLasten(el, app) {
  const p = app.project;
  const kinds = loadKinds(app);
  const active = kinds.filter((k) => k.active());
  const items = active.map((k) => ({ ...k }));
  const openIdx = items.findIndex((k) => k.kind === app.mwOpenLoad);
  const lst = listEditor(items, {
    active: openIdx >= 0 ? openIdx : null,
    onActive: (i) => { app.mwOpenLoad = i === null ? null : items[i]?.kind; },
    label: (k) => k.name,
    sub: (k) => k.sub(),
    swatch: (k) => k.swatch,
    duplicate: false,
    empty: 'Noch keine Lasten. Unten hinzufügen oder in der Grafik mit «Auflast» (Q), «Einzellast» (F), «Querlast» (W), «Horizontalkraft» (H) setzen.',
    onRemove: (i) => { items[i].clear(); app.mwOpenLoad = null; upd(app, { inputs: true }); return false; },
    detail: (d, k) => k.detail(d, () => { upd(app); refreshLater(lst); }, () => upd(app, { inputs: true })),
    add: kinds.filter((k) => !k.active()).map((k) => ({ label: { auflast: 'Auflast', einzellast: 'Einzellast', wind: 'Wind', erddruck: 'Erddruck', hkraft: 'Horizontalkraft' }[k.kind], create: () => { k.add(); app.mwOpenLoad = k.kind; upd(app, { inputs: true }); return null; } })),
  });
  el.append(group(`Einwirkungen (${active.length})`, [lst], { info: 'Charakteristische Werte je Meter Wand (Horizontalkraft und Einzellast in kN). Das Eigengewicht der Wand wird automatisch berücksichtigt.' }));

  // Kombinationen
  const regen = () => { p.combosAuto = true; p.combos = defaultCombos(loadFlags(p)); upd(app, { inputs: true }); };
  const cl = listEditor(p.combos, {
    active: app.mwOpenCombo ?? null,
    onActive: (i) => { app.mwOpenCombo = i; },
    label: (c) => c.name || 'Kombination',
    sub: (c) => comboSum(c),
    swatch: (c) => (c.on === false ? 'var(--surface-3)' : c.type === 'SLS' ? 'var(--c-series-3)' : 'var(--accent)'),
    badge: (c) => badge(c.type === 'SLS' ? 'GZG' : 'GZT', c.on === false ? 'info' : c.type === 'SLS' ? 'ok' : 'info'),
    canRemove: () => p.combos.length > 1,
    duplicate: (c) => ({ ...c, name: `${c.name} (Kopie)` }),
    onChange: () => { p.combosAuto = false; upd(app, { inputs: true }); },
    detail: (d, c) => {
      const chC = () => { p.combosAuto = false; upd(app); refreshLater(cl); };
      d.append(
        textField('Bezeichnung', c, 'name', { onChange: chC }),
        selectField('Art', c, 'type', [{ value: 'ULS', label: 'Tragsicherheit (GZT)' }, { value: 'SLS', label: 'Gebrauch (GZG)' }], { onChange: chC, info: 'GZG: charakteristische Lasten (Faktoren 1.0) für die klaffende Fuge.' }),
        checkField('aktiv', c, 'on', { onChange: chC }),
        numField('γ_G', c, 'g', { onChange: chC, info: 'Ständige Lasten inkl. Eigengewicht: 1.35 ungünstig, 0.80 günstig (SIA 260).' }),
        numField('γ_Q', c, 'q', { onChange: chC, info: 'Nutzlast: 1.5 Leiteinwirkung, ψ_0·1.5 = 1.05 Begleiteinwirkung, ψ_2 = 0.3 bei Erdbeben.' }),
        numField('γ_W', c, 'w', { onChange: chC, info: 'Wind (quer und in Wandebene): 1.5 bzw. ψ_0·1.5 = 0.9.' }),
        numField('γ_Erd', c, 'e', { onChange: chC, info: 'Erddruck inkl. Geländeauflast: 1.35.' }),
        numField('γ_Eb', c, 'ae', { onChange: chC, info: 'Erdbebenkraft V_E,d (Bemessungswert): 1.0 in der Erdbebenkombination.' }));
    },
    add: [{ label: 'Kombination', create: () => ({ on: true, name: 'Neue Kombination', type: 'ULS', g: 1.35, q: 1.5, w: 0, e: 0, ae: 0 }) }],
  });
  el.append(group(`Kombinationen (${p.combos.filter((c) => c.on !== false).length})`, [
    checkField('Automatisch (SIA 260)', p, 'combosAuto', { onChange: (on) => { if (on) regen(); else upd(app); }, info: 'Kombinationen passend zu den erfassten Einwirkungen (Nutzlast, Wind, Erddruck, Erdbeben). Eine Änderung in der Liste schaltet die Automatik aus.' }),
    cl,
  ], { info: 'Bemessungssituationen nach SIA 260. Jede Kombination multipliziert die charakteristischen Einwirkungen mit ihren Lastbeiwerten.' }));
}

// ====================================================================== 4 Nachweise

function tabNachweise(el, app) {
  const p = app.project, S = p.settings, L = p.loads;
  const ch = () => upd(app);
  el.append(group('Verfahren', [
    selectField('Knicken', S, 'method', [
      { value: 'SIA', label: 'SIA 266: Th. 2. Ordnung' },
      { value: 'EN', label: 'EN 1996-1-1: Φ-Verfahren' },
    ], { onChange: ch, info: 'SIA 266: Spannungsblock n_Rd = f_xd·(t − 2e) und numerische Theorie 2. Ordnung mit Laststeigerung. EN: Φ_i und Φ_m nach EN 1996-1-1, 6.1.2.2 und Anhang G.' }),
    selectField('Schub', S, 'shearMethod', [
      { value: 'SIA', label: 'SIA 266: Spannungsfeld' },
      { value: 'EN', label: 'EN 1996-1-1: f_vk0 + 0.4·σ_d' },
    ], { onChange: ch, info: 'SIA 266: geneigtes Druckfeld zur Druckzone am Wandfuss (Ganz/Thürlimann, ohne Kohäsion), Gleiten mit μ. EN 1996-1-1, 6.2: Haftscherfestigkeit und Reibung über die überdrückte Länge.' }),
    checkField('Kriechen', S, 'creep', { onChange: ch, info: 'E_eff = E_xd/(1 + φ_{∞}·n_G/n_d) bzw. Kriechausmitte e_k (EN, für h_ef/t > 15).' }),
  ]));
  el.append(group('Gebrauchstauglichkeit', [
    checkField('Klaffende Fuge e ≤ t/3', S, 'sls', { onChange: ch, info: 'Unter charakteristischen Lasten (Kombinationen GZG) klafft höchstens die halbe Lagerfuge. Empfehlung zur Rissbegrenzung.' }),
    numField('Grenzschlankheit', S, 'lambdaLim', { min: 5, max: 60, onChange: ch, info: 'h_ef/t ≤ 27 nach EN 1996-1-1, 5.5.1.4. Wert gemäss SIA 266 prüfen.' }),
  ]));
  el.append(group('Erweitert', [
    numField('Vorverformung h_ef/…', S, 'impN', { min: 50, max: 2000, onChange: ch, info: 'Ungewollte Ausmitte e_0 = h_ef/450 in Wandmitte (EN 1996-1-1, 5.5.1.1). Wert gemäss SIA 266 prüfen.' }),
    checkField('Bogenwirkung bei Querlast', S, 'arching', { onChange: ch, info: 'Die Resultierende am Wandfuss darf innerhalb der Druckzone zur Gegenseite wandern (statische Methode); die günstigste Lage wird gesucht.' }),
    checkField('Kellerwand EN 1996-3', S, 'basementEN', { onChange: () => upd(app, { inputs: true }), info: 'Vereinfachter Nachweis N_min ≤ N_Ed ≤ t·f_d/3 (EN 1996-3, 4.5). Nur mit Erddruck; Grenzen h ≤ 2.6 m, t ≥ 200 mm, Geländeauflast ≤ 5 kN/m².' }),
    S.basementEN !== false && L.earth?.on ? numField('Querwandabstand b_c', S, 'bc', { unit: 'm', min: 0.1, onChange: ch, info: 'Für β in EN 1996-3: 20 bei b_c ≥ 2h, 40 bei b_c ≤ h.' }) : null,
  ], { collapsed: true, id: 'mw-nw-erweitert' }));
}

// ====================================================================== App

createApp({
  id: 'mauerwerk',
  title: 'Mauerwerk',
  subtitle: 'Nachweise nach SIA 266',
  version: 1,
  instance: { label: 'Wand', plural: 'Wände' },
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
    { id: 'ansicht', label: 'Ansicht', title: 'Wandansicht mit Öffnungen, Lasten und Lastausbreitung – hier wird gezeichnet' },
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

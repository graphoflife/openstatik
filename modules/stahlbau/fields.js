// Gemeinsame Eingabefelder für die Register und das Eigenschaftsfenster der Grafik.
// Jede Funktion erhält {ch, chI}: ch nach Wertänderungen, chI nach Änderungen, die den Aufbau der Felder ändern.
// Im Register ist ch = app.changed() (Fokus bleibt), im Eigenschaftsfenster beides app.changed({inputs: true}).
import { h, numField, selectField, checkField, textField, button, note, stats, svgEl, toast, fmt, rich } from '../../js/core/ui.js';
import { STEEL_GRADES } from '../../js/core/materials.js';
import { SERIES, SEARCHABLE, CATALOG, profileNames, findProfile, sectionProps } from './profiles.js';
import { SYSTEMS, beamModel, normSupports } from './beam.js';
import { materialFor, SHAPE_OPTIONS } from './calc.js';

export const INFO = {
  series: 'Gewalzte Profile nach Normtabelle (Querschnittswerte werden aus den Nennmassen inkl. Ausrundungen berechnet), ein geschweisster I-Querschnitt mit frei wählbaren Blechen oder ganz eigene Querschnittswerte.',
  norm: '<b>SIA 263</b>: γ<sub>M0</sub> = γ<sub>M1</sub> = 1.05, Lastbeiwerte nach SIA 260, Kippen nach SIA 263.<br><b>EN 1993-1-1</b>: γ<sub>M0</sub> = γ<sub>M1</sub> = 1.0 (empfohlene Werte), Lastbeiwerte nach EN 1990.<br>Die Nachweisformeln folgen in beiden Fällen der Nummerierung von EN 1993-1-1.',
  steel: 'Streckgrenze f<sub>y</sub> nach SIA 263 Tab. 1 bzw. EN 1993-1-1 Tab. 3.1. Für Bleche dicker als 40 mm wird f<sub>y</sub> automatisch abgemindert.',
  gamma: 'Widerstandsbeiwerte: γ<sub>M0</sub> für den Querschnittswiderstand, γ<sub>M1</sub> für die Stabilitätsnachweise (Knicken, Kippen).',
  mode: '<b>Träger mit Lasten</b>: System und Lasten eingeben – Schnittgrössen, Kombinationen und Durchbiegungen werden berechnet.<br><b>Schnittgrössen direkt</b>: Bemessungswerte N, M<sub>y</sub>, M<sub>z</sub>, V<sub>z</sub>, V<sub>y</sub> aus einer anderen Berechnung übernehmen (z.B. Stütze aus einem Rahmen).',
  system: 'Vorlagen für die üblichen Systeme. Lager, die Sie in der Grafik setzen oder verschieben, werden automatisch wieder einer Vorlage zugeordnet; passt keine, gilt «Frei». Alle Lager halten den Träger vertikal und seitlich (Gabellager); eingespannte Lager verhindern zusätzlich die Verdrehung in der Ebene.',
  selfWeight: 'Das Eigengewicht g = A · 78.5 kN/m³ wird als ständige Last (Lastfall «Eigengewicht») automatisch angesetzt. Es greift im Schwerpunkt an.',
  loadCases: 'Ein Lastfall fasst Lasten gleicher Herkunft zusammen. Die Kategorie bestimmt die Teilsicherheits- und Kombinationsbeiwerte. Für feldweise Nutzlast bei Durchlaufträgern je Feld einen eigenen Lastfall anlegen.',
  loads: 'Lasten in z wirken nach unten (Schwerkraft) und erzeugen M<sub>y</sub>; Lasten in y wirken horizontal und erzeugen M<sub>z</sub>. Normalkraft: Druck positiv, konstant über die Stablänge.',
  forces: 'Bemessungswerte (bereits mit Lastbeiwerten multipliziert). Vorzeichen: N als Druck positiv. M<sub>y</sub> und M<sub>z</sub> sind die betragsmässig grössten Momente; der Verlauf bestimmt C<sub>1</sub> (Kippen) und die Momentenbeiwerte C<sub>m</sub>.',
  psi: 'Endmomentenverhältnis ψ = M(Stabende) / M(Stabanfang) zwischen −1 und +1. ψ = 1: konstantes Moment, ψ = 0: Dreieck, ψ = −1: Doppelkrümmung (günstig).',
  beta: 'Knicklänge L<sub>cr</sub> = β · Bezugslänge. β = 1.0 für beidseitig gelenkig gehaltene Stäbe, 0.7 für einseitig eingespannt, 0.5 für beidseitig eingespannt, 2.0 für Kragstützen.',
  betaZ: 'Bezugslänge für das Knicken um die schwache Achse ist der grösste Abstand zwischen seitlichen Halterungen (Auflager und zusätzliche Halterungen).',
  sway: 'Seitenverschiebliche Systeme (z.B. Kragstütze, unverschieblich nicht gehaltener Rahmen): Momentenbeiwert C<sub>m</sub> = 0.9 nach EN 1993-1-1 Tab. B.3.',
  ltb: 'Biegedrillknicken (Kippen) tritt bei offenen Querschnitten unter Biegung um die starke Achse auf: Der gedrückte Gurt weicht seitlich aus und der Träger verdreht sich.',
  cont: 'Ist der Druckgurt durchgehend seitlich gehalten (z.B. durch eine schubsteife Decke, Trapezblech mit genügender Verbindung), kann der Träger nicht kippen – der Kippnachweis entfällt.',
  loadPos: 'Lasten auf dem <b>Obergurt</b> wirken destabilisierend (sie verstärken die Verdrehung) und reduzieren M<sub>cr</sub> deutlich (ungünstig). Lasten am <b>Untergurt</b> wirken stabilisierend (günstig).',
  k: 'Seitliche Einspannung der Stabenden (Drehung um die z-Achse). k = 1.0: Gabellager, frei drehbar (Normalfall, auf der sicheren Seite).',
  kw: 'Wölbeinspannung der Stabenden. k<sub>w</sub> = 1.0: freie Verwölbung (Normalfall). k<sub>w</sub> = 0.5 nur bei konstruktiv wölbsteifen Anschlüssen (z.B. Stirnplatten mit Steifen, Einspannung eines Kragarms).',
  mcr: '<b>3-Faktoren-Formel</b>: M<sub>cr</sub> = C<sub>1</sub>·π²EI<sub>z</sub>/(kL)²·{√[(k/k<sub>w</sub>)²·I<sub>w</sub>/I<sub>z</sub> + (kL)²·GI<sub>t</sub>/(π²EI<sub>z</sub>) + (C<sub>2</sub>·z<sub>g</sub>)²] − C<sub>2</sub>·z<sub>g</sub>} mit C<sub>1</sub>, C<sub>2</sub> aus Tabellen (NCCI SN003).<br><b>Eigenwertanalyse</b>: genaue Lösung für beliebige Momentenverläufe, Kragarme und Halterungen (FE-Biegedrillstab).',
  cAuto: 'C<sub>1</sub> berücksichtigt den Momentenverlauf (konstant: 1.0, Gleichlast: 1.13, Dreieck: 1.77). C<sub>2</sub> erfasst den Lastangriffspunkt. Nicht tabellierte Verläufe werden automatisch mit der Eigenwertanalyse gerechnet.',
  chiLT: '<b>Nach Norm</b>: SIA → SIA 263 (α<sub>LT</sub> = 0.21 gewalzt / 0.49 geschweisst, λ̄<sub>LT,0</sub> = 0.4); EN → 6.3.2.3 für I-Profile (mit Modifikation f), sonst 6.3.2.2.',
  restraints: 'Stellen, an denen der Träger seitlich und gegen Verdrehen gehalten ist (Gabellager), z.B. durch Querträger, Pfetten mit Verband oder Kopfbänder. An den Auflagern ist der Träger immer gehalten.',
  factors: 'Teilsicherheitsbeiwerte γ und Kombinationsbeiwerte ψ nach SIA 260 (Tab. 1, Tab. 2) bzw. EN 1990 (Tab. A1.1, A1.2(B)). γ<sub>G,inf</sub> wird für günstig wirkende ständige Lasten bei Durchlaufträgern und Kragarmen verwendet.',
  combos: 'Tragsicherheit: γ<sub>G</sub>·G + γ<sub>Q</sub>·Q<sub>1</sub> + Σ γ<sub>Q</sub>·ψ<sub>0</sub>·Q<sub>i</sub> (jede veränderliche Last einmal als Leiteinwirkung). Gebrauch charakteristisch: G + Q<sub>1</sub> + Σ ψ<sub>0</sub>·Q<sub>i</sub>; quasi-ständig: G + Σ ψ<sub>2</sub>·Q<sub>i</sub>.',
  sls: 'Grenzwerte der Durchbiegung als Bruchteil der Spannweite, z.B. L/300. Bei Kragarmen wird die doppelte Kraglänge eingesetzt (2·L/300).',
  suggest: 'Durchsucht die gewählte Reihe mit allen aktuellen Eingaben (Lasten, Knicklängen, Halterungen) und findet das leichteste Profil, das alle Nachweise erfüllt.',
};

/** Kleines Bild des Momentenverlaufs. */
export function shapeIcon(shape, psi = 1) {
  const f = { lin: (x) => 1 + (psi - 1) * x, q: (x) => 4 * x * (1 - x), P: (x) => 2 * Math.min(x, 1 - x), qe: (x) => 1 - 6 * x + 6 * x * x }[shape] || (() => 1);
  const pts = Array.from({ length: 21 }, (_, i) => [4 + i * 2.6, 13 + 8 * f(i / 20)]);
  const s = svgEl('svg', { viewBox: '0 0 60 26', width: 38, height: 17, 'aria-hidden': 'true', class: 'shape-icon' });
  s.append(svgEl('polygon', { points: [[4, 13], ...pts, [56, 13]].map((q) => q.join(',')).join(' '), style: { fill: 'var(--c-pos-fill)', stroke: 'var(--c-pos)', strokeWidth: 1.2 } }));
  s.append(svgEl('line', { x1: 4, y1: 13, x2: 56, y2: 13, style: { stroke: 'var(--text-2)', strokeWidth: 1.4 } }));
  return s;
}

/** Ersetzt die (leere) Einheitenspalte eines Auswahlfeldes durch eigene Elemente (Knöpfe, Symbol). */
function withTrailer(field, node) {
  field.lastChild.replaceWith(h('span', { class: 'row nowrap' }, node));
  return field;
}

/** Profilwahl (Reihe, Profil mit − / +, Bleche bzw. eigene Werte). compact: eigene Werte nur als Hinweis. */
export function profileFields(app, { ch, chI, compact = false }) {
  const p = app.project, s = p.section;
  const isCat = !!CATALOG[s.series];
  const kids = [
    selectField('Reihe', s, 'series', SERIES.map((x) => ({ value: x.id, label: compact ? x.short || x.id : x.label })), {
      wide: true, info: INFO.series,
      onChange: () => { if (CATALOG[s.series] && !findProfile(s.series, s.name)) s.name = CATALOG[s.series][Math.min(8, CATALOG[s.series].length - 1)].name; if (SEARCHABLE.includes(s.series)) p.suggestSeries = s.series; chI(); },
    }),
  ];
  if (isCat) {
    const names = profileNames(s.series);
    const step = (d) => { const i = names.indexOf(s.name); const j = Math.max(0, Math.min(names.length - 1, i + d)); if (j !== i) { s.name = names[j]; chI(); } };
    kids.push(withTrailer(selectField('Profil', s, 'name', names, { onChange: chI, info: 'Mit − / + zum nächstkleineren bzw. -grösseren Profil der Reihe.' }), [
      button('', { icon: 'minus', small: true, ghost: true, title: 'Nächstkleineres Profil', onClick: () => step(-1) }),
      button('', { icon: 'plus', small: true, ghost: true, title: 'Nächstgrösseres Profil', onClick: () => step(1) })]));
  } else if (s.series === 'WI') {
    const w = s.welded;
    kids.push(h('div', { class: 'grid2' },
      numField('Höhe h', w, 'h', { unit: 'mm', min: 1, onChange: ch, info: 'Gesamthöhe des Trägers.' }),
      numField('Breite b', w, 'b', { unit: 'mm', min: 1, onChange: ch, info: 'Flanschbreite.' }),
      numField('Steg t_w', w, 'tw', { unit: 'mm', min: 0.1, onChange: ch }),
      numField('Flansch t_f', w, 'tf', { unit: 'mm', min: 0.1, onChange: ch }),
      numField('Halsnaht a', w, 'a', { unit: 'mm', min: 0, onChange: ch, info: 'Kehlnahtdicke der Halsnähte. Sie verkürzt die gedrückten Blechbreiten c für die Klassifizierung (c = … − √2·a), wird aber in den Querschnittswerten nicht angerechnet.' })));
  } else if (compact) {
    kids.push(note('Eigene Querschnittswerte bearbeiten Sie im Register «Profil».', ''));
  } else {
    const u = s.custom;
    kids.push(
      textField('Bezeichnung', u, 'name', { onChange: ch }),
      h('div', { class: 'grid2' },
        numField('Höhe h', u, 'h', { unit: 'mm', min: 1, onChange: ch, info: 'Für den Lastangriffspunkt beim Kippen (±h/2) und die Darstellung.' }),
        numField('Breite b', u, 'b', { unit: 'mm', min: 1, onChange: ch }),
        numField('A', u, 'A', { unit: 'cm²', min: 0, onChange: ch }),
        numField('A_vz', u, 'Avz', { unit: 'cm²', min: 0, onChange: ch, info: 'Schubfläche für die Querkraft V<sub>z</sub>.' }),
        numField('I_y', u, 'Iy', { unit: 'cm⁴', min: 0, onChange: ch }),
        numField('I_z', u, 'Iz', { unit: 'cm⁴', min: 0, onChange: ch }),
        numField('W_el,y', u, 'Wely', { unit: 'cm³', min: 0, onChange: ch }),
        numField('W_el,z', u, 'Welz', { unit: 'cm³', min: 0, onChange: ch }),
        numField('W_pl,y', u, 'Wply', { unit: 'cm³', min: 0, onChange: ch }),
        numField('W_pl,z', u, 'Wplz', { unit: 'cm³', min: 0, onChange: ch }),
        numField('I_t', u, 'It', { unit: 'cm⁴', min: 0, onChange: ch, info: 'Torsionsträgheitsmoment (St. Venant).' }),
        numField('I_w', u, 'Iw', { unit: 'cm⁶', min: 0, onChange: ch, info: 'Wölbwiderstand; 0 für Hohlprofile.' })),
      selectField('Klasse', u, 'cls', [1, 2, 3].map((c) => ({ value: c, label: `Klasse ${c}` })), { onChange: ch, info: 'Klassen 1/2: plastische Widerstände, Klasse 3: elastische. Klasse 4 ist für eigene Werte nicht vorgesehen.' }),
      h('div', { class: 'grid3' },
        selectField('Knicken y', u, 'curveY', ['a0', 'a', 'b', 'c', 'd'], { onChange: ch, info: 'Knicklinie für Ausweichen um y-y (Tab. 6.2).' }),
        selectField('Knicken z', u, 'curveZ', ['a0', 'a', 'b', 'c', 'd'], { onChange: ch, info: 'Knicklinie für Ausweichen um z-z (Tab. 6.2).' }),
        selectField('Kippen', u, 'ltbCurve', ['a', 'b', 'c', 'd'], { onChange: ch, info: 'Kipplinie für das allgemeine Verfahren (Tab. 6.4).' })));
  }
  let sec = null;
  try { sec = sectionProps(s); } catch (e) { kids.push(note(e.message, 'fail')); }
  if (sec) {
    if (compact) kids.push(h('div', { class: 'muted small' }, rich(`${fmt(sec.h, 0)} × ${fmt(sec.b, 0)} mm · ${fmt(sec.mass, 1)} kg/m · W_pl,y = ${fmt(sec.Wply / 1e3, 0)} cm³`)));
    else kids.push(stats([['h × b', `${fmt(sec.h, 0)} × ${fmt(sec.b, 0)}`, 'mm'], ['Masse', sec.mass, 'kg/m', 1], ['I_y', sec.Iy / 1e4, 'cm⁴', 0], ['W_pl,y', sec.Wply / 1e3, 'cm³', 0]]));
  }
  return kids;
}

/** Norm und Stahlsorte (Streckgrenze als Hinweis). */
export function materialFields(app, { chI }) {
  const p = app.project;
  let fyHelp = null;
  try { const sec = sectionProps(p.section); const m = materialFor(p, sec); fyHelp = rich(`f_y = ${m.fy} N/mm², f_u = ${m.fu} N/mm²${sec.tmax > 40 ? ' (t > 40 mm)' : ''}`); } catch { /* */ }
  return [
    selectField('Norm', p, 'norm', [{ value: 'SIA', label: 'SIA 263 (Schweiz)' }, { value: 'EC', label: 'EN 1993-1-1 (Eurocode)' }], {
      wide: true, info: INFO.norm,
      onChange: () => { p.combos.factors = null; toast('Last- und Widerstandsbeiwerte auf die Werte der gewählten Norm gesetzt.', 'info'); chI(); },
    }),
    selectField('Stahlsorte', p, 'steel', STEEL_GRADES, { wide: true, onChange: chI, info: INFO.steel, help: fyHelp }),
  ];
}

/** Widerstandsbeiwerte (selten geändert). */
export function gammaFields(app, { ch, chI }) {
  const p = app.project;
  return [
    checkField('nach Norm', p.gamma, 'auto', { onChange: (v) => { if (!v) { const d = p.norm === 'EC' ? 1.0 : 1.05; p.gamma.M0 = d; p.gamma.M1 = d; } chI(); }, info: INFO.gamma }),
    p.gamma.auto === false ? h('div', { class: 'grid2' },
      numField('γ_M0', p.gamma, 'M0', { min: 0.8, max: 2, onChange: ch, info: 'Querschnittswiderstand' }),
      numField('γ_M1', p.gamma, 'M1', { min: 0.8, max: 2, onChange: ch, info: 'Stabilität (Knicken, Kippen)' })) : null,
  ].filter(Boolean);
}

/** Kragarm-Vorgaben für Knicklängen und Kippen (bzw. zurück auf Normalfall). */
export function cantileverDefaults(p, isCant) {
  const st = p.stab;
  if (isCant) { Object.assign(st, { betaY: 2, betaZ: 2, swayY: true, swayZ: true, k: 0.7, kw: 0.7, mcr: 'fe' }); return true; }
  if (st.betaY === 2 && st.swayY) Object.assign(st, { betaY: 1, betaZ: 1, swayY: false, swayZ: false, k: 1, kw: 1, mcr: 'formula' });
  return false;
}

/** Statisches System (Vorlage oder frei), Längen und Eigengewicht. */
export function systemFields(app, { ch, chI, compact = false, spansTable = null }) {
  const p = app.project, b = p.beam;
  const prev = b.system || 'ss';
  const kids = [
    selectField('System', b, 'system', SYSTEMS, {
      wide: true, info: INFO.system,
      onChange: (v) => {
        if (v === 'free') {
          try { const m = beamModel({ ...b, system: prev }); b.length = m.L; b.supports = m.supports.map((s) => ({ ...s })); } catch { b.length = Number(b.length) || 6; b.supports = []; }
        } else if (prev === 'free') {
          const L = Number(b.length) || 6;
          if (v === 'cont') b.spans = [L / 2, L / 2];
          else if (v === 'ss-cant') { const a = Number(b.overhang) > 0 && Number(b.overhang) < L ? Number(b.overhang) : +(0.25 * L).toFixed(2); b.overhang = a; b.spans = [+(L - a).toFixed(3)]; } else b.spans = [L];
        }
        if (v === 'cont' && b.spans.length < 2) b.spans = [b.spans[0] || 5, b.spans[0] || 5];
        if (cantileverDefaults(p, v === 'cant')) toast('Kragarm: Knicklängen β = 2, Einspannung k = k_w = 0.7 und Eigenwertanalyse eingestellt.', 'info', 5000);
        chI();
      },
    }),
  ];
  if (b.system === 'free') {
    kids.push(numField('Trägerlänge L', b, 'length', { unit: 'm', min: 0.01, onChange: ch, info: 'Gesamtlänge des Trägers. Die Lager liegen zwischen 0 und L; Überstände sind Kragarme.' }));
    const sup = normSupports(b.supports, Number(b.length) || 0);
    if (compact || !spansTable) kids.push(h('div', { class: 'muted small' }, sup.length ? `Lager bei x = ${sup.map((s) => `${fmt(s.x, 2)}${s.type === 'fix' ? ' (eingespannt)' : ''}`).join(', ')} m` : 'Noch keine Lager – Werkzeug «Lager» (Taste A) wählen und auf den Träger klicken.'));
    else kids.push(spansTable('free'));
  } else if (b.system === 'cont') {
    if (compact || !spansTable) kids.push(h('div', { class: 'muted small' }, `Felder: ${b.spans.map((x) => fmt(x, 2)).join(' + ')} m – Lager in der Grafik ziehen oder im Register «Lasten» bearbeiten.`));
    else kids.push(spansTable('cont'));
  } else {
    const proxy = { L: b.spans[0] };
    kids.push(numField(b.system === 'cant' ? 'Kraglänge L' : 'Spannweite L', proxy, 'L', { unit: 'm', min: 0.01, onChange: (v) => { b.spans = [v, ...b.spans.slice(1)]; ch(); } }));
    if (b.system === 'ss-cant') kids.push(numField('Kraglänge a', b, 'overhang', { unit: 'm', min: 0.01, onChange: ch, info: 'Kragarm rechts des zweiten Lagers.' }));
  }
  kids.push(checkField('Eigengewicht automatisch', b, 'selfWeight', { onChange: chI, info: INFO.selfWeight }));
  return kids;
}

/** Wichtigste Stabilitätsangaben (vollständig im Register «Stabilität»). */
export function stabilityFields(app, { ch, chI }) {
  const p = app.project, st = p.stab;
  let sec = null;
  try { sec = sectionProps(p.section); } catch { /* */ }
  const kids = [
    h('div', { class: 'grid2' },
      numField('β_y', st, 'betaY', { min: 0.1, max: 10, onChange: ch, info: INFO.beta }),
      numField('β_z', st, 'betaZ', { min: 0.1, max: 10, onChange: ch, info: `${INFO.beta}<br>${INFO.betaZ}` })),
  ];
  if (sec?.closed) kids.push(note('Hohlprofil – nicht kippgefährdet.', 'ok'));
  else {
    kids.push(checkField('Druckgurt gehalten', st, 'contRestraint', { onChange: chI, info: INFO.cont }));
    if (!st.contRestraint) kids.push(...ltbMainFields(app, { ch, chI }));
  }
  return kids;
}

/** Lastangriffspunkt und Ermittlung von M_cr. */
export function ltbMainFields(app, { ch, chI }) {
  const st = app.project.stab;
  return [
    selectField('Lastangriff', st, 'loadPos', [{ value: 'top', label: 'Obergurt' }, { value: 'centroid', label: 'Schwerpunkt' }, { value: 'bottom', label: 'Untergurt' }], { wide: true, onChange: ch, info: INFO.loadPos }),
    selectField('M_cr aus', st, 'mcr', [{ value: 'formula', label: '3-Faktoren-Formel' }, { value: 'fe', label: 'Eigenwertanalyse (FE)' }], { wide: true, onChange: chI, info: INFO.mcr }),
  ];
}

const SHAPE_SHORT = [{ value: 'lin', label: 'linear (ψ)' }, { value: 'q', label: 'Gleichlast' }, { value: 'P', label: 'Einzellast' }, { value: 'qe', label: 'eingespannt' }];

/** Verlauf eines Moments (Auswahl mit Bild) und ggf. ψ. */
function shapeFields(c, key, psiKey, axis, { ch, chI }) {
  const out = [withTrailer(selectField(`Verlauf M_${axis}`, c, key, SHAPE_SHORT, { onChange: chI, info: `Verlauf von M<sub>${axis}</sub> über die Stablänge; bestimmt C<sub>1</sub> (Kippen) und C<sub>m</sub> (Interaktion).` }), shapeIcon(c[key], c[psiKey]))];
  if (c[key] === 'lin') out.push(numField(`ψ_${axis}`, c, psiKey, { min: -1, max: 1, onChange: chI, info: INFO.psi }));
  return out;
}

/** Felder einer Bemessungssituation (direkte Schnittgrössen). */
export function caseFields(c, { ch, chI, name = true }) {
  return [
    name ? textField('Bezeichnung', c, 'name', { onChange: chI }) : null,
    numField('N_Ed (Druck +)', c, 'N', { unit: 'kN', onChange: ch, info: 'Normalkraft, Druck positiv, Zug negativ.' }),
    h('div', { class: 'grid2' },
      numField('M_y,Ed', c, 'My', { unit: 'kNm', onChange: ch, info: 'Grösstes Biegemoment um die starke Achse (bei linearem Verlauf am Stabanfang).' }),
      numField('M_z,Ed', c, 'Mz', { unit: 'kNm', onChange: ch, info: 'Grösstes Biegemoment um die schwache Achse.' }),
      numField('V_z,Ed', c, 'Vz', { unit: 'kN', onChange: ch, info: 'Querkraft in z (wird über die ganze Länge angesetzt).' }),
      numField('V_y,Ed', c, 'Vy', { unit: 'kN', onChange: ch })),
    ...shapeFields(c, 'shapeY', 'psiY', 'y', { ch, chI }),
    ...shapeFields(c, 'shapeZ', 'psiZ', 'z', { ch, chI }),
  ].filter(Boolean);
}

/** Neue Bemessungssituation. */
export const newCase = (n) => ({ name: `Situation ${n}`, N: 0, My: 0, Mz: 0, Vz: 0, Vy: 0, shapeY: 'lin', psiY: 1, shapeZ: 'lin', psiZ: 1 });

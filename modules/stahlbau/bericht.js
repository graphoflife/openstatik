// Statischer Bericht Stahlbau: Eingaben, Querschnitt, Schnittgrössen, Nachweisübersicht.
// Den vollständigen Rechenweg (Formeln, eingesetzte Werte, Normbezüge) hängt der Rahmen als
// «Herleitung der Berechnung» aus derivation.js an.
import { h } from '../../js/core/ui.js';
import { fmt } from '../../js/core/format.js';
import { repTable, repKV, repFigure, repP } from '../../js/core/report.js';
import { SYSTEMS, CATEGORIES, normLoad } from './beam.js';
import { SHAPE_OPTIONS, ref, E_STEEL, G_STEEL } from './calc.js';

const f0 = (x) => fmt(x, 0), f1 = (x) => fmt(x, 1), f2 = (x) => fmt(x, 2), f3 = (x) => fmt(x, 3);
const kNm = (m) => m / 1e6;
const status = (eta) => (Number.isFinite(eta) && eta <= 1.0001 ? 'erfüllt' : 'nicht erfüllt');

/** Momentaufnahme einer Ansicht mit fester Kombinationswahl, ohne Raster und Auswahl des Editors. */
function snap(app, mode, combo = 'gov') {
  const svg = app.snapshot(mode, { viewOpts: { combo } });
  for (const g of svg.querySelectorAll('.gridlayer, .interact')) g.remove();
  return svg;
}

export function buildReport(app) {
  const p = app.project, r = app.results;
  const s = r.sec, mat = r.mat, norm = r.norm;
  const out = [];
  const g0 = mat.gammaM0, g1 = mat.gammaM1;

  // ---------------------------------------------------------------- Grundlagen
  out.push({
    title: '1 Grundlagen',
    content: [
      repKV([
        ['Norm', norm === 'SIA' ? 'SIA 263:2013 (Rechenformeln nach EN 1993-1-1)' : 'EN 1993-1-1 (empfohlene Werte)'],
        ['Stahlsorte', mat.name],
        ['Streckgrenze fy', mat.fy, 'N/mm²', 0],
        ['Zugfestigkeit fu', mat.fu, 'N/mm²', 0],
        ['Elastizitätsmodul E / Schubmodul G', `${E_STEEL} / ${G_STEEL}`, 'N/mm²'],
        ['Widerstandsbeiwerte γM0 / γM1', `${f2(g0)} / ${f2(g1)}`, ''],
        ['ε = √(235/fy)', Math.sqrt(235 / mat.fy), '', 3],
        ['Eingabeart', p.mode === 'forces' ? 'Bemessungsschnittgrössen direkt' : 'Träger mit Lasten (Stabstatik 1. Ordnung)'],
      ]),
      h('ul', {},
        h('li', {}, 'Schnittgrössen nach Theorie 1. Ordnung; Stabilität mit dem Ersatzstabverfahren (EN 1993-1-1 6.3).'),
        h('li', {}, 'Auflager und seitliche Halterungen wirken als Gabellager (seitliche Verschiebung und Verdrehung verhindert).'),
        h('li', {}, 'Querschnittswerte aus den Nennmassen inkl. Ausrundungen berechnet; keine Lochschwächungen.'),
        p.mode === 'forces' ? h('li', {}, 'Die Querkraft wird über die ganze Stablänge angesetzt (Interaktion M–V auf der sicheren Seite).') : null,
        norm === 'SIA' ? h('li', {}, 'SIA-263-Ziffern sind den Nachweisen sinngemäss zugeordnet; die Nummerierung der Formeln folgt EN 1993-1-1.') : null),
      ...r.warnings.map((w) => repP(`Hinweis: ${w}`)),
    ],
  });

  // ---------------------------------------------------------------- Querschnitt
  out.push({
    title: `2 Querschnitt ${s.name}`,
    content: [
      repFigure(snap(app, 'section'), `Querschnitt ${s.name} (massstäblich) mit Spannungsverteilung der massgebenden Kombination`),
      repKV([
        ['Höhe h / Breite b', `${f1(s.h)} / ${f1(s.b)}`, 'mm'],
        s.type === 'RHS' || s.type === 'CHS' ? ['Wanddicke t', s.t, 'mm', 1] : (s.tw ? ['Stegdicke tw / Flanschdicke tf', `${f1(s.tw)} / ${f1(s.tf)}`, 'mm'] : null),
        s.r ? ['Ausrundungsradius r', s.r, 'mm', 1] : null,
        s.type === 'WI' ? ['Halsnaht a', s.a, 'mm', 1] : null,
        ['Fläche A', s.A / 100, 'cm²', 2],
        ['Trägheitsmomente Iy / Iz', `${f1(s.Iy / 1e4)} / ${f1(s.Iz / 1e4)}`, 'cm⁴'],
        ['Widerstandsmomente Wel,y / Wel,z', `${f1(s.Wely / 1e3)} / ${f1(s.Welz / 1e3)}`, 'cm³'],
        ['plastische Widerstandsmomente Wpl,y / Wpl,z', `${f1(s.Wply / 1e3)} / ${f1(s.Wplz / 1e3)}`, 'cm³'],
        ['Trägheitsradien iy / iz', `${f2(s.iy / 10)} / ${f2(s.iz / 10)}`, 'cm'],
        ['Torsionsträgheitsmoment It', s.It / 1e4, 'cm⁴', 2],
        ['Wölbwiderstand Iw', s.Iw / 1e6, 'cm⁶', 0],
        ['Schubflächen Av,z / Av,y', `${f2(s.Avz / 100)} / ${f2(s.Avy / 100)}`, 'cm²'],
        s.type === 'U' ? ['Schwerpunkt ys / Schubmittelpunkt yM (ab S)', `${f2(s.ys / 10)} / ${f2(s.y0 / 10)}`, 'cm'] : null,
        ['Masse', s.mass, 'kg/m', 1],
      ]),
    ],
  });

  // ---------------------------------------------------------------- System und Einwirkungen
  const sysContent = [repFigure(snap(app, 'system'), 'Statisches System, Belastung und seitliche Halterungen (⊗)')];
  if (p.mode === 'forces') {
    sysContent.push(repKV([['Stablänge L', p.forces.L, 'm', 2]]));
    const shape = (v) => SHAPE_OPTIONS.find((o) => o.value === v)?.label || v;
    sysContent.push(repTable(['Situation', { label: 'N [kN]', num: true }, { label: 'My [kNm]', num: true }, 'Verlauf My', { label: 'Mz [kNm]', num: true }, 'Verlauf Mz', { label: 'Vz [kN]', num: true }, { label: 'Vy [kN]', num: true }],
      p.forces.cases.map((c) => [c.name, f1(c.N || 0), f1(c.My || 0), `${shape(c.shapeY)}${c.shapeY === 'lin' ? `, ψ = ${f2(c.psiY ?? 1)}` : ''}`, f1(c.Mz || 0), `${shape(c.shapeZ)}${c.shapeZ === 'lin' ? `, ψ = ${f2(c.psiZ ?? 1)}` : ''}`, f1(c.Vz || 0), f1(c.Vy || 0)])));
    sysContent.push(repP('Bemessungswerte der Schnittgrössen (Druck positiv); My und Mz sind die betragsgrössten Werte des angegebenen Verlaufs.'));
  } else {
    const b = p.beam, m = r.member;
    sysContent.push(repKV([
      ['System', SYSTEMS.find((x) => x.value === b.system)?.label || b.system],
      ['Felder', m.fields.map((f) => `${f2(f.L)} m${f.cant ? ' (Kragarm)' : ''}`).join(' + ')],
      ['Gesamtlänge', m.L, 'm', 2],
      ['Eigengewicht Profil', b.selfWeight ? `${f3(s.A * 1e-6 * 78.5)} kN/m (automatisch)` : 'nicht berücksichtigt'],
    ]));
    const cat = (c) => CATEGORIES.find((x) => x.value === c)?.label || c;
    sysContent.push(repTable(['Lastfall', 'Kategorie'], m.lcs.map((l) => [l.name, cat(l.cat)])));
    const kind = (l) => (l.type === 'N' ? 'Normalkraft (Druck +)' : `${l.type === 'q' ? 'Linienlast' : 'Einzellast'} ${l.dir === 'y' ? 'horizontal (y)' : 'vertikal (z)'}`);
    const lcName = (id) => m.lcs.find((l) => l.id === id)?.name || id;
    sysContent.push(repTable(['Lastfall', 'Art', { label: 'Wert', num: true }, { label: 'x₁ [m]', num: true }, { label: 'x₂ [m]', num: true }],
      m.loads.map((l0) => { const l = normLoad(l0, m.L); return [lcName(l.lc), kind(l), l.type === 'q' ? (Math.abs(l.v1 - l.v2) < 1e-9 ? `${f2(l.v1)} kN/m` : `${f2(l.v1)} … ${f2(l.v2)} kN/m`) : `${f2(l.v1)} kN`, l.type === 'N' ? '–' : f2(l.x1), l.type === 'q' ? f2(l.x2) : '–']; })));
  }
  out.push({ title: '3 System und Einwirkungen', content: sysContent });

  // ---------------------------------------------------------------- Kombinationen
  if (p.mode !== 'forces') {
    const m = r.member, F = m.factors;
    out.push({
      title: '4 Lastkombinationen',
      content: [
        repP(norm === 'SIA' ? 'Grundkombination und Gebrauchstauglichkeit nach SIA 260 (Ziff. 4.4.3, 4.4.4).' : 'Kombinationen nach EN 1990 (6.10, 6.14b, 6.16b).'),
        repKV([['γG / γG,inf / γQ', `${f2(F.gG)} / ${f2(F.gGinf)} / ${f2(F.gQ)}`, ''], ...Object.entries(F.psi).map(([k, v]) => [`ψ0 / ψ1 / ψ2 ${k}`, v.map(f2).join(' / '), ''])]),
        repTable(['Nr.', 'Typ', 'Kombination'], m.combos.map((c) => [c.id, c.type === 'ULS' ? 'Tragsicherheit' : c.type === 'SLS-char' ? 'Gebrauch, charakteristisch' : 'Gebrauch, quasi-ständig', c.name.replace(/^[^:]+: /, '')])),
      ],
    });
  }

  // ---------------------------------------------------------------- Schnittgrössen
  const ext = (arr) => [Math.max(...arr), Math.min(...arr)];
  out.push({
    title: `${p.mode === 'forces' ? 4 : 5} Schnittgrössen (Bemessungswerte)`,
    content: [
      repFigure(snap(app, 'forces', r.uls.length > 1 ? 'env' : 'gov'), r.uls.length > 1 ? 'Umhüllende der Schnittgrössen aller Kombinationen der Tragsicherheit' : 'Schnittgrössen der Tragsicherheit'),
      repTable(['Kombination', { label: 'N max [kN]', num: true }, { label: 'My max/min [kNm]', num: true }, { label: '|Vz| max [kN]', num: true }, { label: '|Mz| max [kNm]', num: true }, { label: 'η', num: true }],
        r.uls.map((u) => { const [mx, mn] = ext(u.smp.My); return [u.combo.name, f1(u.Nc), `${f1(mx)} / ${f1(mn)}`, f1(Math.max(...u.smp.Vz.map(Math.abs))), f1(u.MzMax), f2(u.eta)]; })),
    ],
  });
  let sec = p.mode === 'forces' ? 5 : 6;

  // ---------------------------------------------------------------- Nachweise (Übersicht)
  const u = r.govUls, kl = u.klass;
  const clsRows = kl.parts.filter((pp, i, a) => a.findIndex((q) => q.label === pp.label && q.cls === pp.cls && Math.abs(q.ct - pp.ct) < 1e-9) === i).map((pp) => [
    pp.label, pp.kind === 'internal' ? 'beidseitig gestützt' : pp.kind === 'tube' ? 'Rohr (d/t)' : 'einseitig gestützt', f2(pp.ct),
    Number.isFinite(pp.lim[0]) ? f1(pp.lim[0]) : '–', Number.isFinite(pp.lim[1]) ? f1(pp.lim[1]) : '–', Number.isFinite(pp.lim[2]) ? f1(pp.lim[2]) : '–', pp.tension ? '1 (Zug)' : String(pp.cls)]);
  const st = u.st;
  const segs = st.segments.filter((x) => x.Mcr);
  const nachw = [
    h('h3', {}, `Querschnittsklassifizierung (${ref('class', norm)})`),
    repP(`Massgebende Kombination ${u.combo.name}: N = ${f1(Math.max(0, u.Nc))} kN (Druck), My = ${f1(u.MyMax)} kNm, Mz = ${f1(u.MzMax)} kNm; ε = ${f3(kl.eps)} → Querschnittsklasse ${u.cls}.`),
    clsRows.length ? repTable(['Teil', 'Art', { label: 'c/t', num: true }, { label: 'Kl. 1', num: true }, { label: 'Kl. 2', num: true }, { label: 'Kl. 3', num: true }, 'Klasse'], clsRows) : null,
  ];
  for (const grp of ['Querschnitt', 'Stabilität']) {
    const list = r.checks.filter((c) => c.group === grp);
    if (!list.length) continue;
    nachw.push(h('h3', {}, grp === 'Querschnitt' ? 'Querschnittsnachweise' : 'Stabilitätsnachweise'));
    nachw.push(repTable(['Nachweis', 'Norm', 'Kombination / Stelle', { label: 'Ed', num: true }, { label: 'Rd', num: true }, { label: 'η', num: true }],
      list.map((c) => [c.label, c.ref, [c.comboName, Number.isFinite(c.x) && grp === 'Querschnitt' ? `x = ${f2(c.x)} m` : null, c.seg ? `Segment ${f2(c.seg.x0)} … ${f2(c.seg.x1)} m` : null].filter(Boolean).join(', '), c.Ed !== undefined ? `${f1(c.Ed)} ${c.unit || ''}` : '–', c.Rd !== undefined ? `${f1(c.Rd)} ${c.unit || ''}` : '–', f2(c.eta)])));
  }
  if (r.uls.some((x) => x.Nc > 1e-9) || segs.length) {
    nachw.push(h('h3', {}, 'Kennwerte der Stabilität'));
    nachw.push(repKV([
      ['Knicklängen Lcr,y / Lcr,z', `${f2(st.LcrY / 1000)} / ${f2(st.LcrZ / 1000)}`, 'm'],
      ['Knicklinien y / z', `${st.curveY} / ${st.curveZ}`, ''],
      ['λ̄y / χy', `${f3(st.lamY)} / ${f3(st.chiY)}`, ''],
      ['λ̄z / χz', `${f3(st.lamZ)} / ${f3(st.chiZ)}`, ''],
      st.torsional ? ['λ̄T / χT', `${f3(st.lamT)} / ${f3(st.chiT)}`, ''] : null,
    ]));
    if (segs.length) {
      nachw.push(repTable(['Kippsegment [m]', { label: 'My,Ed [kNm]', num: true }, { label: 'Mcr [kNm]', num: true }, 'Ermittlung', { label: 'λ̄LT', num: true }, { label: 'χLT', num: true }, { label: 'Mb,Rd [kNm]', num: true }],
        segs.map((x) => [`${f2(x.x0)} … ${f2(x.x1)}`, f1(x.MyEd), f1(kNm(x.Mcr)), x.mcrBy === 'formula' ? `C1 = ${f3(x.C1)}, C2 = ${f3(x.C2)}` : 'Eigenwertanalyse', f3(x.lamLT), f3(x.chiLT), f1(kNm(x.MbRd))])));
    }
  } else if (!st.ltbActive) nachw.push(repP(`Kippen: kein Nachweis erforderlich (${st.ltbReason || 'nicht massgebend'}).`));
  nachw.push(repP('Der vollständige Rechenweg aller Nachweise steht im Abschnitt «Herleitung der Berechnung» am Ende des Berichts.'));
  out.push({ title: `${sec++} Nachweise der Tragsicherheit`, content: nachw.filter(Boolean) });

  // ---------------------------------------------------------------- Gebrauchstauglichkeit
  if (p.mode !== 'forces' && r.sls.length) {
    out.push({
      title: `${sec++} Gebrauchstauglichkeit (${ref('w', norm)})`,
      content: [
        repFigure(snap(app, 'deflection'), 'Biegelinie der massgebenden Kombination der Gebrauchstauglichkeit (überhöht)'),
        repTable(['Kombination', 'Feld', 'Richtung', { label: 'w [mm]', num: true }, { label: 'L/w', num: true }, { label: 'Grenze [mm]', num: true }, { label: 'η', num: true }],
          r.sls.map((x) => [x.combo.name, `${f2(x.field.x0)} … ${f2(x.field.x1)} m${x.cant ? ' (Kragarm, 2·L)' : ''}`, x.dir === 'z' ? 'vertikal' : 'horizontal', f1(Math.abs(x.w)), Number.isFinite(x.ratio) ? f0(x.ratio) : '–', `${f1(x.wLim)} (${x.cant ? '2·L' : 'L'}/${x.limit})`, f2(x.eta)])),
      ],
    });
  }

  // ---------------------------------------------------------------- Zusammenfassung
  const ok = r.etaMax <= 1.0001;
  out.push({
    title: `${sec++} Zusammenfassung`,
    content: [
      repTable(['Nachweis', 'Norm', { label: 'Ed', num: true }, { label: 'Rd', num: true }, { label: 'η', num: true }, 'Ergebnis'],
        r.checks.map((c) => [c.label, c.ref, c.Ed !== undefined ? `${f1(c.Ed)} ${c.unit || ''}` : '–', c.Rd !== undefined ? `${f1(c.Rd)} ${c.unit || ''}` : '–', f2(c.eta), status(c.eta)])),
      h('p', { style: { fontWeight: 700 } }, ok
        ? `Alle Nachweise sind erfüllt. Maximale Ausnutzung η = ${f2(r.etaMax)} (${r.gov.label}). Profil ${s.name}, ${mat.name}.`
        : `Nicht alle Nachweise sind erfüllt: maximale Ausnutzung η = ${f2(r.etaMax)} (${r.gov.label}). Das Profil ${s.name} ist ungenügend.`),
    ],
  });
  return out;
}

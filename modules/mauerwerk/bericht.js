// Bericht und Hilfe Mauerwerk
import { h, fmt, checksTable } from '../../js/core/ui.js';
import { xyChart } from '../../js/core/chart.js';
import { repTable, repKV, repFigure, repFormula, repP } from '../../js/core/report.js';
import { typeById, changedFromDefaults } from './materials.js';
import { pickCombo } from './view.js';

const yes = (b) => (b ? 'ja' : 'nein');
const etaS = (x) => (Number.isFinite(x) ? fmt(x, 2) : '∞');
const okS = (x) => (Number.isFinite(x) && x <= 1.0001 ? 'erfüllt' : 'nicht erfüllt');

const SUPPORT = { slab: 'Stahlbetondecken (ρ2 = 0.75)', hinged: 'gelenkig (ρ2 = 1.0)', manual: 'ρ manuell' };
const SIDES = ['keine (zweiseitig gehalten)', 'einseitig (dreiseitig gehalten)', 'beidseitig (vierseitig gehalten)'];
const EMODE = { centric: 'zentrisch', slab: 'Deckenverdrehung e = t/2 − a/3', manual: 'manuell' };

function eccSvg(c, R, profile = c.profile, title = 'Exzentrizität über die Höhe') {
  const t = R.t * 1000;
  const series = [{ points: profile.pts.map((q) => [(q.e1 + q.eq) * 1000, q.z]), label: 'Th. 1. O.', color: 'var(--c-dim)', dash: '5 4' }];
  if (profile.ok) series.push({ points: profile.pts.map((q) => [q.e * 1000, q.z]), label: 'Stützlinie Th. 2. O.', color: 'var(--c-pos)', width: 2.2 });
  const svg = xyChart({
    title, series, xLabel: 'Exzentrizität e [mm]', yLabel: 'Höhe z [m]', width: 520, height: 300, crosshair: false,
    xRange: [-t * 0.55, t * 0.55], yRange: [0, R.h],
    vLines: [{ v: -t / 2, color: 'var(--fail)', dash: '0' }, { v: t / 2, color: 'var(--fail)', dash: '0', label: 'Rand' }, { v: -t / 6 }, { v: t / 6, label: 'Kern' }],
  });
  return h('div', { style: { maxWidth: '520px' } }, svg);
}

export function buildReport(app) {
  const p = app.project, R = app.results, W = p.wall, L = p.loads, M = p.material, S = p.settings || {};
  const md = R.md, t = R.t;
  const sec = [];
  const uls = R.combos.filter((c) => c.type === 'ULS');
  const E = L.earth || {}, C = L.conc || {};

  // ---------------------------------------------------------------- Grundlagen
  sec.push({
    title: 'Grundlagen',
    content: [
      repP('Nachweis einer Wand aus unbewehrtem Mauerwerk nach SIA 266 (2015) «Mauerwerk» mit Einwirkungen und Lastbeiwerten nach SIA 260/261. Wo SIA 266 keine geschlossene Formel vorgibt oder die Tabellenwerte nicht hinterlegt sind, werden mechanisch gleichwertige Verfahren bzw. EN 1996-1-1/-3 verwendet (bei jedem Nachweis angegeben).'),
      repKV([
        ['Normalkraft / Knicken', R.method === 'SIA' ? 'Th. 2. Ordnung numerisch, Spannungsblock (SIA 266, 4.3)' : 'EN 1996-1-1, 6.1.2 und Anhang G'],
        ['Querkraft in Wandebene', R.shearMethod === 'SIA' ? 'Spannungsfeld, Fliessbedingungen Ganz/Thürlimann (SIA 266, 4.4)' : 'EN 1996-1-1, 6.2'],
        ['Teilflächenbelastung', 'EN 1996-1-1, 6.1.3'],
        ['Querbelastung', `Stützlinie Th. 2. O.${S.arching !== false ? ' mit Bogenwirkung' : ''}${S.basementEN !== false && E.on ? '; EN 1996-3, 4.5' : ''}`],
        ['Vorzeichen', 'e und Querlast positiv zur Raumseite (+x)'],
        ['Einheiten', 'Linienlasten und Widerstände je m Wandlänge'],
      ]),
      repP('Hinweis: Die Mauerwerkskennwerte sind Standardwerte (Richtwerte) und müssen mit den Produktangaben bzw. den Tabellenwerten von SIA 266 überprüft werden.'),
    ],
  });

  // ---------------------------------------------------------------- Zusammenfassung
  sec.push({
    title: 'Ergebnisübersicht',
    content: [
      repP(`Maximale Ausnutzung η = ${etaS(R.etaMax)} – ${R.checks.every((c) => Number.isFinite(c.eta) && c.eta <= 1.0001) ? 'alle Nachweise sind erfüllt.' : 'mindestens ein Nachweis ist nicht erfüllt.'}`),
      checksTable(R.checks.map((c) => ({ label: c.label, ref: `${c.ref}${c.lc && c.lc !== 'alle' ? ` · ${c.lc}` : ''}`, Ed: c.Ed, Rd: c.Rd, unit: c.unit, digits: c.digits ?? (c.unit === 'kN/m²' ? 2 : 1), eta: c.eta }))),
      ...R.notes.map((n) => repP(`Hinweis: ${n}`)),
    ],
  });

  // ---------------------------------------------------------------- System
  const openRows = (W.openings || []).map((o, i) => [i + 1, o.x, o.b, o.y, o.hgt]);
  sec.push({
    title: 'Wand und Halterung',
    content: [
      repKV([
        ['Wandhöhe h', W.h, 'm', 2], ['Wanddicke t', W.t, 'mm', 0], ['Wandlänge l', W.l, 'm', 2],
        ['Halterung oben/unten', SUPPORT[W.support] || W.support], ['Seitliche Halterung', SIDES[+W.sides || 0]],
        (+W.sides || 0) > 0 ? ['Abstand Querwände', W.ls, 'm', 2] : null,
        ['Knicklänge', R.eff.formula], ['Schlankheit hef/t', R.slender, '', 1],
      ]),
      openRows.length ? repTable(['Öffnung', { label: 'x [m]', num: true }, { label: 'Breite [m]', num: true }, { label: 'Brüstung [m]', num: true }, { label: 'Höhe [m]', num: true }], openRows) : null,
      openRows.length ? repP(`Lastkonzentration auf die Pfeiler: Faktor l/(l − Σb) = ${fmt(R.kOpen, 3)}${S.openingConc === false ? ' (nicht angesetzt)' : ''}.`) : null,
      repFigure(app.snapshot('ansicht'), 'Ansicht der Wand mit Lasten'),
    ],
  });

  // ---------------------------------------------------------------- Baustoff
  const ch = changedFromDefaults(M);
  sec.push({
    title: 'Baustoff',
    content: [
      repKV([
        ['Mauerwerksart', typeById(M.type).label],
        ['fxk (senkrecht zu Lagerfugen)', md.fxk, 'MPa', 2], ['fyk (parallel zu Lagerfugen)', md.fyk, 'MPa', 2],
        ['Exk', md.Exk, 'MPa', 0], ['γM (SIA 266)', md.gammaM, '', 2], ['γE (E-Modul Th. 2. O.)', md.gammaE, '', 2],
        ['fxd = fxk/γM', md.fxd, 'MPa', 3], ['fyd = fyk/γM', md.fyd, 'MPa', 3], ['Exd = Exk/γE', md.Exd, 'MPa', 0],
        ['Raumlast γ', md.gamma, 'kN/m³', 1], ['Reibungsbeiwert μ', md.mu, '', 2], ['Endkriechzahl φ∞', md.phi, '', 2],
        ['fvk0 (EN 1996)', md.fvk0, 'MPa', 2], ['fvlt = 0.065·fb', md.fvlt, 'MPa', 2], ['Vollsteine (Gruppe 1)', yes(md.solid)],
      ]),
      ch.length ? repP(`Gegenüber den Standardwerten geändert: ${ch.join(', ')}.`) : repP('Es werden die Standardwerte der Mauerwerksart verwendet (vom Anwender zu prüfen).'),
    ],
  });

  // ---------------------------------------------------------------- Einwirkungen
  sec.push({
    title: 'Einwirkungen und Kombinationen',
    content: [
      repKV([
        ['Auflast Wand darüber gk / qk (zentrisch)', `${fmt(L.gW, 1)} / ${fmt(L.qW, 1)}`, 'kN/m'],
        ['Deckenauflager gk / qk', `${fmt(L.gD, 1)} / ${fmt(L.qD, 1)}`, 'kN/m'],
        ['Lastangriff Decke', `${EMODE[L.eMode] || L.eMode}: eD = ${fmt(R.eD * 1000, 1)} mm`],
        ['Exzentrizität Wandfuss eu', L.eU || 0, 'mm', 1],
        ['Eigengewicht Wand γ·t', md.gamma * t, 'kN/m²', 2],
        ['Wind quer wk', L.wind || 0, 'kN/m²', 2],
        E.on ? ['Erddruck: he / γBoden / K / Auflast', `${fmt(E.he, 2)} m / ${fmt(E.gs, 1)} kN/m³ / ${fmt(E.K, 2)} / ${fmt(E.qs, 1)} kN/m²`] : null,
        (L.Vw || L.Ve) ? ['Horizontalkraft in Wandebene Vw,k / VE,d', `${fmt(L.Vw || 0, 1)} / ${fmt(L.Ve || 0, 1)} kN auf hV = ${fmt(L.hV || W.h, 2)} m`] : null,
        C.on ? ['Einzellast Gk / Qk, Lastfläche a × b', `${fmt(C.G, 1)} / ${fmt(C.Q, 1)} kN, ${fmt(C.a, 0)} × ${fmt(C.b, 0)} mm bei x = ${fmt(C.x, 2)} m`] : null,
      ]),
      repTable(['Kombination', 'Art', { label: 'γG', num: true }, { label: 'γQ', num: true }, { label: 'γW', num: true }, { label: 'γErd', num: true }, { label: 'γEb', num: true }],
        (p.combos || []).filter((c) => c.on !== false).map((c) => [c.name, c.type === 'SLS' ? 'GZG' : 'GZT', c.g, c.q, c.w, c.e, c.ae])),
      repTable(['Kombination', { label: 'nd,o [kN/m]', num: true, digits: 1 }, { label: 'eo [mm]', num: true, digits: 1 }, { label: 'nd,m [kN/m]', num: true, digits: 1 }, { label: 'nd,u [kN/m]', num: true, digits: 1 }, { label: 'pd,max [kN/m²]', num: true, digits: 2 }],
        R.combos.map((c) => [c.name, c.nTop, c.eTop * 1000, c.nMid, c.nBot, c.pMax])),
    ],
  });

  // ---------------------------------------------------------------- Normalkraft
  const gc = pickCombo(app, 'schnitt');
  const nk = [];
  nk.push(repFormula([
    `fxd = fxk/γM = ${fmt(md.fxk, 2)}/${fmt(md.gammaM, 2)} = ${fmt(md.fxd, 3)} MPa`,
    R.eff.formula,
    `Vorverformung e0 = hef/${fmt(R.nImp, 0)} = ${fmt(R.eImp * 1000, 2)} mm (Richtung ungünstig)`,
    `Querschnittswiderstand (Spannungsblock): nRd = fxd·(t − 2e)`,
    `Wandkopf: eo = nD·eD/(nW + nD); Wandfuss: eu (Eingabe)`,
  ].join('\n')));
  if (R.method === 'SIA') {
    nk.push(repP('Theorie 2. Ordnung: Wandstreifen b = 1 m, gelenkig gelagert, Knicklänge hef. Werkstoff ohne Zugfestigkeit, linear-elastisch (Exd, mit Kriechen Eeff = Exd/(1 + φ∞·nG/nd)) und ideal-plastisch (fxd). Die Krümmung folgt geschlossen aus dem gerissenen bzw. teilplastifizierten Rechteckquerschnitt; die Biegelinie wird iterativ bestimmt. Die Vertikallasten (inkl. Eigengewicht, bei festen Exzentrizitäten) werden bis zum Verlust des Gleichgewichts gesteigert: nRd = λu·nEd, η = 1/λu.'));
    nk.push(repTable(['Kombination', { label: 'nd,o', num: true, digits: 1 }, { label: 'nRd,o', num: true, digits: 1 }, { label: 'nd,u', num: true, digits: 1 }, { label: 'nRd,u', num: true, digits: 1 }, { label: 'λu', num: true, digits: 3 }, { label: 'z [m]', num: true, digits: 2 }, 'Versagen', 'η'],
      uls.map((c) => [c.name, c.nTop, c.top.nRd, c.nBot, c.bot.nRd, Number.isFinite(c.buck.xMax) ? c.buck.xMax : '>1000', c.buck.z, c.buck.mode, etaS(Math.max(c.checks.top.eta, c.checks.bot.eta, c.buck.eta))])));
    if (gc?.buck) {
      const b = gc.buck;
      nk.push(h('h3', {}, `Massgebende Kombination: ${gc.name}`));
      nk.push(repFormula([
        `Eeff = ${fmt(gc.Eeff / 1000, 0)} MPa (φeff = ${fmt(gc.phiEff, 3)})`,
        `λu = ${Number.isFinite(b.xMax) ? fmt(b.xMax, 3) : '> 1000'} → massgebender Schnitt z = ${fmt(b.z, 2)} m (${b.mode})`,
        `nRd = λu·nEd(z) = ${fmt(b.xMax, 3)}·${fmt(b.nEd, 1)} = ${fmt(b.nRd, 1)} kN/m;  Φ = nRd/(t·fxd) = ${fmt(b.phi, 3)}`,
        `η = 1/λu = ${etaS(b.eta)} → ${okS(b.eta)}`,
      ].join('\n')));
    }
  } else {
    nk.push(repP('EN 1996-1-1, 6.1.2.2: Φi = 1 − 2·ei/t mit ei = Mid/Nid + ehe ± einit ≥ 0.05·t; Wandmitte nach Anhang G: Φm = A1·exp(−u²/2), A1 = 1 − 2·emk/t, u = (λ − 0.063)/(0.73 − 1.17·emk/t), λ = hef/t·√(fk/E), emk = em + ek ≥ 0.05·t, ek = 0.002·φ∞·hef/t·√(t·em) (für hef/t > 15).'));
    nk.push(repTable(['Kombination', { label: 'Φo', num: true, digits: 3 }, { label: 'Φu', num: true, digits: 3 }, { label: 'emk [mm]', num: true, digits: 1 }, { label: 'Φm', num: true, digits: 3 }, { label: 'nd,m', num: true, digits: 1 }, { label: 'nRd,m', num: true, digits: 1 }, 'η'],
      uls.map((c) => [c.name, c.en.top.phi, c.en.bot.phi, c.en.mid.emk * 1000, c.en.mid.phi, c.nMid, c.en.mid.nRd, etaS(Math.max(c.checks.top.eta, c.checks.bot.eta, c.checks.buckEN.eta))])));
  }
  nk.push(repFigure(app.snapshot('schnitt'), `Schnitt mit Stützlinie${gc ? ` (${gc.name})` : ''}, quer überhöht`));
  if (gc) nk.push(eccSvg(gc, R));
  sec.push({ title: 'Nachweis Normalkraft mit Knicken', content: nk });

  // ---------------------------------------------------------------- Schub
  const shearLC = R.combos.filter((c) => c.shear);
  if (shearLC.length) {
    const cont = [];
    if (R.shearMethod === 'SIA') {
      cont.push(repP('Spannungsfeld nach SIA 266: N und V werden über ein geneigtes, einachsiges Druckfeld in die Druckzone lc am Wandfuss geleitet (Spannungsblock). Fliessbedingungen nach Ganz/Thürlimann ohne Kohäsion: Druckfeld σx/fxd + σy/fyd ≤ 1 mit σy = τ²/σx; Gleiten in der Lagerfuge τ ≤ μ·σx. Daraus folgt geschlossen:'));
      cont.push(repFormula('lc = l − 2·V·h0/N\nVRd,c = −t·h0·fyd + √((t·h0·fyd)² + fyd·N·(t·l − N/fxd))\nVRd,f = μ·N\nVRd = min(VRd,c; VRd,f)'));
      cont.push(repTable(['Kombination', { label: 'Nd [kN]', num: true, digits: 1 }, { label: 'Vd [kN]', num: true, digits: 1 }, { label: 'h0 [m]', num: true, digits: 2 }, { label: 'VRd,c', num: true, digits: 1 }, { label: 'VRd,f', num: true, digits: 1 }, { label: 'lc [m]', num: true, digits: 2 }, 'η'],
        shearLC.map((c) => [c.name, c.shear.N, c.shear.V, c.shear.h0, c.shear.Vstrut, c.shear.Vfric, c.shear.lc, etaS(c.checks.shear.eta)])));
    } else {
      cont.push(repP('EN 1996-1-1, 6.2: VRd = fvd·t·lc, fvd = fvk/γM, fvk = fvk0 + 0.4·σd ≤ fvlt, σd = Nd/(t·lc); lc überdrückte Länge bei linearer Spannungsverteilung (gerissen lc = 3·(l/2 − e), e = Vd·h0/Nd). Zusätzlich NRd = fxd·t·(l − 2e).'));
      cont.push(repTable(['Kombination', { label: 'Nd [kN]', num: true, digits: 1 }, { label: 'Vd [kN]', num: true, digits: 1 }, { label: 'lc [m]', num: true, digits: 2 }, { label: 'fvd [MPa]', num: true, digits: 3 }, { label: 'VRd [kN]', num: true, digits: 1 }, { label: 'NRd [kN]', num: true, digits: 1 }, 'η'],
        shearLC.map((c) => [c.name, c.shear.N, c.shear.V, c.shear.lc, c.shear.fvd / 1000, c.shear.VRd, c.shear.NRd, etaS(Math.max(c.checks.shearEN.eta, c.checks.shearN.eta))])));
    }
    cont.push(repFigure(app.snapshot('schub'), 'Wandscheibe mit Druckfeld und Spannungen am Wandfuss'));
    if (W.openings?.length) cont.push(repP('Öffnungen sind im Scheibennachweis nicht berücksichtigt; die Pfeiler sind bei Bedarf separat nachzuweisen.'));
    sec.push({ title: 'Querkraft in Wandebene', content: cont });
  }

  // ---------------------------------------------------------------- Teilfläche
  const concLC = R.combos.filter((c) => c.conc);
  if (concLC.length) {
    const q0 = concLC[0].conc;
    sec.push({
      title: 'Teilflächenbelastung',
      content: [
        repP('EN 1996-1-1, 6.1.3: NRdc = β·Ab·fxd mit β = (1 + 0.3·a1/hc)·(1.5 − 1.1·Ab/Aef), 1.0 ≤ β ≤ min(1.25 + a1/(2hc); 1.5), Ab/Aef ≤ 0.45; Aef = lefm·t, lefm wirksame Länge in Wandmitte bei Lastausbreitung unter 60°. Für Steine der Gruppen 2–4 gilt β = 1.0. Zusätzlich Nachweis der Normalkraft in Wandmitte mit Φm.'),
        repFormula(`Ab = ${fmt(q0.Ab * 1e4, 0)} cm², a1 = ${fmt(q0.a1, 2)} m, hc = ${fmt(W.h, 2)} m, lefm = ${fmt(q0.lefm, 3)} m, Ab/Aef = ${fmt(q0.ratio, 3)}, β = ${fmt(q0.beta, 3)}${md.solid ? '' : ' (Lochsteine: β = 1.0)'}`),
        repTable(['Kombination', { label: 'Nc,d [kN]', num: true, digits: 1 }, { label: 'NRdc [kN]', num: true, digits: 1 }, { label: 'nEd,m [kN/m]', num: true, digits: 1 }, { label: 'nRd,m [kN/m]', num: true, digits: 1 }, 'η'],
          concLC.map((c) => [c.name, c.conc.Nc, c.conc.NRdc, c.conc.nEdMid, c.conc.nRdMid, etaS(Math.max(c.checks.conc.eta, c.checks.concMid.eta))])),
      ],
    });
  }

  // ---------------------------------------------------------------- Querlast
  const latLC = R.combos.filter((c) => c.lat || c.basement);
  if (latLC.length) {
    const cont = [];
    cont.push(repP(`Die Querlast wird bei festen Vertikallasten der Kombination gesteigert, bis keine Gleichgewichtslage nach Th. 2. O. mehr existiert (Faktor μu, η = 1/μu).${S.arching !== false ? ' Bogenwirkung: Die Lage der Resultierenden am Wandfuss wird innerhalb des zulässigen Bereichs |eu| ≤ t/2 − nd,u/(2·fxd) so gewählt, dass μu maximal wird (statische Methode).' : ''}`));
    const withLat = latLC.filter((c) => c.lat);
    if (withLat.length) {
      cont.push(repTable(['Kombination', { label: 'pd,max [kN/m²]', num: true, digits: 2 }, { label: 'nd,m [kN/m]', num: true, digits: 1 }, { label: 'eu [mm]', num: true, digits: 0 }, { label: 'μu', num: true, digits: 3 }, 'Versagen', 'η'],
        withLat.map((c) => [c.name, c.pMax, c.nMid, c.lat.eU * 1000, Number.isFinite(c.lat.xMax) ? c.lat.xMax : '>1000', c.lat.mode, etaS(c.lat.eta)])));
      const g = withLat.reduce((a, b) => ((Number.isFinite(b.lat.eta) ? b.lat.eta : 1e9) > (Number.isFinite(a.lat.eta) ? a.lat.eta : 1e9) ? b : a));
      if (g.lat.profile) cont.push(eccSvg(g, R, g.lat.profile, `Stützlinie unter Querlast – ${g.name}`));
    }
    const bas = latLC.filter((c) => c.basement);
    if (bas.length) {
      const b0 = bas[0].basement;
      cont.push(h('h3', {}, 'Kelleraussenwand nach EN 1996-3, 4.5'));
      cont.push(repFormula(`β = ${fmt(b0.beta, 0)} (bc = ${fmt(S.bc, 2)} m)\nNEd,max ≤ t·fd/3 = ${fmt(b0.NmaxRd, 1)} kN/m\nNEd,min ≥ ρe·h·he²/(β·t) = ${fmt(b0.NminReq, 1)} kN/m`));
      cont.push(repTable(['Kombination', { label: 'NEd [kN/m]', num: true, digits: 1 }, 'η max', 'η min'],
        bas.map((c) => [c.name, c.basement.N, etaS(c.checks.basMax.eta), etaS(c.checks.basMin.eta)])));
      cont.push(repP('Anwendungsgrenzen EN 1996-3, 4.5: h ≤ 2.6 m, t ≥ 200 mm, Decke wirkt als Scheibe, Auflast auf dem Gelände ≤ 5 kN/m², keine Einzellast > 15 kN näher als 1.5 m, kein hydrostatischer Druck, keine Gleitfuge (Sperrbahn) ohne Schubnachweis.'));
    }
    sec.push({ title: 'Querbelastung', content: cont });
  }

  // ---------------------------------------------------------------- Gebrauch
  const sls = R.combos.filter((c) => c.sls);
  sec.push({
    title: 'Gebrauchstauglichkeit und konstruktive Anforderungen',
    content: [
      repFormula(`hef/t = ${fmt(R.slender, 1)} ≤ ${fmt(R.lambdaLim, 0)} (EN 1996-1-1, 5.5.1.4) → ${okS(R.slender / R.lambdaLim)}`),
      sls.length ? repTable(['Kombination', { label: 'eo [mm]', num: true, digits: 1 }, { label: 'em [mm]', num: true, digits: 1 }, { label: 'eu [mm]', num: true, digits: 1 }, { label: 't/3 [mm]', num: true, digits: 1 }, 'η'],
        sls.map((c) => [c.name, c.sls.eTop * 1000, c.sls.eMid * 1000, c.sls.eBot * 1000, c.sls.lim * 1000, etaS(c.checks.crack.eta)])) : repP('Keine Kombination der Gebrauchstauglichkeit aktiv.'),
      repP('Klaffende Fuge: Unter charakteristischen Lasten soll die Resultierende innerhalb der Wanddicke so liegen, dass höchstens die halbe Fuge klafft (|e| ≤ t/3, Th. 1. O.). Empfehlung zur Rissbegrenzung; Grenzwerte projektspezifisch festlegen.'),
    ],
  });

  // ---------------------------------------------------------------- Annahmen
  sec.push({
    title: 'Annahmen und Grenzen',
    content: h('ul', {},
      [
        'Unbewehrtes Mauerwerk ohne Zugfestigkeit; Kohäsion (Haftscherfestigkeit) im SIA-Verfahren vernachlässigt.',
        'Wandstreifen gelenkig am Kopf und Fuss; Einspannwirkungen nur über die Exzentrizitäten (Eingabe) bzw. die Knicklänge.',
        'Knicklänge nach EN 1996-1-1, 5.5.1.2 (sinngemäss SIA 266); Vorverformung hef/450 (anpassbar).',
        'Exzentrizität aus Deckenverdrehung am Endauflager: Resultierende im Abstand a/3 vom Innenrand.',
        'Momente aus Querlast am einfachen Balken der Höhe h; Erddruck mit Ruhedruckbeiwert K (Eingabe).',
        'Öffnungen: Lastkonzentration auf die Pfeiler pauschal mit l/(l − Σb); Pfeiler, Stürze und Brüstungen sind gesondert nachzuweisen.',
        'Scheibe: N zentrisch am Wandkopf, V auf Höhe hV; Wandkopf frei drehbar (h0 = hV) oder eingespannt (h0 = hV/2).',
        'Die Standardwerte der Mauerwerkskennwerte sind Richtwerte und müssen projektbezogen geprüft werden (SIA 266, Produktdatenblätter).',
        'Brandschutz, Erdbebenanforderungen an die Konstruktion (z.B. Mindestabmessungen) und Gebrauchstauglichkeit infolge Schwinden/Temperatur sind nicht Teil dieses Nachweises.',
      ].map((x) => h('li', {}, x))),
  });
  sec.forEach((x, i) => { x.title = `${i + 1} ${x.title}`; });
  return sec;
}

export const HELP = `
<h3>Zweck</h3>
<p>Nachweise für Wände aus unbewehrtem Mauerwerk nach SIA 266 (2015): Normalkraft mit Knicken, Querkraft in Wandebene (Schubwand), Teilflächenbelastung, Querbelastung (z.B. Kellerwand unter Erddruck) und Gebrauchstauglichkeit. Alle Nachweise werden bei jeder Eingabe sofort neu gerechnet.</p>
<h3>Grafische Eingabe</h3>
<p>Die Ansicht in der Mitte ist der Arbeitsbereich. Ein neues Projekt enthält eine Wand (2.60 × 5.00 m, 150 mm Backstein) ohne Lasten.</p>
<ul>
<li><b>Wand</b>: Klick auf die Wandfläche öffnet Abmessungen, Material und Halterung im Eigenschaftsfenster. Die Ecke oben rechts ziehen ändert Höhe und Länge, die Ecke oben links nur die Höhe, die Ecke unten rechts nur die Länge.</li>
<li><b>Öffnung</b> (O): Rechteck mit zwei Ecken aufziehen. Öffnungen lassen sich ziehen, an den Ecken in der Grösse ändern, kopieren (C) und löschen (Entf).</li>
<li><b>Auflast</b> (Q): Deckenoberkante anklicken – Auflasten aus der Wand darüber (zentrisch) und dem Deckenauflager (mit Exzentrizität).</li>
<li><b>Einzellast</b> (F): Stelle auf der Wandkrone anklicken (Teilflächenbelastung); entlang der Krone verschiebbar.</li>
<li><b>Horizontalkraft</b> (H): Wandrand auf der Höhe der Kraft anklicken (Schubwand); der Pfeil lässt sich senkrecht verschieben.</li>
<li><b>Querlast</b> (W): Wandfläche anklicken – Wind oder Erddruck senkrecht zur Wand (Symbol ⊗ neben der Wand).</li>
<li><b>Querwand</b> (K): linken oder rechten Wandrand anklicken – aussteifende Querwand ein/aus.</li>
<li>Im <b>Schnitt</b> öffnet ein Klick auf den Lastangriff am Wandkopf bzw. -fuss die Exzentrizitäten.</li>
<li>Fang an Punkten, Kanten und Raster; X/Y binden an eine Achse, Ziffern tippen Koordinaten, Esc bricht ab. Alle Werte sind zusätzlich in den Registern links verfügbar und bleiben synchron.</li>
<li>Die Lastkombinationen nach SIA 260 werden automatisch passend zu den erfassten Lasten erzeugt, solange sie nicht von Hand geändert werden.</li>
</ul>
<p>Unter <b>Herleitung</b> (rechts oben) steht der vollständige Rechenweg jedes Nachweises mit allgemeiner Formel, eingesetzten Werten, Ergebnis und Normbezug; «Herleitung ›» in den Nachweistabellen springt direkt dorthin.</p>
<h3>Verfahren</h3>
<ul>
<li><b>Bemessungswerte</b>: fxd = fxk/γM, fyd = fyk/γM mit γM = 2.0 (SIA 266, 2.2.5).</li>
<li><b>Normalkraft mit Knicken (SIA)</b>: Spannungsblock nRd = fxd·(t − 2e) für den Querschnitt (SIA 266, 4.3). Die Schlankheit wird mit einer numerischen Berechnung nach Theorie 2. Ordnung erfasst: Wandstreifen ohne Zugfestigkeit, linear-elastisch (Exd = Exk/γE) – ideal-plastisch (fxd), Vorverformung hef/450, Kriechen über Eeff = Exd/(1 + φ∞·nG/nd). Die Vertikallast wird gesteigert, bis keine Gleichgewichtslage mehr existiert; daraus folgt nRd = λu·nEd. Das Verfahren entspricht der mechanischen Grundlage der Bemessungsdiagramme von SIA 266 bzw. EN 1996-1-1 Anhang G (zum Vergleich als Knickkurve dargestellt).</li>
<li><b>Normalkraft (EN)</b>: alternativ Φi = 1 − 2ei/t und Φm nach EN 1996-1-1, Anhang G.</li>
<li><b>Querkraft in Wandebene (SIA)</b>: Spannungsfeld mit geneigtem Druckfeld über der Druckzone am Wandfuss, Fliessbedingungen nach Ganz/Thürlimann (Grundlage SIA 266) ohne Kohäsion: VRd = min(−t·h0·fyd + √((t·h0·fyd)² + fyd·N·(t·l − N/fxd)); μ·N). Alternativ EN 1996-1-1, 6.2 (fvk = fvk0 + 0.4·σd).</li>
<li><b>Teilflächenbelastung</b>: EN 1996-1-1, 6.1.3 (Erhöhungsfaktor β nur für Vollsteine, Lastausbreitung 60°).</li>
<li><b>Querbelastung</b>: Stützlinie nach Th. 2. O.; die Querlast wird bis zum Versagen gesteigert. Optional Bogenwirkung (Lage der Resultierenden am Wandfuss frei) und vereinfachter Kellerwandnachweis nach EN 1996-3, 4.5.</li>
<li><b>Gebrauchstauglichkeit</b>: Schlankheit hef/t ≤ 27 und klaffende Fuge |e| ≤ t/3 unter charakteristischen Lasten (Empfehlung).</li>
</ul>
<h3>Vorzeichen</h3>
<p>Exzentrizitäten und Querlasten sind positiv in Richtung Raumseite (+x). Eine Querlast von aussen (Wind, Erddruck) wirkt also positiv. Die Deckenverdrehung an einem Endauflager verschiebt die Resultierende ebenfalls zur Raumseite.</p>
<h3>Zu prüfende Werte</h3>
<ul>
<li>Mauerwerkskennwerte fxk, fyk, Exk, μ, φ∞, fvk0 und fb: Die Standardwerte sind Richtwerte. Massgebend sind SIA 266 bzw. die Produktdaten des Herstellers.</li>
<li>γE für den E-Modul in der Th. 2. O. (Standard γE = γM) und die Vorverformung hef/450.</li>
<li>Knickbeiwerte ρ nach EN 1996-1-1 (sinngemäss SIA 266).</li>
<li>Erddruckbeiwert K (Ruhedruck K0 ≈ 1 − sin φ').</li>
</ul>
<h3>Grenzen</h3>
<ul>
<li>Bewehrtes Mauerwerk, Brandfall und Erdbebennachweise mit Verformungsvermögen (SIA 261) sind nicht enthalten; die Erdbebenkraft ist als Bemessungswert einzugeben.</li>
<li>Öffnungen werden nur pauschal berücksichtigt (Lastkonzentration); Pfeiler und Stürze separat nachweisen.</li>
<li>Die Wand wird als einzelner Streifen bzw. als Kragscheibe betrachtet; Zusammenwirken mit Querwänden (Flansche) ist nicht berücksichtigt.</li>
</ul>
<p class="muted">Ergebnisse ohne Gewähr. Die Verantwortung für Eingaben und Interpretation liegt beim Anwender.</p>
`;

export const INTRO = `<h4>So funktioniert's</h4>
<ol>
<li>Die Wand ist angelegt: <b>Ecke oben rechts ziehen</b> ändert Höhe und Länge, Klick auf die Wand zeigt Abmessungen und Material.</li>
<li>Lasten mit den Werkzeugen über der Grafik setzen: <b>Auflast</b> (Q) auf die Deckenoberkante, <b>Einzellast</b> (F), <b>Horizontalkraft</b> (H), <b>Querlast</b> (W); <b>Öffnung</b> (O) aufziehen.</li>
<li>Angeklicktes im Eigenschaftsfenster bearbeiten – alle Werte auch in den Registern links.</li>
<li>Rechts Nachweise und <b>Herleitung</b> lesen, Schnitt/Schub umschalten, Bericht erstellen.</li>
</ol>`;

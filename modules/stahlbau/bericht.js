// Statischer Bericht Stahlbau: Eingaben, Querschnitt, Schnittgrössen, alle Nachweise mit Formeln und Zwischenwerten
import { h } from '../../js/core/ui.js';
import { fmt } from '../../js/core/format.js';
import { repTable, repKV, repFigure, repFormula, repP } from '../../js/core/report.js';
import { SYSTEMS, CATEGORIES, normLoad } from './beam.js';
import { SHAPE_OPTIONS, ref, E_STEEL, G_STEEL } from './calc.js';

const f0 = (x) => fmt(x, 0), f1 = (x) => fmt(x, 1), f2 = (x) => fmt(x, 2), f3 = (x) => fmt(x, 3);
const kN = (n) => n / 1e3, kNm = (m) => m / 1e6;
const status = (eta) => (Number.isFinite(eta) && eta <= 1.0001 ? 'erfüllt' : 'nicht erfüllt');
const etaLine = (Ed, Rd, unit, eta) => `η = ${Ed} / ${Rd} = ${f3(eta)} ${eta <= 1.0001 ? '≤ 1.0 → erfüllt' : '> 1.0 → NICHT ERFÜLLT'}${unit ? '' : ''}`;
const h3 = (t) => h('h3', {}, t);

/** Momentaufnahme einer Ansicht mit fester Kombinationswahl. */
function snap(app, mode, combo = 'gov') {
  const prev = app.viewOpts.combo;
  app.viewOpts.combo = combo;
  try { return app.snapshot(mode); } finally { app.viewOpts.combo = prev; }
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

  // ---------------------------------------------------------------- Klassifizierung
  const u = r.govUls;
  const kl = u.klass;
  const clsContent = [
    repP(`Massgebende Kombination: ${u.combo.name}. Beanspruchung für die Klassifizierung: N = ${f1(Math.max(0, u.Nc))} kN (Druck), My = ${f1(u.MyMax)} kNm, Mz = ${f1(u.MzMax)} kNm.`),
    repFormula(`ε = √(235 / fy) = √(235 / ${mat.fy}) = ${f3(kl.eps)}`),
  ];
  if (kl.parts.length) {
    clsContent.push(repTable(['Teil', 'Art', { label: 'c/t', num: true }, { label: 'α / ψ', num: true }, { label: 'Grenze Kl. 1', num: true }, { label: 'Kl. 2', num: true }, { label: 'Kl. 3', num: true }, 'Klasse'],
      kl.parts.filter((pp, i, a) => a.findIndex((q) => q.label === pp.label && q.cls === pp.cls && Math.abs(q.ct - pp.ct) < 1e-9) === i).map((pp) => [
        pp.label, pp.kind === 'internal' ? 'beidseitig gestützt' : pp.kind === 'tube' ? 'Rohr (d/t)' : 'einseitig gestützt', f2(pp.ct),
        pp.tension ? 'Zug' : pp.kind === 'tube' ? '–' : `${f2(pp.alpha)} / ${f2(pp.psi)}`,
        Number.isFinite(pp.lim[0]) ? f1(pp.lim[0]) : '–', Number.isFinite(pp.lim[1]) ? f1(pp.lim[1]) : '–', Number.isFinite(pp.lim[2]) ? f1(pp.lim[2]) : '–', String(pp.cls)])));
  } else clsContent.push(repP(`Querschnittsklasse ${u.cls} (${kl.note || 'vorgegeben'}).`));
  clsContent.push(repP(`→ Querschnittsklasse ${u.cls}: ${u.cls <= 2 ? 'plastische Widerstände' : u.cls === 3 ? 'elastische Widerstände' : 'wirksamer Querschnitt nach EN 1993-1-5'}.`));
  if (u.cls === 4 && u.effs.N) {
    clsContent.push(repKV([
      ['Aeff (zentrischer Druck)', u.effs.N.A / 100, 'cm²', 2],
      ['Weff,y (Biegung y)', u.effs.My.Wy / 1e3, 'cm³', 1],
      ['Weff,z (Biegung z)', u.effs.Mz.Wz / 1e3, 'cm³', 1],
      ['Schwerpunktverschiebung eN,y / eN,z', `${f1(u.effs.N.eNy)} / ${f1(u.effs.N.eNz)}`, 'mm'],
    ]));
    clsContent.push(repFormula('λ̄p = (c/t) / (28.4·ε·√kσ);  innen: ρ = (λ̄p − 0.055·(3 + ψ)) / λ̄p² ≤ 1;  aussen: ρ = (λ̄p − 0.188) / λ̄p² ≤ 1  (EN 1993-1-5 4.4)'));
  }
  out.push({ title: `${sec++} Querschnittsklassifizierung (${ref('class', norm)})`, content: clsContent });

  // ---------------------------------------------------------------- Querschnittsnachweise
  const ck = (id) => r.checks.find((c) => c.id === id);
  const csContent = [];
  const at = (c) => `${c.comboName}${Number.isFinite(c.x) ? `, x = ${f2(c.x)} m` : ''}`;
  const cN = ck('N');
  if (cN) {
    const R = cN.u.R;
    csContent.push(h3(`Normalkraft (${ref('N', norm)}) – ${at(cN)}`));
    csContent.push(repFormula(cN.label.includes('Zug')
      ? `Npl,Rd = A·fy/γM0 = ${f0(s.A)}·${mat.fy}/${f2(g0)} = ${f1(kN(R.NtRd))} kN\nNEd = ${f1(cN.Ed)} kN → ${etaLine(f1(cN.Ed), f1(cN.Rd), 'kN', cN.eta)}`
      : `Nc,Rd = ${R.cls === 4 ? 'Aeff' : 'A'}·fy/γM0 = ${f0(R.Aeff)}·${mat.fy}/${f2(g0)} = ${f1(kN(R.NcRd))} kN\nNEd = ${f1(cN.Ed)} kN → ${etaLine(f1(cN.Ed), f1(cN.Rd), 'kN', cN.eta)}`));
  }
  const cV = ck('Vz');
  if (cV) {
    const R = cV.u.R;
    csContent.push(h3(`Querkraft Vz (${ref('V', norm)}) – ${at(cV)}`));
    csContent.push(repFormula(`Av,z = ${f0(R.Avz)} mm²\nVpl,z,Rd = Av,z·(fy/√3)/γM0 = ${f0(R.Avz)}·(${mat.fy}/√3)/${f2(g0)} = ${f1(kN(R.VplzRd))} kN\nVEd = ${f1(cV.Ed)} kN → ${etaLine(f1(cV.Ed), f1(cV.Rd), 'kN', cV.eta)}${R.hwtw ? `\nSchubbeulen: hw/tw = ${f1(R.hwtw)} ${R.hwtw <= R.hwtwLim ? '≤' : '>'} 72·ε/η = ${f1(R.hwtwLim)}${R.hwtw <= R.hwtwLim ? ' → kein Schubbeulnachweis erforderlich' : ` → λ̄w = ${f3(R.lamw)}, χw = ${f3(R.chiw)}, Vb,Rd = ${f1(kN(R.VbRd))} kN`}` : ''}`));
  }
  const cVy = ck('Vy');
  if (cVy) {
    const R = cVy.u.R;
    csContent.push(h3(`Querkraft Vy – ${at(cVy)}`));
    csContent.push(repFormula(`Vpl,y,Rd = Av,y·(fy/√3)/γM0 = ${f0(R.Avy)}·(${mat.fy}/√3)/${f2(g0)} = ${f1(kN(R.VplyRd))} kN\n${etaLine(f1(cVy.Ed), f1(cVy.Rd), 'kN', cVy.eta)}`));
  }
  const cMy = ck('My');
  if (cMy) {
    const R = cMy.u.R, csr = cMy.u.cs.My;
    const W = R.cls <= 2 ? 'Wpl,y' : R.cls === 3 ? 'Wel,y' : 'Weff,y';
    let t = `Mc,y,Rd = ${W}·fy/γM0 = ${f0(R.Wy / 1e3)}·10³·${mat.fy}/${f2(g0)} = ${f1(kNm(R.McyRd))} kNm`;
    if (csr.rho > 0) t += `\nVEd > 0.5·Vpl,Rd → ρ = (2·VEd/Vpl,Rd − 1)² = ${f3(csr.rho)}\nMy,V,Rd = (${W} − ρ·Aw²/(4·tw))·fy/γM0 = ${f1(cMy.Rd)} kNm`;
    t += `\nMy,Ed = ${f1(cMy.Ed)} kNm → ${etaLine(f1(cMy.Ed), f1(cMy.Rd), 'kNm', cMy.eta)}`;
    csContent.push(h3(`Biegung um y (${ref('M', norm)}) – ${at(cMy)}`), repFormula(t));
  }
  const cMz = ck('Mz');
  if (cMz) {
    const R = cMz.u.R;
    const W = R.cls <= 2 ? 'Wpl,z' : R.cls === 3 ? 'Wel,z' : 'Weff,z';
    csContent.push(h3(`Biegung um z (${ref('M', norm)}) – ${at(cMz)}`), repFormula(`Mc,z,Rd = ${W}·fy/γM0 = ${f1(R.Wz / 1e3)}·10³·${mat.fy}/${f2(g0)} = ${f1(kNm(R.MczRd))} kNm\nMz,Ed = ${f1(cMz.Ed)} kNm → ${etaLine(f1(cMz.Ed), f1(cMz.Rd), 'kNm', cMz.eta)}`));
  }
  const cNM = ck('NM');
  if (cNM) {
    const nm = cNM.u.cs.NM, R = cNM.u.R;
    let t = `Stelle massgebend: NEd = ${f1(nm.N)} kN, My,Ed = ${f1(nm.My)} kNm, Mz,Ed = ${f1(nm.Mz)} kNm\nVerfahren: ${nm.method}`;
    if (nm.MNy !== undefined) {
      t += `\nn = NEd/Npl,Rd = ${f3(nm.n)}${nm.a !== undefined ? `,  a = (A − 2·b·tf)/A ≤ 0.5 = ${f3(nm.a)}` : ''}`;
      t += `\nMN,y,Rd = ${f1(kNm(nm.MNy))} kNm,  MN,z,Rd = ${f1(kNm(nm.MNz))} kNm,  α = ${f2(nm.alpha)},  β = ${f2(nm.beta)}`;
      t += `\n[My,Ed/MN,y,Rd]^α + [Mz,Ed/MN,z,Rd]^β → η = ${f3(cNM.eta)} → ${status(cNM.eta)}`;
    } else {
      t += `\nNEd/NRd + (My,Ed + ΔMy)/My,Rd + (Mz,Ed + ΔMz)/Mz,Rd = ${f3(cNM.eta)} → ${status(cNM.eta)}`;
      if (R.cls === 4) t += `\nΔMy = NEd·eN,z = ${f2(kNm(nm.dMy || 0))} kNm, ΔMz = NEd·eN,y = ${f2(kNm(nm.dMz || 0))} kNm`;
    }
    csContent.push(h3(`${cNM.label} (${ref('NM', norm)}) – ${at(cNM)}`), repFormula(t));
  }
  out.push({ title: `${sec++} Querschnittsnachweise`, content: csContent.length ? csContent : [repP('Keine Querschnittsbeanspruchung.')] });

  // ---------------------------------------------------------------- Stabilität
  const stContent = [];
  const cNb = ck('Nbz') || ck('Nby');
  if (cNb) {
    const st = cNb.u.st;
    const NRk = st.NRk;
    stContent.push(h3(`Biegeknicken (${ref('Nb', norm)}) – ${cNb.comboName}`));
    stContent.push(repFormula(
      `NEd = ${f1(kN(st.NEd))} kN,  NRk = ${cNb.u.R.cls === 4 ? 'Aeff' : 'A'}·fy = ${f1(kN(NRk))} kN\n`
      + `y-y: Lcr,y = ${f3(st.LcrY / 1000)} m,  Ncr,y = π²·E·Iy/Lcr,y² = ${f1(kN(st.NcrY))} kN,  λ̄y = √(NRk/Ncr,y) = ${f3(st.lamY)}\n`
      + `     Knicklinie ${st.curveY} (α = ${f2(st.alphaY)}),  Φy = 0.5·[1 + α·(λ̄y − 0.2) + λ̄y²] = ${f3(st.PhiY)},  χy = 1/(Φy + √(Φy² − λ̄y²)) = ${f3(st.chiY)}\n`
      + `     Nb,y,Rd = χy·NRk/γM1 = ${f1(kN(st.NbyRd))} kN → η = ${f3(st.NEd / st.NbyRd)}\n`
      + `z-z: Lcr,z = ${f3(st.LcrZ / 1000)} m,  Ncr,z = π²·E·Iz/Lcr,z² = ${f1(kN(st.NcrZ))} kN,  λ̄z = √(NRk/Ncr,z) = ${f3(st.lamZ)}\n`
      + `     Knicklinie ${st.curveZ} (α = ${f2(st.alphaZ)}),  Φz = ${f3(st.PhiZ)},  χz = ${f3(st.chiZ)}\n`
      + `     Nb,z,Rd = χz·NRk/γM1 = ${f1(kN(st.NbzRd))} kN → η = ${f3(st.NEd / st.NbzRd)}`));
    if (st.torsional) {
      stContent.push(h3(`${s.type === 'U' ? 'Biegedrillknicken unter Druck' : 'Drillknicken'} (${ref('NbT', norm)})`));
      stContent.push(repFormula(
        `i0² = iy² + iz²${s.type === 'U' ? ' + y0²' : ''} = ${f0(st.i02)} mm²,  LT = kw·L = ${f3(st.LT / 1000)} m\n`
        + `Ncr,T = (G·It + π²·E·Iw/LT²)/i0² = ${f1(kN(st.NcrT))} kN${s.type === 'U' ? `,  Ncr,TF (gekoppelt mit Ncr,y) = ${f1(kN(st.NcrTF))} kN` : ''}\n`
        + `λ̄T = √(NRk/Ncr) = ${f3(st.lamT)},  Knicklinie ${st.curveZ}: χT = ${f3(st.chiT)},  Nb,Rd = ${f1(kN(st.NbTRd))} kN → η = ${f3(st.NEd / st.NbTRd)}`));
    }
  }
  const cLT = ck('Mb');
  if (cLT) {
    const sg = cLT.seg, st = cLT.u.st;
    stContent.push(h3(`Biegedrillknicken – Kippen (${ref('Mb', norm)}) – ${cLT.comboName}`));
    let t = `Kippsegment ${f2(sg.x0)} … ${f2(sg.x1)} m (L = ${f3(sg.L)} m), My,Ed = ${f1(sg.MyEd)} kNm\n`;
    if (sg.mcrBy === 'formula') {
      const fo = sg.formula;
      t += `C1 = ${f3(sg.C1)}, C2 = ${f3(sg.C2)} (${sg.csrc}),  k = ${f2(sg.k)}, kw = ${f2(sg.kw)},  zg = ${f0(sg.zg)} mm\n`
        + `Mcr = C1·π²·E·Iz/(k·L)²·{√[(k/kw)²·Iw/Iz + (k·L)²·G·It/(π²·E·Iz) + (C2·zg)²] − C2·zg}\n`
        + `    = ${f3(sg.C1)}·${f1(kN(fo.Ncrz))} kN·{√[${f0(fo.t1)} + ${f0(fo.t2)} + ${f0(fo.t3)}] − ${f1(sg.C2 * sg.zg)}} mm = ${f1(kNm(sg.Mcr))} kNm\n`;
    } else {
      t += `Mcr aus Eigenwertanalyse (${sg.csrc}): αcr = ${f3(sg.lambdaCr)} → Mcr = αcr·My,Ed = ${f1(kNm(sg.Mcr))} kNm (entspricht C1 = ${f3(sg.C1eq)} bezogen auf das konstante Moment)\n`;
    }
    const lt = sg.lt;
    const W = cLT.u.R.cls <= 2 ? 'Wpl,y' : cLT.u.R.cls === 3 ? 'Wel,y' : 'Weff,y';
    const meth = { general: 'EN 1993-1-1 6.3.2.2 (allgemein)', rolled: 'EN 1993-1-1 6.3.2.3 (Walzprofile)', sia: 'SIA 263 (αLT = 0.21 gewalzt / 0.49 geschweisst, λ̄LT,0 = 0.4)' }[st.ltbMethod];
    t += `λ̄LT = √(${W}·fy/Mcr) = √(${f0(cLT.u.R.Wy / 1e3)}·10³·${mat.fy}/${f1(kNm(sg.Mcr))}·10⁶) = ${f3(sg.lamLT)}\n`
      + `Verfahren: ${meth}; Kipplinie ${sg.curveLT}, αLT = ${f2(sg.alphaLT)}, λ̄LT,0 = ${f2(lt.lam0)}, β = ${f2(lt.beta)}\n`
      + `ΦLT = 0.5·[1 + αLT·(λ̄LT − λ̄LT,0) + β·λ̄LT²] = ${f3(lt.Phi)},  χLT = 1/(ΦLT + √(ΦLT² − β·λ̄LT²)) = ${f3(lt.chi)}`;
    if (st.ltbMethod === 'rolled') t += `\nkc = ${f3(sg.kc)},  f = 1 − 0.5·(1 − kc)·[1 − 2·(λ̄LT − 0.8)²] = ${f3(lt.f)},  χLT,mod = χLT/f = ${f3(lt.chiMod)}`;
    t += `\nMb,Rd = χLT·${W}·fy/γM1 = ${f1(cLT.Rd)} kNm\nMy,Ed = ${f1(cLT.Ed)} kNm → ${etaLine(f1(cLT.Ed), f1(cLT.Rd), 'kNm', cLT.eta)}`;
    stContent.push(repFormula(t));
    if (cLT.u.st.segments.length > 1) {
      stContent.push(repTable(['Segment [m]', { label: 'My,Ed [kNm]', num: true }, { label: 'Mcr [kNm]', num: true }, 'Ermittlung', { label: 'λ̄LT', num: true }, { label: 'χLT', num: true }, { label: 'Mb,Rd [kNm]', num: true }, { label: 'η', num: true }],
        cLT.u.st.segments.filter((x) => x.Mcr).map((x) => [`${f2(x.x0)} … ${f2(x.x1)}`, f1(x.MyEd), f1(kNm(x.Mcr)), x.mcrBy === 'formula' ? `C1 = ${f3(x.C1)}` : 'FE', f3(x.lamLT), f3(x.chiLT), f1(kNm(x.MbRd)), f2(x.etaLT)])));
    }
  } else if (!r.govUls.st.ltbActive) stContent.push(h3('Biegedrillknicken – Kippen'), repP(`Kein Kippnachweis erforderlich: ${r.govUls.st.ltbReason || 'nicht massgebend'}.`));
  const c61 = ck('int61'), c62 = ck('int62');
  if (c61 || c62) {
    const c = (c62 && (!c61 || c62.eta >= c61.eta)) ? c62 : c61;
    const sg = c.seg, R = c.u.R, st = c.u.st;
    stContent.push(h3(`Interaktion Normalkraft und Biegung (${ref('int', norm)}) – ${c.comboName}`));
    stContent.push(repFormula(
      `Segment ${f2(sg.x0)} … ${f2(sg.x1)} m: NEd = ${f1(sg.NEd)} kN, My,Ed = ${f1(sg.MyEd)} kNm, Mz,Ed = ${f1(sg.MzEd)} kNm\n`
      + `Querschnittsklasse ${R.cls} → ${R.cls <= 2 ? 'plastische' : 'elastische'} Interaktionsbeiwerte, ${sg.susceptible ? 'verdrehweich (Tab. B.2)' : 'verdrehsteif bzw. gehalten (Tab. B.1)'}\n`
      + `Cmy = ${f3(sg.Cmy.Cm)}, Cmz = ${f3(sg.Cmz.Cm)}, CmLT = ${f3(Math.max(0.4, sg.CmLT.Cm))}  (Tab. B.3)\n`
      + `nY = NEd/(χy·NRk/γM1) = ${f3(sg.nY)},  nZ = NEd/(χz·NRk/γM1) = ${f3(sg.nZ)},  χLT = ${f3(sg.chiLT)}\n`
      + `kyy = ${f3(sg.kf.kyy)}, kyz = ${f3(sg.kf.kyz)}, kzy = ${f3(sg.kf.kzy)}, kzz = ${f3(sg.kf.kzz)}\n`
      + `(6.61): NEd/(χy·NRk/γM1) + kyy·(My,Ed + ΔMy)/(χLT·My,Rk/γM1) + kyz·(Mz,Ed + ΔMz)/(Mz,Rk/γM1)\n`
      + `      = ${f3(sg.terms.tN1)} + ${f3(sg.kf.kyy)}·${f3(sg.terms.tMy)} + ${f3(sg.kf.kyz)}·${f3(sg.terms.tMz)} = ${f3(sg.int61)} → ${status(sg.int61)}\n`
      + `(6.62): NEd/(χz·NRk/γM1) + kzy·(My,Ed + ΔMy)/(χLT·My,Rk/γM1) + kzz·(Mz,Ed + ΔMz)/(Mz,Rk/γM1)\n`
      + `      = ${f3(sg.terms.tN2)} + ${f3(sg.kf.kzy)}·${f3(sg.terms.tMy)} + ${f3(sg.kf.kzz)}·${f3(sg.terms.tMz)} = ${f3(sg.int62)} → ${status(sg.int62)}`
      + (st.torsional && sg.chiZN < st.chiZ ? `\n(im Normalkraftterm von 6.62 ist χz durch χT = ${f3(st.chiT)} ersetzt, da Drillknicken massgebend)` : '')));
  }
  const cT = ck('intT');
  if (cT) stContent.push(h3('Kippen mit Biegung um z bei Zugkraft'), repFormula(`My,Ed/Mb,Rd + Mz,Ed/Mz,Rd = ${f3(cT.eta)} → ${status(cT.eta)} (Zugkraft günstig vernachlässigt)`));
  out.push({ title: `${sec++} Stabilitätsnachweise`, content: stContent.length ? stContent : [repP('Keine Stabilitätsnachweise erforderlich (keine Druckkraft und kein kippgefährdendes Moment).')] });

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

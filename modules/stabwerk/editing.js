// Grafische Bearbeitung des Stabwerks: Werkzeuge, Geometrie für den Editor, Eigenschaftsfenster
import { h, numField, selectField, checkField, textField, button, kvTable, badge, fmt, note } from '../../js/core/ui.js';
import { TOOL_ICONS } from '../../js/core/editor.js';
import { chartBox } from '../../js/core/chart.js';
import { LOAD_DIRS, LC_KINDS, pickResult } from './calc.js';
import { MATERIALS, PROFILES, SECTION_TYPES, sectionProps, sectionLabel } from './sections.js';
import { SUPPORT_KINDS, supportKind, ensureNode, mergeNodes, removeNodeRefs, removeMemberRefs, DEFAULT_SECTION, connectNode, splitAtInnerNodes } from './model.js';

const nid = (i) => `n:${i}`;
const mid = (k) => `m:${k}`;
const parse = (id) => { const [t, v] = id.split(':'); return { t, i: +v }; };

function memberLen(p, m) {
  const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
}

/** Ergebnis des gewählten Lastfalls bzw. der Kombination (für Werte im Eigenschaftsfenster). */
function currentResult(app) {
  const key = app.viewOpts.case;
  if (!app.results || !key || key === 'env') return null;
  return pickResult(app.results, key);
}

export const editorSpec = {
  axes: ['x', 'y'],
  unit: 'm',
  digits: 3,
  grid: [0.05, 0.1, 0.25, 0.5, 1],
  gridDefault: 0.25,
  modes: ['sys'],
  canCopy: true,
  tools: [
    { id: 'member', label: 'Stab', key: 'l', form: 'chain', icon: TOOL_ICONS.chain, title: 'Stäbe zeichnen: Punkte nacheinander anklicken, Knoten entstehen automatisch; Enter/Esc beendet', prompts: ['Anfangspunkt des Stabes setzen.', 'Endpunkt setzen – weiterzeichnen oder Esc.'] },
    { id: 'node', label: 'Knoten', key: 'k', form: 'point', icon: TOOL_ICONS.point, title: 'Einzelnen Knoten setzen' },
    { id: 'support', label: 'Lager', key: 'a', form: 'pick', pick: ['point'], icon: TOOL_ICONS.support, title: 'Knoten anklicken: Lager anbringen (danach Lagerart im Fenster wählen)', hint: 'Knoten anklicken, an dem ein Lager angebracht wird.' },
    { id: 'dist', label: 'Streckenlast', key: 'q', form: 'pick', pick: ['segment'], icon: TOOL_ICONS.load, title: 'Stab anklicken: Streckenlast im aktiven Lastfall', hint: 'Stab anklicken, auf den eine Streckenlast wirkt.' },
    { id: 'force', label: 'Einzellast', key: 'f', form: 'pick', pick: ['point', 'segment'], icon: TOOL_ICONS.pointload, title: 'Knoten oder Stelle auf einem Stab anklicken: Einzelkraft im aktiven Lastfall', hint: 'Knoten oder Stelle auf einem Stab anklicken.' },
    { id: 'hinge', label: 'Gelenk', key: 'g', form: 'pick', pick: ['segment'], icon: TOOL_ICONS.hinge, title: 'Stab nahe am Ende anklicken: Momentengelenk ein/aus', hint: 'Stab nahe an dem Ende anklicken, an dem das Gelenk sitzt.' },
  ],

  geometry(app) {
    const p = app.project;
    const points = p.nodes.map((n, i) => ({ id: nid(i), p: [+n.x, +n.y], label: `Knoten ${i + 1}` }));
    const segments = [];
    p.members.forEach((m, k) => {
      const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
      if (a && b) segments.push({ id: mid(k), a: [+a.x, +a.y], b: [+b.x, +b.y], label: `Stab ${k + 1}` });
    });
    return { points, segments, regions: [] };
  },

  create(app, tool, pts) {
    const p = app.project;
    if (tool === 'node') {
      const i = ensureNode(p, pts[0]);
      const split = connectNode(p, i);
      app.status(`Knoten ${i + 1} bei (${fmt(pts[0][0], 3)} / ${fmt(pts[0][1], 3)}) m${split ? ' – Stab geteilt' : ''}`, 'ok');
      return [nid(i)];
    }
    if (tool === 'member') {
      if (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) < 1e-6) return null;
      const i = ensureNode(p, pts[0]), j = ensureNode(p, pts[1]);
      if (p.members.some((m) => (m.i === i + 1 && m.j === j + 1) || (m.i === j + 1 && m.j === i + 1))) { app.status('Diesen Stab gibt es bereits.', 'warn'); return null; }
      // Endpunkte auf bestehenden Stäben verbinden diese (T-Stoss)
      connectNode(p, i); connectNode(p, j);
      const sec = Math.min(p.sections.length, Math.max(1, p.activeSec || 1));
      p.members.push({ i: i + 1, j: j + 1, sec, hi: false, hj: false });
      // vorhandene Knoten im Inneren des neuen Stabes teilen ihn
      const parts = splitAtInnerNodes(p, p.members.length - 1);
      app.status(`Stab ${p.members.length}: Knoten ${i + 1} → ${j + 1}, L = ${fmt(Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), 3)} m${parts.length > 1 ? ` (in ${parts.length} Stäbe geteilt)` : ''}`, 'ok');
      return parts.map(mid);
    }
    return null;
  },

  pick(app, tool, hit) {
    const p = app.project;
    const lc = p.loadCases[p.activeLC] || p.loadCases[0];
    if (tool === 'support' && hit.type === 'point') {
      const n = parse(hit.id).i + 1;
      if (!p.supports.some((s) => s.node === n)) p.supports.push({ node: n, ux: true, uy: true, rz: false, kx: 0, ky: 0, kr: 0 });
      app.status(`Lager an Knoten ${n} – Lagerart im Eigenschaftsfenster wählen`, 'ok');
      return [hit.id];
    }
    if (tool === 'dist' && hit.type === 'segment') {
      const k = parse(hit.id).i;
      lc.dist.push({ member: k + 1, dir: 'g', q1: 10, q2: null, a: null, b: null });
      app.status(`Streckenlast 10 kN/m auf Stab ${k + 1} (LF ${p.activeLC + 1}) – Wert im Eigenschaftsfenster anpassen`, 'ok');
      return [hit.id];
    }
    if (tool === 'force') {
      if (hit.type === 'point') {
        const n = parse(hit.id).i + 1;
        lc.nodal.push({ node: n, fx: 0, fy: -10, m: 0 });
        app.status(`Knotenlast 10 kN an Knoten ${n} (LF ${p.activeLC + 1})`, 'ok');
        return [hit.id];
      }
      const k = parse(hit.id).i;
      const L = memberLen(p, p.members[k]);
      const a = Math.round(hit.t * L * 100) / 100;
      lc.point.push({ member: k + 1, dir: 'g', P: 10, a, m: 0 });
      app.status(`Einzellast 10 kN auf Stab ${k + 1} bei a = ${fmt(a, 2)} m (LF ${p.activeLC + 1})`, 'ok');
      return [hit.id];
    }
    if (tool === 'hinge' && hit.type === 'segment') {
      const m = p.members[parse(hit.id).i];
      if (hit.t < 0.5) m.hi = !m.hi; else m.hj = !m.hj;
      app.status(`Gelenk am Stab${hit.t < 0.5 ? 'anfang' : 'ende'} ${(hit.t < 0.5 ? m.hi : m.hj) ? 'gesetzt' : 'entfernt'}`, 'ok');
      return [hit.id];
    }
    return null;
  },

  move(app, ids, d, { copy }) {
    const p = app.project;
    const nodeSet = new Set();
    const memSet = new Set();
    for (const id of ids) {
      const { t, i } = parse(id);
      if (t === 'n') nodeSet.add(i);
      if (t === 'm' && p.members[i]) { memSet.add(i); nodeSet.add(p.members[i].i - 1); nodeSet.add(p.members[i].j - 1); }
    }
    if (copy) {
      const map = new Map();
      for (const i of nodeSet) {
        const n = p.nodes[i];
        map.set(i, ensureNode(p, [n.x + d[0], n.y + d[1]]));
      }
      const out = [];
      for (const k of memSet) {
        const m = p.members[k];
        p.members.push({ ...m, i: map.get(m.i - 1) + 1, j: map.get(m.j - 1) + 1 });
        out.push(mid(p.members.length - 1));
      }
      for (const i of nodeSet) if (!memSet.size) out.push(nid(map.get(i)));
      mergeNodes(p);
      return out;
    }
    for (const i of nodeSet) {
      p.nodes[i].x = +(p.nodes[i].x + d[0]).toFixed(6);
      p.nodes[i].y = +(p.nodes[i].y + d[1]).toFixed(6);
    }
    const before = p.nodes.length;
    const map = mergeNodes(p);
    const moved = [...nodeSet].map((i) => map[i]).filter((i) => i >= 0);
    let split = false;
    for (const i of moved) split = connectNode(p, i) || split;
    if (p.nodes.length < before || split) {
      app.status(p.nodes.length < before ? 'Knoten zusammengeführt' : 'Knoten mit Stab verbunden', 'ok');
      return memSet.size ? ids : moved.map(nid);
    }
    return ids;
  },

  remove(app, ids) {
    const p = app.project;
    const nodes = ids.map(parse).filter((x) => x.t === 'n').map((x) => x.i).sort((a, b) => b - a);
    const mems = ids.map(parse).filter((x) => x.t === 'm').map((x) => x.i).sort((a, b) => b - a);
    for (const k of mems) { removeMemberRefs(p, k); p.members.splice(k, 1); for (const m of p.members) void m; }
    for (const i of nodes) { removeNodeRefs(p, i); p.nodes.splice(i, 1); }
    // freie Knoten ohne Stab und ohne Last bleiben bestehen (können wieder verbunden werden)
    app.status(`${ids.length} Element${ids.length === 1 ? '' : 'e'} gelöscht`, 'ok');
  },

  inspect(app, ids) {
    const p = app.project;
    if (ids.length === 1) {
      const { t, i } = parse(ids[0]);
      if (t === 'n' && p.nodes[i]) return inspectNode(app, i);
      if (t === 'm' && p.members[i]) return inspectMember(app, i);
    }
    return inspectMulti(app, ids);
  },

  idleHint(app) {
    const p = app.project;
    if (!p.members.length) return h('span', {}, 'Wählen Sie oben ', h('b', {}, 'Stab'), ' (Taste L) und klicken Sie Anfangs- und Endpunkt in die Grafik. Knoten entstehen automatisch, das Raster und vorhandene Punkte fangen den Zeiger.');
    if (!p.supports.length) return h('span', {}, 'Als Nächstes Lager anbringen: Werkzeug ', h('b', {}, 'Lager'), ' (A) und einen Knoten anklicken.');
    return h('span', {}, 'Stab oder Knoten anklicken, um Querschnitt, Lager und Lasten zu bearbeiten. Ziehen verschiebt – mit X/Y entlang einer Achse, M für die Mitte zweier Punkte.');
  },
};

// ------------------------------------------------------------------ Eigenschaftsfenster

function lcLabel(p) {
  const lc = p.loadCases[p.activeLC];
  return lc ? `LF ${p.activeLC + 1}: ${lc.name}` : '';
}

function lcSelect(app) {
  const p = app.project;
  return selectField('Lastfall', p, 'activeLC', p.loadCases.map((lc, i) => ({ value: i, label: `LF ${i + 1}: ${lc.name} (${LC_KINDS[lc.kind]?.short || lc.kind})` })), {
    wide: true, info: 'Neue Lasten werden diesem Lastfall zugeordnet. Lastfälle verwalten Sie im Register «Lasten».',
    onChange: () => { app.changed({ inputs: true }); app.editor.refreshPanel(true); },
  });
}

function inspectNode(app, i) {
  const p = app.project;
  const n = p.nodes[i];
  const ch = () => app.changed({ inputs: true });
  const sup = p.supports.find((s) => s.node === i + 1);
  const kindObj = { kind: supportKind(sup) };
  const out = [
    h('div', { class: 'grid2' }, numField('x', n, 'x', { unit: 'm', onChange: ch }), numField('y', n, 'y', { unit: 'm', onChange: ch })),
    selectField('Lager', kindObj, 'kind', SUPPORT_KINDS.filter((k) => k.value !== 'custom' || kindObj.kind === 'custom'), {
      wide: true, info: 'Gelenkig fest: x und y gehalten. Rolle: nur eine Richtung gehalten. Eingespannt: zusätzlich die Verdrehung.',
      onChange: (v) => {
        const k = SUPPORT_KINDS.find((q) => q.value === v);
        let s = p.supports.find((q) => q.node === i + 1);
        if (v === 'none') { p.supports = p.supports.filter((q) => q.node !== i + 1); ch(); app.editor.refreshPanel(true); return; }
        if (!s) { s = { node: i + 1, ux: false, uy: false, rz: false, kx: 0, ky: 0, kr: 0 }; p.supports.push(s); }
        if (k?.flags) [s.ux, s.uy, s.rz] = k.flags;
        ch(); app.editor.refreshPanel(true);
      },
    }),
  ];
  if (sup && (kindObj.kind === 'spring' || sup.kx || sup.ky || sup.kr)) {
    out.push(numField('Feder kx', sup, 'kx', { unit: 'kN/m', min: 0, onChange: ch }), numField('Feder ky', sup, 'ky', { unit: 'kN/m', min: 0, onChange: ch }), numField('Drehfeder kφ', sup, 'kr', { unit: 'kNm/rad', min: 0, onChange: ch }));
  }
  // Knotenlasten des aktiven Lastfalls
  const lc = p.loadCases[p.activeLC];
  if (lc) {
    out.push(h('div', { class: 'ed-sub' }, 'Knotenlasten', h('span', { class: 'muted small' }, ` · ${lcLabel(p)}`)));
    lc.nodal.forEach((l, k) => {
      if (l.node !== i + 1) return;
      out.push(h('div', { class: 'ed-load' },
        h('div', { class: 'grid3' }, numField('Fx →', l, 'fx', { unit: 'kN', onChange: ch }), numField('Fy ↑', l, 'fy', { unit: 'kN', onChange: ch }), numField('M ↺', l, 'm', { unit: 'kNm', onChange: ch })),
        button('', { icon: 'trash', small: true, ghost: true, title: 'Last entfernen', onClick: () => { lc.nodal.splice(k, 1); ch(); app.editor.refreshPanel(true); } })));
    });
    out.push(button('Knotenlast', { icon: 'plus', small: true, onClick: () => { lc.nodal.push({ node: i + 1, fx: 0, fy: -10, m: 0 }); ch(); app.editor.refreshPanel(true); } }));
  }
  // Ergebnisse
  const res = currentResult(app);
  if (res?.disp?.[i]) {
    const d = res.disp[i];
    const r = res.reactions.find((q) => q.node === i);
    out.push(h('div', { class: 'ed-sub' }, 'Ergebnisse', h('span', { class: 'muted small' }, ` · ${app.viewOpts.case?.startsWith('co:') ? 'Kombination' : 'Lastfall'}`)));
    out.push(kvTable([
      ['Verschiebung ux', d[0] * 1000, 'mm', 2], ['Verschiebung uy', d[1] * 1000, 'mm', 2], ['Verdrehung φ', d[2] * 1000, 'mrad', 3],
      r ? ['Auflager Rx / Ry', `${fmt(r.Rx, 1)} / ${fmt(r.Ry, 1)}`, 'kN'] : null,
      r && Math.abs(r.M) > 1e-9 ? ['Einspannmoment', r.M, 'kNm', 1] : null,
    ]));
  }
  return { title: `Knoten ${i + 1}`, content: out };
}

function sectionEditor(app, s, idx) {
  const p = app.project;
  const ch = () => { app.changed({ inputs: true }); app.editor.refreshPanel(true); };
  const users = p.members.filter((m) => m.sec === idx + 1).length;
  const f = [
    selectField('Material', s, 'mat', MATERIALS.map((m) => ({ value: m.id, label: m.label })), { wide: true, onChange: ch, info: 'Bestimmt E-Modul und Raumgewicht (Eigengewicht).' }),
    selectField('Form', s, 'type', SECTION_TYPES, { wide: true, onChange: ch }),
  ];
  if (s.type === 'rect') f.push(h('div', { class: 'grid2' }, numField('b', s, 'b', { unit: 'mm', min: 1, onChange: ch }), numField('h', s, 'h', { unit: 'mm', min: 1, onChange: ch, info: 'Höhe in der Tragwerksebene.' })));
  if (s.type === 'circle') f.push(numField('Durchmesser', s, 'd', { unit: 'mm', min: 1, onChange: ch }));
  if (s.type === 'profile') f.push(selectField('Profil', s, 'profile', Object.keys(PROFILES), { wide: true, onChange: ch }));
  if (s.type === 'values') f.push(h('div', { class: 'grid2' }, numField('A', s, 'A', { unit: 'cm²', min: 0, onChange: ch }), numField('I', s, 'I', { unit: 'cm⁴', min: 0, onChange: ch })));
  if (s.mat === 'custom') f.push(h('div', { class: 'grid2' }, numField('E', s, 'E', { unit: 'MPa', min: 1, onChange: ch }), numField('γ', s, 'gamma', { unit: 'kN/m³', min: 0, onChange: ch })));
  try {
    const sp = sectionProps(s);
    f.push(h('div', { class: 'muted small' }, `A = ${fmt(sp.A * 1e4, 1)} cm² · I = ${fmt(sp.I * 1e8, 0)} cm⁴ · E = ${fmt(sp.E / 1000, 0)} MPa · g₀ = ${fmt(sp.gamma * sp.A, 2)} kN/m`));
  } catch { /* unvollständig */ }
  if (users > 1) f.push(h('div', { class: 'muted small' }, `Gilt für ${users} Stäbe mit Querschnitt «${s.name}».`));
  return f;
}

function inspectMember(app, k) {
  const p = app.project;
  const m = p.members[k];
  const ch = () => app.changed({ inputs: true });
  const L = memberLen(p, m);
  const secOpts = [...p.sections.map((s, i) => ({ value: i + 1, label: `${s.name} (${sectionLabel(s)})` })), { value: 0, label: '+ Neuer Querschnitt …' }];
  const out = [
    h('div', { class: 'muted small' }, `Knoten ${m.i} → ${m.j} · L = ${fmt(L, 3)} m`),
    selectField('Querschnitt', m, 'sec', secOpts, {
      wide: true, info: 'Querschnitt dieses Stabes. Änderungen an Material und Abmessungen gelten für alle Stäbe mit diesem Querschnitt.',
      onChange: (v) => {
        if (v === 0) {
          const base = p.sections[(p.activeSec || 1) - 1] || DEFAULT_SECTION;
          p.sections.push({ ...base, name: `Querschnitt ${p.sections.length + 1}` });
          m.sec = p.sections.length;
        }
        p.activeSec = m.sec;
        ch(); app.editor.refreshPanel(true);
      },
    }),
  ];
  const s = p.sections[m.sec - 1];
  if (s) {
    out.push(h('details', { class: 'ed-details', open: true }, h('summary', {}, `Querschnitt «${s.name}» bearbeiten`), textField('Name', s, 'name', { onChange: () => { ch(); app.editor.refreshPanel(true); } }), ...sectionEditor(app, s, m.sec - 1)));
  }
  out.push(h('div', { class: 'grid2' },
    checkField('Gelenk Anfang', m, 'hi', { onChange: ch, info: 'Momentengelenk am Knoten i.' }),
    checkField('Gelenk Ende', m, 'hj', { onChange: ch, info: 'Momentengelenk am Knoten j.' })));
  // Lasten
  const lc = p.loadCases[p.activeLC];
  if (lc) {
    out.push(lcSelect(app));
    lc.dist.forEach((l, q) => {
      if (l.member !== k + 1) return;
      out.push(h('div', { class: 'ed-load' },
        h('div', {},
          selectField('Streckenlast', l, 'dir', LOAD_DIRS, { wide: true, onChange: ch }),
          h('div', { class: 'grid2' }, numField('q Anfang', l, 'q1', { unit: 'kN/m', onChange: ch }), numField('q Ende', l, 'q2', { unit: 'kN/m', allowEmpty: true, onChange: ch, info: 'Leer = konstant' }))),
        button('', { icon: 'trash', small: true, ghost: true, title: 'Last entfernen', onClick: () => { lc.dist.splice(q, 1); ch(); app.editor.refreshPanel(true); } })));
    });
    lc.point.forEach((l, q) => {
      if (l.member !== k + 1) return;
      out.push(h('div', { class: 'ed-load' },
        h('div', {},
          selectField('Einzellast', l, 'dir', LOAD_DIRS.filter((d) => d.value !== 'gp'), { wide: true, onChange: ch }),
          h('div', { class: 'grid2' }, numField('P', l, 'P', { unit: 'kN', onChange: ch }), numField('a', l, 'a', { unit: 'm', min: 0, max: L, onChange: ch, info: 'Abstand vom Anfangsknoten.' }))),
        button('', { icon: 'trash', small: true, ghost: true, title: 'Last entfernen', onClick: () => { lc.point.splice(q, 1); ch(); app.editor.refreshPanel(true); } })));
    });
    out.push(h('div', { class: 'row' },
      button('Streckenlast', { icon: 'plus', small: true, onClick: () => { lc.dist.push({ member: k + 1, dir: 'g', q1: 10, q2: null, a: null, b: null }); ch(); app.editor.refreshPanel(true); } }),
      button('Einzellast', { icon: 'plus', small: true, onClick: () => { lc.point.push({ member: k + 1, dir: 'g', P: 10, a: Math.round(L / 2 * 100) / 100, m: 0 }); ch(); app.editor.refreshPanel(true); } })));
  }
  // Ergebnisse dieses Stabes
  const res = currentResult(app);
  const mr = res?.members?.[k];
  if (mr) {
    out.push(h('div', { class: 'ed-sub' }, 'Schnittgrössen'));
    out.push(kvTable([
      ['M max / min', `${fmt(mr.M.max, 1)} / ${fmt(mr.M.min, 1)}`, 'kNm'],
      ['V max / min', `${fmt(mr.V.max, 1)} / ${fmt(mr.V.min, 1)}`, 'kN'],
      ['N max / min', `${fmt(mr.N.max, 1)} / ${fmt(mr.N.min, 1)}`, 'kN'],
      ['Verschiebung max', mr.uMax * 1000, 'mm', 1],
    ]));
  }
  return { title: `Stab ${k + 1}`, content: out };
}

function inspectMulti(app, ids) {
  const p = app.project;
  const mems = ids.map(parse).filter((x) => x.t === 'm' && p.members[x.i]).map((x) => x.i);
  const nodes = ids.map(parse).filter((x) => x.t === 'n').length;
  const out = [h('div', { class: 'muted small' }, `${mems.length} Stäbe, ${nodes} Knoten ausgewählt`)];
  if (mems.length) {
    const tmp = { sec: p.members[mems[0]].sec };
    out.push(selectField('Querschnitt für alle', tmp, 'sec', p.sections.map((s, i) => ({ value: i + 1, label: `${s.name} (${sectionLabel(s)})` })), {
      wide: true, onChange: (v) => { for (const k of mems) p.members[k].sec = v; app.changed({ inputs: true }); },
    }));
    const lc = p.loadCases[p.activeLC];
    if (lc) out.push(lcSelect(app), button('Streckenlast auf alle', { icon: 'plus', small: true, onClick: () => { for (const k of mems) lc.dist.push({ member: k + 1, dir: 'g', q1: 10, q2: null, a: null, b: null }); app.changed({ inputs: true }); app.editor.refreshPanel(true); } }));
  }
  out.push(note('Ziehen verschiebt alle gewählten Elemente, Entf löscht sie.'));
  void badge;
  return { title: `${ids.length} Elemente`, content: out };
}

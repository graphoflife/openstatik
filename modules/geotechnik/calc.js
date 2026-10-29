// Rechenkern Geotechnik: Verteilung auf die Analysearten (DOM-frei, in Node testbar)
import { makeSoil, normPreset } from './soil.js';
import { earthPressureProfile } from './earthpressure.js';
import { footingAnalysis } from './bearing.js';
import { settlementAnalysis } from './settlement.js';
import { slopeAnalysis } from './slope.js';
import { wallAnalysis } from './wall.js';

export const ANALYSES = [
  { id: 'erddruck', label: 'Erddruck', short: 'Erddruck', desc: 'Erddruckverteilung auf eine Wand (aktiv, Ruhedruck, Erdwiderstand)' },
  { id: 'grundbruch', label: 'Grundbruch', short: 'Grundbruch', desc: 'Tragwiderstand, Gleiten und Ausmittigkeit einer Flachfundation' },
  { id: 'setzung', label: 'Setzung', short: 'Setzung', desc: 'Spannungsausbreitung und Setzung unter einem Fundament' },
  { id: 'boeschung', label: 'Böschung', short: 'Böschung', desc: 'Gleitkreisverfahren nach Bishop mit automatischer Suche' },
  { id: 'stuetzmauer', label: 'Stützmauer', short: 'Stützmauer', desc: 'Winkelstützmauer: Gleiten, Kippen, Grundbruch, Schnittkräfte' },
];

/**
 * Unvollständige Eingabe (z.B. leeres Projekt): wird vom Rahmen als freundlicher Hinweis statt als Fehler
 * angezeigt (gleiche Schnittstelle wie IncompleteInput in js/core/app.js, hier DOM-frei).
 */
export class IncompleteInput extends Error {
  constructor(msg, hint) { super(msg); this.incomplete = true; this.hint = hint; }
}

/** Prüft, ob die wesentlichen Eingaben der gewählten Analyse vorhanden sind. */
export function checkComplete(project) {
  const type = project.analysis || 'erddruck';
  if (!(project.soil?.soils?.length || project.soil?.layers?.length)) throw new IncompleteInput('Es ist noch keine Bodenart definiert.', 'Im Register «Baugrund» unter «Bodenarten» eine Bodenart hinzufügen.');
  const pos = (v) => Number(v) > 0;
  if (type === 'erddruck' && !pos(project.ep?.H)) {
    throw new IncompleteInput('Noch keine Wand definiert.', 'Werkzeug «Wand» (Taste N) wählen und Wandkopf und Wandfuss in der Grafik anklicken – oder die Wandhöhe H im Register «Analyse» eingeben.');
  }
  if (type === 'grundbruch' || type === 'setzung') {
    const f = type === 'grundbruch' ? project.bc : project.st;
    if (!pos(f?.B) || (f.shape === 'rect' && !pos(f.L))) throw new IncompleteInput('Noch kein Fundament definiert.', 'Werkzeug «Fundament» (Taste F) wählen und zwei gegenüberliegende Ecken im Schnitt anklicken – oder Breite und Länge im Register «Analyse» eingeben.');
    if (type === 'grundbruch') {
      const L = f.loads || {};
      const any = ['G', 'Q'].some((k) => ['V', 'HB', 'HL', 'MB', 'ML'].some((c) => Number(L[k]?.[c]) !== 0 && Number.isFinite(Number(L[k]?.[c]))));
      if (!any) throw new IncompleteInput('Noch keine Lasten auf dem Fundament.', 'Die Stütze bzw. das Fundament in der Grafik anklicken und im Eigenschaftsfenster die charakteristischen Lasten V, H und M (ständig G, veränderlich Q) eingeben.');
    }
    if (type === 'setzung' && !(f.loadMode === 'V' ? pos(f.V) : pos(f.p0))) throw new IncompleteInput('Noch keine setzungswirksame Last.', 'Fundament anklicken und im Eigenschaftsfenster die Sohlspannung σ₀ bzw. die Vertikalkraft V eingeben.');
  }
  if (type === 'boeschung') {
    const pts = (project.sl?.surface || []).filter((q) => Number.isFinite(Number(q.x)) && Number.isFinite(Number(q.y)));
    if (pts.length < 2) throw new IncompleteInput('Noch keine Geländelinie.', 'Werkzeug «Gelände» (Taste G) wählen und die Punkte der Geländeoberfläche anklicken (Doppelklick beendet) – oder im Register «Analyse» eine Böschung erzeugen.');
    const ys = pts.map((q) => Number(q.y));
    if (Math.max(...ys) - Math.min(...ys) < 1e-6) throw new IncompleteInput('Die Geländelinie ist noch horizontal.', 'Einen Geländepunkt nach oben oder unten ziehen, damit eine Böschung entsteht.');
  }
  if (type === 'stuetzmauer' && !pos(project.rw?.hs)) {
    throw new IncompleteInput('Noch keine Stützmauer definiert.', 'Werkzeug «Mauer» (Taste N) wählen: zuerst die Vorderkante des Fundaments unten, dann die Mauerkrone anklicken – oder die Masse im Register «Analyse» eingeben.');
  }
}

/** Wirksame Normfaktoren (Voreinstellung + Projektwerte). */
export function effectiveNorm(project) {
  const n = { ...normPreset(project.norm?.code || 'SIA'), ...(project.norm || {}) };
  for (const k of ['gPhi', 'gC', 'gCu', 'gGamma', 'gG', 'gGinf', 'gQ', 'gQslope', 'gRv', 'gRh', 'gRe', 'gRs']) {
    const v = Number(n[k]);
    if (!(v > 0)) throw new Error(`Partialfaktor ${k} muss grösser als 0 sein (Register «Nachweis»).`);
    n[k] = v;
  }
  return n;
}

/** Erddruckanalyse einer Wand mit Vergleichswerten (aktiv / Ruhedruck / passiv). */
export function earthPressureAnalysis(project, norm) {
  const ep = project.ep;
  const H = Number(ep.H);
  // Bodenprofil in der Mitte der Wandrückseite (Wandkopf bei x = −H·tan α)
  const xProf = -0.5 * (H || 0) * Math.tan((Number(ep.alpha) || 0) * Math.PI / 180) + 0.01;
  const soil = makeSoil(project.soil, { ignoreWater: !ep.water, x: xProf });
  if (!(H > 0)) throw new Error('Die Wandhöhe H muss grösser als 0 sein (Register «Wand»).');
  const base = {
    soil, zTop: 0, zBot: H, alpha: Number(ep.alpha) || 0, beta: Number(ep.beta) || 0,
    deltaMode: ep.method === 'rankine' ? 'beta' : 'ratio', passiveMethod: ep.passiveMethod || 'curved',
    dpRatio: Number(ep.dpRatio) || 0, mu: Number(ep.mu ?? 0.5), ocr: Number(ep.ocr) || 1,
    q: Number(ep.q) || 0, loads: ep.loads || [], water: !!ep.water, minPressure: !!ep.minPressure,
  };
  const prof = earthPressureProfile({ ...base, kind: ep.kind || 'active' });
  const cmp = {};
  for (const kind of ['active', 'atrest', 'passive']) {
    try { const r = kind === (ep.kind || 'active') ? prof : earthPressureProfile({ ...base, kind }); cmp[kind] = { Eh: r.Eh, hE: r.hE }; } catch { cmp[kind] = null; }
  }
  const passive = prof.kind === 'passive';
  const Ed = passive ? prof.Eh / norm.gRe : norm.gG * (prof.EhG + prof.U) + norm.gQ * prof.EhQ;
  const Mbase = prof.Eh * prof.hE + prof.U * prof.hU;
  const Mbased = passive ? Mbase / norm.gRe : norm.gG * (prof.EhG * (H - prof.zEG) + prof.U * prof.hU) + norm.gQ * prof.EhQ * (H - prof.zEQ);
  return { ...prof, cmp, Ed, Mbase, Mbased, passive };
}

export function compute(project) {
  checkComplete(project);
  const norm = effectiveNorm(project);
  const type = project.analysis || 'erddruck';
  switch (type) {
    case 'erddruck': return { type, norm, ep: earthPressureAnalysis(project, norm) };
    case 'grundbruch': return { type, norm, bc: footingAnalysis(makeSoil(project.soil), norm, project.bc) };
    case 'setzung': return { type, norm, st: settlementAnalysis(makeSoil(project.soil), project.st) };
    case 'boeschung': return { type, norm, sl: slopeAnalysis(makeSoil(project.soil), project.sl, norm) };
    case 'stuetzmauer': return { type, norm, rw: wallAnalysis(project.soil, project.rw, norm) };
    default: throw new Error(`Unbekannte Analyseart «${type}».`);
  }
}

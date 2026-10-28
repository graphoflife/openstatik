# OpenStatik – Architektur und Konventionen

OpenStatik ist eine rein statische Web-Anwendung (HTML, CSS, JavaScript-ES-Module) ohne Build-Schritt
und ohne externe Abhängigkeiten. Sie läuft direkt auf GitHub Pages oder lokal über einen beliebigen
statischen Webserver (`python3 -m http.server`). Alle Pfade sind relativ.

## Verzeichnisstruktur

```
index.html                 Startseite mit allen Modulen
favicon.svg
css/app.css                gemeinsames Design-System (Hell/Dunkel über CSS-Variablen)
js/core/                   gemeinsamer Kern
  app.js                   Anwendungsrahmen (createApp)
  ui.js                    DOM-Helfer, Formularfelder, editierbare Tabellen, Nachweistabellen, Dialoge, Icons
  svgview.js               Zeichenfläche mit Weltkoordinaten, Zoom/Pan, Symbolen, Legende
  chart.js                 XY-Diagramme (Interaktionsdiagramme, Verläufe …)
  colormap.js              Farbskalen für Ergebnisplots
  format.js                Zahlenformat, Zahleneingabe mit Ausdrücken ("6/2", "2,5")
  linalg.js                Gleichungslöser (dicht, Skyline-LDLᵀ), RCM, Eigenwerte, Stabilität
  materials.js             Beton, Betonstahl, Baustahl nach SIA/EC, Werkstoffgesetze
  rcsection.js             Fasermodell für Stahlbetonquerschnitte (Interaktion, M-κ, Dehnungszustand)
  report.js                druckbarer Bericht
modules/<id>/
  index.html               Einstiegsseite (lädt main.js)
  main.js                  UI-Definition für createApp
  calc.js                  Rechenkern – DOM-frei, in Node testbar (weitere Dateien nach Bedarf)
tests/<id>.test.js         Tests mit node:test (`npm test`)
```

## Module

| Modul        | Ordner                 | Inhalt                                                        |
|--------------|------------------------|---------------------------------------------------------------|
| Platte       | `modules/platte`       | FE-Berechnung von Platten (Biegung, Bemessung, Durchstanzen)  |
| Stabwerk     | `modules/stabwerk`     | Ebene Stabtragwerke, Theorie 1./2. Ordnung, Stabilität        |
| Querschnitt  | `modules/querschnitt`  | Beliebige Stahlbetonquerschnitte: Werte, Spannungen, Interaktion |
| Mauerwerk    | `modules/mauerwerk`    | Unbewehrtes Mauerwerk nach SIA 266                            |
| Stahlbau     | `modules/stahlbau`     | Stahlstäbe nach SIA 263 / EN 1993-1-1                         |
| Stütze       | `modules/stuetze`      | Stahlbetonstützen nichtlinear (Theorie 2. Ordnung)            |
| Geotechnik   | `modules/geotechnik`   | Erddruck, Grundbruch, Setzung, Böschungsstabilität, Stützmauer |

## Moduldefinition (`createApp`)

```js
import { createApp } from '../../js/core/app.js';

createApp({
  id: 'stabwerk',                       // Speicherschlüssel & Dateiendung (*.stabwerk.json)
  title: 'Stabwerk',
  subtitle: 'Ebene Stabtragwerke',
  version: 1,
  defaultProject: () => ({ … }),        // leeres/neues Projekt
  examples: [{ name, desc, project: () => ({ … }) }],   // erstes Beispiel wird beim ersten Start geladen
  inputTabs: [{ id, label, render(el, app) }],
  viewModes: [{ id, label, needsResults }] | (app) => [ … ],
  viewOptions: [{ key, label, type: 'check' | 'range' | 'select', default, … }],   // app.viewOpts[key]
  renderView(view, app, mode),          // zeichnet in SvgView; Rahmen ruft view.clear()/view.finish()
  onViewClick(x, y, app, ev),           // optional: Klick in die Grafik (Weltkoordinaten)
  autoCompute: true,                    // true → nach jeder Änderung (entprellt) rechnen
  compute(project, app) → results,      // reine Rechnung; Fehler als Error mit verständlicher Meldung
  renderResults(el, app),               // Ergebnisbereich rechts
  report(app) → [{ title, content }],   // Abschnitte des Berichts (Node | HTML-String | Array)
  intro: '<h4>So funktioniert\'s</h4><ol><li>…</li></ol>',   // Einstiegskarte über den Registern
  help: '<h3>…</h3><p>…</p>',
});
```

Wichtig im Ablauf:

* Eingabeelemente verändern `app.project` direkt und rufen danach `app.changed()` auf
  (bzw. `app.changed({ inputs: true })`, wenn der Eingabebereich neu aufgebaut werden muss).
* `app.results` enthält das Ergebnis von `compute`; `app.stale` ist `true`, wenn Eingaben geändert wurden.
* `app.viewMode`, `app.viewOpts`, `app.selection` (frei nutzbar für Hervorhebungen), `app.status(msg, kind)`.
* `app.snapshot(mode, {viewOpts})` liefert ein SVG der Grafik in einer bestimmten Darstellung (optional mit
  vorübergehend geänderten Ansichtsoptionen) für den Bericht.
* Eingaberegister werden automatisch nummeriert (Arbeitsablauf), `intro` erscheint als ausblendbare Einstiegskarte.
* Direktlinks: `?beispiel=N` lädt Beispiel N, `theme=dark|light` setzt das Farbschema, `ansicht=<viewMode>` die Darstellung.
* Speichern/Öffnen, Beispiele, Rückgängig/Wiederholen, Zwischenspeicherung, Hell/Dunkel und Bericht
  übernimmt der Rahmen.

## Gemeinsame Bausteine (Auswahl)

`ui.js`: Alle Felder, Gruppen (`group(…, {info})`) und Tabellenspalten (`{info}`) akzeptieren eine Erklärung
`info` (HTML), die als «?»-Tooltip erscheint. `emptyState(title, text)` für leere Listen. Ausserdem: `h(tag, props, …children)`, `group(title, children, {actions, collapsible})`, `numField(label, obj, key, {unit, min, max, onChange})`,
`selectField`, `checkField`, `textField`, `rangeField`, `dataTable(columns, rows, {onChange, newRow, …})`
(Excel-Einfügen, Enter-Navigation), `segmented`, `button(label, {icon, primary, small})`, `kvTable`, `resultTable`,
`checksTable([{label, ref, Ed, Rd, unit, eta}])`, `summaryCard(etaMax)`, `stats([[label, value, unit, digits]])`,
`utilBar(eta)`, `badge`, `note(text, kind)`, `toast`, `modal`, `icon(name)`.

`svgview.js` (Weltkoordinaten in m, y nach oben): `line`, `polyline`, `polygon`, `rings` (Löcher), `rect`, `circle`, `arc`
in Weltkoordinaten mit konstanter Strichstärke; `text`, `dot`, `arrow`, `momentArrow`, `support`, `hinge`, `symbol`,
`dimension` in Pixelgrösse (Bemassungen werden bei jedem Zoom neu ausgelegt); `legend` (Farbskala, oben rechts),
`keyLegend` (Zeichenerklärung, unten links), `caption`, `scaleBar` am Bildschirmrand; `setBounds(…, {noFit})`
für das Einpassen. Oben links bleibt frei für modulspezifische Legenden, die Zoomknöpfe liegen unten rechts.
Stile: `{stroke, fill, width, dash, opacity}` – Farben ausschliesslich über CSS-Variablen (`var(--c-struct)` usw.),
damit der Dunkelmodus funktioniert. Ausnahme: Farbskalen aus `colormap.js`.

`chart.js`: `xyChart({series, points, xLabel, yLabel, invertY, equal, hLines, vLines})`, `chartBox(...)`.

`rcsection.js`: `buildSection({regions, bars, mesh})`, `resultants`, `solveStrain`, `ultimatePlane`,
`capacityAtN`, `interactionNM`, `interactionMyMz`, `utilization`, `momentCurvature`, `idealProps`, `polygonProps`.
Vorzeichen: Druck negativ, `My = ∫σ·z dA` (positiv → Zug oben), für einachsige Biegung „Zug unten positiv“ gilt `M = −My`.
`utilization` skaliert das Moment bei konstantem N radial bis zum Interaktionsrand (vom Ursprung bzw., falls dieser
ausserhalb liegt, vom Schwerpunkt des Interaktionsbereichs) und liefert `η = max(η_M, η_N)`.
Werkstoffgesetze in `materials.js` haben eine Rundungstoleranz an den Grenzdehnungen; `opts.strength: 'design'`
erzwingt Bemessungsfestigkeiten auch für lineare bzw. Sargin-Gesetze.

## Konventionen

* **Sprache**: Deutsch in Schweizer Rechtschreibung (kein „ß“: „Grösse“, „Massstab“, „Schliessen“).
* **Einheiten**: Geometrie in m (Querschnittsabmessungen in der Eingabe in mm oder cm, wo üblich),
  Kräfte kN, Momente kNm, Spannungen MPa (N/mm²), Flächenlasten kN/m², Bewehrung mm² bzw. mm²/m.
  Einheiten stehen immer in der Spaltenüberschrift bzw. neben dem Feld.
* **Normen**: SIA 260–267 als Standard, Eurocode als Option, wo sinnvoll. Normbezüge (Ziffern) im Bericht angeben.
* **Rechenkern** (`calc.js` u.a.) ist DOM-frei und wird mit `node --test` gegen Handrechnungen geprüft.
* **Oberfläche**: aufgeräumt, wenige klare Farben, Ergebnisse mit Kennzahlen-Kacheln, Nachweistabellen mit
  Ausnutzungsbalken, Diagramme mit Fadenkreuz. Keine festen Farbwerte im Modulcode.
* **Haftung**: Ergebnisse ohne Gewähr; jeder Bericht enthält den entsprechenden Hinweis.

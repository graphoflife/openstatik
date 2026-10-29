// Hilfetexte des Plattenmoduls

export const INTRO = `<h4>So funktioniert's</h4>
<ol>
  <li><b>Platte</b> (U) in der Grafik zeichnen – weitere Platten mit gemeinsamen Rändern sind verbunden, eine Platte innerhalb einer anderen ändert dort die Dicke.</li>
  <li><b>Wand</b> (W) und <b>Stütze</b> (S) setzen; Platte anklicken › «Wände an freien Rändern».</li>
  <li>Lasten: <b>Flächenlast</b> (F) in eine Platte klicken, <b>Linienlast</b> (L), <b>Punktlast</b> (P). Eigengewicht und Kombinationen sind automatisch.</li>
  <li><b>Berechnen</b> (Ctrl+Enter) und oben Durchbiegung, Momente, Bewehrung und Reaktionen ansehen. Klick in die Grafik zeigt die Werte.</li>
</ol>`;

export const HELP = `
<h3>Grafisch arbeiten</h3>
<p>Die Grafik ist der Hauptarbeitsbereich: Werkzeug wählen (Taste in Klammern), Punkte anklicken oder Koordinaten tippen.
Fang an Punkten, Mitten und Schnittpunkten; <b>X/Y</b> binden an eine Achse, <b>M</b> fängt die Mitte zweier Punkte,
Shift zeichnet orthogonal. Ein Klick auf ein Element öffnet seine Eigenschaften; Ziehen verschiebt es, verbundene Punkte
(Wandenden auf Plattenecken, gemeinsame Ecken benachbarter Platten) gehen mit. Die Tabellen links bleiben synchron.</p>

<h3>Mehrere Platten</h3>
<ul>
  <li>Platten mit gemeinsamen Rändern bilden eine zusammenhängende, biegesteif verbundene Platte (z.B. Decke und Balkon mit verschiedener Dicke).</li>
  <li>Liegt eine Platte innerhalb einer anderen, gelten dort ihre Dicke und ihr Beton (Stützenkopfverstärkung, dünnerer Bereich).</li>
  <li>Eigengewicht, Steifigkeit, statische Höhe der Bemessung und Durchstanzhöhe folgen der Dicke der jeweiligen Platte.</li>
  <li>Flächenlasten wirken auf alle Platten, eine einzelne Platte (Werkzeug «Flächenlast» und Klick in die Platte) oder eine Lastfläche.</li>
  <li>Mehrere unabhängige Decken (Positionen) verwalten Sie oben links über «Decke».</li>
</ul>

<h3>Berechnungsmodell</h3>
<p>Die Platten werden als schubstarre Kirchhoff-Platten mit stückweise konstanter Dicke und linear-elastischem, ungerissenem Beton
(E = E<sub>cm</sub>) mit der Methode der finiten Elemente berechnet. Element: <b>DKT</b> (Discrete Kirchhoff Triangle,
Batoz/Bathe/Ho 1980) mit drei Freiheitsgraden je Knoten (w, θx, θy). Das Dreiecksnetz wird automatisch erzeugt
(Delaunay-Triangulierung); Plattenrand, Öffnungen, Wände, Linienlasten und Ränder von Lastflächen werden exakt
abgebildet, Stützen und Punktlasten liegen auf Netzknoten. Um Stützen wird das Netz abgestuft verfeinert.</p>

<h3>Vorzeichen und Bezeichnungen</h3>
<ul>
  <li><b>x, y</b>: Koordinaten in der Plattenebene [m]; Lasten und Durchbiegung <b>w</b> positiv nach unten.</li>
  <li><b>m<sub>x</sub></b>: Moment, das Spannungen in x-Richtung erzeugt (massgebend für die Bewehrung in x-Richtung).
      Positiv = Zug an der Plattenunterseite. Analog <b>m<sub>y</sub></b>.</li>
  <li><b>m<sub>xy</sub></b>: Drillmoment. <b>m<sub>1</sub>, m<sub>2</sub></b>: Hauptmomente (m<sub>1</sub> ≥ m<sub>2</sub>).</li>
  <li>Auflagerkräfte positiv = Druck auf das Lager. Linienlager: Verlauf in kN/m.</li>
</ul>

<h3>Werkzeuge</h3>
<ul>
  <li><b>Platte</b> (U, Polygon), <b>Öffnung</b> (O, Rechteck), <b>Stütze</b> (S), <b>Wand</b> (W, Linienzug),
      <b>Flächenlast</b> (F, Klick in eine Platte oder Lastfläche), <b>Lastfläche</b> (Z, Polygon mit Last),
      <b>Linienlast</b> (L) und <b>Punktlast</b> (P). Neue Lasten erhalten den Lastfall, der oben unter «Neue Lasten in» gewählt ist.</li>
  <li>Eigenschaftsfenster: Name, Dicke, Beton und Lasten auf der ganzen Platte bei Platten; b × h, Federn und
      Durchstanzergebnis bei Stützen; «eingespannt» und Wandkraft bei Wänden; Wert und Lastfall bei Lasten.</li>
  <li>Eine Randkante anklicken › «Punkt einfügen» erzeugt einen weiteren Eckpunkt (z.B. für eine L-Form).
      Entf löscht, C kopiert (Platten samt ihrer Lasten, Stützen, Wände, Lasten, Öffnungen).</li>
</ul>

<h3>Eingabe in Tabellen</h3>
<ul>
  <li><b>Stützen</b> mit Abmessungen b × h werden als starre Bereiche (Stützenkopf) modelliert; die Momente werden
      dadurch am Stützenrand ausgegeben. Ohne Abmessungen entsteht ein reines Punktlager mit singulärer Momentenspitze.</li>
  <li>Elastische Lagerung: Federsteifigkeit kz [kN/m]; Einspannung durch Stützen: Drehfeder kφ [kNm/rad].</li>
  <li><b>Wände</b> sind vertikal starr; «eingespannt» verhindert zusätzlich die Verdrehung um die Wandachse.</li>
  <li>Tabellen können direkt aus Excel eingefügt werden (Zellen markieren, kopieren, in die erste Zelle einfügen).</li>
  <li>Zahlenfelder akzeptieren Ausdrücke wie <code>6.5*3</code> oder <code>19.5/2</code>.</li>
</ul>

<h3>Herleitung</h3>
<p>Im Ergebnisbereich zeigt die Seite <b>Herleitung</b> den Rechenweg: Baustoffkennwerte und Plattensteifigkeit,
Lastkombinationen, Gleichgewichtskontrolle, Wood–Armer-Momente und Bewehrung am massgebenden Punkt jeder Lage,
jeden Durchstanznachweis (u, d<sub>v</sub>, k<sub>e</sub>, ψ, k<sub>r</sub>, V<sub>Rd</sub>) und den Durchbiegungsnachweis –
jeweils mit allgemeiner Formel, eingesetzten Werten und Normbezug. Die Herleitung wird auch an den Bericht angehängt.</p>

<h3>Kombinationen</h3>
<p>Automatisch nach SIA 260 bzw. EN 1990: Tragsicherheit 1.35·G + 1.5·Q<sub>1</sub> + Σ 1.5·ψ<sub>0</sub>·Q<sub>i</sub>
(jede veränderliche Last einmal als Leiteinwirkung), Gebrauchstauglichkeit quasi-ständig G + Σ ψ<sub>2</sub>·Q<sub>i</sub>.
Günstig wirkende ständige Lasten (γ<sub>G,inf</sub>) und feldweise Lastanordnungen (Schachbrett) werden nur berücksichtigt,
wenn sie über eigene Lastfälle, Lastflächen und Kombinationen von Hand definiert werden.</p>

<h3>Bemessung</h3>
<ul>
  <li>Bemessungsmomente nach <b>Wood–Armer</b> für eine orthogonale x/y-Bewehrung, oben und unten,
      als Umhüllende aller Tragsicherheitskombinationen.</li>
  <li>Erforderliche Bewehrung je Lage mit rechteckigem Spannungsblock (SIA 262: 0.85·x, EN 1992-1-1: 0.8·x),
      statische Höhen aus Überdeckung und Lagenfolge; Mindestbewehrung wahlweise.</li>
  <li><b>Durchstanzen</b> nach SIA 262:2013, 4.3.6 (Näherungsstufe 2): ψ = 1.5·(r<sub>s</sub>/d)·(f<sub>sd</sub>/E<sub>s</sub>)·(m<sub>sd</sub>/m<sub>Rd</sub>)<sup>1.5</sup>,
      k<sub>r</sub> = 1/(0.45 + 0.18·ψ·d·k<sub>g</sub>) ≤ 2, V<sub>Rd,c</sub> = k<sub>r</sub>·τ<sub>cd</sub>·d<sub>v</sub>·k<sub>e</sub>·u.
      Nachweisschnitt im Abstand d<sub>v</sub>/2 vom Stützenrand; Teile ausserhalb der Platte und im Schatten von Öffnungen
      (Abstand &lt; 5d) sind unwirksam. Rand-/Eckstützen werden automatisch erkannt (k<sub>e</sub> = 0.9 / 0.7 / 0.65;
      m<sub>sd</sub> = V<sub>d</sub>/8, /4, /2). r<sub>s</sub> = 0.22·L mit L = Abstand zum nächsten Lager in x bzw. y.
      Mit Eurocode: EN 1992-1-1, 6.4.4 (u<sub>1</sub> im Abstand 2d, β = 1.15 / 1.4 / 1.5).</li>
  <li><b>Durchbiegung</b>: w<sub>∞</sub> ≈ k·w<sub>el</sub> (quasi-ständig) im Vergleich mit L/300 (einstellbar).</li>
</ul>

<h3>Grenzen des Programms</h3>
<ul>
  <li>Linear-elastisch, ungerissen, Dicke je Platte konstant (Dickensprünge ohne Ausmittigkeit der Mittelfläche), keine Schubverformungen (dünne Platten, L/h ≳ 5),
      keine Membrankräfte, keine Lagerabhebung (Zuglager wirken mit), keine Temperatur- oder Vorspannlasten.</li>
  <li>Momente unter Punktlasten und an Punktlagern ohne Abmessungen sind singulär, d.h. netzabhängig;
      auch an einspringenden Ecken treten Spannungsspitzen auf. Für die Bemessung über Stützen sind die Werte am
      Stützenrand massgebend; eine weitergehende Momentenausrundung erfolgt nicht.</li>
  <li>Der Durchstanznachweis setzt V<sub>d</sub> gleich der Stützenkraft (ohne Abzug der Last innerhalb des Nachweisschnitts)
      und vernachlässigt Lastausmitten (e<sub>u</sub> = 0, vereinfachte k<sub>e</sub>-Werte). Bemessung der Durchstanzbewehrung ist nicht enthalten.</li>
  <li>Die Querkraftbemessung der Platte, Rissbreiten und eine nichtlineare Durchbiegungsberechnung sind nicht enthalten.</li>
</ul>
<p class="muted small">Die Ergebnisse sind ohne Gewähr und von einer fachkundigen Person zu prüfen.</p>
`;

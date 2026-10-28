// Hilfetexte des Plattenmoduls

export const INTRO = `<h4>So funktioniert's</h4>
<ol>
  <li><b>Geometrie</b>: Plattenrand (oder «Rechteck …»), Öffnungen, Dicke und Beton festlegen.</li>
  <li><b>Lager</b>: Stützen (auch als Raster) und Wände eingeben.</li>
  <li><b>Lasten</b>: Lastfälle anlegen und Flächen-, Linien- oder Punktlasten zuordnen. Das Eigengewicht ist automatisch dabei, die Kombinationen nach SIA 260 entstehen von selbst.</li>
  <li><b>Berechnen</b> (Ctrl+Enter), dann oben in der Grafik Durchbiegung, Momente, Bewehrung und Reaktionen ansehen. Ein Klick in die Grafik zeigt die Werte an dieser Stelle.</li>
</ol>`;

export const HELP = `
<h3>Berechnungsmodell</h3>
<p>Die Platte wird als schubstarre Kirchhoff-Platte mit konstanter Dicke und linear-elastischem, ungerissenem Beton
(E = E<sub>cm</sub>) mit der Methode der finiten Elemente berechnet. Element: <b>DKT</b> (Discrete Kirchhoff Triangle,
Batoz/Bathe/Ho 1980) mit drei Freiheitsgraden je Knoten (w, θx, θy). Das Dreiecksnetz wird automatisch erzeugt
(Delaunay-Triangulierung); Plattenrand, Öffnungen, Wände, Linienlasten und Ränder von Lastflächen werden exakt
abgebildet, Stützen und Punktlasten liegen auf Netzknoten. Um Stützen wird das Netz abgestuft verfeinert.</p>

<h3>Vorzeichen und Bezeichnungen</h3>
<ul>
  <li><b>x, y</b>: Koordinaten in der Plattenebene [m]; Lasten und Durchbiegung <b>w</b> positiv nach unten.</li>
  <li><b>mx</b>: Moment, das Spannungen in x-Richtung erzeugt (massgebend für die Bewehrung in x-Richtung).
      Positiv = Zug an der Plattenunterseite. Analog <b>my</b>.</li>
  <li><b>mxy</b>: Drillmoment. <b>m₁, m₂</b>: Hauptmomente (m₁ ≥ m₂).</li>
  <li>Auflagerkräfte positiv = Druck auf das Lager. Linienlager: Verlauf in kN/m.</li>
</ul>

<h3>Eingabe</h3>
<ul>
  <li><b>Stützen</b> mit Abmessungen b × h werden als starre Bereiche (Stützenkopf) modelliert; die Momente werden
      dadurch am Stützenrand ausgegeben. Ohne Abmessungen entsteht ein reines Punktlager mit singulärer Momentenspitze.</li>
  <li>Elastische Lagerung: Federsteifigkeit kz [kN/m]; Einspannung durch Stützen: Drehfeder kφ [kNm/rad].</li>
  <li><b>Wände</b> sind vertikal starr; «eingespannt» verhindert zusätzlich die Verdrehung um die Wandachse.</li>
  <li>Tabellen können direkt aus Excel eingefügt werden (Zellen markieren, kopieren, in die erste Zelle einfügen).</li>
  <li>Zahlenfelder akzeptieren Ausdrücke wie <code>6.5*3</code> oder <code>19.5/2</code>.</li>
</ul>

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
  <li>Linear-elastisch, ungerissen, konstante Dicke, keine Schubverformungen (dünne Platten, L/h ≳ 5),
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

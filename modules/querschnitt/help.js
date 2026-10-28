// Querschnitt – Kurzanleitung und Hilfe (HTML)

export const INTRO = `<h4>So funktioniert's</h4>
<ol>
  <li><b>Querschnitt zeichnen</b>: oben <b>Rechteck</b> (Taste Q) wählen und zwei Ecken anklicken – oder <b>Polygon</b> (U) für beliebige Formen. Vorlagen wie Plattenbalken oder Kreis im Register «Querschnitt»; Aussparungen mit <b>Öffnung</b> (O) und <b>Hüllrohr</b> (H).</li>
  <li><b>Bewehrung setzen</b>: <b>Stab</b> (B), <b>Stabreihe</b> (L) oder <b>Stabkreis</b> (K). Die Fangpunkte ○ liegen im Achsabstand c + Øw + Ø/2 vom Rand.</li>
  <li><b>Anklicken</b> öffnet das Eigenschaftsfenster (Abmessungen, Beton, Ø, Anzahl, Dehnung und Spannung eines Stabs); <b>Ziehen</b> verschiebt Eckpunkte, Stäbe und Aussparungen.</li>
  <li><b>Lastfall</b> im Register «Lasten» erfassen. Rechts stehen Ausnutzung, Interaktion und M–κ, unter <b>Herleitung</b> der Rechenweg mit Normbezügen. Die Register links bleiben als Alternative zur Grafik.</li>
</ol>`;

export const HELP = `
<h3>Koordinaten und Vorzeichen</h3>
<ul>
  <li>Koordinaten <b>y nach rechts, z nach oben</b>, Eingabe in <b>mm</b>. Vorlagen liegen mit der Unterkante auf z = 0 und sind zur z-Achse zentriert; Kreis und Kreisring haben den Mittelpunkt im Ursprung, der L-Winkel die äussere Ecke.</li>
  <li><b>N &gt; 0 Zug</b>, N &lt; 0 Druck.</li>
  <li><b>My &gt; 0 erzeugt Zug unten</b> (Biegung um die y-Achse, «Feldmoment»), <b>Mz &gt; 0 erzeugt Zug rechts</b> (Biegung um die z-Achse).</li>
  <li>Die Schnittgrössen wirken im <b>Bezugspunkt</b> (Standard: Schwerpunkt des Betonbruttoquerschnitts; wählbar im Register «Nachweise»). Intern wird stets auf den Betonschwerpunkt umgerechnet – die Ausnutzung hängt deshalb nicht von der Wahl des Bezugspunkts ab; Widerstände und Diagramme werden wieder auf den Bezugspunkt bezogen ausgegeben.</li>
  <li>Dehnungen und Spannungen: Druck negativ (blau), Zug positiv (rosé).</li>
</ul>
<h3>Berechnungsverfahren</h3>
<ul>
  <li><b>Fasermodell</b>: Der Beton wird in rund 2000 Dreiecksfasern zerlegt, jeder Stab ist eine Punktfaser (die Betonfläche an der Stabstelle wird abgezogen). Es gilt das Ebenbleiben der Querschnitte bei starrem Verbund: ε(y, z) = ε₀ + ∂ε/∂y·y + ∂ε/∂z·z.</li>
  <li><b>Beton</b>: Parabel-Rechteck-Diagramm mit fcd (SIA 262 4.2.1 bzw. EN 1992-1-1 3.1.7), εc2 = 2 ‰, εcu = 3 ‰ (SIA) bzw. 3.5 ‰ (EC bis C50/60), ohne Zugfestigkeit. <b>Betonstahl</b>: bilinear mit fsd, wahlweise mit Verfestigung, Bruchdehnung εud.</li>
  <li><b>Tragwiderstand (GZT)</b>: Bruchdehnungsebenen nach der <b>Pivot-Methode</b> (Drehpunkte εud im Stahl, εcu am Druckrand, εc2 im Inneren bei zentrischem Druck). Die Ausnutzung ist η = max(η<sub>M</sub>, η<sub>N</sub>): η<sub>M</sub> ist das Verhältnis der Momente zum Interaktionsrand bei <b>gleicher Normalkraft</b> und gleicher Momentenrichtung (My-Mz-Diagramm), η<sub>N</sub> = N/NRd das Verhältnis zum zentrischen Widerstand. Liegt der Bezugspunkt bei diesem N ausserhalb des My-Mz-Bereichs (stark exzentrischer Bezugspunkt), werden die Momente vom Schwerpunkt des Bereichs aus gesteigert.</li>
  <li><b>Dehnungszustand unter Bemessungslasten</b>: Newton-Verfahren auf der Dehnungsebene mit denselben Werkstoffgesetzen.</li>
  <li><b>Gebrauchstauglichkeit (GZG)</b>: linear-elastisch im gerissenen Zustand (Beton ohne Zug, Ec,eff = Es/n). Die Wertigkeit n ist standardmässig Es·(1+φ)/Ecm. Nachweis der Stahlspannung nach SIA 262 4.4.2 (σs,adm abhängig von den Anforderungen und dem Stababstand – <b>Näherung der Kurven von Fig. 31</b>, gerundete Ablesewerte; bitte mit der Norm vergleichen oder σs,adm manuell vorgeben) bzw. EN 1992-1-1 7.2 (σs ≤ 0.8 fyk, |σc| ≤ 0.6 fck).</li>
  <li><b>M–κ</b>: Krümmung schrittweise gesteigert, Normalkraft konstant; Bruch, wenn εcu im Beton oder εud im Stahl erreicht wird (exakt durch Bisektion). Mittelwerte: fcm mit Zugfestigkeit fctm bis zur Rissbildung und Stahl fsk mit Verfestigung; Kriechen über Streckung der Betondehnungen um (1+φ).</li>
  <li><b>Querkraft</b> (optional): SIA 262 4.3.3 – VRd,s = (Asw/s)·z·fsd·cot α, VRd,c = bw·z·kc·fcd·sin α·cos α mit kc = 0.55; ohne Querkraftbewehrung VRd = kd·τcd·d·bw mit kd = 1/(1 + εv·d·kg). EN 1992-1-1 6.2.2/6.2.3 als Option. bw, d und z werden automatisch aus dem Querschnitt bestimmt und können überschrieben werden.</li>
</ul>
<h3>Grafische Bearbeitung</h3>
<ul>
  <li>Die Grafik arbeitet in <b>mm</b>; Koordinaten lassen sich beim Zeichnen auch tippen (relativ, absolut oder Länge/Winkel). <b>Y</b>/<b>Z</b> binden an eine Achse, <b>M</b> nimmt die Mitte zweier Punkte, <b>Esc</b> geht schrittweise zurück.</li>
  <li><b>Polygon</b> (U) und <b>Rechteck</b> (Q) zeichnen den Betonumriss und ersetzen einen bestehenden. Ein zur z-Achse symmetrisches Rechteck auf z = 0 wird als Vorlage «Rechteck» gespeichert (Masse im Fenster änderbar).</li>
  <li><b>Öffnung</b> (O) zeichnet eine polygonale Aussparung, <b>Hüllrohr</b> (H) eine kreisförmige mit Ø im Eigenschaftsfenster.</li>
  <li><b>Stab</b> (B) setzt Einzelstäbe mit dem Ø, das im Eigenschaftsfenster ohne Auswahl eingestellt ist. <b>Stabreihe</b> (L) verteilt Stäbe zwischen dem ersten und dem letzten Stab, <b>Stabkreis</b> (K) auf einem Kreis (Mittelpunkt, dann erster Stab); die Anzahl lässt sich danach im Eigenschaftsfenster ändern.</li>
  <li>Fangpunkte ○: Schwerpunkt, Hüllrohrmitten und die Ecken im Achsabstand a = c + Øw + Ø/2 vom Rand (c und Øw im Fenster ohne Auswahl).</li>
  <li><b>Vorlagen</b> (Plattenbalken, Hohlkasten …) bleiben parametrisch, solange nur ihre Masse geändert werden. Das Ziehen eines Eckpunkts oder einer Kante wandelt sie automatisch in «Polygon frei» um (Hinweis in der Statuszeile, Rückgängig mit Ctrl+Z). Eine Kante anklicken → «Punkt in der Mitte einfügen».</li>
  <li><b>Löschen</b> (Entf): Stäbe, Aussparungen, Eckpunkte oder der ganze Beton (die Bewehrung bleibt erhalten). <b>Kopieren</b> (C) gilt für Stäbe und Aussparungen.</li>
  <li>In den Darstellungen «Dehnungen» und «Spannungen» zeigt ein Klick auf einen Stab dessen Dehnung, Spannung und Kraft im gewählten Lastfall.</li>
</ul>
<h3>Bedienung</h3>
<ul>
  <li>Ein neues Projekt ist leer; fertige Querschnitte gibt es oben unter «Beispiele». Solange etwas fehlt, nennt der Ergebnisbereich den nächsten Schritt.</li>
  <li>Alle Zahlenfelder akzeptieren Ausdrücke wie <code>600/2</code> oder Dezimalkomma. Tabellen lassen sich aus Excel einfügen (Spalten in der gezeigten Reihenfolge); Grafik und Tabellen sind stets synchron.</li>
  <li>Eine Zeile in der Lastfalltabelle wählt den Lastfall für Grafik und Ergebnisse. «Herleitung ›» in den Nachweisen öffnet den Rechenweg des Lastfalls.</li>
  <li>Die Berechnung läuft automatisch nach jeder Eingabe; rechenintensive Teile (M–κ, My-Mz bei GZG-Lastfällen) erst beim Öffnen des jeweiligen Registers.</li>
</ul>
<h3>Grenzen</h3>
<ul>
  <li>Reiner Querschnittsnachweis: keine Effekte nach Theorie 2. Ordnung, keine Torsion, keine Interaktion Biegung–Querkraft, keine Vorspannung.</li>
  <li>Ein Beton und ein Betonstahl pro Querschnitt; keine Mitwirkung des Betons zwischen den Rissen.</li>
  <li>Mindestbewehrung, Verankerung und konstruktive Regeln sind separat nachzuweisen.</li>
  <li>Ergebnisse ohne Gewähr – Plausibilität stets mit einer Handrechnung prüfen.</li>
</ul>`;

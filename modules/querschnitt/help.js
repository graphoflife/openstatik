// Querschnitt – Kurzanleitung, Hilfe und Hilfsfunktion für Formelzeichen in HTML-Texten

/**
 * Formelzeichen in HTML-Texten (Info-Tooltips, Hilfe) tiefstellen: f_cd → f<sub>cd</sub>, f_{c,d} → f<sub>c,d</sub>.
 * Bestehendes HTML bleibt erhalten (nur Unterstriche werden ersetzt).
 */
export function subs(html) {
  return String(html)
    .replace(/_\{([^}]*)\}/g, '<sub>$1</sub>')
    .replace(/_([\wäöüÄÖÜαβγδεζηθκλμνξρστφχψω'′]+(?:,[\wäöüαβγδεηθκλμρστφψω'′]+)*)/g, '<sub>$1</sub>');
}

export const INTRO = subs(`<h4>So funktioniert's</h4>
<ol>
  <li><b>Beton</b>: Form wählen (Register 1) oder in der Grafik <b>Rechteck</b> (Q) bzw. <b>Polygon</b> (U) zeichnen.</li>
  <li><b>Bewehrung</b>: <b>Stab</b> (B), <b>Stabreihe</b> (L), <b>Stabkreis</b> (K) – oder ganze Lagen im Register 2.</li>
  <li><b>Lastfälle</b> mit N, M_y, M_z im Register 3. Anklicken in der Grafik öffnet das Eigenschaftsfenster.</li>
  <li>Rechts: Ausnutzung, Interaktion, M–κ und die <b>Herleitung</b>. Weitere Querschnitte oben links mit <b>+</b>.</li>
</ol>`);

export const HELP = subs(`
<h3>Koordinaten und Vorzeichen</h3>
<ul>
  <li>Koordinaten <b>y nach rechts, z nach oben</b>, Eingabe in <b>mm</b>. Vorlagen liegen mit der Unterkante auf z = 0 und sind zur z-Achse zentriert; Kreis und Kreisring haben den Mittelpunkt im Ursprung, der L-Winkel die äussere Ecke.</li>
  <li><b>N &gt; 0 Zug</b>, N &lt; 0 Druck.</li>
  <li><b>M_y &gt; 0 erzeugt Zug unten</b> (Biegung um die y-Achse, «Feldmoment»), <b>M_z &gt; 0 erzeugt Zug rechts</b> (Biegung um die z-Achse).</li>
  <li>Die Schnittgrössen wirken im <b>Bezugspunkt</b> (Standard: Schwerpunkt des Betonbruttoquerschnitts; wählbar unter «Lasten → Erweitert»).</li>
  <li>Dehnungen und Spannungen: Druck negativ (blau), Zug positiv (rosé).</li>
</ul>
<h3>Mehrere Querschnitte</h3>
<ul>
  <li>Ein Projekt kann beliebig viele <b>Querschnitte</b> enthalten. Die Leiste oben links wechselt zwischen ihnen; <b>+</b> legt einen neuen, leeren Querschnitt an, das Kopiersymbol dupliziert den aktuellen (z.B. als Variante mit anderer Bewehrung). Umbenennen und Löschen im Menü der Leiste.</li>
  <li>Projektangaben und der Bericht gelten für das ganze Dokument; der Bericht beschreibt den aktiven Querschnitt.</li>
</ul>
<h3>Berechnungsverfahren</h3>
<ul>
  <li><b>Fasermodell</b>: Der Beton wird in rund 2000 Dreiecksfasern zerlegt, jeder Stab ist eine Punktfaser (die Betonfläche an der Stabstelle wird abgezogen). Es gilt das Ebenbleiben der Querschnitte bei starrem Verbund: ε(y, z) = ε_0 + κ_y·y + κ_z·z.</li>
  <li><b>Beton</b>: Parabel-Rechteck-Diagramm mit f_cd (SIA 262 4.2.1 bzw. EN 1992-1-1 3.1.7), ε_c2 = 2 ‰, ε_cu = 3 ‰ (SIA) bzw. 3.5 ‰ (EC bis C50/60), ohne Zugfestigkeit. <b>Betonstahl</b>: bilinear mit f_sd, wahlweise mit Verfestigung, Bruchdehnung ε_ud.</li>
  <li><b>Tragwiderstand (GZT)</b>: Bruchdehnungsebenen nach der <b>Pivot-Methode</b> (Drehpunkte ε_ud im Stahl, ε_cu am Druckrand, ε_c2 im Inneren bei zentrischem Druck). Die Ausnutzung η_M ist das Verhältnis der Momente zum Interaktionsrand bei <b>gleicher Normalkraft</b> und gleicher Momentenrichtung, η_N = N/N_Rd; massgebend ist η = max(η_M, η_N).</li>
  <li><b>Dehnungszustand unter Bemessungslasten</b>: Newton-Verfahren auf der Dehnungsebene mit denselben Werkstoffgesetzen.</li>
  <li><b>Gebrauchstauglichkeit (GZG)</b>: linear-elastisch im gerissenen Zustand (Beton ohne Zug, E_c,eff = E_s/n). Die Wertigkeit n ist standardmässig E_s·(1+φ)/E_cm. Nachweis der Stahlspannung nach SIA 262 4.4.2 (σ_s,adm abhängig von den Anforderungen und dem Stababstand – <b>Näherung der Kurven von Fig. 31</b>, gerundete Ablesewerte; bitte mit der Norm vergleichen oder σ_s,adm vorgeben) bzw. EN 1992-1-1 7.2 (σ_s ≤ 0.8·f_yk, |σ_c| ≤ 0.6·f_ck).</li>
  <li><b>M–κ</b>: Krümmung schrittweise gesteigert, Normalkraft konstant; Bruch, wenn ε_cu im Beton oder ε_ud im Stahl erreicht wird (exakt durch Bisektion). Mittelwerte: f_cm mit Zugfestigkeit f_ctm bis zur Rissbildung und Stahl f_sk mit Verfestigung; Kriechen über Streckung der Betondehnungen um (1+φ).</li>
  <li><b>Querkraft</b> (optional, Register «Bewehrung»): SIA 262 4.3.3 – V_Rd,s = (A_sw/s)·z·f_sd·cot α, V_Rd,c = b_w·z·k_c·f_cd·sin α·cos α mit k_c = 0.55; ohne Querkraftbewehrung V_Rd = k_d·τ_cd·d·b_w mit k_d = 1/(1 + ε_v·d·k_g). EN 1992-1-1 6.2.2/6.2.3 als Option. b_w, d und z werden automatisch aus dem Querschnitt bestimmt und können überschrieben werden.</li>
</ul>
<h3>Grafische Bearbeitung</h3>
<ul>
  <li>Die Grafik arbeitet in <b>mm</b>; Koordinaten lassen sich beim Zeichnen auch tippen (relativ, absolut oder Länge/Winkel). <b>Y</b>/<b>Z</b> binden an eine Achse, <b>M</b> nimmt die Mitte zweier Punkte, <b>Esc</b> geht schrittweise zurück.</li>
  <li><b>Polygon</b> (U) und <b>Rechteck</b> (Q) zeichnen den Betonumriss und ersetzen einen bestehenden. Ein zur z-Achse symmetrisches Rechteck auf z = 0 wird als Vorlage «Rechteck» gespeichert (Masse im Fenster änderbar).</li>
  <li><b>Öffnung</b> (O) zeichnet eine polygonale Aussparung, <b>Hüllrohr</b> (H) eine kreisförmige mit Ø im Eigenschaftsfenster.</li>
  <li><b>Stab</b> (B) setzt Einzelstäbe mit dem Ø, das im Eigenschaftsfenster ohne Auswahl eingestellt ist. <b>Stabreihe</b> (L) verteilt Stäbe zwischen dem ersten und dem letzten Stab, <b>Stabkreis</b> (K) auf einem Kreis (Mittelpunkt, dann erster Stab); die Anzahl lässt sich danach im Eigenschaftsfenster ändern.</li>
  <li>Fangpunkte ○: Schwerpunkt, Hüllrohrmitten und die Ecken im Achsabstand a = c + Ø_w + Ø/2 vom Rand (c und Ø_w im Fenster ohne Auswahl).</li>
  <li><b>Vorlagen</b> (Plattenbalken, Hohlkasten …) bleiben parametrisch, solange nur ihre Masse geändert werden. Das Ziehen eines Eckpunkts oder einer Kante wandelt sie automatisch in «Polygon frei» um (Hinweis in der Statuszeile, Rückgängig mit Ctrl+Z). Eine Kante anklicken → «Punkt in der Mitte einfügen».</li>
  <li><b>Löschen</b> (Entf): Stäbe, Aussparungen, Eckpunkte oder der ganze Beton (die Bewehrung bleibt erhalten). <b>Kopieren</b> (C) gilt für Stäbe und Aussparungen.</li>
  <li>In den Darstellungen «Dehnungen» und «Spannungen» zeigt ein Klick auf einen Stab dessen Dehnung, Spannung und Kraft im gewählten Lastfall.</li>
</ul>
<h3>Bedienung</h3>
<ul>
  <li>Ein neues Projekt ist leer; fertige Querschnitte gibt es oben unter «Beispiele» (bei bestehender Eingabe als zusätzlicher Querschnitt). Solange etwas fehlt, nennt der Ergebnisbereich den nächsten Schritt.</li>
  <li>Alle Zahlenfelder akzeptieren Ausdrücke wie <code>600/2</code> oder Dezimalkomma. Eckpunkte, Stäbe und Lastfälle lassen sich aus Excel einfügen (Spalten in der gezeigten Reihenfolge); Grafik und Tabellen sind stets synchron.</li>
  <li>Ein Lastfall in der Liste wählt ihn für Grafik und Ergebnisse. «Herleitung ›» in den Nachweisen öffnet den Rechenweg.</li>
  <li>Die Berechnung läuft automatisch nach jeder Eingabe; rechenintensive Teile (M–κ, M_y-M_z bei GZG-Lastfällen) erst beim Öffnen des jeweiligen Registers.</li>
</ul>
<h3>Grenzen</h3>
<ul>
  <li>Reiner Querschnittsnachweis: keine Effekte nach Theorie 2. Ordnung, keine Torsion, keine Interaktion Biegung–Querkraft, keine Vorspannung.</li>
  <li>Ein Beton und ein Betonstahl pro Querschnitt; keine Mitwirkung des Betons zwischen den Rissen.</li>
  <li>Mindestbewehrung, Verankerung und konstruktive Regeln sind separat nachzuweisen.</li>
  <li>Ergebnisse ohne Gewähr – Plausibilität stets mit einer Handrechnung prüfen.</li>
</ul>`);

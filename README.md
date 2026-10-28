# OpenStatik – Baustatik im Browser

OpenStatik ist eine Sammlung von Statikprogrammen für Bauingenieurinnen und Bauingenieure, die vollständig
im Browser läuft – ohne Installation, ohne Server und ohne Build-Schritt. Die Oberfläche ist deutschsprachig
(Schweizer Rechtschreibung), die Nachweise folgen den SIA-Normen 260–267 mit Eurocode-Optionen.

| Modul | Inhalt | Funktional vergleichbar mit |
|-------|--------|-----------------------------|
| **Platte** | FE-Berechnung von Decken und Bodenplatten: beliebige Grundrisse, Öffnungen, Stützen, Wände, Momente, Bewehrung (Wood–Armer), Durchstanzen | CEDRUS |
| **Stabwerk** | Ebene Rahmen, Durchlaufträger und Fachwerke, Lastfälle und Kombinationen nach SIA 260, Theorie 2. Ordnung, Verzweigungslasten | STATIK |
| **Querschnitt** | Beliebige Stahlbetonquerschnitte: Querschnittswerte, Spannungen, N-M- und My-Mz-Interaktion, Momenten-Krümmung | FAGUS |
| **Mauerwerk** | Unbewehrtes Mauerwerk nach SIA 266: Normalkraft mit Knicken, Schubwände, Teilflächenlasten | MURUS |
| **Stahlbau** | Stahlstäbe nach SIA 263 / EN 1993-1-1: Querschnittsklassen, Knicken, Biegedrillknicken, Interaktion, Profilvorschlag | AVENA |
| **Stütze** | Stahlbetonstützen nach Theorie 2. Ordnung (nichtlinear und Modellstützenverfahren) | PYRUS |
| **Geotechnik** | Erddruck, Grundbruch, Setzungen, Böschungsstabilität (Bishop), Winkelstützmauern | LARIX |

> OpenStatik ist ein unabhängiges Projekt und steht in keiner Verbindung zur cubus AG. Die Produktnamen in der
> rechten Spalte dienen nur der Einordnung des Funktionsumfangs.

## Bedienung

* Jedes Modul startet mit einem Beispiel; weitere Beispiele unter **Beispiele**.
* Die Eingabe ist in nummerierte Register gegliedert. Das **?** neben einem Feld erklärt Bedeutung, Vorzeichen und übliche Werte.
* Ergebnisse aktualisieren sich sofort; Ausnutzungsbalken zeigen, ob ein Nachweis erfüllt ist.
* **Bericht** erzeugt ein druckfertiges Dokument (Drucken → PDF oder Export als HTML).
* **Speichern** lädt die Projektdatei (`*.modul.json`) herunter, **Öffnen** lädt sie wieder. Der letzte Stand wird zusätzlich im Browser zwischengespeichert.
* Tabellen akzeptieren Einfügen aus Excel sowie Ausdrücke wie `6/2` oder `2*3,5`.
* Rückgängig/Wiederholen mit Ctrl+Z / Ctrl+Y, Hell/Dunkel über das Sonnen-/Mondsymbol.
* Direktlinks: `modules/stabwerk/?beispiel=2&theme=dark&ansicht=M` öffnet Beispiel 2 im Dunkelmodus mit Momentenlinie.

## Veröffentlichen auf GitHub Pages

1. Repository auf GitHub anlegen und den Inhalt dieses Ordners pushen.
2. Auf GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, Branch `main`, Ordner `/ (root)`.
3. Nach kurzer Zeit ist die Seite unter `https://<benutzer>.github.io/<repository>/` erreichbar.

Die Datei `.nojekyll` sorgt dafür, dass GitHub die Dateien unverändert ausliefert. Alle Pfade sind relativ,
die Seite funktioniert daher auch in einem Unterverzeichnis.

## Lokal starten

ES-Module benötigen einen Webserver (ein Doppelklick auf `index.html` genügt nicht):

```bash
python3 -m http.server 8080
```

Danach `http://localhost:8080` im Browser öffnen.

## Tests

Die Rechenkerne sind DOM-frei und werden mit Node.js (≥ 18) gegen Handrechnungen geprüft:

```bash
npm test
```

Der GitHub-Workflow `.github/workflows/tests.yml` führt die Tests bei jedem Push aus.

## Aufbau

Siehe [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md): gemeinsamer Kern in `js/core/` (Anwendungsrahmen,
Zeichenfläche, Tabellen, Diagramme, Gleichungslöser, Baustoffe, Fasermodell für Stahlbetonquerschnitte, Bericht),
ein Ordner je Modul in `modules/`, Tests in `tests/`.

## Haftungsausschluss

Die Programme werden ohne Gewähr zur Verfügung gestellt. Eingaben, Modellbildung und Ergebnisse sind von einer
fachkundigen Person zu prüfen; die Verantwortung für die Tragwerksplanung liegt bei der projektierenden Person.
Normbezüge und Tabellenwerte (z.B. Mauerwerksfestigkeiten) sind vor der Verwendung mit der gültigen Normausgabe abzugleichen.

## Lizenz

Open Source unter der [MIT-Lizenz](LICENSE): Nutzung, Änderung und Weitergabe sind frei erlaubt, solange der
Copyright-Hinweis erhalten bleibt. Die Software wird ohne jede Gewährleistung bereitgestellt (siehe Haftungsausschluss).

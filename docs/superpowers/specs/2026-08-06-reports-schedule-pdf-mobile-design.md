# Berichte, Dienstplan-PDF und kompakter Mitarbeiter-Dienstplan

## Ziel

Der Berichtsbereich muss PDF und Excel zuverlässig erzeugen. Zusätzlich soll der Dienstplan als PDF exportierbar sein. Auf dem Handy sollen Dienstpläne kompakt und ohne leere Tage dargestellt werden. Die Änderung wird ausschließlich im geschützten Zweig `fix-reports-live` entwickelt und geprüft. Es erfolgt keine Veröffentlichung ohne eine spätere ausdrückliche Freigabe.

## Umfang

### 1. Berichte

- PDF-Vorschau, PDF-Download und Excel-Download verwenden denselben geprüften Datenweg.
- Die Mitarbeiterfilterung erfolgt ausschließlich über parametrisierte SQL-Werte.
- Fehler werden intern protokolliert und im Portal mit einer verständlichen Meldung angezeigt.
- Ein leerer Zeitraum liefert eine klare Meldung, keine allgemeine Serverfehlermeldung.
- Firmenname, Telefonnummer, E-Mail und unverändertes Original-Logo werden automatisch aus den Einstellungen übernommen.

### 2. Dienstplan als PDF

- Admin, Hauptadmin und Einsatzleiter erhalten im Dienstplan die Aktion `Dienstplan als PDF`.
- Normale Mitarbeiter erhalten keinen PDF-Download.
- Das PDF enthält das unveränderte Original-Logo, Firmenname, Telefonnummer, E-Mail, ausgewählten Zeitraum, Mitarbeiter, Datum, Beginn, Ende, Pause, Einsatzort und Arbeitsbereich.
- Nur freigegebene Dienste werden ausgegeben.
- Bei fehlenden Diensten wird eine klare Meldung angezeigt.

### 3. Mitarbeiter-Dienstplan

- Mitarbeiter sehen ausschließlich ihre eigenen freigegebenen Dienste.
- Tage ohne Dienst werden nicht dargestellt.
- Bei genau einem Dienst wird nur dieser Dienst angezeigt.
- Bei mehreren Diensten werden nur die tatsächlich vorhandenen Tage in zeitlicher Reihenfolge angezeigt.
- Bearbeiten, Kopieren, Freigeben, PDF, Excel und Daten anderer Mitarbeiter bleiben gesperrt.

### 4. Mobile Darstellung

- Keine breite Sieben-Tage-Horizontalansicht für Mitarbeiter.
- Dienste erscheinen als kompakte, untereinander angeordnete Karten.
- Jede Karte zeigt Datum, Beginn–Ende, Pause, Einsatzort und Arbeitsbereich.
- Die Kartenhöhe richtet sich nach dem Inhalt und enthält keinen großen leeren Bereich.
- Admin-Dienstplankarten werden auf kleinen Bildschirmen verkleinert, ohne Bearbeitungsfunktionen zu verlieren.
- Es darf kein horizontales Überlaufen auf iPhone oder Android geben.
- Safe-Area-Abstände für Safari und installierte App bleiben erhalten.

## Architektur

- Die bestehende React-Anwendung bleibt die einzige Portaloberfläche.
- Die vorhandenen Berichts- und Dienstplandatenquellen werden weiterverwendet.
- Für Dienstplan-PDF wird eine eigene serverseitige Netlify-Funktion mit Rollenprüfung verwendet.
- PDF-Erzeugung bleibt serverseitig; der Browser erhält nur die fertige Datei.
- Mitarbeiterrechte werden sowohl in der Oberfläche als auch serverseitig geprüft.

## Fehlerbehandlung

- Datenbankfehler werden serverseitig protokolliert.
- Das Portal unterscheidet zwischen fehlenden Daten, fehlender Berechtigung, ungültigem Zeitraum und technischem Fehler.
- Ein fehlgeschlagener Download darf keine leere oder beschädigte Datei erzeugen.
- PDF- und Excel-Antworten müssen den korrekten Dateityp und Dateinamen liefern.

## Prüfung

Vor einer Freigabe müssen folgende Prüfungen erfolgreich sein:

- Bericht ohne Mitarbeiterauswahl
- Bericht mit einem ausgewählten Mitarbeiter
- Bericht mit mehreren ausgewählten Mitarbeitern
- PDF-Vorschau öffnen
- PDF herunterladen und als gültiges PDF öffnen
- Excel herunterladen und als gültige XLSX-Datei öffnen
- Dienstplan-PDF für Admin/Einsatzleiter herunterladen und öffnen
- Mitarbeiter kann Dienstplan-PDF nicht aufrufen
- Mitarbeiter sieht nur eigene freigegebene Dienste
- Leere Tage sind nicht sichtbar
- Ein einzelner Dienst wird ohne weitere Tageskarten angezeigt
- Mehrere Dienste werden chronologisch dargestellt
- iPhone-, Android- und Desktop-Prüfung ohne horizontales Überlaufen
- vollständiger Build und bestehende Rollen-, Stempel- und Datenbanktests

## Nicht im Umfang

- Keine Änderung an Farben oder Logo-Datei
- Keine Veröffentlichung
- Keine Änderung an der Stempeluhr
- Keine neuen Mitarbeiterrechte außerhalb der eigenen Dienstplanansicht
- Keine Änderung an bestehenden Produktionsdaten

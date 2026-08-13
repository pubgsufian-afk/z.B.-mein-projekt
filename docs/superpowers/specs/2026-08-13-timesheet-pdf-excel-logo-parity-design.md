# Stundenzettel PDF/Excel Logo-Parität – Design

## Ziel
PDF und Excel sollen denselben Stundenzettel-Aufbau verwenden. Das bisherige rechteckige Standardlogo mit dunklem Hintergrund darf in Exporten nicht mehr erscheinen; stattdessen wird das bereits vorhandene transparente `public/habun-logo-pdf.png` verwendet.

## PDF
Das bestehende PDF-Layout bleibt erhalten: Titel, Zeitraum, Arbeitnehmer, goldene Tabellenkopfzeile, Tageszeilen, Gesamtdauer, Anmerkungen und Firmenfooter bleiben an ihren bisherigen Stellen. Nur die Logodarstellung wird korrigiert. Beim bisherigen Standardpfad `/habun-logo.png` wird für Exporte automatisch `/habun-logo-pdf.png` verwendet. Das Logo wird als sauberes Schild ohne grauen Rechteck-Hintergrund mittig unter dem Anmerkungsbereich dargestellt.

## Excel
Excel übernimmt dieselbe visuelle Hierarchie wie das PDF: A4 Hochformat, Titel `Stundenzettel`, Zeitraum, `Arbeitnehmer`, dieselben sieben Spalten (`Datum`, `Startzeit`, `Endzeit`, `Pause`, `Dauer`, `Status`, `Tätigkeit / Einsatzort`), dieselben leeren Tageszeilen im gewählten Zeitraum, goldene Kopfzeile, `Gesamtdauer`, `Anmerkungen`, dasselbe Logo und denselben Firmenfooter. Excel bleibt editierbar, wird aber für Druck auf eine A4-Seite in der Breite angepasst.

## Logo-Regel
Wenn die Firmeneinstellungen weiterhin den alten Standard `/habun-logo.png` enthalten, nutzt der Export automatisch `/habun-logo-pdf.png`. Ein später bewusst gesetztes anderes Logo bleibt nutzbar. PDF und Excel laden dieselbe Export-Logoquelle.

## Sicherheit und Daten
Es werden weder Rechte, Anmeldung, Mitarbeiterdaten noch Berechnungsregeln geändert. Die Änderung betrifft ausschließlich Darstellung und Export.

## Tests
Ein Source-Contract prüft, dass das transparente Exportlogo verwendet wird, PDF und Excel dieselben Kernelemente enthalten, Excel im Hochformat läuft, leere Tageszeilen übernimmt und der alte Landscape/Office-Sheet-Stil nicht zurückkehrt. Danach laufen Verify, Build und E2E-Tests des Portals.
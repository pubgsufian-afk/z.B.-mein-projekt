# Standortprüfung: GPS-Genauigkeit berücksichtigen

## Problem

Mitarbeiter können sich am korrekten Einsatzort befinden und trotzdem als außerhalb erkannt werden, wenn die vom Gerät gemeldete Position innerhalb der GPS-Ungenauigkeit versetzt liegt.

## Änderung

- Der konfigurierte Einsatzradius bleibt die Grundlage.
- Die vom Gerät gemeldete GPS-Genauigkeit wird als zusätzliche Toleranz berücksichtigt.
- Diese zusätzliche Toleranz ist auf 250 Meter begrenzt, damit sehr ungenaue Standortmessungen den Einsatzradius nicht beliebig erweitern.
- Wenn eine Buchung weiterhin außerhalb liegt, zeigt die Fehlermeldung Entfernung, GPS-Genauigkeit, Einsatzradius und den effektiv erlaubten Bereich.
- Es werden keine zusätzlichen Standortabfragen eingeführt; Standort bleibt nur für Arbeitsbeginn und Arbeitsende relevant.

## Regressionstest

Ein Test deckt sowohl einen plausiblen GPS-Versatz innerhalb der Genauigkeit als auch eine extrem ungenaue Messung ab, deren Toleranz begrenzt bleiben muss.

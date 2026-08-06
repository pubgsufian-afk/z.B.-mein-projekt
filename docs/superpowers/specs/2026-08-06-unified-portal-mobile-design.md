# Einheitliches Habun-Mitarbeiterportal – verbindliches Design

Stand: 06.08.2026
Arbeitszweig: `fix/unified-portal-mobile-settings`

## Ziel

Das Habun-Mitarbeiterportal bleibt eine einzige Webseite mit einer einzigen Navigation. Die bisherige zusätzliche Oberfläche „Neue Zeiterfassung“ wird vollständig entfernt. Ihre Funktionen werden auf die vorhandenen Portalbereiche verteilt.

Das bestehende Habun-Logo sowie alle bisherigen Schwarz-Gold-Farben bleiben unverändert. Die Bedienung wird moderner, übersichtlicher und besonders auf dem Handy deutlich einfacher.

## Navigation und Bereiche

### Übersicht

Zeigt nur wichtige Informationen wie heutige Dienste, offene Anfragen, laufende Arbeitszeiten und Hinweise. Es gibt keinen zweiten Portal-Start und keinen zusätzlichen Zeiterfassungsdialog.

### Zeiterfassung

Die Zeiterfassung wird direkt im normalen Inhaltsbereich geöffnet.

- große digitale Uhr mit Stunden, Minuten und Sekunden
- heutiges Datum
- heutiger Dienst und Einsatzort
- Standortstatus
- Arbeit beginnen
- Pause beginnen
- Pause beenden
- Arbeit beenden
- heutige Buchungen
- eigene Korrektur beantragen
- keine dauerhafte Standortverfolgung

Die Oberfläche soll modern und digital wirken, aber weiterhin das bestehende Schwarz-Gold-Design verwenden.

### Dienstplan

Der Dienstplan bleibt ein eigener Portalbereich.

Desktop:

- übersichtliche Wochenansicht
- Mitarbeiter, Einsatzorte und Zeiten direkt sichtbar
- Schichten erstellen, bearbeiten, kopieren und löschen

Handy:

- keine schwer bedienbare breite Tabelle als Hauptbedienung
- Tage als einzelne Karten
- auf einen Tag tippen und Schicht hinzufügen
- einfacher Ablauf für Datum, Einsatzort, Mitarbeiter, Beginn, Ende und Pause
- mehrere Tage übernehmen
- Entwurf speichern
- Dienstplan freigeben
- Warnungen bei Doppelbelegung, Zeitüberschneidung oder fehlenden Angaben

### Mitarbeiter

- offene Registrierungen freigeben oder ablehnen
- aktive und archivierte Mitarbeiter anzeigen
- Rollen und Berechtigungen verwalten
- Mitarbeiter-ID oder Personalnummer wird nicht sichtbar angezeigt
- Auswahl erfolgt über den Namen

### Einsatzorte

- Objektname
- Adresse
- Standortkoordinaten
- erlaubter Radius für die Standortprüfung
- Einsatzorte erstellen, bearbeiten und deaktivieren

### Korrekturen

- Mitarbeiter können nur eigene Korrekturen beantragen
- Einsatzleiter, Admin und Hauptadmin können Anträge prüfen
- akzeptieren oder ablehnen
- jede Entscheidung bleibt nachvollziehbar

### Berichte

- Mitarbeiter oder mehrere Mitarbeiter auswählen
- Zeitraum auswählen
- PDF-Vorschau vor dem Download
- PDF herunterladen
- Excel herunterladen, sofern für den jeweiligen Bericht vorgesehen
- Arbeitsbeginn, Arbeitsende, Pausen, Tagesstunden und Gesamtstunden sauber darstellen

Jedes PDF enthält automatisch:

- unverändertes Firmenlogo
- Firmenname
- Telefonnummer
- E-Mail-Adresse
- Berichtszeitraum
- Erstellungsdatum

### Einstellungen

Einstellungen öffnen sich als normaler Portalbereich und dürfen nicht hängen bleiben oder eine leere Seite zeigen.

Dort werden einmal gespeichert:

- Firmenname
- Telefonnummer
- E-Mail-Adresse
- Firmenlogo

Diese Angaben werden automatisch für alle neuen PDFs verwendet. Nur Admin und Hauptadmin dürfen sie ändern.

## Rollen und Rechte

### Mitarbeiter

- eigene Zeiterfassung bedienen
- eigenen Dienstplan sehen
- eigene Zeiten sehen
- eigene Korrektur beantragen
- keine fremden Mitarbeiter, Dienstpläne, Einsatzorte oder Einstellungen ändern

### Einsatzleiter

- Dienstpläne erstellen und bearbeiten
- Mitarbeiter einteilen
- Zeiten und Korrekturen prüfen
- keine Hauptadmin-Rechte vergeben

### Admin

- zusätzlich Registrierungen freigeben oder ablehnen
- Mitarbeiter verwalten
- Einsatzorte verwalten
- Berichte erstellen
- Firmendaten in den Einstellungen verwalten

### Hauptadmin

- vollständige Kontrolle
- Rollen vergeben
- alle Adminfunktionen

## Technische Struktur

Die vorhandene React-Portaloberfläche bleibt die einzige sichtbare Anwendung. Die bisherigen Attendance-V2-Funktionen werden nicht mehr in einem modalen zweiten System gerendert, sondern als normale Komponenten in die bestehenden Bereiche eingebaut.

Die vorhandenen Serverfunktionen und Datenbanktabellen werden weiterverwendet. Sichtbare Mitarbeiter-ID-Felder werden nicht benötigt; intern bleibt die technische Benutzer-ID ausschließlich für sichere Zuordnungen erhalten.

## Fehlerbehandlung

- klare Fehlermeldungen in deutscher Sprache
- Speichern-Schaltflächen zeigen einen Ladezustand
- keine doppelte Übermittlung bei mehrfacher Betätigung
- Formulare behalten Eingaben bei vorübergehenden Fehlern
- fehlende Pflichtangaben werden direkt am Feld angezeigt
- Einstellungen und Navigation bleiben nach einem Fehler weiter bedienbar

## Prüfungen vor jeder Veröffentlichung

- Anmeldung und Abmeldung
- Registrierung
- Freigabe und Ablehnung
- alle vier Rollen
- Zeiterfassung mit Arbeitsbeginn, Pause und Arbeitsende
- Standortstatus
- Dienstplan erstellen, bearbeiten, kopieren, veröffentlichen und löschen
- mobile Dienstplanerstellung
- Einstellungen speichern und erneut laden
- PDF-Vorschau
- PDF mit Logo, Firmenname, Telefonnummer und E-Mail-Adresse
- Excel-Download
- Desktop-Browserprüfung
- iPhone-Größe
- Android-Größe
- keine zweite Portaloberfläche
- keine sichtbare Mitarbeiter-ID
- keine Veröffentlichung ohne ausdrückliche Freigabe

## Nicht enthalten

- keine Änderung der bestehenden Farben
- kein neues Logo
- keine zweite Webseite
- kein zusätzliches Zeiterfassungsfenster
- keine Veröffentlichung aus diesem Reparaturzweig ohne ausdrückliche Zustimmung

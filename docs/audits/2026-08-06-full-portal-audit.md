# Vollständige Portalprüfung – 06.08.2026

Dieser Prüfzweig dient ausschließlich der vollständigen Qualitätskontrolle. Die Hauptseite wird erst nach ausdrücklicher Freigabe geändert.

## Prüfumfang

- Login, Registrierung, Freigabe und Rollen
- Mitarbeiterrechte: Einstempeln, Pause starten/beenden, Ausstempeln und eigener Dienstplan
- Admin/Einsatzleiter: Mitarbeiter, Dienstplan, Arbeitszeiten, Berichte und Einstellungen
- Dienstplan: Erstellen, Bearbeiten, Veröffentlichen, Kopieren und mobile Darstellung
- Dienstplan-Support: ausschließlich Dienstplan lesen, erstellen, bearbeiten und freigeben
- Arbeitszeiten: Tages- und Monatsberechnung, Pausen und Zeitzone Europe/Berlin
- PDF/Excel: Berichte, Monatsdaten, Mitarbeiterauswahl, Logo und Dienstplan-PDF
- Datenschutz und Zugriffsschutz der APIs
- Mobile Darstellung auf iPhone, Android sowie Desktop
- Build, automatisierte Tests und End-to-End-Prüfung

## Zwischenstand

Der getrennte Vorschau-Build hat geräteübergreifend zwei Prüfpunkte aufgedeckt: Bericht-Downloads und die Browserprüfung des neuen Dienstplan-Supports. Die Prüfungen wurden deshalb in 33 getrennte Abläufe aufgeteilt. Zusätzlich nennt der Build jetzt jeden Quell- und Prüfschritt einzeln, falls er vor den Browsertests stoppt. Die Hauptseite blieb unverändert.

## Freigaberegel

Kein Merge und keine Veröffentlichung auf `main`, bevor alle Fehler behoben, alle Prüfungen dokumentiert und die ausdrückliche Freigabe des Auftraggebers vorliegt.

# Mitarbeiterprofile durch Hauptadmin bearbeiten

## Ziel

Im Bereich **Mitarbeiter** soll der Hauptadmin bestehende Mitarbeiterdaten direkt bearbeiten können. Der bisherige Schutz des Hauptadmin-Kontos darf nur sicherheitskritische Aktionen sperren, nicht die Bearbeitung normaler Profildaten.

## Berechtigungen

### Hauptadmin (`owner`)

- Darf bei allen aktiven Konten Profildaten bearbeiten, einschließlich des eigenen Kontos.
- Darf insbesondere **vollständigen Namen**, **Firma**, **Objekt / Einsatzort** und vorhandene interne Mitarbeiterdaten bearbeiten.
- Das eigene Hauptadmin-Konto bleibt gegen **Herabstufung**, **Deaktivierung** und **Löschung** geschützt.
- Ein Hauptadmin darf seine eigenen normalen Profildaten trotzdem speichern.

### Admin (`admin`)

- Die bestehende Rollen- und Kontoverwaltung bleibt unverändert.
- Diese Änderung erweitert nicht automatisch die Rechte eines normalen Admins auf das Hauptadmin-Konto.

### Einsatzleiter und Mitarbeiter

- Keine neuen Rechte zur Bearbeitung von Kontoprofilen.

## Oberfläche

Auf jeder Mitarbeiterkarte wird für den Hauptadmin zusätzlich eine Aktion **„Daten bearbeiten“** angeboten.

Nach dem Öffnen erscheinen editierbare Felder für die vorhandenen Profildaten. Änderungen werden erst nach **„Speichern“** übernommen. **„Abbrechen“** verwirft die Eingaben.

Beim eigenen Hauptadmin-Konto bleibt der Hinweis **„Hauptadmin ist geschützt“** nur bei Rolle/Deaktivierung bestehen; die Profilbearbeitung ist trotzdem sichtbar und nutzbar.

## Backend

Der bestehende Endpunkt `/api/registrations` erhält eine klar getrennte Verwaltungsaktion `update-profile`.

Serverregeln:

1. `owner` darf `update-profile` für aktive Konten ausführen, auch für das eigene Konto.
2. `update-profile` darf niemals die Rolle, den Aktivstatus oder die Hauptadmin-Schutzlogik verändern.
3. `update-role` und `deactivate-account` bleiben für das eigene Hauptadmin-Konto weiterhin verboten.
4. Geänderte Profildaten werden in `portal-access` gespeichert und, soweit relevant, in die Dienstplan-Mitarbeiterquelle synchronisiert.
5. Leere oder ungültige Namen werden serverseitig abgelehnt.
6. Änderungen an Login-/Authentifizierungsdaten wie Passwort werden nicht über diese Funktion vorgenommen.

## Datenkonsistenz

Wenn `fullName` oder `location` geändert werden, wird der zugehörige Dienstplan-Mitarbeiter ebenfalls aktualisiert, damit Mitarbeiterverwaltung, Dienstplan und Berichte denselben Namen bzw. Einsatzort verwenden.

## Fehlerbehandlung

- Fehlende Berechtigung: `403`.
- Nicht vorhandener oder inaktiver Benutzer: `404`.
- Ungültige Profildaten: `400`.
- Die Oberfläche zeigt die Servermeldung an und übernimmt bei einem Fehler keine unbestätigten Änderungen.

## Tests

Mindestens folgende Fälle werden automatisiert geprüft:

- Hauptadmin kann den Namen eines Mitarbeiters ändern.
- Hauptadmin kann Firma und Einsatzort eines Mitarbeiters ändern.
- Hauptadmin kann den eigenen Namen bzw. eigene Profildaten ändern.
- Hauptadmin kann die eigene Rolle weiterhin nicht herabstufen.
- Hauptadmin kann das eigene Konto weiterhin nicht deaktivieren.
- Ein normales Admin-Konto kann das Hauptadmin-Profil nicht verändern.
- Geänderter Name/Einsatzort wird in der Dienstplan-Mitarbeiterquelle synchronisiert.
- Nach erfolgreichem Speichern zeigt die Mitarbeiterkarte die neuen Daten ohne erneute Anmeldung.

## Nicht Teil dieser Änderung

- Keine Änderung am visuellen Grunddesign.
- Keine Änderung an Passwörtern oder Authentifizierungsverfahren.
- Keine Aufhebung des Schutzes gegen Herabstufung oder Deaktivierung des Hauptadmins.

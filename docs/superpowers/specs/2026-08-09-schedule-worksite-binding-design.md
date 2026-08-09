# Automatische Einsatzort-Zuordnung im Dienstplan-Assistenten

Datum: 09.08.2026

## Ziel

Automatisch veröffentlichte Schichten müssen immer mit einem im Portal gespeicherten Einsatzort und dessen echter `objectId` verknüpft werden. Der Einsatzort muss gültige Koordinaten und einen Prüfradius besitzen, damit die bestehende Standortprüfung einen Arbeitsbeginn nur innerhalb des registrierten Bereichs erlaubt. Ohne ausdrückliche Standortangabe verwendet der Assistent immer den gespeicherten Einsatzort **Abbott Laboratories GmbH**. Manuelles Eintragen im Portal bleibt unverändert.

## Standortregeln

- Fehlt im Dienstplan eine Standortangabe, verwendet der Assistent `Abbott Laboratories GmbH`.
- Normale Dienstplan-Nachrichten ohne besondere Standortmitteilung gehören vollständig zu diesem Standardstandort.
- Nennt der Nutzer für einen späteren Auftrag ausdrücklich einen anderen Standort, gilt dieser Standort für den betreffenden Dienstplan-Batch und wird ausschließlich gegen die gespeicherten Portal-Einsatzorte aufgelöst.
- Genau ein Treffer mit gültigen Koordinaten und gültigem Prüfradius übernimmt die kanonische Bezeichnung und die gespeicherte `objectId`.
- Kein Treffer oder mehrere Treffer lehnen nur die betroffene Schicht ab. Der Assistent rät nicht und speichert keinen freien Standorttext.
- Mitarbeiter-, Zeit-, Bereichs- und Pausenregeln bleiben unverändert. Eine nicht angegebene Pause bleibt weiterhin bei 0 Minuten.

## Technische Gestaltung

Der bestehende `schedule-assistant` liest zusätzlich die Einsatzorte aus dem vorhandenen Netlify-Blob-Store `portal-schedule-v2` unter `objects/`. Eine kleine, rein funktionale Standortauflösung erhält den angeforderten Namen und die gespeicherten Einsatzorte und liefert entweder einen eindeutigen, vollständig konfigurierten Treffer, `not_found`, `ambiguous` oder `unconfigured`.

Vor dem Speichern einer Schicht werden Mitarbeiter und Einsatzort unabhängig voneinander aufgelöst. Nur wenn beide eindeutig sind, erzeugt der Assistent den bestehenden `ScheduleShift`. Dabei werden `location` aus dem kanonischen Portal-Namen und `objectId` aus dem gespeicherten Einsatzort gesetzt. Es gibt keine neue Datenbankverbindung, keinen neuen öffentlichen Endpunkt und keine Änderung am verschlüsselten PR-Relay.

## Duplikatschutz

Für automatische Aufträge gilt eine zusätzliche sichere Zeitgleichheitsprüfung: Existiert für denselben Mitarbeiter bereits eine Schicht mit gleichem Datum, Beginn und Ende, wird der neue Eintrag als `duplicate` behandelt. Unterschiede bei abgekürztem Standorttext, `objectId`, Arbeitsbereich oder Pause erzeugen dann keine zweite Karte. Die bestehende manuelle Portal-Logik wird nicht verändert.

## Fehler und Rückmeldung

- Nicht registrierter oder mehrdeutiger Mitarbeiter: bestehender Ablehnungsstatus.
- Nicht gespeicherter Standort: `location_not_found`.
- Mehrdeutiger Standort: `location_ambiguous`.
- Standort ohne gültige Koordinaten oder gültigen Prüfradius: `location_unconfigured`.
- Bereits zeitgleiche Schicht: `duplicate`.
- Nicht verfügbarer Standort-Store: Auftrag wird sicher abgelehnt; es wird keine Schicht ohne Standort-ID veröffentlicht.

Der Batch verarbeitet andere gültige Schichten weiter. `published`, `duplicate` und `rejected` bleiben die öffentlichen Sammelwerte des OIDC-Relays.

## Tests und Abnahme

- Ohne Standortangabe wird `Abbott Laboratories GmbH` samt `objectId` gewählt.
- Ein ausdrücklich genannter, eindeutig gespeicherter Standort wird gewählt.
- Ein ausdrücklich für einen anderen Auftrag genannter Standort gilt für den gesamten betreffenden Batch.
- Unbekannte, mehrdeutige und nicht vollständig für die Standortprüfung konfigurierte Standorte werden abgelehnt.
- Eine Schicht ohne aufgelöste `objectId` wird nicht gespeichert.
- Die gespeicherte `objectId` bindet die vorhandene Eincheck-Prüfung an Koordinaten und Radius des registrierten Einsatzortes; die bestehende Eincheck-Logik selbst wird nicht verändert.
- Gleiche Person, gleiches Datum und gleiche Uhrzeit wird trotz abweichendem Standorttext oder Pause als Duplikat erkannt.
- Bestehende Mitarbeiterauflösung, Batch-Grenze, OIDC-Schutz und manuelles Portal bleiben unverändert.
- Repository-Verifikation, Build und E2E müssen vor dem einmaligen Production-Deploy erfolgreich sein.

## Nicht im Umfang

- Keine automatische Löschung bestehender doppelter Schichten.
- Keine Änderung der Einsatzort-Verwaltung, GPS-Koordinaten oder bestehenden Eincheck-Berechnung.
- Keine Änderung der Kostenarchitektur, Rollen, Dienstplan-Oberfläche oder manuellen Bedienung.

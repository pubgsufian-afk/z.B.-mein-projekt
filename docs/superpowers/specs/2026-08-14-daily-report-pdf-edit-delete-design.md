# Tagesbericht – PDF, Bearbeiten und Löschen

Datum: 14. August 2026  
Status: Vom Nutzer freigegebene Erweiterung des bestehenden Tagesbericht-Systems

## Ziel

Der vorhandene Admin-Bereich `Tagesbericht` wird um professionelle PDF-Exporte sowie Bearbeiten und endgültiges Löschen erweitert. Das bestehende Rollenmodell bleibt bestehen: ausschließlich `owner` und `admin` dürfen Tagesberichte verwenden. Normale Mitarbeiter und Einsatzleiter sehen den Bereich weiterhin nicht und dürfen auch serverseitig nicht darauf zugreifen.

## Berechtigungen

Für `owner` und `admin` gelten dieselben Rechte innerhalb des Tagesbericht-Systems:

- Tagesbericht schreiben
- gespeicherte Tagesberichte ansehen
- jeden Tagesbericht bearbeiten
- jeden Tagesbericht endgültig löschen
- jeden einzelnen Bericht als PDF herunterladen
- alle Berichte eines ausgewählten Tages zusammen als PDF herunterladen

`manager` und `employee` erhalten für alle Tagesbericht-Endpunkte weiterhin `403`.

## Oberfläche

Der bestehende Dialog `Berichte öffnen` wird zu einer kleinen professionellen Berichtsverwaltung erweitert.

Oben steht ein Datumsfilter. Standardmäßig ist der aktuelle Tag vorausgewählt. Daneben befindet sich der Button `Tages-PDF herunterladen`. Dieser Button ist deaktiviert, wenn für den ausgewählten Tag keine Berichte vorhanden sind.

Jeder gespeicherte Bericht zeigt weiterhin Verfasser, Erstellungsdatum, Erstellungszeit und Berichtstext. Zusätzlich erhält jeder Eintrag die Aktionen:

- `PDF`
- `Bearbeiten`
- `Löschen`

Die Oberfläche bleibt mobile-first und für iPhone optimiert. Aktionen werden als klar erkennbare Touch-Flächen dargestellt, ohne die Berichtsliste zu überladen.

## Bearbeiten

Beim Antippen von `Bearbeiten` öffnet sich der vorhandene Berichtsdialog mit dem aktuellen Text.

Es gelten dieselben Regeln wie beim Erstellen:

- Text ist Pflicht
- maximal 1.000 Wörter
- sichtbarer Wortzähler
- Speichern erst beim bewussten Antippen der Schaltfläche
- kein Autosave
- keine KI
- keine Fotos

Beim Bearbeiten bleiben folgende ursprüngliche Werte unverändert:

- `id`
- `authorId`
- `authorName`
- `createdAt`

Beim erfolgreichen Speichern werden serverseitig zusätzlich gesetzt:

- `updatedAt`
- `updatedById`
- `updatedByName`

Im UI und in der PDF wird bei einem bearbeiteten Bericht zusätzlich angezeigt:

`Zuletzt bearbeitet am TT.MM.JJJJ um HH:MM Uhr`

Die ursprüngliche Erstellungszeit bleibt weiterhin sichtbar.

## Löschen

`Löschen` ist für `owner` und `admin` erlaubt.

Vor dem Löschen erscheint eine eindeutige Sicherheitsabfrage:

`Bericht wirklich endgültig löschen?`

Erst nach Bestätigung wird der Bericht serverseitig gelöscht. Es gibt keinen Papierkorb und keine Wiederherstellung. Bei einem Fehler bleibt der Bericht bestehen und die Oberfläche zeigt eine verständliche Fehlermeldung.

## API-Erweiterung

Der vorhandene Endpunkt `/api/daily-reports` wird erweitert.

Unterstützte Methoden:

- `GET` – Berichte lesen, optional nach Datum filtern
- `POST` – neuen Bericht anlegen
- `PATCH` – bestehenden Bericht bearbeiten
- `DELETE` – bestehenden Bericht endgültig löschen

Für `PATCH` und `DELETE` wird die Bericht-ID als Query-Parameter übergeben, z. B. `/api/daily-reports?id=<report-id>`.

Alle Methoden bleiben auf `owner` und `admin` beschränkt. Schreibende Methoden prüfen zusätzlich die Anfragequelle über die bereits verwendete Netlify-Identity-Origin-Prüfung.

Der Server vertraut weder Autoren- noch Zeit-Metadaten aus dem Browser. Bei Bearbeitung werden `updatedAt`, `updatedById` und `updatedByName` ausschließlich serverseitig erzeugt.

## Speicherung und Kompatibilität

Die vorhandenen Berichte im Netlify-Blobs-Store `portal-daily-reports` müssen unverändert lesbar bleiben.

Die bestehende Schlüsselstruktur darf deshalb nicht so geändert werden, dass alte Berichte verschwinden oder migriert werden müssen. Für Bearbeiten und Löschen wird die angeforderte Bericht-ID serverseitig gegen die gespeicherten Berichte aufgelöst. Der Browser darf keinen internen Blob-Schlüssel bestimmen oder senden.

Beim Bearbeiten wird derselbe gespeicherte Bericht überschrieben; `createdAt` und ursprünglicher Autor bleiben erhalten. Beim Löschen wird ausschließlich der eindeutig gefundene Bericht entfernt.

## PDF-Export

Für PDFs wird ein separater Admin-Endpunkt `/api/daily-reports-pdf` verwendet. Dadurch bleiben JSON-Verwaltung und PDF-Erzeugung klar getrennt.

Unterstützte Exporte:

### Einzel-PDF

Aufruf mit Bericht-ID, z. B.:

`/api/daily-reports-pdf?id=<report-id>`

Die PDF enthält genau diesen Bericht.

### Tages-PDF

Aufruf mit Datum, z. B.:

`/api/daily-reports-pdf?date=2026-08-14`

Die PDF enthält alle Berichte dieses Tages in chronologischer Reihenfolge von früh nach spät.

Auch der PDF-Endpunkt ist ausschließlich für `owner` und `admin` zugänglich.

## Professionelles PDF-Layout

Die PDF wird serverseitig mit der bereits vorhandenen `pdf-lib`-Infrastruktur erzeugt. Das bestehende zentrale Firmenlogo und die vorhandenen Branding-Helfer werden wiederverwendet; es wird kein zweites Logo-System eingeführt.

Format: A4 Hochformat.

Auf jeder PDF steht oben mittig das aktuelle Firmenlogo. Darunter folgen Firmenbezeichnung und die Überschrift `Tagesbericht`.

Bei einer Einzel-PDF werden darunter sauber getrennt dargestellt:

- Datum
- Verfasser
- erstellt am und um
- falls vorhanden: zuletzt bearbeitet am und um
- Berichtstext

Bei einer Tages-PDF folgt auf die Überschrift das ausgewählte Datum. Anschließend werden alle Berichte des Tages als getrennte Abschnitte dargestellt. Jeder Abschnitt enthält Verfasser, Erstellungszeit, gegebenenfalls Bearbeitungszeit und den vollständigen Berichtstext.

Lange Texte werden automatisch umgebrochen und auf weitere Seiten verteilt. Seitenumbrüche dürfen keine Textzeilen abschneiden. Jede Seite erhält eine dezente Fußzeile mit Seitennummer, z. B. `Seite 1 von 3`.

Die Gestaltung bleibt schlicht, hochwertig und firmentauglich: klare Ränder, saubere Typografie, ausreichend Weißraum und goldene/dunkle Akzente nur dort, wo sie im PDF technisch sauber darstellbar sind.

## Dateinamen

Einzelbericht:

`Tagesbericht_YYYY-MM-DD_<Verfasser>.pdf`

Tagesübersicht:

`Tagesberichte_YYYY-MM-DD.pdf`

Dateinamen werden serverseitig bereinigt, damit Sonderzeichen keine ungültigen Downloads erzeugen.

## Download-Verhalten auf Mobilgeräten

Der Download nutzt einen echten PDF-Response mit `Content-Type: application/pdf` und `Content-Disposition: attachment`. Damit kann die Datei auf iPhone, Android und Desktop über die normale Browser-/Systemfunktion gespeichert oder geteilt werden.

## Fehlerverhalten

- nicht angemeldet → `401`
- Rolle nicht `owner` oder `admin` → `403`
- Bericht-ID fehlt oder unbekannt → `404`
- ungültiges Datum → `400`
- leerer bearbeiteter Text → `400`
- mehr als 1.000 Wörter → `400`
- Tages-PDF ohne vorhandene Berichte → `404` mit verständlicher Meldung
- PDF-Erzeugungsfehler → `500`, ohne gespeicherte Berichte zu verändern
- Löschfehler → Bericht bleibt erhalten

## Betroffene Komponenten

Voraussichtlich betroffen:

- `frontend/src/AdminOverview.jsx` – Datumsfilter, PDF-, Bearbeiten- und Löschen-Aktionen
- `frontend/src/admin-overview.css` – mobile Berichtsverwaltung und Aktionsbuttons
- `netlify/functions/daily-reports.mts` – `GET`, `POST`, `PATCH`, `DELETE`
- neue Funktion `netlify/functions/daily-reports-pdf.mts` – Einzel- und Tages-PDF
- vorhandene PDF-Helfer unter `netlify/functions/_shared/` – Wiederverwendung von Logo/Branding
- Tests für Rollen, Bearbeiten, Löschen, PDF-Antworten, Logo, Datumsfilter und mobile Bedienung

## Nicht im Umfang

Diese Erweiterung führt bewusst nicht ein:

- Papierkorb
- Wiederherstellung gelöschter Berichte
- Bilder oder Anhänge
- KI-Schreibhilfe
- automatische Speicherung während der Eingabe
- neue Rollen
- Änderungen an der normalen Zeiterfassung, Dienstplan-Logik oder den bestehenden PDF-/Excel-Berichten

## Abnahmekriterien

Die Erweiterung gilt als fertig, wenn:

1. `owner` und `admin` jeden Tagesbericht bearbeiten und endgültig löschen können.
2. `manager` und `employee` weder UI noch API dieser Funktionen verwenden können.
3. Erstellungszeit und ursprünglicher Autor beim Bearbeiten erhalten bleiben.
4. `updatedAt` serverseitig gesetzt und als `Zuletzt bearbeitet ...` angezeigt wird.
5. Löschen erst nach ausdrücklicher Bestätigung erfolgt und danach endgültig ist.
6. Jeder einzelne Bericht als professionell gestaltete PDF mit Firmenlogo heruntergeladen werden kann.
7. Alle Berichte eines ausgewählten Tages gemeinsam als professionelle PDF heruntergeladen werden können.
8. Die Tages-PDF die Berichte chronologisch ausgibt.
9. Mehrseitige PDFs Text korrekt umbrechen und Seitenzahlen enthalten.
10. Vorhandene bereits gespeicherte Tagesberichte weiterhin funktionieren.
11. Die bestehende zentrale PDF-Logo-Konfiguration verwendet wird.
12. Die komplette Portal-Test-Suite sowie neue Tagesbericht-Tests erfolgreich durchlaufen.

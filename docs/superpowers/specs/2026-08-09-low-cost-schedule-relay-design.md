# Günstiger sicherer Dienstplan-Relay

Datum: 09.08.2026

## Ziel

Das Habun-Mitarbeiterportal soll zwei gleichwertige Wege für Dienstpläne behalten:

1. Der Hauptadmin/Admin/Einsatzleiter kann Dienste weiterhin manuell im Portal eintragen und bearbeiten.
2. Der Nutzer kann ChatGPT im normalen Chat eine WhatsApp-artige Dienstplan-Nachricht oder eine Liste mit Namen, Zeiten und Arbeitsbereichen schicken. ChatGPT verarbeitet alle gültigen Dienste zusammen in einem einzigen verschlüsselten Batch-Auftrag.

Der automatische Weg darf nicht bei jedem Dienstplan einen Netlify-Production-Deploy auslösen.

## Nicht-Ziele

- Keine Änderung an der normalen manuellen Dienstplan-Bedienung im Portal.
- Keine direkte Datenbank-Schreibschnittstelle für ChatGPT.
- Kein Passwort oder dauerhaftes Hauptadmin-Login für ChatGPT.
- Keine ungeschützte öffentliche Schreib-API.
- Keine Klartext-Dienstplandaten im öffentlichen Repository.
- Keine fuzzy Namenszuordnung oder erfundene Mitarbeiter-IDs.

## Gewählter Ansatz

Der vorhandene sichere GitHub-OIDC-Relay bleibt die Vertrauensgrenze. Der bisherige teure Teil wird entfernt: Ein neuer Dienstplan wird nicht mehr als Command-Datei auf `main` gespeichert.

Stattdessen wird der komplette verschlüsselte Auftrag ausschließlich auf dem vorhandenen technischen Zweig `ops/schedule-relay` aktualisiert. Der dauerhaft offene technische PR #73 löst dadurch den vorhandenen GitHub-Actions-Workflow aus. Der Workflow führt ausschließlich den vertrauenswürdigen Relay-Code aus `main` aus, liest aber die verschlüsselte Command-Hülle vom technischen Relay-Zweig.

GitHub Actions fordert ein kurzlebiges OIDC-Token an und sendet genau einen Batch-Request an den vorhandenen Netlify-Produktions-Endpunkt. Netlify prüft weiterhin Repository, Repository-ID, Owner-ID, Workflow, Relay-PR und OIDC-Claims, entschlüsselt den Auftrag serverseitig und übergibt ihn an den bestehenden Dienstplan-Assistenten.

## Kein Deploy pro Dienstplan

Netlify erhält eine Build-Ignore-Regel für `ops/schedule-relay`. Änderungen, die nur den technischen Relay-Zweig betreffen, werden vor dem eigentlichen Build beendet. Dadurch erzeugt ein neuer Dienstplan keinen Production-Deploy und keinen Deploy-Preview-Build für diesen Zweig.

Die Einrichtung dieser Regel und der Workflow-Anpassung benötigt genau einen normalen geprüften Rollout der Portal-Konfiguration. Danach benötigen tägliche Dienstpläne keinen neuen Portal-Deploy mehr.

## Batch-Verhalten

Eine WhatsApp-artige Nachricht wird in einen Command mit einer Liste von `shifts` umgewandelt. Alle genannten Mitarbeiter werden in demselben Auftrag verarbeitet.

Beispiel logisch:

```json
{
  "shifts": [
    { "employeeName": "Aras", "date": "2026-08-10", "start": "06:00", "end": "17:00", "pauseMinutes": 0, "workArea": "ZuKo" },
    { "employeeName": "Adel", "date": "2026-08-10", "start": "07:00", "end": "17:00", "pauseMinutes": 0, "workArea": "GMB ZuKo" }
  ]
}
```

Dieser Klartext dient nur zur Beschreibung der Struktur und wird nicht ins öffentliche Repository geschrieben. Im Relay-Zweig liegt ausschließlich die bereits vorhandene RSA-OAEP/AES-GCM-verschlüsselte Envelope.

## Mitarbeiter-Zuordnung

- Vollständiger eindeutiger Name hat Priorität.
- Ein einzelner Vorname darf nur verwendet werden, wenn genau ein aktiver Mitarbeiter diesen Vornamen hat.
- Bei zwei gleichnamigen Mitarbeitern wird der Eintrag abgelehnt und nicht geraten.
- Nicht registrierte oder nicht aktive Mitarbeiter werden übersprungen/abgelehnt.
- Es werden niemals erfundene Benutzer-IDs erzeugt.

## Manuelles Eintragen

Die bestehende Portal-Oberfläche und `/api/schedule-v2` bleiben für manuelle Einträge unverändert. Manuelles und automatisches Eintragen schreiben weiterhin über die vorhandene Anwendungslogik in dieselbe Produktions-Dienstplanquelle. Dadurch können anschließend beide Wege dieselben Dienste sehen und bearbeiten.

## Duplikate und Fehler

Der vorhandene Scheduler bleibt für Duplikaterkennung, Überschneidungen und Veröffentlichung zuständig.

Nach jedem Batch wird nur die anonyme Zusammenfassung zurückgemeldet:

- Anzahl gefundener aktiver Mitarbeiter
- `publishedCount`
- `duplicateCount`
- `rejectedCount`

Ein bereits vorhandener identischer Dienst wird nicht ein zweites Mal erzeugt. Ein fehlerhafter Mitarbeiter blockiert nicht automatisch alle anderen gültigen Einträge; die Ergebnisse werden pro Eintrag ausgewertet und dem Nutzer verständlich zusammengefasst.

## Sicherheit

- OIDC-Token ist kurzlebig.
- Workflow läuft nur für den festgelegten technischen PR #73, das festgelegte Repository, den festgelegten Repository-Owner und den festgelegten Relay-Zweig.
- Der private Entschlüsselungsschlüssel bleibt ausschließlich als Netlify-Secret verfügbar.
- GitHub enthält nur verschlüsselte Dienstplandaten.
- Der Relay-Workflow führt Scripts aus `main` aus; der Relay-Zweig darf nur die verschlüsselte Envelope und den technischen Trigger liefern.
- Keine Query-String-Secrets, keine Passwortweitergabe und keine direkte Neon-Schreibberechtigung.

## Kostenmodell nach Einrichtung

Für einen normalen automatischen Dienstplan entsteht nach der Einrichtung:

1. ein GitHub-Actions-Lauf auf einem Standard-Runner;
2. ein HTTP-Request an die vorhandene Netlify-Funktion;
3. die tatsächliche Laufzeit dieser Netlify-Funktion und der bereits bestehenden Datenbankzugriffe.

Da das Repository öffentlich ist, ist der Standard-GitHub-Actions-Runner für diesen Workflow nach GitHub-Regeln kostenlos. Der große Netlify-Kostenblock eines Production-Deploys entfällt für Dienstplan-Aufträge.

Der exakte Netlify-Verbrauch hängt von der gemessenen Function-Laufzeit ab und kann deshalb nicht vorab auf die letzte Nachkommastelle garantiert werden. Das Design stellt aber sicher, dass 15 Mitarbeiter nicht 15 Deploys und auch nicht 15 einzelne Automations-Aufträge benötigen, sondern als ein Batch verarbeitet werden.

## Teststrategie

Vor dem finalen Rollout müssen folgende Punkte nachgewiesen werden:

1. Bestehende manuelle Dienstplan-Tests bleiben grün.
2. Ein Batch mit mehreren Mitarbeitern wird in einem einzigen Relay-Request verarbeitet.
3. Vollständige Namen und eindeutige Vornamen funktionieren unverändert sicher.
4. Doppelte Vornamen werden weiterhin abgelehnt.
5. Duplikate werden nicht erneut veröffentlicht.
6. OIDC lehnt falsches Repository, falschen Owner, falschen PR und falschen Relay-Zweig ab.
7. Der Workflow liest ausführbaren Code ausschließlich aus `main`.
8. Der verschlüsselte Command wird vom Relay-Zweig gelesen.
9. Ein Commit auf `ops/schedule-relay` wird von Netlify als Build ignoriert.
10. `npm run verify`, `npm run build` und die relevanten E2E-Tests sind erfolgreich.
11. Ein kontrollierter Produktions-Test mit einem Test-/Duplikat-Auftrag bestätigt, dass der Scheduler erreichbar ist, ohne einen neuen Production-Deploy für den Dienstplan selbst zu erzeugen.

## Erfolgskriterium

Nach der Einrichtung kann der Nutzer entweder selbst im Portal eintragen oder ChatGPT einen kompletten Dienstplan als normale Nachricht schicken. ChatGPT verarbeitet alle gültigen Mitarbeiter gesammelt über den sicheren OIDC-Relay. Für tägliche Dienstpläne wird kein neuer Netlify-Production-Deploy mehr benötigt.
# Günstiger Dienstplan-Batch-Relay

Datum: 09.08.2026

## Ziel

Ein kompletter Dienstplan soll weiterhin automatisch über den geschützten Dienstplan-Assistenten veröffentlicht werden können, aber ohne pro Auftrag einen Commit auf `main`, einen Relay-Branch-Commit oder einen Netlify-Deploy auszulösen. Manuelles Eintragen im Portal bleibt unverändert möglich.

## Gewählter Ablauf

1. ChatGPT erstellt aus der vom Nutzer gesendeten WhatsApp-/Text-Nachricht genau einen Dienstplan-Batch mit bis zu 100 Schichten.
2. Der Batch wird wie bisher mit dem vorhandenen RSA-/AES-Verfahren verschlüsselt. Lesbare Mitarbeiterdaten werden nicht in GitHub gespeichert.
3. Der verschlüsselte Envelope wird als speziell markierter technischer Kommentar an den dauerhaft offenen PR #73 gesendet.
4. Ein GitHub-Actions-Workflow reagiert ausschließlich auf neu erstellte Kommentare an PR #73, ausschließlich vom festen Besitzerkonto `actor_id=249184348` und ausschließlich auf das feste Envelope-Präfix.
5. Der Workflow läuft mit `contents: read` und `id-token: write`, liest den verschlüsselten Envelope aus dem Event, holt ein kurzlebiges GitHub-OIDC-Token und POSTet Envelope + OIDC-Token an die bereits vorhandene Netlify-Route `/api/schedule-oidc-trigger`.
6. Netlify prüft Signatur, Repository-ID, Owner-ID, Actor-ID, Event-Typ, Ref und Workflow-Ref. Danach wird der Envelope serverseitig entschlüsselt und über `schedule-assistant` veröffentlicht.
7. Der Assistent verarbeitet alle Schichten des Auftrags gemeinsam. Exakte Duplikate bleiben `duplicate`; fehlende oder mehrdeutige Mitarbeiter bleiben `rejected`; es wird nicht geraten.
8. Nach erfolgreicher Ausführung kann der technische Kommentar auf einen neutralen Status ohne Ciphertext reduziert werden. Das Editieren darf keinen zweiten Lauf auslösen.

## Sicherheit

- Kein Passwort oder Service-Account im Workflow.
- Kein Netlify- oder Datenbank-Secret in GitHub.
- Kein direkter Schreibzugriff von ChatGPT auf Neon.
- OIDC-Token bleibt kurzlebig.
- Nur Repository `1184469401`, Owner `249184348`, Actor `249184348`, Workflow `schedule-oidc-publish.yml`, PR #73 und der fest definierte Kommentar-Marker dürfen den Lauf starten.
- Der Netlify-Endpunkt bleibt der einzige technische Eingang; der bestehende `schedule-assistant` bleibt der einzige fachliche Writer.
- Maximal 100 Schichten pro Batch wie im bestehenden Trigger.

## Kosten-/Deploy-Verhalten

Ein normaler Dienstplan-Auftrag verändert nach dieser Umstellung keine Repository-Datei und erzeugt deshalb keinen Netlify-Production-Deploy und keinen Deploy-Preview. Netlify wird nur durch den bestehenden Function-Aufruf belastet. Die einmalige Einführung dieser Workflow-Änderung kann weiterhin einen normalen Produktions-Deploy auslösen, weil Quellcode auf `main` geändert wird.

## Manuelles Eintragen

Die bestehende Dienstplan-Oberfläche und ihre API bleiben unangetastet. Hauptadmin/Admin/Einsatzleiter können weiterhin manuell eintragen. Automatische und manuelle Einträge landen über die bestehende Scheduler-Logik in derselben Produktionsquelle und verwenden dieselbe Duplikatlogik.

## Erfolgskriterien

- Ein neuer technischer Kommentar an PR #73 startet genau einen Relay-Lauf.
- Ein bearbeiteter Kommentar startet keinen zweiten Lauf.
- Kommentare anderer Nutzer, anderer PRs oder ohne Marker starten keinen Publish-Job.
- Der Workflow braucht keine Schreibberechtigung auf Repository-Inhalte.
- Der Relay akzeptiert den Envelope aus einer Umgebungsvariable/Eventdatei und braucht keine `ops/schedule-command.envelope.json` mehr für neue Aufträge.
- OIDC-Validierung akzeptiert ausschließlich den neuen `issue_comment`-Kontext auf `refs/heads/main` und lehnt falschen Actor/Event/Ref/Workflow ab.
- Bestehende Scheduler-, Verschlüsselungs-, Duplikat- und Namenszuordnungstests bleiben grün.

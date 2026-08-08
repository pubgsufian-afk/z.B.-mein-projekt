# Sicherer OIDC-Auslöser für den Dienstplan-Assistenten

## Ziel

ChatGPT soll einen Dienstplan-Auftrag über das bestehende GitHub-Repository sicher an das Habun-Mitarbeiterportal senden können, ohne Datenbank-Direktzugriff, ohne dauerhaftes GitHub- oder Portal-Passwort und ohne einen geheimen Bearer-Token im Repository zu speichern.

Der bestehende `Dienstplan-Assistent` bleibt die einzige Komponente, die Dienste veröffentlicht. Die neue OIDC-Brücke ist nur ein sicherer Auslöser davor.

## Gewählter Ansatz

Ein GitHub-Actions-Workflow auf `main` erhält von GitHub für jeden Lauf ein kurzlebiges OIDC-Identitätstoken. Der Workflow sendet dieses Token zusammen mit dem bereits verschlüsselten Dienstplan-Envelope an eine neue geschützte Netlify-Funktion.

Die Netlify-Funktion akzeptiert nur ein gültiges GitHub-OIDC-Token mit allen folgenden Merkmalen:

- Aussteller ist GitHub Actions.
- Audience ist ausschließlich der Habun-Dienstplan-Endpunkt.
- Repository ist exakt `pubgsufian-afk/z.B.-mein-projekt`.
- Ref ist exakt `refs/heads/main`.
- Der aufrufende Workflow ist exakt der dafür vorgesehene Dienstplan-Workflow auf `main`.
- Das Token ist noch gültig und kryptografisch mit GitHubs veröffentlichten OIDC-Schlüsseln verifiziert.

Damit reicht ein beliebiger GitHub-Account, Fork, Pull Request oder anderer Workflow nicht aus, um Dienste zu veröffentlichen.

## Datenfluss

1. ChatGPT erstellt einen frischen Dienstplan-Auftrag im vorhandenen verschlüsselten Envelope-Format. Im öffentlichen Repository liegt nur Ciphertext.
2. Ein Commit auf `main` mit dem neuen Envelope bzw. technischen Trigger startet ausschließlich den Dienstplan-Workflow.
3. GitHub Actions fordert ein kurzlebiges OIDC-Token mit der Habun-Audience an.
4. Der Workflow sendet OIDC-Token und verschlüsselten Envelope per POST an die neue Netlify-Funktion.
5. Die Funktion verifiziert zuerst die GitHub-Identität und die erlaubten Claims.
6. Erst danach entschlüsselt die Funktion den Envelope mit dem bestehenden privaten Netlify-Schlüssel. Der private Schlüssel bleibt ausschließlich in Netlify.
7. Der entschlüsselte Auftrag muss dem vorhandenen Command-Vertrag entsprechen und darf höchstens 30 Minuten alt sein.
8. Die Funktion übergibt den Auftrag intern an den bestehenden `Dienstplan-Assistenten`.
9. Der Dienstplan-Assistent löst Mitarbeiter nur exakt auf, veröffentlicht eindeutige Dienste, erkennt Duplikate und protokolliert die Aktion.
10. ChatGPT kontrolliert anschließend den Live-Stand in Neon. Erst nach dieser Kontrolle wird dem Nutzer „eingetragen“ gemeldet.

## Berechtigungen

Der GitHub-Workflow erhält nur:

- `contents: read`
- `id-token: write`

Er bekommt keinen Datenbank-Schlüssel und keinen dauerhaft gespeicherten Portal-Token.

Die Netlify-OIDC-Funktion darf ausschließlich den bestehenden Scheduler-Pfad auslösen. Sie erhält keine Account-, Rollen-, Zeiterfassungs- oder allgemeinen Admin-Funktionen.

## Geheimnisse

- Der vorhandene private Schlüssel für den verschlüsselten Command-Envelope bleibt als Secret in Netlify und wird zusätzlich nur für Functions/Runtime verfügbar gemacht, soweit für die serverseitige Entschlüsselung erforderlich.
- `SCHEDULE_ASSISTANT_TOKEN` bleibt ausschließlich in Netlify.
- Kein geheimer Wert wird in GitHub-Quellcode, Commit-Nachrichten, Workflow-Dateien oder Chat-Antworten geschrieben.
- GitHub Actions braucht für diesen Weg kein dauerhaftes Habun-Secret.

## Fehlerverhalten

- Ungültiges oder falsches OIDC-Token: Anfrage wird vor jeder Entschlüsselung und vor jedem Schreibvorgang abgewiesen.
- Falsches Repository, Branch oder Workflow: Anfrage wird abgewiesen.
- Abgelaufener oder beschädigter Envelope: keine Veröffentlichung.
- Mitarbeitername nicht eindeutig oder nicht vorhanden: nur dieser Dienst wird abgewiesen; es wird nichts geraten.
- Exakter bereits vorhandener Dienst: wird als Duplikat erkannt und nicht erneut angelegt.
- Teilfehler: erfolgreiche eindeutige Einträge dürfen veröffentlicht werden; nicht auflösbare Einträge bleiben abgewiesen und werden im Ergebnis kenntlich gemacht.

## Prüfung

Vor Produktionsfreigabe müssen folgende Prüfungen grün sein:

- Unit-Tests für OIDC-Claim-Prüfung und Command-Validierung.
- Source-/Contract-Test für den Workflow: `id-token: write`, `contents: read`, keine langlebigen Portal-Secrets.
- Source-/Contract-Test für die Netlify-Funktion: exakte Repository-, Ref-, Audience- und Workflow-Bindung; keine CORS-Freigabe; kein direkter Datenbank-Schreibzugriff.
- Bestehende Dienstplan-, Zeiterfassungs-, Build- und E2E-Prüfungen dürfen nicht regressieren.
- Netlify Deploy Preview muss erfolgreich bauen.
- Nach Merge muss die Produktionsfunktion im Live-Deploy vorhanden sein.

## Erster produktiver Auftrag

Nach erfolgreicher Produktionsfreigabe wird ein frischer Auftrag für Samstag, 08.08.2026, gesendet:

- Aras: 06:00–17:00, ZuKo
- Amin: 07:00–17:00, GMP ZuKo
- Sarmad: 07:00–17:00, GMP Bereich

Keine Pause wurde angegeben, daher 0 Minuten. Ein fehlender Einsatzort wird weiterhin nach der bestehenden Scheduler-Regel aus dem gespeicherten Mitarbeiterstandort übernommen; falls dort keiner vorhanden ist, greift der bestehende Fallback `Abbott`.

Die Veröffentlichung gilt erst als abgeschlossen, wenn alle tatsächlich veröffentlichten Dienste anschließend aus der Live-Datenbank verifiziert wurden.

## Nicht Teil dieses Schritts

- Kein direkter SQL-/Datenbank-Schreibzugriff aus ChatGPT oder GitHub Actions.
- Kein allgemeiner HTTP-Proxy.
- Kein menschliches Servicekonto mit Passwort.
- Keine Erweiterung der Rechte des Dienstplan-Assistenten.
- Keine Änderung an Zeiterfassung, Rollen oder Accounts.
# Dauerhafter Netlify-Dienstplan-Zugang

## Ziel

ChatGPT soll künftig ohne manuelle Portal-Schritte aktive Mitarbeiter synchronisieren und freigegebene Dienstpläne über die bestehende Habun-Portal-Logik veröffentlichen können. ChatGPT erhält keinen direkten Schreibzugriff auf Neon.

## Datenfluss

1. ChatGPT setzt über den bestehenden Netlify-Connector eine geheime Produktionsvariable `SCHEDULE_ASSISTANT_COMMAND`.
2. Der Wert enthält einen Command mit zufälliger ID, Erstellzeit, Aktion und bei Bedarf den Dienstplan. Die Variable ist nur für Builds/Functions vorgesehen und als Secret markiert.
3. ChatGPT aktualisiert anschließend ausschließlich eine harmlose Datei `ops/schedule-command-trigger.txt` mit der Command-ID. Dadurch startet der bereits vorhandene automatische Netlify-Deploy von `main`.
4. Nach dem Deploy läuft die Netlify Scheduled Function `schedule-command-worker` im Minutenintervall. Sie liest den Command, validiert Alter/Aktion/ID und prüft in Netlify Blobs, ob diese Command-ID bereits verarbeitet wurde.
5. Der Worker ruft intern den bestehenden geschützten `schedule-assistant` auf. Dadurch bleiben Namensauflösung, aktive Benutzer, Duplikatschutz, Audit-Protokollierung und Schedule-Repository dieselben wie im Portal.
6. Der Worker speichert nur ein minimales Verarbeitungsergebnis im privaten Blob-Store. ChatGPT verifiziert anschließend lesend in Neon, welche Mitarbeiter synchronisiert bzw. welche Dienste veröffentlicht wurden.

## Unterstützte Aktionen

- `sync-directory`: synchronisiert aktive Portal-Benutzer nach `schedule_employees` und gibt intern nur die Anzahl zurück.
- `publish-shifts`: veröffentlicht eindeutige Schichten. Unbekannte oder mehrdeutige Namen werden nicht geraten.

## Sicherheit

- Kein Portal-Passwort in ChatGPT oder GitHub.
- Keine Dienstplandaten in GitHub; der Trigger-Commit enthält nur eine zufällige Command-ID.
- `SCHEDULE_ASSISTANT_COMMAND` wird als geheime Netlify-Variable gesetzt.
- Keine neue öffentliche Schreib-API und keine CORS-Freigabe.
- Kein direkter ChatGPT→Neon-Schreibweg.
- Idempotenz über `processed/<commandId>` verhindert Wiederholungen.
- Commands älter als 30 Minuten werden nicht verarbeitet.
- Der bestehende `SCHEDULE_ASSISTANT_TOKEN` bleibt serverintern.

## Betrieb aus zukünftigen Chats

Für einen neuen Dienstplan führt ChatGPT selbstständig aus: Secret setzen, Trigger-Datei auf `main` aktualisieren, Produktionsdeploy abwarten, Verarbeitung abwarten und Ergebnis in Neon prüfen. Der Nutzer muss weder die Webseite öffnen noch Screenshots schicken.

## Erfolgskriterien

- Ein `sync-directory`-Command füllt `schedule_employees` mit den aktiven Portal-Mitarbeitern.
- ChatGPT kann danach Anzahl und Namen der aktiven Mitarbeiter selbst lesen.
- Ein eindeutiger `publish-shifts`-Command erzeugt veröffentlichte Schichten mit Quelle `chatgpt`.
- Wiederholung derselben Command-ID erzeugt keine zweite Schicht.
- Bestehende Tests, Build und E2E bleiben grün.

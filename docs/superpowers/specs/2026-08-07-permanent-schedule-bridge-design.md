# Dauerhafter Dienstplan-Zugang für ChatGPT

## Ziel

ChatGPT soll künftig ohne manuelle Schritte des Hauptadmins aktive Portal-Mitarbeiter synchronisieren, eindeutig zuordnen und freigegebene Dienstpläne über die bestehende Portal-Logik veröffentlichen können. Direkte Schreibzugriffe von ChatGPT auf die Live-Datenbank bleiben ausgeschlossen.

## Architektur

Der bestehende geschützte `schedule-assistant` bleibt die einzige Komponente, die Dienstpläne veröffentlicht. Davor wird eine dauerhafte Brücke gesetzt:

1. ChatGPT erzeugt einen verschlüsselten Auftrag und legt ihn als GitHub-Issue im bestehenden Repository an.
2. Ein GitHub-Actions-Workflow reagiert ausschließlich auf entsprechend gekennzeichnete Issues des Repository-Besitzers und ruft den Netlify-Endpunkt `/api/schedule-command-bridge` auf.
3. Der Netlify-Endpunkt lädt das Issue selbst über die öffentliche GitHub-API, prüft Repository, Autor und Titel, entschlüsselt den Auftrag mit einem ausschließlich in Netlify gespeicherten privaten Schlüssel und übergibt die erlaubte Aktion intern an den bestehenden `schedule-assistant`.
4. Das Ergebnis wird ohne Mitarbeiterdaten als knapper Status zurückgegeben. Wiederholte Aufträge werden über eine Command-ID idempotent behandelt.

## Verschlüsselung und Zugriff

- Im Repository liegt nur der öffentliche Verschlüsselungsschlüssel.
- Der private Schlüssel liegt ausschließlich als geheime Netlify-Produktionsvariable.
- Der eigentliche Dienstplantext steht niemals im Klartext im GitHub-Issue.
- Die Bridge akzeptiert ausschließlich das fest konfigurierte Repository und Issues des Repository-Besitzers.
- Die Bridge akzeptiert ausschließlich bekannte Aktionen und verwirft abgelaufene oder bereits verarbeitete Command-IDs.
- Keine CORS-Freigabe, kein SQL-Endpunkt, kein generischer Admin-Endpunkt und keine Passwörter im Repository.

## Unterstützte Aktionen

### `sync-directory`

Liest die aktiven Benutzer aus dem vorhandenen Portal-Zugriffsbestand und synchronisiert sie in das Dienstplan-Verzeichnis. Dadurch kann ChatGPT anschließend über den bestehenden Neon-Lesezugang Anzahl, Namen, Rollenstatus und gespeicherten Standard-Einsatzort der aktiven Mitarbeiter prüfen.

### `publish-shifts`

Nutzt dieselbe Namensauflösung, Validierung, Duplikatprüfung, Überschneidungswarnung, Audit-Protokollierung und Veröffentlichung wie der vorhandene Dienstplan-Assistent. Unbekannte oder mehrdeutige Namen werden nicht geraten und nicht veröffentlicht.

## Datenschutz im öffentlichen Repository

Issue-Titel enthalten nur eine zufällige Command-ID. Issue-Inhalte enthalten ausschließlich eine hybride RSA-OAEP/AES-GCM-Verschlüsselungshülle. GitHub-Actions-Kommentare enthalten nur die Command-ID und aggregierte Statuszahlen, keine Namen, Uhrzeiten, Einsatzorte oder sonstige Dienstplandaten.

## Fehlerverhalten

- Falsches Repository, falscher Autor oder falscher Titel: Anfrage wird abgelehnt.
- Ungültige Verschlüsselung oder abgelaufener Auftrag: Anfrage wird abgelehnt.
- Bereits verarbeitete Command-ID: gespeichertes minimales Ergebnis wird zurückgegeben, ohne erneut zu veröffentlichen.
- Unbekannter Mitarbeiter: nur dieser Eintrag wird abgelehnt.
- Technischer Fehler: keine erfundene Erfolgsmeldung; der Auftrag bleibt prüfbar und kann idempotent erneut ausgelöst werden.

## Erfolgskriterien

- ChatGPT kann einen `sync-directory`-Auftrag ohne Nutzerinteraktion auslösen und danach die aktiven Mitarbeiter aus Neon lesen.
- ChatGPT kann einen verschlüsselten `publish-shifts`-Auftrag auslösen, ohne das Portal-Passwort oder einen Datenbank-Schreibzugang zu besitzen.
- Ein fremdes GitHub-Konto kann keine Dienstplanbefehle auslösen.
- Klartext-Dienstplandaten erscheinen weder im Repository noch in öffentlichen Action-Kommentaren.
- Exakte Wiederholungen erzeugen keine doppelten Dienste.
- Bestehende Portal-, Standort-, Rollen-, PDF- und Zeiterfassungsfunktionen bleiben unverändert funktionsfähig.

# Dienstpläne aus ChatGPT direkt veröffentlichen und Mitarbeiteransicht reparieren

Datum: 07.08.2026
Status: vom Nutzer inhaltlich freigegeben, noch nicht implementiert

## Ziel

Der Nutzer soll künftig nur noch einen Dienstplan in ChatGPT schicken müssen. ChatGPT überträgt die eindeutigen Dienste in das bestehende Habun-Mitarbeiterportal, berücksichtigt ausschließlich aktive Mitarbeiter und veröffentlicht die Dienste ohne zusätzlichen Freigabeschritt. Gleichzeitig muss ein veröffentlichter Dienst im Konto des zugeordneten Mitarbeiters zuverlässig sichtbar sein.

## Festgelegte Geschäftsregeln

- Eindeutige Dienstpläne werden direkt eingetragen und veröffentlicht.
- Bei widersprüchlichem oder unklarem Datum wird vor dem Schreiben nachgefragt.
- Bei unklarer Mitarbeiterzuordnung wird vor dem Schreiben nachgefragt.
- Nicht aktive bzw. nicht registrierte Mitarbeiter werden übersprungen.
- Mehrere Dienste derselben Person am selben Tag bleiben getrennte Dienste.
- Wenn keine Pause angegeben ist, gelten 0 Minuten Pause.
- Wenn kein anderer Einsatzort angegeben ist, wird der gespeicherte Einsatzort Abbott verwendet.
- Wenn ausdrücklich ein anderer Einsatzort angegeben ist, hat dieser Vorrang.
- Exakte Duplikate dürfen nicht doppelt angelegt werden.
- Nach erfolgreichem Schreiben meldet ChatGPT, welche Dienste veröffentlicht und welche Namen übersprungen wurden.

## Architektur

### Private Schreibstrecke

Für die direkte Übertragung aus ChatGPT wird das bereits vorhandene private Neon-Projekt `habun-mitarbeiterportal` verwendet. Mitarbeiter- und Dienstplandaten werden nicht als GitHub-Issue, Commit-Inhalt oder sonstige öffentliche Transportdaten abgelegt.

Die bestehende öffentliche GitHub-Codebasis bleibt ausschließlich Quellcode- und Deployment-Kanal. Personenbezogene Dienstplandaten werden dort nicht gespeichert.

### Dienstplan-Datenmodell

Neon erhält einen kleinen, klar abgegrenzten Dienstplanbereich mit:

- aktiver Mitarbeiterzuordnung über die stabile Netlify-Identity-Benutzer-ID,
- veröffentlichten Diensten,
- Einsatzort/Arbeitsbereich,
- Beginn/Ende,
- Pause,
- Erstell-/Änderungszeit,
- Quelle des Eintrags,
- Idempotenz-/Duplikatschutz.

Die stabile Benutzer-ID ist die einzige technische Zuordnung zwischen Login und Dienst. Namen dienen nur der Anzeige und dem Matching, niemals als Primärschlüssel.

### Aktive Mitarbeiter

Die bestehende Portal-Zugriffsquelle `portal-access` bleibt maßgeblich dafür, ob ein Konto aktiv ist. Das Portal synchronisiert nur aktive, freigeschaltete Konten in die private Mitarbeiterzuordnung für die Dienstplanung. E-Mail-Adressen oder Passwörter sind für die Dienstplanübertragung nicht erforderlich.

Die Synchronisierung muss idempotent sein und bestehende Mitarbeiter-IDs nicht verändern.

### Bestehende Portal-API

Die sichtbare Bedienung im Portal soll möglichst unverändert bleiben. Die vorhandenen Dienstplan-Routen behalten ihren äußeren Vertrag, werden intern jedoch so angebunden, dass Admin-Ansicht, Mitarbeiteransicht, PDF und ChatGPT-Schreibweg dieselbe veröffentlichte Datenquelle verwenden.

Es darf nicht zwei voneinander abweichende Wahrheiten geben, bei denen der Admin einen Dienst sieht, der Mitarbeiter aber aus einer anderen Quelle liest.

## Bestätigter Fehler in der Mitarbeiteransicht

Aktuell liefert das vorgelagerte Session-System die Login-ID als `id`. Der aktuelle Session-Wrapper gibt für Mitarbeiter dagegen `userId: data.userId` zurück. Dadurch ist `session.userId` beim Mitarbeiter leer, obwohl `data.id` vorhanden ist.

Die Dienstplanseite filtert anschließend auf `entry.employeeUserId === session.userId && entry.status === 'published'`. Dadurch werden veröffentlichte Dienste im Mitarbeiterkonto herausgefiltert.

### Korrektur

Der Session-Wrapper normalisiert die stabile Login-ID zuverlässig auf `userId`, wobei die vorhandene `id` als Quelle verwendet wird, wenn `userId` nicht vorhanden ist.

Zusätzlich wird die Mitarbeiteransicht robust gegen alte Session-Antworten gemacht: Die effektive Benutzer-ID wird aus `session.userId || session.id` bestimmt. Der Server bleibt weiterhin die primäre Berechtigungsgrenze und liefert Mitarbeitern nur ihre eigenen veröffentlichten Dienste.

Damit gilt Defense-in-Depth ohne die aktuell fehlerhafte doppelte Filterung.

## Veröffentlichungsverhalten

Ein ChatGPT-Auftrag wird nur ausgeführt, wenn Datum, Mitarbeiter, Beginn und Ende eindeutig sind. Vor dem Schreiben wird gegen die private Liste aktiver Mitarbeiter abgeglichen.

Für jeden Dienst gilt:

1. aktiven Mitarbeiter anhand normalisiertem Namen bestimmen,
2. stabile Benutzer-ID verwenden,
3. Einsatzort bestimmen, standardmäßig Abbott,
4. Pause bestimmen, standardmäßig 0 Minuten,
5. Duplikat prüfen,
6. Dienst als veröffentlicht speichern,
7. Ergebnis protokollieren.

Wenn ein Name nicht eindeutig einem aktiven Mitarbeiter zugeordnet werden kann, wird dieser Dienst nicht geraten und nicht geschrieben.

## Datenschutz und Sicherheit

- Keine Mitarbeiterdaten in GitHub-Issues, Commits oder öffentlichen Artefakten.
- Keine Passwörter oder dauerhaften Browser-Sessions für ChatGPT.
- ChatGPT schreibt nur über die private Datenbankverbindung.
- Das Portal prüft weiterhin Rollen und Authentifizierung serverseitig.
- Mitarbeiter lesen ausschließlich eigene veröffentlichte Dienste.
- Admin/Owner/Manager behalten ihre bestehenden Planungsrechte.
- Der Dienstplan-Support behält ausschließlich die bereits vorgesehenen Dienstplanrechte.
- Jeder automatisch geschriebene Dienst erhält einen internen Audit-Hinweis zur Quelle.

## Bestehende Daten

Die Umstellung darf bestehende veröffentlichte Dienstpläne nicht unsichtbar machen. Vor einer Produktionsfreigabe wird geprüft, ob vorhandene Netlify-Blob-Dienste übernommen oder über eine kompatible Übergangsleselogik weiterhin sichtbar gehalten werden müssen.

Es gibt keine Löschung bestehender Dienstplandaten im Rahmen dieser Änderung.

## Fehlerfälle

- Unklares Datum: nichts schreiben, Nutzer fragen.
- Unklarer Mitarbeiter: nichts für diesen Namen schreiben, Nutzer fragen.
- Inaktiver/nicht registrierter Mitarbeiter: überspringen und im Ergebnis nennen.
- Ende vor/gleich Beginn: Auftrag ablehnen und nachfragen.
- Exaktes Duplikat: nicht erneut anlegen; als bereits vorhanden melden.
- Datenbank-/Serverfehler: keine Erfolgsmeldung ausgeben; Fehler klar melden.
- Teilweiser Fehler bei mehreren Diensten: eindeutig angeben, welche Dienste erfolgreich waren und welche nicht.

## Tests

Vor Veröffentlichung müssen mindestens folgende Fälle automatisiert geprüft werden:

- Mitarbeiter-Session mit nur `id` wird korrekt zu `userId` normalisiert.
- Mitarbeiter sieht eigenen veröffentlichten Dienst.
- Mitarbeiter sieht keinen fremden veröffentlichten Dienst.
- Mitarbeiter sieht keinen Entwurf.
- Admin sieht alle Dienste im Berechtigungsbereich.
- aktiver Mitarbeiter wird für Chat-Import gematcht.
- inaktiver/unbekannter Mitarbeiter wird übersprungen.
- zwei getrennte Dienste derselben Person bleiben getrennt.
- Standardpause 0 Minuten.
- Standard-Einsatzort Abbott.
- expliziter anderer Einsatzort überschreibt Abbott.
- exaktes Duplikat wird blockiert.
- widersprüchliches Datum führt zu keinem Schreibvorgang.
- Desktop-, iPhone- und Android-Browserlauf bleibt erfolgreich.
- Dienstplan-PDF enthält weiterhin die veröffentlichten Dienste aus derselben Datenquelle.

## Erfolgskriterien

Die Änderung ist fertig, wenn:

1. der Nutzer einen eindeutigen Dienstplan in ChatGPT schicken kann und ChatGPT ihn ohne Browserlogin direkt veröffentlichen kann;
2. nur aktive Mitarbeiter übernommen werden;
3. die festgelegten Standardregeln für Abbott und 0 Minuten Pause gelten;
4. unklare Angaben vor dem Schreiben abgefragt werden;
5. der Mitarbeiter unmittelbar nach Veröffentlichung seinen eigenen Dienstplan sehen kann;
6. kein Mitarbeiter fremde Dienste sieht;
7. bestehende Dienstplandaten erhalten bleiben;
8. alle Rollen-, API-, Datenbank-, PDF- und Browserregressionstests erfolgreich sind;
9. die technische Änderung erst nach separater ausdrücklicher Produktionsfreigabe veröffentlicht wird.

## Nicht Teil dieser Änderung

- Push-Benachrichtigungen an Mitarbeiter.
- WhatsApp-Versand.
- Änderungen an Zeiterfassung oder Standortprüfung außerhalb der für den Dienstplan notwendigen Zuordnung.
- Veröffentlichung personenbezogener Dienstplandaten in GitHub.

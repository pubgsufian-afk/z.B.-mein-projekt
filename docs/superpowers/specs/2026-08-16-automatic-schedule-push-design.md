# Automatische Dienstplan-Push-Benachrichtigungen

Datum: 16.08.2026
Status: vom Nutzer fachlich freigegeben

## Ziel

Das Mitarbeiterportal verschickt Push-Benachrichtigungen automatisch. Die bisherige manuelle Glocke zum Schreiben und Versenden von Mitteilungen wird entfernt.

Mitarbeiter müssen Benachrichtigungen auf jedem gewünschten Gerät nur einmal erlauben. Danach erfolgen die hier definierten Dienstplan-Benachrichtigungen ohne weitere manuelle Aktion durch Admin oder Einsatzleiter.

## Festgelegte Regeln

### 1. Neuer Dienstplan wird veröffentlicht

Wenn ein neuer Dienstplan erfolgreich veröffentlicht wird, erhält jeder Mitarbeiter, der in diesem veröffentlichten Plan mindestens einen Dienst hat, genau eine Push-Benachrichtigung.

Text:

> Ein neuer Dienstplan wurde veröffentlicht. Bitte im Mitarbeiterportal prüfen.

Ein Mitarbeiter erhält bei derselben Veröffentlichung nur eine Benachrichtigung, auch wenn er mehrere Dienste im veröffentlichten Plan hat.

### 2. Veröffentlichter Dienst wird später geändert

Wenn ein bereits veröffentlichter Dienst geändert wird, erhält nur der betroffene Mitarbeiter eine Push-Benachrichtigung.

Text:

> Dein Dienstplan wurde geändert. Bitte im Mitarbeiterportal prüfen.

Wenn ein veröffentlichter Dienst von Mitarbeiter A auf Mitarbeiter B umgebucht wird, gelten beide als betroffen:

- Mitarbeiter A erhält die Änderungsbenachrichtigung, weil sein bisheriger Dienst entfällt.
- Mitarbeiter B erhält die Änderungsbenachrichtigung, weil ihm der Dienst neu zugewiesen wurde.

### 3. Veröffentlichter Dienst wird gelöscht

Wenn ein veröffentlichter Dienst gelöscht wird, erhält nur der Mitarbeiter, dem dieser Dienst zugeordnet war, die Änderungsbenachrichtigung.

Text:

> Dein Dienstplan wurde geändert. Bitte im Mitarbeiterportal prüfen.

### 4. Entwürfe

Änderungen an Entwürfen lösen keine Push-Benachrichtigung aus.

Erst eine erfolgreiche Veröffentlichung macht die Änderung benachrichtigungsrelevant.

### 5. Erinnerung vor Dienstbeginn

Fünf Minuten vor Beginn jedes veröffentlichten Dienstes erhält der zugeordnete Mitarbeiter automatisch eine Push-Benachrichtigung.

Text:

> Dein Dienst beginnt gleich. Bitte rechtzeitig einchecken.

Die Erinnerung wird pro Dienst höchstens einmal versendet.

## Architektur

### A. Ereignisbasierte Dienstplan-Benachrichtigungen

Push wird direkt nach einer erfolgreich gespeicherten veröffentlichten Änderung ausgelöst. Dadurch ist kein Polling für Dienstplanänderungen nötig.

Alle vorhandenen Wege zur Dienstplanpflege müssen denselben Benachrichtigungsdienst verwenden:

1. Normale Dienstplanverwaltung über `/api/schedule-v2`.
2. Dienstplan-Assistent und Batch-Relay über `/api/schedule-assistant` beziehungsweise den bestehenden `schedule-command-worker`.

Die Benachrichtigung darf erst nach erfolgreicher Datenbankänderung ausgelöst werden. Schlägt das Speichern oder Veröffentlichen fehl, darf kein Push gesendet werden.

### B. Gemeinsamer Push-Dienst

Die bestehende Push-Infrastruktur bleibt die zentrale Zustellschicht. Ein gemeinsames serverseitiges Modul erhält fachliche Funktionen wie:

- `notifySchedulePublished(userIds)`
- `notifyScheduleChanged(userIds)`
- `notifyShiftStartingSoon(userId, shiftId)`

Diese Funktionen deduplizieren Empfänger und kapseln die Texte. Die Dienstplan-Funktionen müssen keine Push-Details kennen.

### C. Erinnerung-Worker

Ein kleiner Netlify Scheduled Function Worker läuft einmal pro Minute.

Der Worker:

1. bestimmt die aktuelle Zeit in `Europe/Berlin`, einschließlich Sommer-/Winterzeit,
2. sucht ausschließlich veröffentlichte Dienste, deren Beginn ungefähr fünf Minuten bevorsteht,
3. sendet nur an den dem Dienst zugeordneten Mitarbeiter,
4. speichert pro Dienst einen eindeutigen Versandmarker,
5. überspringt bereits erinnerte Dienste.

Die Zeitprüfung soll ein enges Fenster rund um `Dienstbeginn - 5 Minuten` verwenden, damit ein leicht verspäteter Cron-Lauf die Erinnerung nicht verliert, gleichzeitig aber keine Doppelmeldungen entstehen.

## Deduplizierung

### Veröffentlichungsbenachrichtigung

Pro erfolgreichem Veröffentlichungsereignis wird jeder betroffene `userId` nur einmal berücksichtigt.

Beim Batch-Relay mit mehreren veröffentlichten Schichten werden die erfolgreich veröffentlichten Ergebnisse zuerst nach `userId` zusammengefasst. Ein Mitarbeiter bekommt deshalb pro Batch nur eine Meldung über den neuen veröffentlichten Plan.

### Änderungsbenachrichtigung

Eine einzelne veröffentlichte Änderung wird pro betroffenem `userId` einmal versendet.

### Dienstbeginn-Erinnerung

Ein persistenter Marker, zum Beispiel `reminders/<shiftId>/<scheduledStart>`, verhindert Wiederholungen bei späteren Worker-Läufen. Wird die Startzeit eines veröffentlichten Dienstes geändert, erzeugt der neue geplante Start einen neuen Marker-Key; eine Erinnerung für die alte Startzeit darf danach nicht mehr ausgelöst werden.

## Verhalten der Push-Geräte

Die vorhandene Gerätezuordnung bleibt erhalten:

- Ein Gerät ist dem eingeloggten Mitarbeiter zugeordnet.
- Ein Mitarbeiter kann mehrere eigene Geräte registrieren.
- Eine Benachrichtigung an einen Mitarbeiter wird an alle aktuell gültigen registrierten Geräte dieses Mitarbeiters zugestellt.
- Ungültige oder abgelaufene Push-Endpunkte werden weiterhin entfernt.

Die einmalige Betriebssystem-/Browser-Erlaubnis kann technisch nicht umgangen werden.

## UI-Änderung

Die manuelle Glocke unten rechts und das Fenster zum manuellen Schreiben von Nachrichten werden vollständig aus der Portal-Oberfläche entfernt.

Die einmalige Aktivierung von Push bleibt bestehen. Nach erfolgreicher Aktivierung darf weiterhin automatisch eine Testbenachrichtigung an genau dieses Gerät gesendet werden, damit der Mitarbeiter sofort erkennt, dass Push funktioniert.

## Server-Sicherheit

Der Browser darf keine beliebigen automatischen Dienstplan-Pushs auslösen.

Automatische Benachrichtigungen werden ausschließlich serverseitig aus erfolgreichen Dienstplanaktionen beziehungsweise dem Reminder-Worker ausgelöst.

Der bisherige manuelle `send`-Pfad der Push-API soll entfernt oder serverseitig deaktiviert werden, wenn er nach Entfernung der Glocke nicht mehr benötigt wird. Die API behält nur die für Geräteverwaltung und gegebenenfalls Aktivierungstest notwendigen Aktionen.

## Fehlerbehandlung

Eine erfolgreich gespeicherte Dienstplanänderung darf nicht rückgängig gemacht werden, nur weil ein Push-Dienst vorübergehend nicht erreichbar ist.

Daher gilt:

- Dienstplanänderung zuerst dauerhaft speichern.
- Push danach best-effort senden.
- Push-Fehler serverseitig protokollieren.
- Ungültige Endpunkte entfernen.
- Kein zweites Speichern und keine doppelte Dienstplanänderung wegen eines Push-Fehlers.

Für die Dienstbeginn-Erinnerung bleibt der Versandmarker nur dann endgültig gesetzt, wenn der Versandversuch fachlich als verarbeitet gilt. Die genaue Implementierung muss Doppelversand bei Funktionswiederholungen verhindern.

## Daten- und Datenschutzprinzip

Push-Texte enthalten keine Uhrzeit, keinen Einsatzort und keine weiteren Dienstplandetails auf dem Sperrbildschirm.

Die Benachrichtigungen verweisen lediglich darauf, den Dienstplan im authentifizierten Mitarbeiterportal zu prüfen.

## Tests

Die Umsetzung braucht mindestens folgende automatische Prüfungen:

1. Veröffentlichen einer Woche benachrichtigt jeden eingeplanten Mitarbeiter genau einmal.
2. Mehrere Dienste desselben Mitarbeiters in einem veröffentlichten Batch erzeugen nur eine Veröffentlichungsnachricht.
3. Entwurfsänderung erzeugt keine Nachricht.
4. Änderung eines veröffentlichten Dienstes benachrichtigt nur den betroffenen Mitarbeiter.
5. Umbuchung von A auf B benachrichtigt A und B jeweils einmal.
6. Löschen eines veröffentlichten Dienstes benachrichtigt den bisherigen Mitarbeiter.
7. Batch-Relay/Assistent nutzt dieselben Regeln wie die Portal-Veröffentlichung.
8. Reminder-Worker sendet ungefähr fünf Minuten vor Beginn.
9. Reminder-Worker sendet pro Dienst nicht doppelt, auch wenn er mehrfach läuft.
10. Gelöschte oder auf eine andere Uhrzeit verschobene Dienste lösen keine veraltete Erinnerung aus.
11. Push-Fehler lassen die erfolgreich gespeicherte Dienstplanänderung bestehen.
12. Die manuelle Glocke und das manuelle Nachrichtenfenster sind nicht mehr sichtbar.
13. Bestehende Push-Aktivierung auf Android, iPhone/iPad-Home-Screen-Web-App und unterstützten Desktop-Browsern bleibt erhalten.

## Nicht Bestandteil dieser Änderung

Andere Portalereignisse außerhalb des Dienstplans, zum Beispiel Tagesberichte, Stundenzettel oder allgemeine Admin-Mitteilungen, lösen in dieser Version keine automatische Push-Benachrichtigung aus.

## Erfolgskriterium

Nach einmaliger Push-Aktivierung muss ein Mitarbeiter ohne weitere manuelle Handlung zuverlässig informiert werden, wenn:

- ein neuer veröffentlichter Dienstplan ihn enthält,
- sein veröffentlichter Dienst später geändert oder gelöscht wird,
- sein veröffentlichter Dienst in fünf Minuten beginnt.

Admin oder Einsatzleiter müssen dafür keine Glocke öffnen und keine Nachricht manuell schreiben.
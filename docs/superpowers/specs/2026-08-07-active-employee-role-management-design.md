# Aktive Mitarbeiter: Rollen- und Kontoverwaltung

## Ziel

Die Seite **Mitarbeiter** soll nicht nur neue Registrierungen freischalten, sondern auch bereits aktive Konten verwalten. Hauptadmin und Admin erhalten dabei unterschiedliche, serverseitig erzwungene Befugnisse.

## Rollenmodell

### Hauptadmin (`owner`)

- Hat vollständigen Zugriff auf alle Bereiche des Portals.
- Darf aktive Mitarbeiter, Einsatzleiter und Admins bearbeiten.
- Darf Rollen auf **Mitarbeiter**, **Einsatzleiter** oder **Admin** setzen.
- Darf Admin-Rechte vergeben und entziehen.
- Darf Admin-Konten löschen/deaktivieren.
- Das eigene Hauptadmin-Konto bleibt geschützt und darf nicht versehentlich herabgestuft oder gelöscht werden.

### Admin (`admin`)

- Darf normale Mitarbeiter vollständig verwalten.
- Darf Mitarbeiterzeiten, Pausen, Dienstpläne, Korrekturen und die vorgesehenen Mitarbeiterdaten bearbeiten.
- Darf Rollen zwischen **Mitarbeiter** und **Einsatzleiter** ändern.
- Darf **keinen Admin** bearbeiten, löschen oder dessen Rolle ändern.
- Darf **keinen Mitarbeiter zum Admin machen**.
- Darf den Hauptadmin niemals bearbeiten, herabstufen oder löschen.

### Einsatzleiter (`manager`)

- Behält die bereits vorgesehenen operativen Rechte, insbesondere die freigegebene Bearbeitung von Mitarbeiterzeiten.
- Darf keine Admin-Rollen vergeben oder Konten der Administration verwalten.

### Mitarbeiter (`employee`)

- Behält ausschließlich die normalen Mitarbeiterrechte.
- Keine Rollen- oder Kontoverwaltung.

## Oberfläche

Im Bereich **Aktive Mitarbeiter** erhält jedes verwaltbare Konto eine sichtbare Rolle und eine Bearbeitungsaktion.

- Hauptadmin sieht bei Mitarbeiter- und Einsatzleiterkonten die Rollen **Mitarbeiter / Einsatzleiter / Admin**.
- Hauptadmin kann auch bestehende Admins bearbeiten.
- Admin sieht bei Mitarbeiter- und Einsatzleiterkonten nur **Mitarbeiter / Einsatzleiter**.
- Bei bestehenden Admin-Konten und beim Hauptadmin werden einem normalen Admin keine Rollenänderung und keine Löschfunktion angeboten.
- Aktuelle Rolle wird direkt auf der Mitarbeiterkarte angezeigt.
- Änderungen werden erst nach explizitem Speichern übernommen und anschließend neu geladen.

## Backend-Regeln

Die Berechtigungen werden nicht nur in der UI ausgeblendet, sondern serverseitig geprüft.

Der bestehende Registrierungs-Endpunkt wird um Verwaltung aktiver Mitarbeiter erweitert oder es wird ein klar abgegrenzter Endpunkt für aktive Konten ergänzt. Die API muss mindestens unterstützen:

- aktive Mitarbeiter abrufen, inklusive aktueller Rolle;
- Rolle eines aktiven Kontos ändern;
- Konto deaktivieren/löschen, soweit die Rolle des handelnden Benutzers dies erlaubt.

Serverseitige Schutzregeln:

1. Nur `owner` darf Zielrolle `admin` vergeben.
2. Nur `owner` darf ein bestehendes `admin`-Konto verändern oder deaktivieren.
3. `admin` darf nur Zielkonten mit Rolle `employee` oder `manager` verändern.
4. `admin` darf als Zielrolle nur `employee` oder `manager` setzen.
5. `owner`-Konten dürfen nicht durch `admin` verändert werden.
6. Das aktuell konfigurierte Hauptadmin-Konto darf nicht versehentlich selbst herabgestuft oder gelöscht werden.
7. Rollenänderungen werden in der Portal-Zugriffsquelle und in der Dienstplan-Mitarbeiterquelle konsistent synchronisiert.

## Datenkonsistenz

Die bestehende `portal-access`-Quelle bleibt maßgeblich für Portalrollen. Wenn eine Rolle geändert wird, muss dieselbe Rolle auch in der Dienstplan-Mitarbeiterquelle aktualisiert werden, damit Navigation, Dienstplan und Berechtigungen dieselbe Rolle verwenden.

## Fehlerbehandlung

- Nicht erlaubte Rollenänderungen liefern `403` mit verständlicher Meldung.
- Nicht vorhandene Benutzer liefern `404`.
- Ungültige Zielrollen liefern `400`.
- Die UI zeigt die Servermeldung als Fehlermeldung an und behält die bisherige Rolle bei.

## Tests

Mindestens folgende Fälle werden automatisiert geprüft:

- Hauptadmin kann Mitarbeiter zu Einsatzleiter ändern.
- Hauptadmin kann Mitarbeiter zu Admin ändern.
- Hauptadmin kann bestehenden Admin wieder herabstufen.
- Admin kann Mitarbeiter zu Einsatzleiter und zurück ändern.
- Admin kann keinen Mitarbeiter zu Admin machen.
- Admin kann keinen bestehenden Admin verändern oder löschen.
- Admin kann den Hauptadmin nicht verändern oder löschen.
- Mitarbeiter/Einsatzleiter können keine Rollenverwaltung aufrufen.
- Nach einer erfolgreichen Rollenänderung liefert `/api/session` für den betroffenen Benutzer die neue Rolle.
- Rollenänderung wird in der Dienstplan-Mitarbeiterquelle synchronisiert.

## Nicht Teil dieser Änderung

- Keine Änderung am visuellen Grunddesign des Portals.
- Keine neuen öffentlichen Seiten.
- Keine Änderung an der bereits eingerichteten Hauptadmin-E-Mail-Konfiguration.
- Keine Erweiterung der normalen Mitarbeiterrechte.

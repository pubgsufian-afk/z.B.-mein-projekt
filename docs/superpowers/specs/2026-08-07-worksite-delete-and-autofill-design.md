# Einsatzorte löschen und Dienstplan automatisch ausfüllen

Datum: 07.08.2026
Status: vom Nutzer inhaltlich bestätigt, noch nicht implementiert
Zweig: `fix/pdf-logo-contact-20260807`

## Ziel

Admins sollen gespeicherte Einsatzorte löschen können. Gleichzeitig soll im Dienstplan beim Auswählen eines gespeicherten Einsatzortes dessen Name automatisch in das Feld `Bezeichnung des Einsatzortes` übernommen werden.

## Löschen von Einsatzorten

- Nur Rollen mit bestehendem Zugriff auf `Einsatzorte` (`owner`, `admin`) dürfen löschen.
- In der Liste `Gespeicherte Einsatzorte` erhält jeder Eintrag eine sichtbare Aktion `Löschen`.
- Vor dem Löschen erscheint eine Sicherheitsabfrage mit dem Namen des Einsatzortes.
- Nach Bestätigung wird nur der gespeicherte Einsatzort aus `objects/<id>` entfernt.
- Bereits vorhandene alte Dienstpläne bleiben unverändert. In bestehenden Diensten bleiben `location`, `workArea` und andere gespeicherte Schichtdaten erhalten, auch wenn der zugehörige Einsatzort später gelöscht wurde.
- Der gelöschte Ort erscheint nach erfolgreichem Löschen nicht mehr in `Gespeicherte Einsatzorte` und nicht mehr in der Auswahl beim Erstellen neuer Dienste.
- Ein Fehler beim Löschen zeigt eine verständliche Meldung und lässt den Eintrag sichtbar.

## Automatische Übernahme im Dienstplan

Beim Erstellen oder Bearbeiten eines Dienstes enthält das Formular weiterhin die Auswahl `Einsatzort` sowie das Textfeld `Bezeichnung des Einsatzortes`.

Wenn ein gespeicherter Einsatzort ausgewählt wird:

- `form.objectId` wird auf die ID des Einsatzortes gesetzt.
- `form.location` wird automatisch mit `object.name` gefüllt.
- Dadurch ist im Feld `Bezeichnung des Einsatzortes` sofort z. B. `Abbott Laboratories GmbH` sichtbar.
- Der Nutzer kann den Text anschließend weiterhin manuell ändern, falls für einen konkreten Dienst eine abweichende Bezeichnung nötig ist.

Wenn `Ohne gespeicherten Einsatzort` gewählt wird:

- `form.objectId` wird leer.
- Das Textfeld `Bezeichnung des Einsatzortes` bleibt frei editierbar.
- Ein zuvor automatisch übernommener Name wird nicht als versteckte Verknüpfung behalten.

## Datenintegrität

Das Löschen eines Einsatzortes darf keine alten Dienste löschen oder verändern. Ein Dienst speichert den Einsatzortnamen bereits direkt in `location`; deshalb bleiben historische Dienstpläne lesbar und PDFs können weiterhin den damaligen Namen ausgeben.

Die Serverfunktion erhält eine eigene Aktion `object-delete` mit einer strikten Rollenprüfung für `owner` und `admin`. Sie löscht ausschließlich den Schlüssel `objects/<id>` aus dem bestehenden Netlify-Blob-Store.

## Oberfläche auf dem iPhone

Die bestehende mobile Karte für einen gespeicherten Einsatzort bleibt kompakt. Die Aktionen `Bearbeiten` und `Löschen` werden so angeordnet, dass kein horizontaler Überlauf entsteht. `Löschen` ist klar als gefährliche Aktion erkennbar, aber nicht so groß, dass die Liste unnötig hoch wird.

## Tests

Die Umsetzung wird abgesichert durch:

- Backend-Test: `object-delete` ist nur für `owner`/`admin` erlaubt.
- Backend-Test: nach `object-delete` ist der Ort nicht mehr in `resource=objects` vorhanden.
- Regressionstest: vorhandene Schichten mit derselben `objectId` werden durch das Löschen nicht entfernt oder geändert.
- Browser-Test: Admin kann einen gespeicherten Einsatzort löschen und die Liste aktualisiert sich.
- Browser-Test: Abbrechen in der Bestätigungsabfrage löscht nichts.
- Browser-Test: Auswahl eines gespeicherten Einsatzortes füllt `Bezeichnung des Einsatzortes` automatisch mit dem Namen.
- Browser-Test: Mitarbeiter und Dienstplan-Support erhalten keine neue Löschberechtigung.
- Desktop-, iPhone- und Android-Browserlauf bleibt ohne horizontalen Überlauf grün.

## Nicht Teil dieser Änderung

- Alte Dienste werden nicht rückwirkend verändert.
- Es gibt keine Massenlöschung mehrerer Einsatzorte.
- Es gibt keinen Papierkorb oder Wiederherstellungsbereich.
- Die Standortkoordinaten-Logik beim Ein-/Ausstempeln wird nicht verändert.
- Keine Veröffentlichung ohne erneute ausdrückliche Freigabe des Nutzers.

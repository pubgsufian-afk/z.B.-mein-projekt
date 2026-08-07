# Google-Maps-Einsatzorte und robustes Arbeitsende

Datum: 07.08.2026
Status: vom Nutzer im Chat bestätigt
Zweig: `fix/worksite-maps-clockout-20260807`

## Ziel

Einsatzorte sollen über einen kopierten Google-Maps-Link bzw. einen gesetzten Google-Maps-Pin angelegt werden können. Aus dem Link werden die Koordinaten automatisch übernommen. Der Prüfradius bleibt frei einstellbar. Arbeitsbeginn bleibt strikt an Einsatzort und Radius gebunden; ein bereits laufender Dienst muss dagegen jederzeit beendet werden können, auch nach dem geplanten Dienstende und auch außerhalb des Radius.

## Einsatzorte

- Nur `owner` und `admin` dürfen Einsatzorte anlegen oder ändern.
- Das Einsatzortformular erhält ein Feld `Google-Maps-Link` und eine Aktion `Standort aus Link übernehmen`.
- Unterstützt werden direkte Google-Maps-Links mit Koordinaten sowie von Google Maps erzeugte Kurzlinks (`maps.app.goo.gl`).
- Kurzlinks werden ausschließlich serverseitig aufgelöst. Es werden nur Google-Maps-Domains akzeptiert; beliebige Fremd-URLs werden nicht abgerufen.
- Nach erfolgreicher Erkennung werden `latitude` und `longitude` automatisch in das Formular übernommen.
- `radiusMeters` bleibt frei einstellbar, z. B. 100 m, 300 m oder 500 m.
- Eine klassische postalische Adresse ist optional, damit noch nicht kartierte Baustellen allein über einen gesetzten Pin gespeichert werden können.
- Nach erkannter Position zeigt die Admin-Oberfläche eine kompakte Karten-/Positionsvorschau sowie die erkannten Koordinaten.
- Bestehende gespeicherte Einsatzorte bleiben kompatibel.

## Arbeitsbeginn

- `clock-in` ist nur innerhalb des gespeicherten Einsatzradius zulässig.
- Ohne konfigurierten Einsatzort, ohne Geräteposition oder außerhalb des Radius wird `clock-in` serverseitig abgelehnt.
- Die vorhandene begrenzte GPS-Genauigkeitstoleranz bleibt bestehen.
- Ein Arbeitsbeginn darf nicht nur lokal/offline vorgespiegelt werden, wenn der Server die Standortprüfung nicht durchführen kann.

## Arbeitsende

- Sobald eine Arbeitszeit läuft, bleibt `Arbeit beenden` sichtbar und bedienbar, auch wenn die geplante Endzeit bereits überschritten ist.
- Die geplante Dienstzeit begrenzt nur den Arbeitsbeginn, nicht das Arbeitsende eines bereits laufenden Dienstes.
- `clock-out` darf außerhalb des Einsatzradius gespeichert werden.
- Ist beim Arbeitsende ein Standort verfügbar, wird Distanz/Status weiterhin als Diagnose gespeichert (`inside`/`outside`).
- Ist beim Arbeitsende kein Standort verfügbar, wird der Vorgang trotzdem gespeichert und der Standortstatus lautet `unavailable`.
- Die tatsächliche gebuchte Endzeit wird gespeichert; es gibt kein automatisches Ende zur Planzeit.

## Pausen

- Bestehende Pausenlogik bleibt unverändert.
- Ein laufender Pausenzustand muss weiterhin erst beendet werden, bevor `clock-out` zulässig ist.

## Sicherheit und Datenschutz

- Keine dauerhafte Ortung. Standort wird nur bei einer Stempelaktion abgefragt.
- Google-Maps-Linkauflösung ist auf Google-Domains beschränkt, um SSRF auf beliebige Hosts zu vermeiden.
- Mitarbeiter erhalten keine zusätzlichen Adminrechte.

## Tests

- Regression: laufender Dienst bleibt nach geplantem Dienstende im Zustand `working` und kann beendet werden.
- Regression: `clock-in` außerhalb des Dienstfensters bleibt gesperrt.
- Regression: `clock-out` wird auch nach dem Dienstfenster angenommen.
- Regression: `clock-in` außerhalb des Radius wird abgelehnt.
- Regression: `clock-out` außerhalb des Radius wird gespeichert und als `outside` markiert.
- Regression: `clock-out` ohne Geräteposition wird gespeichert und als `unavailable` markiert.
- Google-Maps-Parser: direkte Koordinaten-URLs werden erkannt; Kurzlinks werden nur für erlaubte Google-Hosts aufgelöst; Fremd-URLs werden abgelehnt.
- UI: Google-Maps-Link füllt Koordinaten; Radius ist weiterhin editierbar; Arbeitsende bleibt bei `working` sichtbar.

## Veröffentlichung

Diese Änderung wird zunächst nur auf dem oben genannten GitHub-Zweig vorbereitet. Keine Produktionsveröffentlichung ohne ausdrückliche Freigabe.
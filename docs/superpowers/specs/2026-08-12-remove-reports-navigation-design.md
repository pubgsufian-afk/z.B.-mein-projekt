# Berichte aus der Navigation entfernen – Design

Datum: 12.08.2026

## Ziel

Der sichtbare Menüpunkt **„Berichte“** wird aus der linken Hauptnavigation des Habun-Mitarbeiterportals entfernt.

## Gewählte Lösung

Es wird nur der Navigationseintrag entfernt. Die dahinterliegenden Berichtsfunktionen werden nicht pauschal gelöscht.

Damit bleiben insbesondere erhalten:

- PDF-/Excel-Download im **Stundenzettel**
- Downloads und Vergleichsfunktionen im **Stempelprotokoll**
- bestehende interne Report-Endpunkte, soweit andere Portalbereiche sie weiterhin benötigen

## Nicht gewählte Alternative

Eine vollständige Entfernung der Berichte-Seite inklusive Report-Endpunkten wäre technisch umfassender, könnte aber bestehende Downloads oder andere Funktionen unnötig beschädigen. Das ist nicht gewünscht.

## Verhalten nach der Änderung

Für Chef/Hauptadmin, Admin und Einsatzleiter erscheint **„Berichte“** nicht mehr im Seitenmenü. Die übrige Navigation bleibt in gleicher Reihenfolge und mit denselben Rollenrechten bestehen.

Direkte PDF-/Excel-Aktionen innerhalb von Stundenzettel und Stempelprotokoll bleiben verfügbar.

## Technische Umsetzung

Die Änderung erfolgt an der Quelle, aus der die Navigation gebaut wird. Da das Projekt während Build/Verify mehrere Patch-Skripte verwendet, muss zusätzlich geprüft werden, dass kein Build-Skript den Menüpunkt „Berichte“ wieder einfügt.

Es werden keine Datenbankänderungen benötigt.

## Tests

Vor dem Merge müssen mindestens diese Punkte geprüft werden:

1. Der Menüpunkt „Berichte“ ist bei Management-Rollen nicht mehr sichtbar.
2. Die übrigen Menüpunkte bleiben sichtbar und funktionsfähig.
3. Stundenzettel-PDF/Excel bleibt erreichbar.
4. Stempelprotokoll und dessen Export-/Vergleichsfunktionen bleiben erreichbar.
5. Der vollständige bestehende Verify-, Build- und E2E-Lauf bleibt grün.

## Veröffentlichung

Erst nach grüner Gesamtprüfung wird die Änderung gemergt. Ein Production-Deploy wird nur einmal und nur für den geprüften Stand ausgelöst.
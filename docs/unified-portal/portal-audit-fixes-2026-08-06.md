# Portal-Audit-Korrekturen – 06.08.2026

Dieser Arbeitszweig behebt drei beim Produktionsaudit gefundene Fehler:

1. Pausen ohne Standort dürfen im Stundenbericht keine falsche Standortwarnung erzeugen.
2. Das Tagesdatum im Frontend muss aus der Zeitzone Europe/Berlin stammen.
3. Das erneute Kopieren der Vorwoche darf keine identischen Dienste doppelt anlegen.

Die Änderungen werden durch `scripts/portal-audit-regression-test.mjs` abgesichert.

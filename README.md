# Mein Behördenhub

> Private Android-App (Flutter) zur Verwaltung eigener Behördenportale in einem Dashboard.  
> **Wichtig:** Keine offizielle App einer Behörde, keine Umgehung von Login-, CAPTCHA- oder 2FA-Schutz.

## Projektarchitektur

```text
lib/
  app/
    mein_behoerdenhub_app.dart
  core/
    errors/
    notifications/
    router/
    security/
    storage/
    theme/
  features/
    onboarding/presentation/
    dashboard/presentation/
    portals/
      domain/
      application/
      presentation/
    notes/domain/
    reminders/domain/
    settings/presentation/
  shared/widgets/
```

## Enthaltene erste Version (MVP)

- Onboarding mit Hinweis „nicht offiziell“ und PIN-Eingabe-Start.
- Dashboard mit Suchfeld und Portalkarten.
- Portal hinzufügen (manuell) inkl. URL-Validierung.
- Portal-Detailseite mit Status-Aktionen.
- In-App WebView + Fallback auf Systembrowser.
- Einstellungsseite (Dark Mode, Biometrie-Flag, Privacy Mode).
- Sicherheits- und Reminder-Services als Basis.
- Datenmodelle für Portal, Notizen, Erinnerungen, App-Settings.

## Setup

1. Flutter installieren (stable Channel).
2. Abhängigkeiten holen:

```bash
flutter pub get
```

3. Android starten:

```bash
flutter run
```

## Sicherheitshinweise

- Keine Klartext-Passwörter speichern.
- Standardmäßig direkt auf den offiziellen Seiten anmelden.
- Sensible App-Daten über `flutter_secure_storage` schützen.
- Für produktive Nutzung: Drift/Hive-Verschlüsselung vollständig implementieren.

## Nächste Schritte (Roadmap)

1. Drift/Hive mit echter Verschlüsselung und Migrationen.
2. PIN/Biometrie-Flow mit Inaktivitäts-Auto-Lock.
3. Notizen/Reminder CRUD inkl. lokaler Benachrichtigungsplanung.
4. Import/Export (nur Metadaten), Session-Cleanup, Mehrsprachigkeit (de/en).
5. Saubere Tests (`flutter test`, Widget Tests, Repository Tests).

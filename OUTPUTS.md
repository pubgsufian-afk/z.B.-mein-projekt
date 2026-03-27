# Build/Output Standorte

## Vorhandene Flutter-Plattformordner

Diese Ordner sind im Repository-Root vorhanden:

- `android/`
- `ios/`

## Wenn ein APK-Build erfolgreich läuft

Der Standardpfad für die Release-APK ist:

- `build/app/outputs/flutter-apk/app-release.apk`

## iOS Build-Ausgabe

Nach `flutter build ios --release` liegen die Artefakte typischerweise unter:

- `build/ios/iphoneos/Runner.app`

## Lokale Verifikation

```bash
find . -maxdepth 1 -mindepth 1 | sed 's#^./##' | sort
```

```bash
ls -lah build/app/outputs/flutter-apk/  # falls APK gebaut wurde
```

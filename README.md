# Mein Behördenhub

Wiederhergestellte Flutter-MVP-App für den privaten, sicheren Zugriff auf eigene Behördenportale.

## Projektstatus

- Flutter-MVP ist wiederhergestellt (`lib/` + Navigation + Dashboard + Portalflows).
- Plattformordner `android/` und `ios/` sind vorhanden.
- `pubspec.yaml` ist vorhanden.

## App lokal starten

```bash
flutter pub get
flutter run
```

## Android APK bauen

Debug:

```bash
flutter build apk --debug
```

Release:

```bash
flutter build apk --release
```

APK-Pfad:

```text
build/app/outputs/flutter-apk/app-release.apk
```

## iPhone Build vorbereiten und bauen

```bash
cd ios
pod install
cd ..
```

Dann in Xcode:
- `ios/Runner.xcworkspace` öffnen
- Signing Team setzen
- Bundle Identifier setzen

Build:

```bash
flutter build ios --release
```

oder direkt Run auf Gerät/Simulator:

```bash
flutter run -d <ios_device_id>
```

## Wichtiger Hinweis

Wenn deine lokale Flutter-Version andere Plattform-Templates erwartet, führe einmal aus:

```bash
flutter create --platforms=android,ios .
```

## Strukturprüfung

Zur schnellen Verifikation im Repo-Root:

```bash
find . -maxdepth 1 -mindepth 1 | sed 's#^./##' | sort
```

Erwartet: mindestens `android`, `ios`, `lib`, `pubspec.yaml`, `README.md`.

## Finaler Root-File-Tree

```text
.gitignore
.metadata
README.md
analysis_options.yaml
android/
ios/
lib/
pubspec.yaml
```

## Ausgabeorte

- Android Plattformprojekt: `android/`
- iOS Plattformprojekt: `ios/`
- APK (nach erfolgreichem Build): `build/app/outputs/flutter-apk/app-release.apk`
- iOS App (nach erfolgreichem Build): `build/ios/iphoneos/Runner.app`


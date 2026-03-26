import '../../features/portals/domain/portal.dart';

/// Platzhalter für Drift/Hive-Integration mit Verschlüsselung.
class LocalStorageService {
  Future<void> initEncryptedProfile() async {
    // TODO: Datenbank mit Schlüssel aus Keystore/Keychain initialisieren.
  }

  Future<List<Portal>> loadPortals() async {
    return const [];
  }

  Future<void> savePortals(List<Portal> portals) async {
    // TODO: Portale in lokaler, verschlüsselter DB speichern.
  }
}

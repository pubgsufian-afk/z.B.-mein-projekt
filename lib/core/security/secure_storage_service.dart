import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStorageService {
  SecureStorageService() : _storage = const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  Future<void> savePinHash(String hash) async {
    await _storage.write(key: 'app_pin_hash', value: hash);
  }

  Future<String?> getPinHash() => _storage.read(key: 'app_pin_hash');

  Future<void> clearAll() => _storage.deleteAll();
}

class AppSettings {
  const AppSettings({
    this.darkMode = false,
    this.biometricEnabled = true,
    this.autoLockMinutes = 2,
    this.language = 'de',
    this.privacyModeEnabled = false,
  });

  final bool darkMode;
  final bool biometricEnabled;
  final int autoLockMinutes;
  final String language;
  final bool privacyModeEnabled;

  AppSettings copyWith({
    bool? darkMode,
    bool? biometricEnabled,
    int? autoLockMinutes,
    String? language,
    bool? privacyModeEnabled,
  }) {
    return AppSettings(
      darkMode: darkMode ?? this.darkMode,
      biometricEnabled: biometricEnabled ?? this.biometricEnabled,
      autoLockMinutes: autoLockMinutes ?? this.autoLockMinutes,
      language: language ?? this.language,
      privacyModeEnabled: privacyModeEnabled ?? this.privacyModeEnabled,
    );
  }
}

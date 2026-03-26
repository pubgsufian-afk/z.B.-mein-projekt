import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_settings.dart';

final settingsControllerProvider = StateNotifierProvider<SettingsController, AppSettings>(
  (ref) => SettingsController(),
);

class SettingsController extends StateNotifier<AppSettings> {
  SettingsController() : super(const AppSettings());

  void toggleDarkMode(bool value) {
    state = state.copyWith(darkMode: value);
  }

  void toggleBiometric(bool value) {
    state = state.copyWith(biometricEnabled: value);
  }

  void togglePrivacyMode(bool value) {
    state = state.copyWith(privacyModeEnabled: value);
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'settings_controller.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsControllerProvider);
    final controller = ref.read(settingsControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('Einstellungen')),
      body: ListView(
        children: [
          SwitchListTile(
            title: const Text('Dark Mode'),
            value: settings.darkMode,
            onChanged: controller.toggleDarkMode,
          ),
          SwitchListTile(
            title: const Text('Biometrische Entsperrung'),
            value: settings.biometricEnabled,
            onChanged: controller.toggleBiometric,
          ),
          SwitchListTile(
            title: const Text('Privatsphäre-Modus (Namen ausblenden)'),
            value: settings.privacyModeEnabled,
            onChanged: controller.togglePrivacyMode,
          ),
          ListTile(
            title: const Text('Sitzungen löschen'),
            subtitle: const Text('Entfernt lokale Browser-Sitzungen für Portale.'),
            onTap: () {},
          ),
          ListTile(
            title: const Text('Export (nur Metadaten)'),
            onTap: () {},
          ),
          ListTile(
            title: const Text('Alle lokalen Daten löschen'),
            textColor: Colors.red,
            onTap: () {},
          ),
        ],
      ),
    );
  }
}

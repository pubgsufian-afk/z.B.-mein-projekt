import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../application/portal_controller.dart';
import '../domain/portal.dart';

class PortalDetailScreen extends ConsumerWidget {
  const PortalDetailScreen({super.key, required this.portalId});

  final String portalId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(portalControllerProvider.notifier);
    final portal = controller.byId(portalId);
    if (portal == null) {
      return const Scaffold(body: Center(child: Text('Portal nicht gefunden')));
    }

    return Scaffold(
      appBar: AppBar(title: Text(portal.name)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(portal.url, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text('Kategorie: ${portal.category.name}'),
          Text('Zuletzt geöffnet: ${_formatDate(portal.lastOpenedAt)}'),
          Text('Notiz: ${portal.notePreview.isEmpty ? 'Keine Notiz' : portal.notePreview}'),
          const SizedBox(height: 12),
          const Card(
            child: Padding(
              padding: EdgeInsets.all(12),
              child: Text(
                'Dieses Portal verwaltet Login und Sicherheit selbst. Manche Funktionen benötigen den Systembrowser.',
              ),
            ),
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: () => context.push('/portal/$portalId/browser'),
            icon: const Icon(Icons.open_in_browser),
            label: const Text('Portal öffnen'),
          ),
          OutlinedButton(
            onPressed: () => controller.updateStatus(portalId, PortalStatus.checked),
            child: const Text('Als geprüft markieren'),
          ),
          OutlinedButton(
            onPressed: () => controller.updateStatus(portalId, PortalStatus.important),
            child: const Text('Als wichtig markieren'),
          ),
          OutlinedButton(
            onPressed: () {},
            child: const Text('Erinnerung setzen (Stub)'),
          ),
        ],
      ),
    );
  }

  String _formatDate(DateTime? dt) {
    if (dt == null) return 'Noch nie';
    return DateFormat('dd.MM.yyyy HH:mm').format(dt);
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/portal_card.dart';
import '../../portals/application/portal_controller.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final portals = ref.watch(portalControllerProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mein Behördenhub'),
        actions: [
          IconButton(onPressed: () => context.push('/settings'), icon: const Icon(Icons.settings)),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              onChanged: ref.read(portalControllerProvider.notifier).search,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Portale, URLs, Notizen durchsuchen',
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: portals.length,
              itemBuilder: (context, index) {
                final portal = portals[index];
                return PortalCard(portal: portal, onTap: () => context.push('/portal/${portal.id}'));
              },
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/add-portal'),
        icon: const Icon(Icons.add),
        label: const Text('Neues Portal'),
      ),
    );
  }
}

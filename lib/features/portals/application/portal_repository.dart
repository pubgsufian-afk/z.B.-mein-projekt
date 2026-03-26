import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/portal.dart';

final portalRepositoryProvider = Provider<PortalRepository>((ref) {
  return InMemoryPortalRepository();
});

abstract class PortalRepository {
  List<Portal> getAll();
  List<Portal> search(String query);
  Portal? byId(String id);
  void save(Portal portal);
}

class InMemoryPortalRepository implements PortalRepository {
  final List<Portal> _portals = [
    Portal(
      id: '1',
      name: 'Jobcenter',
      url: 'https://www.jobcenter.digital',
      category: PortalCategory.jobcenter,
      icon: 'work',
      colorValue: Colors.blue.value,
      notePreview: 'Unterlagen prüfen',
      lastOpenedAt: DateTime.now().subtract(const Duration(days: 1)),
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
      status: PortalStatus.reminder,
      openMode: OpenMode.inApp,
    ),
    Portal(
      id: '2',
      name: 'BundID',
      url: 'https://id.bund.de',
      category: PortalCategory.identitaet,
      icon: 'shield',
      colorValue: Colors.green.value,
      notePreview: 'Identitätsnachweis offen',
      lastOpenedAt: DateTime.now().subtract(const Duration(days: 5)),
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
      status: PortalStatus.unchecked,
      openMode: OpenMode.external,
    ),
  ];

  @override
  Portal? byId(String id) {
    try {
      return _portals.firstWhere((p) => p.id == id);
    } catch (_) {
      return null;
    }
  }

  @override
  List<Portal> getAll() => [..._portals];

  @override
  void save(Portal portal) {
    final index = _portals.indexWhere((p) => p.id == portal.id);
    if (index == -1) {
      _portals.add(portal);
      return;
    }
    _portals[index] = portal;
  }

  @override
  List<Portal> search(String query) {
    if (query.trim().isEmpty) return getAll();
    final q = query.toLowerCase();
    return _portals
        .where(
          (p) =>
              p.name.toLowerCase().contains(q) ||
              p.url.toLowerCase().contains(q) ||
              p.notePreview.toLowerCase().contains(q) ||
              p.category.name.toLowerCase().contains(q) ||
              p.status.name.toLowerCase().contains(q),
        )
        .toList(growable: false);
  }
}

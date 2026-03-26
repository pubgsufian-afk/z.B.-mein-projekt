import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/portal.dart';
import 'portal_repository.dart';

final portalControllerProvider = StateNotifierProvider<PortalController, List<Portal>>((ref) {
  final repo = ref.watch(portalRepositoryProvider);
  return PortalController(repo)..load();
});

class PortalController extends StateNotifier<List<Portal>> {
  PortalController(this._repository) : super(const []);

  final PortalRepository _repository;

  void load() {
    state = _repository.getAll();
  }

  void search(String query) {
    state = _repository.search(query);
  }

  Portal? byId(String id) => _repository.byId(id);

  void addPortal({
    required String name,
    required String url,
    required PortalCategory category,
    String note = '',
  }) {
    final now = DateTime.now();
    final portal = Portal(
      id: now.microsecondsSinceEpoch.toString(),
      name: name,
      url: url,
      category: category,
      icon: 'public',
      colorValue: 0xFF4457FF,
      notePreview: note,
      lastOpenedAt: null,
      createdAt: now,
      updatedAt: now,
      status: PortalStatus.unchecked,
      openMode: OpenMode.inApp,
    );
    _repository.save(portal);
    load();
  }

  void updateStatus(String id, PortalStatus status) {
    final portal = _repository.byId(id);
    if (portal == null) return;
    _repository.save(portal.copyWith(status: status, updatedAt: DateTime.now()));
    load();
  }
}

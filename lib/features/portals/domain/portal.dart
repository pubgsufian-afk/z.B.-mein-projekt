enum PortalCategory { jobcenter, familie, arbeit, identitaet, gericht, sonstiges }

enum PortalStatus { unchecked, checked, important, reminder }

enum OpenMode { inApp, external }

class Portal {
  const Portal({
    required this.id,
    required this.name,
    required this.url,
    required this.category,
    required this.icon,
    required this.colorValue,
    required this.notePreview,
    required this.lastOpenedAt,
    required this.createdAt,
    required this.updatedAt,
    required this.status,
    required this.openMode,
  });

  final String id;
  final String name;
  final String url;
  final PortalCategory category;
  final String icon;
  final int colorValue;
  final String notePreview;
  final DateTime? lastOpenedAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  final PortalStatus status;
  final OpenMode openMode;

  Portal copyWith({
    String? id,
    String? name,
    String? url,
    PortalCategory? category,
    String? icon,
    int? colorValue,
    String? notePreview,
    DateTime? lastOpenedAt,
    DateTime? createdAt,
    DateTime? updatedAt,
    PortalStatus? status,
    OpenMode? openMode,
  }) {
    return Portal(
      id: id ?? this.id,
      name: name ?? this.name,
      url: url ?? this.url,
      category: category ?? this.category,
      icon: icon ?? this.icon,
      colorValue: colorValue ?? this.colorValue,
      notePreview: notePreview ?? this.notePreview,
      lastOpenedAt: lastOpenedAt ?? this.lastOpenedAt,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      status: status ?? this.status,
      openMode: openMode ?? this.openMode,
    );
  }
}

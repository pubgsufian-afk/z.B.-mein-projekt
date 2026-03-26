class PortalNote {
  const PortalNote({
    required this.id,
    required this.portalId,
    required this.content,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String portalId;
  final String content;
  final DateTime createdAt;
  final DateTime updatedAt;
}

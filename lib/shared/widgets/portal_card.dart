import 'package:flutter/material.dart';

import '../../features/portals/domain/portal.dart';

class PortalCard extends StatelessWidget {
  const PortalCard({
    super.key,
    required this.portal,
    required this.onTap,
  });

  final Portal portal;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        onTap: onTap,
        leading: CircleAvatar(
          backgroundColor: Color(portal.colorValue),
          child: const Icon(Icons.public),
        ),
        title: Text(portal.name),
        subtitle: Text('${portal.url}\nNotiz: ${portal.notePreview}'),
        isThreeLine: true,
        trailing: Chip(label: Text(portal.status.name)),
      ),
    );
  }
}

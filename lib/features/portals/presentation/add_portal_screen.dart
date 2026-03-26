import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../application/portal_controller.dart';
import '../domain/portal.dart';

class AddPortalScreen extends ConsumerStatefulWidget {
  const AddPortalScreen({super.key});

  @override
  ConsumerState<AddPortalScreen> createState() => _AddPortalScreenState();
}

class _AddPortalScreenState extends ConsumerState<AddPortalScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _urlController = TextEditingController();
  final _noteController = TextEditingController();
  PortalCategory _category = PortalCategory.sonstiges;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Portal hinzufügen')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(labelText: 'Portalname'),
              validator: (v) => (v == null || v.isEmpty) ? 'Bitte Namen eingeben' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _urlController,
              decoration: const InputDecoration(labelText: 'Website-URL'),
              validator: (v) {
                final value = v ?? '';
                final uri = Uri.tryParse(value);
                if (uri == null || !(uri.hasScheme && uri.hasAuthority)) {
                  return 'Ungültige URL';
                }
                return null;
              },
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<PortalCategory>(
              value: _category,
              items: PortalCategory.values
                  .map((c) => DropdownMenuItem(value: c, child: Text(c.name)))
                  .toList(growable: false),
              onChanged: (v) => setState(() => _category = v ?? PortalCategory.sonstiges),
              decoration: const InputDecoration(labelText: 'Kategorie'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _noteController,
              minLines: 2,
              maxLines: 4,
              decoration: const InputDecoration(labelText: 'Optionale Notiz'),
            ),
            const SizedBox(height: 18),
            FilledButton(
              onPressed: () {
                if (!_formKey.currentState!.validate()) return;
                ref.read(portalControllerProvider.notifier).addPortal(
                      name: _nameController.text.trim(),
                      url: _urlController.text.trim(),
                      category: _category,
                      note: _noteController.text.trim(),
                    );
                context.pop();
              },
              child: const Text('Portal speichern'),
            ),
          ],
        ),
      ),
    );
  }
}

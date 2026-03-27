import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _pinController = TextEditingController();

  @override
  void dispose() {
    _pinController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Willkommen bei Mein Behördenhub')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Diese App ist ein privater Portal-Manager und keine offizielle Behördensoftware.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _pinController,
              maxLength: 6,
              keyboardType: TextInputType.number,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Lokale PIN festlegen',
                hintText: 'z. B. 6-stellig',
              ),
            ),
            const Spacer(),
            FilledButton.icon(
              onPressed: () {
                context.go('/');
              },
              icon: const Icon(Icons.lock_outline),
              label: const Text('Profil lokal verschlüsselt starten'),
            ),
          ],
        ),
      ),
    );
  }
}

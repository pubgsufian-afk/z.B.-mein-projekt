import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../application/portal_controller.dart';

class PortalBrowserScreen extends ConsumerStatefulWidget {
  const PortalBrowserScreen({super.key, required this.portalId});

  final String portalId;

  @override
  ConsumerState<PortalBrowserScreen> createState() => _PortalBrowserScreenState();
}

class _PortalBrowserScreenState extends ConsumerState<PortalBrowserScreen> {
  WebViewController? _webController;
  bool _webViewFailed = false;

  @override
  void initState() {
    super.initState();
    final portal = ref.read(portalControllerProvider.notifier).byId(widget.portalId);
    if (portal == null) return;

    _webController = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onWebResourceError: (_) {
            setState(() => _webViewFailed = true);
          },
        ),
      )
      ..loadRequest(Uri.parse(portal.url));
  }

  @override
  Widget build(BuildContext context) {
    final portal = ref.read(portalControllerProvider.notifier).byId(widget.portalId);
    if (portal == null) {
      return const Scaffold(body: Center(child: Text('Portal nicht gefunden')));
    }

    return Scaffold(
      appBar: AppBar(
        title: Text('Portal: ${portal.name}'),
        actions: [
          IconButton(
            onPressed: () async {
              await launchUrl(Uri.parse(portal.url), mode: LaunchMode.externalApplication);
            },
            icon: const Icon(Icons.open_in_new),
          ),
        ],
      ),
      body: _webViewFailed || _webController == null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('WebView nicht verfügbar. Bitte im Systembrowser öffnen.'),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: () async {
                        await launchUrl(Uri.parse(portal.url), mode: LaunchMode.externalApplication);
                      },
                      child: const Text('Im Systembrowser öffnen'),
                    ),
                  ],
                ),
              ),
            )
          : WebViewWidget(controller: _webController!),
    );
  }
}

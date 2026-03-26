import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/dashboard/presentation/dashboard_screen.dart';
import '../../features/onboarding/presentation/onboarding_screen.dart';
import '../../features/portals/presentation/add_portal_screen.dart';
import '../../features/portals/presentation/portal_browser_screen.dart';
import '../../features/portals/presentation/portal_detail_screen.dart';
import '../../features/settings/presentation/settings_screen.dart';

final appRouter = GoRouter(
  initialLocation: '/onboarding',
  routes: [
    GoRoute(path: '/onboarding', builder: (context, state) => const OnboardingScreen()),
    GoRoute(path: '/', builder: (context, state) => const DashboardScreen(), routes: [
      GoRoute(path: 'add-portal', builder: (context, state) => const AddPortalScreen()),
      GoRoute(
        path: 'portal/:id',
        builder: (context, state) => PortalDetailScreen(portalId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: 'portal/:id/browser',
        builder: (context, state) => PortalBrowserScreen(portalId: state.pathParameters['id']!),
      ),
      GoRoute(path: 'settings', builder: (context, state) => const SettingsScreen()),
    ]),
  ],
);

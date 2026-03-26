import 'package:flutter/material.dart';

class AppTheme {
  static final light = ThemeData(
    useMaterial3: true,
    colorSchemeSeed: const Color(0xFF2446D8),
    brightness: Brightness.light,
    cardTheme: const CardThemeData(margin: EdgeInsets.symmetric(horizontal: 16, vertical: 8)),
  );

  static final dark = ThemeData(
    useMaterial3: true,
    colorSchemeSeed: const Color(0xFF6C86FF),
    brightness: Brightness.dark,
  );
}

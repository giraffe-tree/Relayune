import 'package:flutter/material.dart';

@immutable
class RelayRenderingCapabilities
    extends ThemeExtension<RelayRenderingCapabilities> {
  const RelayRenderingCapabilities({
    this.usesIosSimulatorEmojiFallback = false,
  });

  final bool usesIosSimulatorEmojiFallback;

  @override
  RelayRenderingCapabilities copyWith({bool? usesIosSimulatorEmojiFallback}) =>
      RelayRenderingCapabilities(
        usesIosSimulatorEmojiFallback:
            usesIosSimulatorEmojiFallback ?? this.usesIosSimulatorEmojiFallback,
      );

  @override
  RelayRenderingCapabilities lerp(
    covariant RelayRenderingCapabilities? other,
    double t,
  ) => t < 0.5 ? this : (other ?? this);
}

/// The native expression of the Relayune web workbench design system.
///
/// Keep these values aligned with the CSS custom properties in
/// `app/globals.css`; native screens should feel like the same product instead
/// of a separate Material skin.
class RelayTheme {
  static const background = Color(0xFF0D0D0D);
  static const panel = Color(0xFF121212);
  static const panelRaised = Color(0xFF181818);
  static const panelSoft = Color(0xFF151515);
  static const field = Color(0xFF0F0F0F);
  static const line = Color(0xFF292929);
  static const lineSoft = Color(0xFF202020);

  static const text = Color(0xFFF3F3F1);
  static const muted = Color(0xFF8F8F8C);
  static const mutedBright = Color(0xFFB8B8B4);

  static const green = Color(0xFF7FD6A3);
  static const greenStrong = Color(0xFFA6E3B9);
  static const greenBackground = Color(0xFF153222);
  static const amber = Color(0xFFD9A94F);
  static const amberBackground = Color(0xFF352712);
  static const red = Color(0xFFE88181);
  static const redBackground = Color(0xFF351B1B);

  // Compatibility names used throughout the existing feature widgets.
  static const ink = text;
  static const paper = background;
  static const surface = panelRaised;
  static const fern = green;
  static const mint = greenBackground;
  static const ember = red;

  static ThemeData get web => webFor();

  static ThemeData webFor({bool usesIosSimulatorEmojiFallback = false}) {
    const scheme = ColorScheme.dark(
      primary: Color(0xFFF2F2ED),
      onPrimary: Color(0xFF111111),
      primaryContainer: Color(0xFF222222),
      onPrimaryContainer: text,
      secondary: green,
      onSecondary: Color(0xFF102419),
      secondaryContainer: greenBackground,
      onSecondaryContainer: greenStrong,
      tertiary: amber,
      onTertiary: Color(0xFF21170A),
      tertiaryContainer: amberBackground,
      onTertiaryContainer: Color(0xFFF4D99E),
      error: red,
      onError: Color(0xFF280A0A),
      errorContainer: redBackground,
      onErrorContainer: Color(0xFFF0BEBE),
      surface: panel,
      onSurface: text,
      onSurfaceVariant: mutedBright,
      outline: line,
      outlineVariant: lineSoft,
      shadow: Colors.black,
      scrim: Colors.black,
      inverseSurface: Color(0xFFF2F2ED),
      onInverseSurface: Color(0xFF111111),
      inversePrimary: Color(0xFF22583B),
    );
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      canvasColor: panel,
      cardColor: panelRaised,
      dividerColor: line,
      splashFactory: InkSparkle.splashFactory,
    );
    return base.copyWith(
      extensions: [
        RelayRenderingCapabilities(
          usesIosSimulatorEmojiFallback: usesIosSimulatorEmojiFallback,
        ),
      ],
      textTheme: base.textTheme
          .apply(bodyColor: text, displayColor: text)
          .copyWith(
            bodyLarge: const TextStyle(fontSize: 16, height: 1.55, color: text),
            bodyMedium: const TextStyle(fontSize: 15, height: 1.5, color: text),
            bodySmall: const TextStyle(
              fontSize: 12,
              height: 1.45,
              color: mutedBright,
            ),
            titleMedium: const TextStyle(
              fontSize: 17,
              height: 1.35,
              fontWeight: FontWeight.w600,
              color: text,
            ),
            headlineSmall: const TextStyle(
              fontSize: 24,
              height: 1.3,
              fontWeight: FontWeight.w600,
              color: text,
            ),
          ),
      primaryTextTheme: base.primaryTextTheme.apply(
        bodyColor: text,
        displayColor: text,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFF111111),
        foregroundColor: text,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        shape: Border(bottom: BorderSide(color: line)),
      ),
      cardTheme: CardThemeData(
        color: panelRaised,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(9),
          side: const BorderSide(color: line),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: panelRaised,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: line),
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: panelRaised,
        modalBackgroundColor: panelRaised,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
          side: BorderSide(color: line),
        ),
      ),
      drawerTheme: const DrawerThemeData(
        backgroundColor: Color(0xFF111111),
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: line),
          borderRadius: BorderRadius.horizontal(right: Radius.circular(10)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: field,
        labelStyle: const TextStyle(color: mutedBright, fontSize: 13),
        hintStyle: const TextStyle(color: Color(0xFF666662)),
        helperStyle: const TextStyle(color: muted, fontSize: 11),
        prefixIconColor: const Color(0xFF7F7F7B),
        suffixIconColor: muted,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 14,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: Color(0xFF353535)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: Color(0xFF353535)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: Color(0xFF6D9A7B), width: 1.4),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: lineSoft),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: red),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: red, width: 1.4),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFFF2F2ED),
          foregroundColor: const Color(0xFF111111),
          disabledBackgroundColor: const Color(0xFF343431),
          disabledForegroundColor: muted,
          minimumSize: const Size(44, 48),
          padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 12),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          side: const BorderSide(color: Color(0xFFE5E5DF)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: const Color(0xFFE8E8E2),
          minimumSize: const Size(44, 44),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          side: const BorderSide(color: Color(0xFF454540)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: mutedBright,
          minimumSize: const Size(44, 44),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(7)),
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: mutedBright,
          minimumSize: const Size(44, 44),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: const Color(0xFF111111),
        indicatorColor: const Color(0xFF252525),
        surfaceTintColor: Colors.transparent,
        shadowColor: Colors.transparent,
        elevation: 0,
        height: 64,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected) ? greenStrong : muted,
            size: 21,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            color: states.contains(WidgetState.selected) ? text : muted,
            fontSize: 10,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w600
                : FontWeight.w500,
          ),
        ),
      ),
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: Color(0xFF111111),
        indicatorColor: Color(0xFF252525),
        selectedIconTheme: IconThemeData(color: greenStrong),
        unselectedIconTheme: IconThemeData(color: muted),
        selectedLabelTextStyle: TextStyle(color: text, fontSize: 10),
        unselectedLabelTextStyle: TextStyle(color: muted, fontSize: 10),
      ),
      listTileTheme: const ListTileThemeData(
        iconColor: muted,
        textColor: text,
        selectedColor: greenStrong,
        selectedTileColor: Color(0xFF222222),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(7)),
        ),
      ),
      expansionTileTheme: const ExpansionTileThemeData(
        textColor: text,
        iconColor: mutedBright,
        collapsedTextColor: mutedBright,
        collapsedIconColor: muted,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(7)),
        ),
        collapsedShape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(7)),
        ),
      ),
      dividerTheme: const DividerThemeData(color: line, space: 1, thickness: 1),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: green,
        linearTrackColor: lineSoft,
        circularTrackColor: lineSoft,
      ),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: Color(0xFF242424),
        contentTextStyle: TextStyle(color: text),
        actionTextColor: greenStrong,
        behavior: SnackBarBehavior.floating,
      ),
      badgeTheme: const BadgeThemeData(
        backgroundColor: greenBackground,
        textColor: greenStrong,
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: panelRaised,
        surfaceTintColor: Colors.transparent,
        textStyle: const TextStyle(color: text),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: const BorderSide(color: line),
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: Color(0xFF111111),
        selectedItemColor: greenStrong,
        unselectedItemColor: muted,
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: const Color(0xFF252525),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: line),
        ),
        textStyle: const TextStyle(color: text, fontSize: 11),
      ),
    );
  }

  // Kept temporarily for call sites and tests compiled against the old name.
  static ThemeData get light => web;
}

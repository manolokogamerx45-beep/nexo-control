import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/api_client.dart';
import 'features/auth/auth_repository.dart';
import 'features/auth/auth_view_model.dart';
import 'features/auth/auth_screen.dart';
import 'features/inventory/inventory_view_model.dart';
import 'features/inventory/home_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    final api = ApiClient(
      baseUrl: const String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: 'http://127.0.0.1:4173',
      ),
    );
    runApp(NexoApp(auth: AuthViewModel(ServerAuthRepository(api))));
  } on ApiException catch (e) {
    runApp(
      MaterialApp(
        home: Scaffold(
          body: SafeArea(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(e.message),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class NexoApp extends StatefulWidget {
  const NexoApp({super.key, required this.auth, this.inventoryRepository});
  final AuthViewModel auth;
  final InventoryRepository? inventoryRepository;
  @override
  State<NexoApp> createState() => _NexoAppState();
}

class _NexoAppState extends State<NexoApp> {
  @override
  void initState() {
    super.initState();
    widget.auth.initialize();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Nexo · Inventario',
    debugShowCheckedModeBanner: false,
    locale: const Locale('es', 'MX'),
    supportedLocales: const [Locale('es', 'MX')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF244D40),
        primary: const Color(0xFF244D40),
        secondary: const Color(0xFF52751E),
        surface: const Color(0xFFFAFAF5),
      ),
      scaffoldBackgroundColor: const Color(0xFFF5F6F0),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: Color(0xFF244D40),
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFFF5F6F0),
        foregroundColor: Color(0xFF203D33),
        centerTitle: false,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        contentPadding: const EdgeInsets.all(16),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(48, 52)),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: Colors.white,
        margin: const EdgeInsets.only(bottom: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(color: Color(0xFFE1E6DC)),
        ),
      ),
    ),
    home: AnimatedBuilder(
      animation: widget.auth,
      builder: (context, _) {
        final auth = widget.auth;
        if (auth.initializing) {
          return const Scaffold(
            body: Center(
              child: CircularProgressIndicator(
                semanticsLabel: 'Recuperando sesión',
              ),
            ),
          );
        }
        if (!auth.demo && auth.user == null) return AuthScreen(auth: auth);
        if (!auth.demo && !auth.user!.active) return PendingScreen(auth: auth);
        return HomeScreen(
          key: ValueKey(auth.demo ? 'demo' : auth.user!.id),
          auth: auth,
          repository: widget.inventoryRepository ?? DemoInventoryRepository(),
        );
      },
    ),
  );
}

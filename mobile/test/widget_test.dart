import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexo_mobile/main.dart';
import 'package:nexo_mobile/features/auth/auth_repository.dart';
import 'package:nexo_mobile/features/auth/auth_view_model.dart';
import 'package:nexo_mobile/features/inventory/inventory_view_model.dart';

class FakeAuth implements AuthRepository {
  AppUser? current;
  @override
  Future<AppUser?> restore() async => current;
  @override
  Future<AppUser> login(String email, String password) async => current!;
  @override
  Future<AppUser> google() async => current!;
  @override
  Future<AppUser> refresh() async => current!;
  @override
  Future<String> register(String name, String email, String password) async =>
      'Solicitud recibida';
  @override
  Future<AppUser> updateProfile(
    String name,
    String department,
    String phone,
  ) async => current!;
  @override
  Future<void> logout() async {
    current = null;
  }
}

class MemoryInventory implements InventoryRepository {
  MemoryInventory(this.data);
  final Map<String, dynamic> data;
  @override
  Future<Map<String, dynamic>> load() async => data;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'stock filters and movements preserve quantities and reject invalid outputs',
    () async {
      final vm = InventoryViewModel(DemoInventoryRepository());
      await vm.load();
      expect(vm.error, isNull);
      expect(vm.items.length, 6);
      vm.filter(search: 'ins-003');
      expect(vm.filtered.single.low, isTrue);
      vm.filter(search: '', location: 'Producto terminado');
      expect(vm.filtered.length, 2);
      vm.record(id: 4, type: 'Salida', quantity: 4, reason: 'Entrega');
      expect(vm.item(4).quantity, 20);
      expect(
        () => vm.record(id: 4, type: 'Salida', quantity: 21, reason: 'Entrega'),
        throwsFormatException,
      );
      expect(
        () => vm.record(
          id: 4,
          type: 'Entrada',
          quantity: double.nan,
          reason: 'Entrega',
        ),
        throwsFormatException,
      );
      vm.record(id: 4, type: 'Merma', quantity: 2, reason: 'Derrame');
      expect(vm.item(4).quantity, 18);
      expect(vm.wastes.first['qty'], 2);
      await vm.load();
      expect(vm.item(4).quantity, 24);
      vm.dispose();
    },
  );
  for (final width in [320.0, 390.0, 840.0]) {
    testWidgets(
      'mobile navigation and forms fit width $width with large text',
      (tester) async {
        tester.view.physicalSize = Size(width, 1000);
        tester.view.devicePixelRatio = 1;
        tester.platformDispatcher.textScaleFactorTestValue = 1.5;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final auth = AuthViewModel(FakeAuth());
        final data = await tester.runAsync(
          () => DemoInventoryRepository().load(),
        );
        await tester.pumpWidget(
          NexoApp(auth: auth, inventoryRepository: MemoryInventory(data!)),
        );
        await tester.pumpAndSettle();
        expect(find.text('Todo en su lugar.'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.text('Iniciar sesión'));
        await tester.tap(find.text('Iniciar sesión'));
        await tester.pumpAndSettle();
        expect(find.text('Escribe un correo válido.'), findsOneWidget);
        auth.explore();
        await tester.pumpAndSettle();
        expect(find.text('Tu almacén,\na simple vista.'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.tap(find.text('Inventario').last);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.enterText(find.byType(TextField).first, 'zzz');
        await tester.pumpAndSettle();
        expect(find.text('No encontramos artículos.'), findsOneWidget);
        await tester.tap(find.byTooltip('Borrar búsqueda'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Movimiento de prueba'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.text('Cancelar'));
        await tester.tap(find.text('Cancelar'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Más').last);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Almacenes'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Mi perfil'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Salir de la demostración'));
        await tester.pumpAndSettle();
        expect(find.text('Todo en su lugar.'), findsOneWidget);
        await tester.pumpWidget(const SizedBox());
        auth.dispose();
      },
    );
  }
  testWidgets('pending account cannot enter inventory', (tester) async {
    final repo = FakeAuth()
      ..current = const AppUser(
        name: 'Pendiente',
        email: 'test@example.test',
        role: 'consulta',
        status: 'pending',
      );
    final auth = AuthViewModel(repo);
    await tester.pumpWidget(NexoApp(auth: auth));
    await tester.pumpAndSettle();
    expect(find.text('Acceso pendiente'), findsOneWidget);
    expect(find.text('Inventario'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    auth.dispose();
  });
}

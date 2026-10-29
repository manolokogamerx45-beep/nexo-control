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
  final sent = <(String, Map<String, dynamic>)>[];
  @override
  Future<Map<String, dynamic>> load() async => data;
  @override
  Future<void> send(String path, Map<String, dynamic> body) async =>
      sent.add((path, body));
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
      vm.record(id: '4', type: 'Salida', quantity: 4, reason: 'Entrega');
      expect(vm.item('4').quantity, 20);
      expect(
        () =>
            vm.record(id: '4', type: 'Salida', quantity: 21, reason: 'Entrega'),
        throwsFormatException,
      );
      expect(
        () => vm.record(
          id: '4',
          type: 'Entrada',
          quantity: double.nan,
          reason: 'Entrega',
        ),
        throwsFormatException,
      );
      vm.record(id: '4', type: 'Merma', quantity: 2, reason: 'Derrame');
      expect(vm.item('4').quantity, 18);
      expect(vm.wastes.first['qty'], 2);
      await vm.load();
      expect(vm.item('4').quantity, 24);
      vm.dispose();
    },
  );
  testWidgets('signed-in users see the live inventory without demo controls', (
    tester,
  ) async {
    final repo = FakeAuth()
      ..current = const AppUser(
        name: 'Ana Almacén',
        email: 'ana@example.test',
        role: 'almacen',
        status: 'active',
      );
    final auth = AuthViewModel(repo);
    final inventory = MemoryInventory(
      ApiInventoryRepository.fromSnapshot({
        'articles': [
          {'id': 'a1', 'sku': 'SKU-1', 'name': 'Tornillo', 'unit': 'pzas'},
        ],
        'warehouses': [
          {'id': 'w1', 'name': 'Central'},
        ],
        'partners': [
          {'id': 'c1', 'name': 'Tienda 4', 'kind': 'Punto de venta'},
        ],
        'batches': [
          {
            'id': 'b1',
            'articleId': 'a1',
            'warehouseId': 'w1',
            'lot': 'L1',
            'quantity': 20000,
            'reserved': 0,
          },
        ],
      }),
    );
    await tester.pumpWidget(
      NexoApp(auth: auth, inventoryRepository: inventory),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Inventario').last);
    await tester.pumpAndSettle();
    expect(find.text('Tornillo'), findsOneWidget);
    expect(find.text('Movimiento de prueba'), findsNothing);
    expect(find.textContaining('Inventario de demostración'), findsNothing);
    expect(find.byTooltip('Actualizar'), findsOneWidget);

    await tester.tap(find.text('Registrar movimiento'));
    await tester.pumpAndSettle();
    // No supplier exists yet, so receipts explain what to set up first.
    expect(
      find.text('Primero registra un proveedor en la web.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Salida'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Artículo y almacén'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Tornillo · Central').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cliente o punto de venta'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Tienda 4').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Cantidad (pzas)'),
      '25',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Referencia (remisión, pedido)'),
      'REM-1',
    );
    await tester.ensureVisible(find.text('Registrar salida'));
    await tester.tap(find.text('Registrar salida'));
    await tester.pumpAndSettle();
    expect(find.text('Supera lo disponible (20 pzas).'), findsOneWidget);
    expect(inventory.sent, isEmpty);
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Cantidad (pzas)'),
      '7',
    );
    await tester.ensureVisible(find.text('Registrar salida'));
    await tester.tap(find.text('Registrar salida'));
    await tester.pumpAndSettle();
    expect(inventory.sent.single.$1, '/issues');
    expect(inventory.sent.single.$2, containsPair('articleId', 'a1'));
    expect(inventory.sent.single.$2, containsPair('warehouseId', 'w1'));
    expect(inventory.sent.single.$2, containsPair('partnerId', 'c1'));
    expect(inventory.sent.single.$2, containsPair('quantity', '7'));
    expect(inventory.sent.single.$2['_operationId'], hasLength(32));
    expect(find.text('Salida registrada correctamente.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    auth.dispose();
  });
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
  testWidgets('privacy notice is reachable before signing up', (tester) async {
    final auth = AuthViewModel(FakeAuth());
    await tester.pumpWidget(NexoApp(auth: auth));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Solicitar una cuenta'));
    await tester.tap(find.text('Solicitar una cuenta'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('No los usamos con fines comerciales'),
      findsOneWidget,
    );
    await tester.ensureVisible(find.text('Aviso de privacidad'));
    await tester.tap(find.text('Aviso de privacidad'));
    await tester.pumpAndSettle();
    expect(find.text('Tus derechos'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    auth.dispose();
  });
}

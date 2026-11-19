import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexo_mobile/core/api_client.dart';
import 'package:nexo_mobile/core/offline_store.dart';
import 'package:nexo_mobile/features/auth/auth_repository.dart';
import 'package:nexo_mobile/features/auth/auth_view_model.dart';
import 'package:nexo_mobile/features/ops/csv.dart';
import 'package:nexo_mobile/features/ops/op_specs.dart';
import 'package:nexo_mobile/features/ops/ops_view_model.dart';
import 'package:nexo_mobile/features/ops/snapshot.dart';
import 'package:nexo_mobile/main.dart';

Map<String, dynamic> sampleSnapshot({String role = 'administrador'}) => {
  'role': role,
  'userId': 'u1',
  'company': {'name': 'Mi empresa', 'logo': ''},
  'articles': [
    {
      'id': 'a1',
      'sku': 'TOR-1',
      'name': 'Tornillo',
      'unit': 'pzas',
      'kind': 'Mercancía',
      'active': true,
    },
    {
      'id': 'a2',
      'sku': 'ACE-1',
      'name': 'Aceite',
      'unit': 'L',
      'kind': 'Insumo',
      'active': true,
    },
  ],
  'warehouses': [
    {'id': 'w1', 'name': 'Central', 'location': 'Querétaro'},
    {'id': 'w2', 'name': 'Secundario', 'location': 'San Juan'},
  ],
  'partners': [
    {
      'id': 'p1',
      'name': 'Proveedor A',
      'kind': 'Proveedor',
      'reference': 'QRO',
    },
    {
      'id': 'c1',
      'name': 'Tienda 4',
      'kind': 'Punto de venta',
      'reference': 'SJR',
    },
  ],
  'batches': [
    {
      'id': 'b1',
      'articleId': 'a1',
      'warehouseId': 'w1',
      'partnerId': 'p1',
      'lot': 'L1',
      'expiry': null,
      'quantity': 20000,
      'reserved': 5000,
      'receivedAt': '2026-10-01T10:00:00.000Z',
    },
    {
      'id': 'b2',
      'articleId': 'a2',
      'warehouseId': 'w1',
      'partnerId': 'p1',
      'lot': 'L2',
      'expiry': '2020-01-01',
      'quantity': 3000,
      'reserved': 0,
      'receivedAt': '2026-10-02T10:00:00.000Z',
    },
  ],
  'events': [
    {
      'id': 'e1',
      'type': 'Entrada',
      'batchId': 'b1',
      'articleId': 'a1',
      'warehouseId': 'w1',
      'qty': 20000,
      'at': '2026-10-01T10:00:00.000Z',
      'actorName': 'Admin',
      'reference': 'REC-1',
    },
  ],
  'requests': [
    {
      'id': 'r1',
      'reference': 'SOL-1',
      'status': 'Pendiente',
      'warehouseId': 'w1',
      'destination': 'Tienda 4',
      'createdBy': 'u1',
      'createdByName': 'Admin',
      'createdAt': '2026-10-05T10:00:00.000Z',
      'items': [
        {'articleId': 'a1', 'quantity': 3000, 'allocations': []},
      ],
      'history': [],
    },
  ],
  'policies': [
    {'id': 'a1_w1', 'articleId': 'a1', 'warehouseId': 'w1', 'minimum': 30000},
  ],
  'purchases': [],
  'transfers': [],
};

/// A stand-in server that can be switched offline.
class FakeServer {
  FakeServer({Map<String, dynamic>? snapshot})
    : snapshot = snapshot ?? sampleSnapshot();
  bool online = true;
  Map<String, dynamic> snapshot;
  final writes = <(String, String, Map<String, dynamic>)>[];
  http.Response? Function(String path, Map<String, dynamic> body)? rejectWith;
  final metricsCalls = <String>[];

  /// Lets previews show a full year of history instead of the minimal sample.
  Map<String, dynamic>? metricsOverride;

  late final client = MockClient((req) async {
    if (!online) throw http.ClientException('offline');
    final path = req.url.path.replaceFirst('/api/v1', '');
    if (req.method == 'GET' && path == '/operations/snapshot') {
      return http.Response(jsonEncode(snapshot), 200);
    }
    if (req.method == 'GET' && path.startsWith('/operations/metrics/')) {
      metricsCalls.add(path);
      if (metricsOverride != null) return http.Response(jsonEncode(metricsOverride), 200);
      return http.Response(
        jsonEncode({
          'months': int.parse(path.split('/').last),
          'inventoryValue': 0,
          'costCoverage': {'valued': 0, 'total': 0},
          'totals': {
            'movements': 1,
            'waste': 0,
            'wasteValue': 0,
            'rotation': null,
          },
          'monthly': [
            {
              'month': '2026-10',
              'movements': {
                'entries': 1,
                'exits': 0,
                'waste': 0,
                'supplierReturns': 0,
                'adjustments': 0,
                'transfers': 0,
                'total': 1,
              },
              'entryValue': 0,
              'exitValue': 0,
              'wasteValue': 0,
              'openingValue': 0,
              'closingValue': 0,
              'rotation': null,
            },
          ],
          'articles': [],
        }),
        200,
      );
    }
    final body = req.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(req.body) as Map<String, dynamic>;
    final reject = rejectWith?.call(path, body);
    if (reject != null) return reject;
    writes.add((req.method, path, body));
    return http.Response('{"id":"new"}', 200);
  });
}

ApiClient apiFor(FakeServer server) =>
    ApiClient(baseUrl: 'https://nexo.example', client: server.client);

OpsViewModel viewModel(FakeServer server, OfflineStore store) => OpsViewModel(
  api: apiFor(server),
  store: store,
  userId: 'u1',
  retryEvery: const Duration(days: 1),
);

class FakeAuth implements AuthRepository {
  AppUser? current = const AppUser(
    id: 'u1',
    name: 'Admin',
    email: 'a@example.test',
    role: 'administrador',
    status: 'active',
  );
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
      'ok';
  @override
  Future<AppUser> updateProfile(
    String name,
    String department,
    String phone,
  ) async => current!;
  @override
  Future<void> logout() async => current = null;
}

void main() {
  group('offline sync', () {
    test(
      'downloads the inventory, keeps a copy, and opens it without internet',
      () async {
        final server = FakeServer(), store = MemoryOfflineStore();
        final online = viewModel(server, store);
        await online.init();
        expect(online.offline, isFalse);
        expect(online.snapshot!.articles, hasLength(2));
        online.dispose();

        server.online = false;
        final offline = viewModel(server, store);
        await offline.init();
        expect(offline.offline, isTrue);
        expect(offline.snapshot!.articleName('a1'), 'Tornillo');
        expect(offline.syncedAt, isNotNull);
        offline.dispose();
      },
    );

    test(
      'with no copy and no connection there is nothing to show yet',
      () async {
        final server = FakeServer()..online = false;
        final vm = viewModel(server, MemoryOfflineStore());
        await vm.init();
        expect(vm.snapshot, isNull);
        expect(vm.offline, isTrue);
        expect(vm.loading, isFalse);
        vm.dispose();
      },
    );

    test(
      'operations made offline are queued, kept across restarts and sent in order once',
      () async {
        final server = FakeServer(), store = MemoryOfflineStore();
        var vm = viewModel(server, store);
        await vm.init();
        server.online = false;
        expect(
          await vm.submit(
            path: '/waste',
            method: 'POST',
            body: {'batchId': 'b1', 'quantity': '1', 'reason': 'Daño'},
            label: 'Merma',
          ),
          SubmitOutcome.queued,
        );
        expect(
          await vm.submit(
            path: '/requests/r1',
            method: 'PATCH',
            body: {'action': 'approve'},
            label: 'Aprobar',
          ),
          SubmitOutcome.queued,
        );
        expect(vm.pendingCount, 2);
        expect(vm.offline, isTrue);
        vm.dispose();

        // The app is closed and reopened, still without connection.
        vm = viewModel(server, store);
        await vm.init();
        expect(vm.pendingCount, 2);
        expect(server.writes, isEmpty);

        server.online = true;
        await vm.refresh();
        expect(vm.offline, isFalse);
        expect(vm.pendingCount, 0);
        expect(server.writes.map((w) => '${w.$1} ${w.$2}'), [
          'POST /operations/waste',
          'PATCH /operations/requests/r1',
        ]);
        final ids = server.writes
            .map((w) => w.$3['_operationId'] as String)
            .toList();
        expect(ids.every((id) => id.length == 32), isTrue);
        expect(ids.toSet(), hasLength(2));
        expect(await store.readQueue('u1'), isEmpty);
        await vm.refresh();
        expect(server.writes, hasLength(2));
        vm.dispose();
      },
    );

    test(
      'a lost answer is retried with the same operation id so the server can ignore the duplicate',
      () async {
        final server = FakeServer(), store = MemoryOfflineStore();
        final vm = viewModel(server, store);
        await vm.init();
        server.online = false;
        await vm.submit(
          path: '/waste',
          method: 'POST',
          body: {'batchId': 'b1'},
          label: 'Merma',
        );
        final queuedId = vm.queue.single.id;
        server.online = true;
        await vm.refresh();
        expect(server.writes.single.$3['_operationId'], queuedId);
        vm.dispose();
      },
    );

    test(
      'server rejections reach the form when online and are flagged when they come from the queue',
      () async {
        final server = FakeServer(), store = MemoryOfflineStore();
        final vm = viewModel(server, store);
        await vm.init();
        server.rejectWith = (path, body) =>
            http.Response('{"error":"Existencias insuficientes"}', 409);
        await expectLater(
          vm.submit(
            path: '/issues',
            method: 'POST',
            body: {'quantity': '99'},
            label: 'Salida',
          ),
          throwsA(
            isA<ApiException>().having(
              (e) => e.message,
              'message',
              'Existencias insuficientes',
            ),
          ),
        );
        expect(vm.queue, isEmpty);

        server.rejectWith = null;
        server.online = false;
        await vm.submit(
          path: '/issues',
          method: 'POST',
          body: {'quantity': '99'},
          label: 'Salida',
        );
        await vm.submit(
          path: '/waste',
          method: 'POST',
          body: {'batchId': 'b1'},
          label: 'Merma',
        );
        server.online = true;
        server.rejectWith = (path, body) => path.endsWith('/issues')
            ? http.Response('{"error":"Existencias insuficientes"}', 409)
            : null;
        await vm.refresh();
        expect(vm.failedCount, 1);
        expect(vm.queue.single.error, 'Existencias insuficientes');
        expect(server.writes.single.$2, '/operations/waste');
        await vm.discard(vm.queue.single);
        expect(vm.queue, isEmpty);
        vm.dispose();
      },
    );

    test(
      'indicators fall back to the last downloaded copy when offline',
      () async {
        final server = FakeServer(), store = MemoryOfflineStore();
        final vm = viewModel(server, store);
        await vm.init();
        await vm.loadMetrics(6);
        expect(vm.metrics!['months'], 6);
        expect(vm.metricsStale, isFalse);
        server.online = false;
        await vm.loadMetrics(6);
        expect(vm.metrics!['months'], 6);
        expect(vm.metricsStale, isTrue);
        await vm.loadMetrics(12);
        expect(vm.metrics, isNull);
        expect(vm.metricsError, contains('Sin conexión'));
        vm.dispose();
      },
    );
  });

  group('forms validate without asking the server', () {
    final s = Snapshot(sampleSnapshot(), today: '2026-11-18');
    test('quantities follow the unit and the available stock', () {
      expect(qtyError('2.5', 'pzas'), contains('enteras'));
      expect(qtyError('0', 'kg'), contains('mayor que cero'));
      expect(qtyError('1.2345', 'kg'), contains('tres decimales'));
      expect(qtyError('0', 'kg', zero: true), isNull);
      expect(qtyError('16', 'pzas', max: 15000), contains('15'));
      expect(qtyError('1,5', 'L'), isNull);
    });

    test(
      'issue and transfer cannot exceed what is available (not reserved, not expired)',
      () {
        final issue = issueSpec(s);
        final v = {
          'articleId': 'a1',
          'warehouseId': 'w1',
          'partnerId': 'c1',
          'quantity': '16',
          'reference': 'X',
        };
        expect(issue.validate!(v, []), contains('supera lo disponible'));
        expect(issue.validate!({...v, 'quantity': '15'}, []), isNull);
        expect(s.totals('a2', 'w1').available, 0); // expired lot
        expect(
          transferSpec(s).validate!({
            'articleId': 'a1',
            'sourceWarehouseId': 'w1',
            'destinationWarehouseId': 'w1',
            'quantity': '1',
          }, []),
          contains('diferente'),
        );
      },
    );

    test(
      'a receipt sends only what was filled in, including cost and purchase',
      () {
        final spec = receiptSpec(s);
        final v = {
          'articleId': 'a1',
          'warehouseId': 'w1',
          'partnerId': 'p1',
          'lot': ' L9 ',
          'quantity': '4',
          'expiry': '',
          'unitCost': '',
          'reference': 'REC-9',
        };
        expect(spec.validate!(v, []), isNull);
        expect(spec.body(v, []), {
          'articleId': 'a1',
          'warehouseId': 'w1',
          'partnerId': 'p1',
          'lot': 'L9',
          'quantity': '4',
          'reference': 'REC-9',
        });
        expect(
          spec.body({...v, 'unitCost': '12,50', 'expiry': '2027-01-01'}, []),
          containsPair('unitCost', '12.50'),
        );
        expect(
          spec.validate!({...v, 'unitCost': '12.345'}, []),
          contains('dos decimales'),
        );
        expect(
          spec.validate!({...v, 'expiry': '2020-01-01'}, []),
          contains('venció'),
        );
      },
    );

    test('requests need distinct articles with valid quantities', () {
      final spec = requestSpec(s);
      expect(spec.validate!({}, []), contains('al menos un artículo'));
      expect(
        spec.validate!({}, [
          {'articleId': 'a1', 'quantity': '1'},
          {'articleId': 'a1', 'quantity': '2'},
        ]),
        contains('una sola vez'),
      );
      expect(
        spec.validate!({}, [
          {'articleId': 'a1', 'quantity': '1.5'},
        ]),
        contains('enteras'),
      );
      final lines = [
        {'articleId': 'a1', 'quantity': '2'},
        {'articleId': 'a2', 'quantity': '1.5'},
      ];
      expect(spec.validate!({}, lines), isNull);
      expect(
        spec.body({
          'warehouseId': 'w1',
          'destination': 'T',
          'reference': 'R',
        }, lines)['items'],
        [
          {'articleId': 'a1', 'quantity': '2'},
          {'articleId': 'a2', 'quantity': '1.5'},
        ],
      );
    });

    test(
      'company edits keep the existing logo and CSV imports match the catalog',
      () {
        expect(companySpec(s).body({'name': 'Nueva'}, []), {
          'name': 'Nueva',
          'logo': '',
        });
        final rows = parseArticlesCsv(
          'SKU;Nombre;Tipo;Unidad\n"x-1";"Clavo, grande";Mercancía;Piezas',
        );
        expect(rows.single, {
          'sku': 'X-1',
          'name': 'Clavo, grande',
          'kind': 'Mercancía',
          'unit': 'pzas',
        });
        expect(
          () => parseArticlesCsv('SKU,Nombre\nA,B'),
          throwsFormatException,
        );
        final stock = parseInventoryCsv(
          'SKU,Almacén,Proveedor,Lote,Cantidad,Caducidad,Referencia,Costo\nTOR-1,central,Proveedor A,L5,"3,5",,R1,\$12.50',
          s,
        );
        expect(stock.single, containsPair('articleId', 'a1'));
        expect(stock.single, containsPair('unitCost', '12.50'));
        expect(stock.single, containsPair('quantity', '3.5'));
        expect(
          () => parseInventoryCsv(
            'SKU,Almacén,Proveedor,Lote,Cantidad,Caducidad,Referencia\nNOPE,Central,Proveedor A,L,1,,R',
            s,
          ),
          throwsFormatException,
        );
      },
    );
  });

  group('workspace layout', () {
    Future<void> open(
      WidgetTester tester,
      double width,
      FakeServer server, {
      double text = 1.0,
      double height = 900,
    }) async {
      tester.view.physicalSize = Size(width, height);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = text;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final auth = AuthViewModel(FakeAuth());
      await tester.pumpWidget(
        NexoApp(auth: auth, api: apiFor(server), store: MemoryOfflineStore()),
      );
      await tester.pumpAndSettle();
    }

    Future<void> goTo(
      WidgetTester tester,
      String label, {
      required bool wide,
    }) async {
      if (!wide) {
        expect(
          find.byType(DrawerButton),
          findsOneWidget,
          reason: 'menu button before opening $label',
        );
        await tester.tap(find.byType(DrawerButton));
        await tester.pumpAndSettle();
      }
      final tile = find.widgetWithText(ListTile, label);
      if (!wide) {
        // The drawer is a lazy list: bring the entry into view first.
        final menu = find.descendant(of: find.byType(Drawer), matching: find.byType(Scrollable)).first;
        await tester.scrollUntilVisible(tile, 120, scrollable: menu);
      }
      await tester.tap(tile);
      await tester.pumpAndSettle();
    }

    const labels = [
      'Indicadores',
      'Inventario',
      'Artículos',
      'Solicitudes',
      'Lotes y trazabilidad',
      'Movimientos',
      'Transferencias',
      'Devoluciones',
      'Mermas',
      'Compras',
      'Empresas y puntos de venta',
      'Almacenes',
      'Mi empresa',
      'Resumen',
    ];

    for (final width in [320.0, 390.0, 768.0, 1280.0]) {
      testWidgets('every section fits width $width with large text, online', (
        tester,
      ) async {
        final wide = width >= 900;
        await open(tester, width, FakeServer(), text: 1.5, height: wide ? 2600 : 900);
        expect(find.text('Alertas de stock bajo'), findsOneWidget);
        expect(tester.takeException(), isNull);
        for (final label in labels) {
          await goTo(tester, label, wide: wide);
          expect(tester.takeException(), isNull, reason: '$label @ $width');
        }
        await tester.pumpWidget(const SizedBox());
      });
    }

    testWidgets(
      'offline: shows saved data, explains the state and queues a waste record',
      (tester) async {
        final server = FakeServer();
        final store = MemoryOfflineStore();
        await store.writeSnapshot(
          'u1',
          sampleSnapshot(),
          DateTime.now().subtract(const Duration(hours: 3)),
        );
        server.online = false;
        tester.view.physicalSize = const Size(390, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          NexoApp(
            auth: AuthViewModel(FakeAuth()),
            api: apiFor(server),
            store: store,
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.textContaining('Sin conexión · datos de hace 3 h'),
          findsOneWidget,
        );
        expect(find.text('Alertas de stock bajo'), findsOneWidget);

        await goTo(tester, 'Mermas', wide: false);
        await tester.tap(find.text('Registrar merma'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining('se guardará en este dispositivo'),
          findsOneWidget,
        );
        await tester.tap(find.text('Guardar'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining('guardado en este dispositivo'),
          findsOneWidget,
        );
        expect(find.byTooltip('Operaciones por enviar'), findsOneWidget);
        final queue = await store.readQueue('u1');
        expect(queue.single.path, '/waste');
        expect(queue.single.body, containsPair('batchId', 'b1'));
        expect(server.writes, isEmpty);

        // Back online: the next sync sends it.
        server.online = true;
        await tester.tap(find.byTooltip('Actualizar'));
        await tester.pumpAndSettle();
        expect(server.writes.single.$2, '/operations/waste');
        expect(await store.readQueue('u1'), isEmpty);
        await tester.pumpWidget(const SizedBox());
      },
    );

    testWidgets('requesters only see their three sections', (tester) async {
      await open(
        tester,
        390,
        FakeServer(snapshot: sampleSnapshot(role: 'solicitante')),
      );
      await tester.tap(find.byType(DrawerButton));
      await tester.pumpAndSettle();
      for (final shown in ['Resumen', 'Artículos', 'Solicitudes']) {
        expect(find.widgetWithText(ListTile, shown), findsOneWidget);
      }
      for (final hidden in [
        'Indicadores',
        'Inventario',
        'Mermas',
        'Compras',
        'Mi empresa',
      ]) {
        expect(find.widgetWithText(ListTile, hidden), findsNothing);
      }
      await tester.pumpWidget(const SizedBox());
    });
  });
}

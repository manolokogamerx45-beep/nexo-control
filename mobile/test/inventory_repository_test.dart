import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexo_mobile/core/api_client.dart';
import 'package:nexo_mobile/features/inventory/inventory_view_model.dart';

final snapshot = {
  'articles': [
    {'id': 'a1', 'sku': 'RES-1', 'name': 'Resina', 'unit': 'kg'},
    {'id': 'a2', 'sku': 'TOR-1', 'name': 'Tornillo', 'unit': 'pzas'},
  ],
  'warehouses': [
    {'id': 'w1', 'name': 'Central'},
    {'id': 'w2', 'name': 'Norte'},
  ],
  'partners': [
    {'id': 'p1', 'name': 'Polímeros', 'kind': 'Proveedor', 'reference': 'CDMX'},
    {'id': 'c1', 'name': 'Tienda 4', 'kind': 'Punto de venta'},
  ],
  'batches': [
    {
      'id': 'b1',
      'articleId': 'a1',
      'warehouseId': 'w1',
      'partnerId': 'p1',
      'lot': 'L-1',
      'expiry': '2026-12-31',
      'quantity': 5000,
      'reserved': 2000,
      'receivedAt': '2026-10-01T10:00:00.000Z',
    },
    {
      'id': 'b2',
      'articleId': 'a1',
      'warehouseId': 'w1',
      'partnerId': 'p1',
      'lot': 'L-2',
      'expiry': '2026-10-01',
      'quantity': 1250,
      'reserved': 0,
      'receivedAt': '2026-09-01T10:00:00.000Z',
    },
  ],
  'policies': [
    {'id': 'a1_w1', 'articleId': 'a1', 'warehouseId': 'w1', 'minimum': 4000},
    {'id': 'a2_w2', 'articleId': 'a2', 'warehouseId': 'w2', 'minimum': 0},
  ],
  'events': [
    {
      'type': 'Merma',
      'articleId': 'a1',
      'warehouseId': 'w1',
      'qty': 500,
      'at': '2026-10-02T15:00:00.000Z',
      'reference': 'Derrame',
      'actorName': 'Ana',
    },
    {
      'type': 'Entrada',
      'articleId': 'a1',
      'warehouseId': 'w1',
      'qty': 5000,
      'at': '2026-10-01T10:00:00.000Z',
      'reference': 'FAC-1',
    },
  ],
  'purchases': [
    {
      'id': 'x1',
      'partnerId': 'p1',
      'reference': 'OC-7',
      'status': 'Recepción parcial',
      'createdAt': '2026-09-30T10:00:00.000Z',
      'items': [
        {'articleId': 'a1', 'quantity': 10000, 'received': 5000},
      ],
    },
  ],
};

void main() {
  test('snapshot rows are grouped per article and warehouse', () {
    final data = ApiInventoryRepository.fromSnapshot(
      snapshot,
      now: DateTime(2026, 10, 28),
    );
    final items = data['inventory'] as List;
    final resin = items.firstWhere((e) => e['id'] == 'a1|w1') as Map;
    // Thousandths → units; the expired L-2 layer is physical but unavailable.
    expect(resin['physical'], 6.25);
    expect(resin['reserved'], 2);
    expect(resin['qty'], 3);
    expect(resin['min'], 4);
    expect(resin['lot'], '2 lotes');
    expect(resin['supplier'], 'Polímeros');
    expect(resin['expiry'], '2026-10-01');
    expect(StockItem(Map<String, dynamic>.from(resin)).low, isTrue);
    final screws = items.firstWhere((e) => e['id'] == 'a2|w2') as Map;
    expect(screws['qty'], 0);
    expect(StockItem(Map<String, dynamic>.from(screws)).low, isFalse);
    expect((data['lots'] as List).length, 2);
    expect((data['movements'] as List).first['incoming'], isFalse);
    expect((data['movements'] as List).last['incoming'], isTrue);
    expect((data['wastes'] as List).single['qty'], 0.5);
    expect(
      (data['purchases'] as List).single['lines'],
      'Resina\nPedido: 10 kg · Recibido: 5 kg',
    );
    expect((data['suppliers'] as List).single['name'], 'Polímeros');
    expect(data['warehouses'], ['Central', 'Norte']);
  });

  test('view model loads the live snapshot through the API', () async {
    late http.Request sent;
    final api = ApiClient(
      baseUrl: 'http://127.0.0.1:4173',
      client: MockClient((req) async {
        sent = req;
        return http.Response(jsonEncode(snapshot), 200);
      }),
    )..sessionCookie = 'nexo_session=abc';
    final vm = InventoryViewModel(ApiInventoryRepository(api));
    await vm.load();
    expect(sent.url.path, '/api/v1/operations/snapshot');
    expect(sent.headers['Cookie'], 'nexo_session=abc');
    expect(vm.error, isNull);
    expect(vm.live, isTrue);
    expect(vm.items.length, 2);
    expect(vm.warehouses, ['Central', 'Norte']);
    expect(
      () => vm.record(id: 'a1|w1', type: 'Merma', quantity: 1, reason: 'Roto'),
      throwsFormatException,
    );
    vm.dispose();
  });

  test('API errors are shown to the user', () async {
    final api = ApiClient(
      baseUrl: 'http://127.0.0.1:4173',
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({'error': 'No tienes permiso para esta operación.'}),
          403,
        ),
      ),
    );
    final vm = InventoryViewModel(ApiInventoryRepository(api));
    await vm.load();
    expect(vm.error, 'No tienes permiso para esta operación.');
    vm.dispose();
  });
}

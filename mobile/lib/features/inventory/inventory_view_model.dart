import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../../core/api_client.dart';

class StockItem {
  StockItem(Map<String, dynamic> data) : data = Map.of(data);
  final Map<String, dynamic> data;
  String get id => data['id'].toString();
  String text(String key) => data[key]?.toString() ?? 'Sin caducidad';
  String get name => text('name');
  double get quantity => (data['qty'] as num).toDouble();
  double? get minimum => (data['min'] as num?)?.toDouble();
  double? get cost => (data['cost'] as num?)?.toDouble();
  double get value => quantity * (cost ?? 0);
  bool get low => minimum != null && quantity < minimum!;
  StockItem withQuantity(double value) => StockItem({...data, 'qty': value});
}

abstract class InventoryRepository {
  Future<Map<String, dynamic>> load();

  /// Sends a write to `/api/v1/operations{path}`.
  Future<void> send(String path, Map<String, dynamic> data);
}

class DemoInventoryRepository implements InventoryRepository {
  @override
  Future<Map<String, dynamic>> load() async =>
      jsonDecode(await rootBundle.loadString('assets/demo_catalog.json'))
          as Map<String, dynamic>;
  @override
  Future<void> send(String path, Map<String, dynamic> data) =>
      throw UnsupportedError('La demostración no guarda en el servidor.');
}

/// Reads and writes the inventory persisted by the web through the shared API.
class ApiInventoryRepository implements InventoryRepository {
  ApiInventoryRepository(this.api);
  final ApiClient api;

  @override
  Future<Map<String, dynamic>> load() async =>
      fromSnapshot(await api.request('/operations/snapshot'));

  @override
  Future<void> send(String path, Map<String, dynamic> data) =>
      api.request('/operations$path', method: 'POST', data: data);

  /// Converts `/operations/snapshot` (quantities in thousandths, one row per
  /// receipt layer) into one row per article and warehouse, as the web shows.
  static Map<String, dynamic> fromSnapshot(
    Map<String, dynamic> snapshot, {
    DateTime? now,
  }) {
    List<Map<String, dynamic>> rows(String key) =>
        ((snapshot[key] as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
    Map<String, Map<String, dynamic>> byId(String key) => {
      for (final row in rows(key)) '${row['id']}': row,
    };
    final articles = byId('articles'),
        warehouses = byId('warehouses'),
        partners = byId('partners');
    final today = DateFormat('yyyy-MM-dd').format(now ?? DateTime.now());
    final amount = NumberFormat('#,##0.###', 'es_MX');
    double qty(Object? value) => ((value as num?) ?? 0) / 1000;
    String date(Object? value) {
      final parsed = DateTime.tryParse('$value');
      return parsed == null
          ? 'Sin fecha'
          : DateFormat('dd/MM/yyyy HH:mm').format(parsed.toLocal());
    }

    final items = <String, Map<String, dynamic>>{};
    final lots = <String, Set<String>>{}, suppliers = <String, Set<String>>{};
    Map<String, dynamic>? item(Object? articleId, Object? warehouseId) {
      final article = articles['$articleId'],
          warehouse = warehouses['$warehouseId'];
      if (article == null || warehouse == null) return null;
      final key = '$articleId|$warehouseId';
      lots.putIfAbsent(key, () => {});
      suppliers.putIfAbsent(key, () => {});
      return items.putIfAbsent(
        key,
        () => {
          'id': key,
          'articleId': '$articleId',
          'warehouseId': '$warehouseId',
          'name': article['name'],
          'sku': article['sku'],
          'kind': article['kind'],
          'unit': article['unit'],
          'warehouse': warehouse['name'],
          'qty': 0.0,
          'physical': 0.0,
          'reserved': 0.0,
          'min': null,
          'expiry': null,
        },
      );
    }

    final lotRows = <Map<String, dynamic>>[];
    for (final batch in rows('batches')) {
      final row = item(batch['articleId'], batch['warehouseId']);
      if (row == null) continue;
      final quantity = qty(batch['quantity']),
          reserved = qty(batch['reserved']);
      final expiry = batch['expiry'] as String?;
      // Expired layers stay in the physical count but cannot be issued.
      final available = expiry == null || expiry.compareTo(today) >= 0
          ? quantity - reserved
          : 0.0;
      row['physical'] += quantity;
      row['reserved'] += reserved;
      row['qty'] += available;
      if (quantity <= 0) continue;
      lots[row['id']]!.add('${batch['lot']}');
      final supplier = partners['${batch['partnerId']}']?['name'];
      if (supplier != null) suppliers[row['id']]!.add('$supplier');
      if (expiry != null &&
          (row['expiry'] == null ||
              expiry.compareTo(row['expiry'] as String) < 0)) {
        row['expiry'] = expiry;
      }
      lotRows.add({
        'item': row['id'],
        'batchId': '${batch['id']}',
        'lot': batch['lot'],
        'expiry': expiry,
        'qty': quantity,
        // Waste can only take the unreserved part, even from expired lots.
        'wasteable': quantity - reserved,
      });
    }
    for (final policy in rows('policies')) {
      item(policy['articleId'], policy['warehouseId'])?['min'] = qty(
        policy['minimum'],
      );
    }
    for (final row in items.values) {
      final rowLots = lots[row['id']]!, rowSuppliers = suppliers[row['id']]!;
      row['lot'] = rowLots.isEmpty
          ? 'Sin existencias'
          : rowLots.length == 1
          ? rowLots.first
          : '${rowLots.length} lotes';
      row['supplier'] = rowSuppliers.isEmpty
          ? 'Sin proveedor'
          : rowSuppliers.length == 1
          ? rowSuppliers.first
          : 'Varios proveedores';
    }

    const incoming = {
      'Entrada',
      'Carga inicial',
      'Transferencia entrada',
      'Transferencia rechazada',
      'Devolución de cliente',
      'Ajuste positivo',
    };
    final movements = <Map<String, dynamic>>[];
    for (final event in rows('events')) {
      final key = '${event['articleId']}|${event['warehouseId']}';
      if (!items.containsKey(key)) continue;
      movements.add({
        'item': key,
        'type': event['type'],
        'incoming': incoming.contains(event['type']),
        'qty': qty(event['qty']),
        'date': date(event['at']),
        'ref': event['reference'] ?? '',
        'reason': [
          event['reference'],
          event['actorName'],
        ].whereType<String>().join(' · '),
        'cause': event['reference'] ?? 'Sin causa',
      });
    }

    String article(Object? id) =>
        '${articles['$id']?['name'] ?? 'Artículo no disponible'}';
    String unit(Object? id) => '${articles['$id']?['unit'] ?? ''}';
    final purchases = rows('purchases').map((p) {
      final lines = (p['items'] as List? ?? [p])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .map(
            (line) =>
                '${article(line['articleId'])}\nPedido: ${amount.format(qty(line['quantity']))} ${unit(line['articleId'])} · Recibido: ${amount.format(qty(line['received']))} ${unit(line['articleId'])}',
          );
      return <String, dynamic>{
        'id': p['reference'] ?? p['id'],
        'supplier': partners['${p['partnerId']}']?['name'] ?? 'Proveedor',
        'date': date(p['createdAt']),
        'status': p['status'],
        'lines': lines.join('\n'),
      };
    }).toList();

    return {
      'live': true,
      'inventory': items.values.toList(),
      'lots': lotRows,
      'movements': movements,
      'wastes': movements.where((e) => e['type'] == 'Merma').toList(),
      'purchases': purchases,
      'suppliers': partners.values
          .where((p) => p['kind'] == 'Proveedor')
          .map(
            (p) => {
              'name': p['name'],
              'category': p['kind'],
              'detail': p['reference'] ?? '',
            },
          )
          .toList(),
      'warehouses': warehouses.values.map((w) => '${w['name']}').toList(),
      // Options for the movement forms, referenced by stable server IDs.
      'catalog': {
        'articles': [
          for (final a in articles.values)
            if (a['active'] != false)
              {
                'id': '${a['id']}',
                'name': '${a['name']}',
                'sku': '${a['sku']}',
                'unit': '${a['unit']}',
              },
        ],
        'warehouses': [
          for (final w in warehouses.values)
            {'id': '${w['id']}', 'name': '${w['name']}'},
        ],
        'partners': [
          for (final p in partners.values)
            {
              'id': '${p['id']}',
              'name': '${p['name']}',
              'kind': '${p['kind']}',
            },
        ],
      },
    };
  }
}

class InventoryViewModel extends ChangeNotifier {
  InventoryViewModel(this.repository);
  final InventoryRepository repository;
  List<StockItem> items = [];
  List<Map<String, dynamic>> movements = [],
      wastes = [],
      purchases = [],
      suppliers = [],
      lots = [];
  List<Map<String, dynamic>> catalogArticles = [],
      catalogWarehouses = [],
      catalogPartners = [];
  List<String> _warehouses = [];
  bool loading = true, live = false;
  String? error;
  String query = '', warehouse = 'Todos';
  bool onlyLow = false;
  Future<void> load() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final data = await repository.load();
      live = data['live'] == true;
      items = (data['inventory'] as List)
          .map((e) => StockItem(Map<String, dynamic>.from(e as Map)))
          .toList();
      lots = data['lots'] == null
          ? [
              for (final e in items)
                {
                  'item': e.id,
                  'lot': e.data['lot'],
                  'expiry': e.data['expiry'],
                  'qty': e.quantity,
                },
            ]
          : _rows(data['lots']);
      movements = _rows(data['movements']);
      wastes = _rows(data['wastes']);
      purchases = _rows(data['purchases']);
      suppliers = _rows(data['suppliers']);
      _warehouses = List<String>.from(data['warehouses'] as List? ?? const []);
      if (!warehouses.contains(warehouse)) warehouse = 'Todos';
      final catalog = data['catalog'] as Map? ?? const {};
      catalogArticles = _rows(catalog['articles'] ?? const []);
      catalogWarehouses = _rows(catalog['warehouses'] ?? const []);
      catalogPartners = _rows(catalog['partners'] ?? const []);
    } on ApiException catch (e) {
      error = e.message;
    } catch (_) {
      error = 'No se pudo cargar el inventario.';
    }
    loading = false;
    notifyListeners();
  }

  List<Map<String, dynamic>> _rows(dynamic value) =>
      (value as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  List<String> get warehouses =>
      {..._warehouses, ...items.map((e) => e.text('warehouse'))}.toList();
  List<StockItem> get filtered => items
      .where(
        (e) =>
            (warehouse == 'Todos' || e.text('warehouse') == warehouse) &&
            (!onlyLow || e.low) &&
            '${e.name} ${e.text('sku')} ${e.text('lot')}'
                .toLowerCase()
                .contains(query.toLowerCase().trim()),
      )
      .toList();
  double get totalValue => items.fold(0, (sum, e) => sum + e.value);
  StockItem item(String id) => items.firstWhere((e) => e.id == id);
  void filter({String? search, String? location, bool? low}) {
    query = search ?? query;
    warehouse = location ?? warehouse;
    onlyLow = low ?? onlyLow;
    notifyListeners();
  }

  /// One ID per open form: a retried submission is not applied twice.
  static String newOperationId() => List.generate(
    32,
    (_) => Random.secure().nextInt(16).toRadixString(16),
  ).join();

  /// Registers a real operation and reloads the snapshot so FIFO results show.
  Future<void> submit(
    String path,
    Map<String, dynamic> data,
    String operationId,
  ) async {
    await repository.send(path, {...data, '_operationId': operationId});
    await load();
  }

  void record({
    required String id,
    required String type,
    required double quantity,
    required String reason,
  }) {
    if (live) {
      throw const FormatException(
        'Los movimientos de prueba solo están disponibles en la demostración.',
      );
    }
    if (!['Entrada', 'Salida', 'Merma'].contains(type) ||
        !quantity.isFinite ||
        quantity <= 0 ||
        quantity > 1000000 ||
        reason.trim().length < 3) {
      throw const FormatException(
        'Revisa la cantidad y escribe un motivo de al menos 3 caracteres.',
      );
    }
    final current = item(id);
    if (type != 'Entrada' && quantity > current.quantity) {
      throw const FormatException(
        'La cantidad supera las existencias disponibles.',
      );
    }
    final updated =
        current.quantity + (type == 'Entrada' ? quantity : -quantity);
    items = items.map((e) => e.id == id ? e.withQuantity(updated) : e).toList();
    final row = <String, dynamic>{
      'item': id,
      'type': type,
      'qty': quantity,
      'reason': reason.trim(),
      'date': 'Ahora · prueba local',
      'ref': 'DEMO',
      'cause': reason.trim(),
      'note': reason.trim(),
    };
    movements.insert(0, row);
    if (type == 'Merma') wastes.insert(0, row);
    lots = [
      for (final lot in lots)
        lot['item'] == id ? {...lot, 'qty': updated} : lot,
    ];
    notifyListeners();
  }
}

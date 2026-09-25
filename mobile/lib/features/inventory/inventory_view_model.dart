import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class StockItem {
  StockItem(Map<String, dynamic> data) : data = Map.of(data);
  final Map<String, dynamic> data;
  int get id => data['id'] as int;
  String text(String key) => data[key]?.toString() ?? 'Sin caducidad';
  String get name => text('name');
  double get quantity => (data['qty'] as num).toDouble();
  double get minimum => (data['min'] as num).toDouble();
  double get value => quantity * (data['cost'] as num);
  bool get low => quantity < minimum;
  StockItem withQuantity(double value) => StockItem({...data, 'qty': value});
}

abstract class InventoryRepository {
  Future<Map<String, dynamic>> load();
}

class DemoInventoryRepository implements InventoryRepository {
  @override
  Future<Map<String, dynamic>> load() async =>
      jsonDecode(await rootBundle.loadString('assets/demo_catalog.json'))
          as Map<String, dynamic>;
}

class InventoryViewModel extends ChangeNotifier {
  InventoryViewModel(this.repository);
  final InventoryRepository repository;
  List<StockItem> items = [];
  List<Map<String, dynamic>> movements = [], wastes = [], purchases = [];
  List<List<dynamic>> suppliers = [];
  bool loading = true;
  String? error;
  String query = '', warehouse = 'Todos';
  bool onlyLow = false;
  Future<void> load() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final data = await repository.load();
      items = (data['inventory'] as List)
          .map((e) => StockItem(Map<String, dynamic>.from(e as Map)))
          .toList();
      movements = _rows(data['movements']);
      wastes = _rows(data['wastes']);
      purchases = _rows(data['purchases']);
      suppliers = (data['suppliers'] as List)
          .map((e) => List<dynamic>.from(e as List))
          .toList();
    } catch (_) {
      error = 'No se pudo cargar el catálogo de demostración.';
    }
    loading = false;
    notifyListeners();
  }

  List<Map<String, dynamic>> _rows(dynamic value) =>
      (value as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  List<String> get warehouses =>
      items.map((e) => e.text('warehouse')).toSet().toList();
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
  StockItem item(int id) => items.firstWhere((e) => e.id == id);
  void filter({String? search, String? location, bool? low}) {
    query = search ?? query;
    warehouse = location ?? warehouse;
    onlyLow = low ?? onlyLow;
    notifyListeners();
  }

  void record({
    required int id,
    required String type,
    required double quantity,
    required String reason,
  }) {
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
    notifyListeners();
  }
}

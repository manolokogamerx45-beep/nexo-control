import 'package:intl/intl.dart';

typedef Rec = Map<String, dynamic>;

class Totals {
  const Totals(this.physical, this.reserved, this.available);
  final int physical, reserved, available;
}

/// Typed view over `GET /operations/snapshot`. Quantities stay in thousandths,
/// exactly as the server stores them, so web and phone always agree.
class Snapshot {
  Snapshot(this.raw, {String? today}) : today = today ?? _today();
  final Map<String, dynamic> raw;
  final String today;

  static String _today() {
    // The business day is Mexico City's (UTC-6, no daylight saving since 2022).
    final now = DateTime.now().toUtc().subtract(const Duration(hours: 6));
    return DateFormat('yyyy-MM-dd').format(now);
  }

  List<Rec> _rows(String key) => [
    for (final e in (raw[key] as List?) ?? const [])
      Map<String, dynamic>.from(e as Map),
  ];

  late final List<Rec> articles = _rows('articles');
  late final List<Rec> warehouses = _rows('warehouses');
  late final List<Rec> partners = _rows('partners');
  late final List<Rec> batches = _rows('batches');
  late final List<Rec> events = _rows('events');
  late final List<Rec> requests = _rows('requests');
  late final List<Rec> policies = _rows('policies');
  late final List<Rec> purchases = _rows('purchases');
  late final List<Rec> transfers = _rows('transfers');

  late final Map<String, Rec> _articleById = {
    for (final a in articles) '${a['id']}': a,
  };
  late final Map<String, Rec> _warehouseById = {
    for (final w in warehouses) '${w['id']}': w,
  };
  late final Map<String, Rec> _partnerById = {
    for (final p in partners) '${p['id']}': p,
  };
  late final Map<String, Rec> _batchById = {
    for (final b in batches) '${b['id']}': b,
  };

  String get role => '${raw['role'] ?? 'consulta'}';
  String get userId => '${raw['userId'] ?? ''}';
  String get companyName =>
      '${(raw['company'] as Map?)?['name'] ?? 'Mi empresa'}';
  bool get requester => role == 'solicitante';

  /// Mirrors the web's `allow()`: administrators may do everything.
  bool allow([List<String> roles = const []]) =>
      role == 'administrador' || roles.contains(role);

  Rec? article(Object? id) => _articleById['$id'];
  Rec? batch(Object? id) => _batchById['$id'];
  Rec? partner(Object? id) => _partnerById['$id'];
  String articleName(Object? id) => '${article(id)?['name'] ?? '—'}';
  String unit(Object? id) => '${article(id)?['unit'] ?? ''}';
  String warehouseName(Object? id) =>
      '${_warehouseById['$id']?['name'] ?? '—'}';
  String partnerName(Object? id) => '${partner(id)?['name'] ?? '—'}';

  bool usable(Rec batch) {
    final expiry = batch['expiry'] as String?;
    return expiry == null || expiry.compareTo(today) >= 0;
  }

  Totals totals(String articleId, [String? warehouseId]) {
    var physical = 0, reserved = 0, available = 0;
    for (final b in batches) {
      if (b['articleId'] != articleId) continue;
      if (warehouseId != null && b['warehouseId'] != warehouseId) continue;
      final q = (b['quantity'] as num).toInt(),
          r = (b['reserved'] as num).toInt();
      physical += q;
      reserved += r;
      if (usable(b)) available += q - r;
    }
    return Totals(physical, reserved, available);
  }

  List<Rec> get lowStock => [
    for (final p in policies)
      if (totals('${p['articleId']}', '${p['warehouseId']}').available <
          (p['minimum'] as num))
        p,
  ];

  List<Rec> get expired => [
    for (final b in batches)
      if ((b['quantity'] as num) > 0 &&
          b['expiry'] != null &&
          (b['expiry'] as String).compareTo(today) < 0)
        b,
  ];

  int get pendingRequests =>
      requests.where((r) => r['status'] == 'Pendiente').length;

  List<Rec> requestItems(Rec r) {
    if (r['items'] is List) {
      return [
        for (final e in r['items'] as List) Map<String, dynamic>.from(e as Map),
      ];
    }
    return [
      {
        'articleId': r['articleId'],
        'quantity': r['quantity'],
        'allocations': r['allocations'] ?? const [],
      },
    ];
  }

  List<Rec> purchaseItems(Rec p) {
    if (p['items'] is List) {
      return [
        for (final e in p['items'] as List) Map<String, dynamic>.from(e as Map),
      ];
    }
    return [
      {
        'articleId': p['articleId'],
        'quantity': p['quantity'],
        'received': p['received'] ?? 0,
      },
    ];
  }

  int dispatched(Rec item) => [
    for (final a in (item['allocations'] as List? ?? const []))
      ((a as Map)['dispatched'] as num?)?.toInt() ?? 0,
  ].fold(0, (n, v) => n + v);

  /// Quantity of a batch that left for customers and has not come back yet.
  int returnable(Rec batch) {
    const out = {'Salida PEPS', 'Despacho', 'Despacho parcial'};
    var sent = 0, back = 0;
    for (final e in events) {
      if (e['batchId'] == batch['id'] && out.contains(e['type'])) {
        sent += (e['qty'] as num).toInt();
      }
      if (e['sourceBatchId'] == batch['id'] &&
          e['type'] == 'Devolución de cliente') {
        back += (e['qty'] as num).toInt();
      }
    }
    return sent - back;
  }

  /// Formats a quantity in thousandths, e.g. 12500 -> "12.5".
  static String qty(num thousandths) =>
      NumberFormat('#,##0.###', 'es_MX').format(thousandths / 1000);
}

final _money = NumberFormat.currency(locale: 'es_MX', symbol: r'$');
String money(num value) => _money.format(value);

String formatDate(Object? iso) {
  final parsed = DateTime.tryParse('$iso');
  return parsed == null
      ? '—'
      : DateFormat('dd/MM/yyyy HH:mm').format(parsed.toLocal());
}

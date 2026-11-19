import 'csv.dart';
import 'snapshot.dart';

enum FieldKind { select, text, multiline, number, money, date }

class Option {
  const Option(this.value, this.label);
  final String value, label;
}

typedef Values = Map<String, String>;
typedef Lines = List<Map<String, String>>;

class OpField {
  OpField(
    this.name,
    this.label, {
    this.kind = FieldKind.text,
    this.options = const [],
    this.required = true,
    this.initial = '',
    this.hint,
    this.help,
  });
  final String name, label, initial;
  final FieldKind kind;
  final List<Option> options;
  final bool required;
  final String? help;

  /// Extra line under the field that depends on the other answers.
  final String? Function(Values values)? hint;
}

/// A repeated "article + quantity" block (requests and purchases).
class LineGroup {
  const LineGroup(this.articles, {this.max = 20});
  final List<Option> articles;
  final int max;
}

class OpSpec {
  OpSpec({
    required this.title,
    required this.path,
    required this.fields,
    required this.body,
    required this.queuedLabel,
    this.method = 'POST',
    this.lines,
    this.validate,
    this.note,
    this.submitLabel = 'Guardar',
  });
  final String title, path, method, queuedLabel, submitLabel;
  final String? note;
  final List<OpField> fields;
  final LineGroup? lines;
  final String? Function(Values values, Lines lines)? validate;
  final Map<String, dynamic> Function(Values values, Lines lines) body;
}

final _qtyPattern = RegExp(r'^\d+(\.\d{1,3})?$');

/// Validates a typed quantity like the server does, so a mistake is caught on
/// the phone even when there is no connection to ask the server.
String? qtyError(
  String text,
  String unit, {
  int? max,
  bool zero = false,
  String label = 'La cantidad',
}) {
  final t = text.trim().replaceAll(',', '.');
  if (!_qtyPattern.hasMatch(t)) {
    return '$label debe ser un número positivo con hasta tres decimales.';
  }
  final q = (double.parse(t) * 1000).round();
  if (unit == 'pzas' && q % 1000 != 0) {
    return 'Las piezas requieren cantidades enteras.';
  }
  if (q < (zero ? 0 : 1)) return '$label debe ser mayor que cero.';
  if (max != null && q > max) {
    return '$label supera lo disponible (${Snapshot.qty(max)} $unit).';
  }
  return null;
}

String _num(String text) => text.trim().replaceAll(',', '.');

String? _dateError(String text, String today, {bool future = false}) {
  if (text.trim().isEmpty) return null;
  final ok =
      RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text) &&
      DateTime.tryParse(text) != null;
  if (!ok) return 'La fecha de caducidad no es válida.';
  if (future && text.compareTo(today) < 0) return 'La caducidad ya venció.';
  return null;
}

String? _costError(String text) {
  if (text.trim().isEmpty) return null;
  return RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(_num(text))
      ? null
      : 'El costo usa pesos con hasta dos decimales.';
}

// ---- option builders -------------------------------------------------------

List<Option> articleOptions(Snapshot s, {Iterable<String>? only}) => [
  for (final a in s.articles)
    if (a['active'] != false && (only == null || only.contains('${a['id']}')))
      Option('${a['id']}', '${a['sku']} · ${a['name']} (${a['unit']})'),
];

List<Option> warehouseOptions(Snapshot s) => [
  for (final w in s.warehouses) Option('${w['id']}', '${w['name']}'),
];

List<Option> partnerOptions(Snapshot s, {required bool supplier}) => [
  for (final p in s.partners)
    if ((p['kind'] == 'Proveedor') == supplier)
      Option('${p['id']}', '${p['name']}'),
];

String _batchLabel(Snapshot s, Rec b, String extra) =>
    '${s.articleName(b['articleId'])} · ${b['lot']} · ${s.warehouseName(b['warehouseId'])}$extra';

List<Option> _batchOptions(
  Snapshot s,
  bool Function(Rec) test,
  String Function(Rec) extra,
) => [
  for (final b in s.batches)
    if (test(b)) Option('${b['id']}', _batchLabel(s, b, extra(b))),
];

String? _unitOfBatch(Snapshot s, Values v) =>
    s.unit(s.batch(v['batchId'])?['articleId']);

// ---- movements -------------------------------------------------------------

OpSpec receiptSpec(Snapshot s, {Rec? purchase}) {
  final pending = purchase == null
      ? null
      : s
            .purchaseItems(purchase)
            .where((i) => (i['received'] as num) < (i['quantity'] as num))
            .toList();
  final first = pending?.firstOrNull;
  return OpSpec(
    title: purchase == null ? 'Recepción de mercancía' : 'Recibir compra',
    path: '/receipts',
    queuedLabel: 'Recepción de mercancía',
    fields: [
      OpField(
        'articleId',
        purchase == null ? 'Artículo' : 'Artículo pendiente',
        kind: FieldKind.select,
        options: articleOptions(
          s,
          only: pending?.map((i) => '${i['articleId']}'),
        ),
        initial: first == null ? '' : '${first['articleId']}',
      ),
      OpField(
        'warehouseId',
        'Almacén de recepción',
        kind: FieldKind.select,
        options: warehouseOptions(s),
      ),
      OpField(
        'partnerId',
        'Proveedor',
        kind: FieldKind.select,
        options: purchase == null
            ? partnerOptions(s, supplier: true)
            : [
                Option(
                  '${purchase['partnerId']}',
                  s.partnerName(purchase['partnerId']),
                ),
              ],
        initial: purchase == null ? '' : '${purchase['partnerId']}',
      ),
      OpField('lot', 'Número de lote'),
      OpField(
        'quantity',
        'Cantidad',
        kind: FieldKind.number,
        initial: first == null
            ? '1'
            : Snapshot.qty(
                (first['quantity'] as num) - (first['received'] as num),
              ).replaceAll(',', ''),
        hint: (v) => 'Unidad: ${s.unit(v['articleId'])}',
      ),
      OpField(
        'expiry',
        'Caducidad (opcional)',
        kind: FieldKind.date,
        required: false,
      ),
      OpField(
        'unitCost',
        'Costo unitario en MXN (opcional)',
        kind: FieldKind.money,
        required: false,
      ),
      OpField(
        'reference',
        'Documento de recepción',
        initial: purchase == null ? '' : '${purchase['reference']}',
      ),
    ],
    validate: (v, _) =>
        qtyError(v['quantity']!, s.unit(v['articleId'])) ??
        _dateError(v['expiry']!, s.today, future: true) ??
        _costError(v['unitCost']!),
    body: (v, _) => {
      'articleId': v['articleId'],
      'warehouseId': v['warehouseId'],
      'partnerId': v['partnerId'],
      'lot': v['lot']!.trim(),
      'quantity': _num(v['quantity']!),
      'reference': v['reference']!.trim(),
      if (v['expiry']!.isNotEmpty) 'expiry': v['expiry'],
      if (v['unitCost']!.trim().isNotEmpty) 'unitCost': _num(v['unitCost']!),
      if (purchase != null) 'purchaseId': purchase['id'],
    },
  );
}

OpSpec issueSpec(Snapshot s) => OpSpec(
  title: 'Salida automática PEPS',
  path: '/issues',
  queuedLabel: 'Salida PEPS',
  note:
      'Se consumirán primero las recepciones más antiguas disponibles. Los lotes caducados y las reservas no se usan.',
  fields: [
    OpField(
      'articleId',
      'Artículo',
      kind: FieldKind.select,
      options: articleOptions(s),
    ),
    OpField(
      'warehouseId',
      'Almacén de origen',
      kind: FieldKind.select,
      options: warehouseOptions(s),
      hint: (v) => v['articleId']!.isEmpty || v['warehouseId']!.isEmpty
          ? null
          : 'Disponible: ${Snapshot.qty(s.totals(v['articleId']!, v['warehouseId']).available)} ${s.unit(v['articleId'])}',
    ),
    OpField(
      'partnerId',
      'Destino',
      kind: FieldKind.select,
      options: partnerOptions(s, supplier: false),
    ),
    OpField('quantity', 'Cantidad', kind: FieldKind.number, initial: '1'),
    OpField('reference', 'Documento de entrega'),
  ],
  validate: (v, _) => qtyError(
    v['quantity']!,
    s.unit(v['articleId']),
    max: s.totals(v['articleId']!, v['warehouseId']).available,
  ),
  body: (v, _) => {
    'articleId': v['articleId'],
    'warehouseId': v['warehouseId'],
    'partnerId': v['partnerId'],
    'quantity': _num(v['quantity']!),
    'reference': v['reference']!.trim(),
  },
);

OpSpec transferSpec(Snapshot s) => OpSpec(
  title: 'Preparar transferencia',
  path: '/transfers',
  queuedLabel: 'Transferencia entre almacenes',
  note:
      'Preparar reserva el inventario; enviar lo descuenta del origen; recibirlo crea las existencias en el destino.',
  fields: [
    OpField(
      'articleId',
      'Artículo',
      kind: FieldKind.select,
      options: articleOptions(s),
    ),
    OpField(
      'sourceWarehouseId',
      'Almacén de origen',
      kind: FieldKind.select,
      options: warehouseOptions(s),
      hint: (v) => v['articleId']!.isEmpty || v['sourceWarehouseId']!.isEmpty
          ? null
          : 'Disponible: ${Snapshot.qty(s.totals(v['articleId']!, v['sourceWarehouseId']).available)} ${s.unit(v['articleId'])}',
    ),
    OpField(
      'destinationWarehouseId',
      'Almacén de destino',
      kind: FieldKind.select,
      options: warehouseOptions(s),
    ),
    OpField('quantity', 'Cantidad', kind: FieldKind.number, initial: '1'),
    OpField('reference', 'Referencia de transferencia'),
  ],
  validate: (v, _) => v['sourceWarehouseId'] == v['destinationWarehouseId']
      ? 'El almacén de destino debe ser diferente al de origen.'
      : qtyError(
          v['quantity']!,
          s.unit(v['articleId']),
          max: s.totals(v['articleId']!, v['sourceWarehouseId']).available,
        ),
  body: (v, _) => {
    'articleId': v['articleId'],
    'sourceWarehouseId': v['sourceWarehouseId'],
    'destinationWarehouseId': v['destinationWarehouseId'],
    'quantity': _num(v['quantity']!),
    'reference': v['reference']!.trim(),
  },
);

OpSpec countSpec(Snapshot s) {
  final options = _batchOptions(
    s,
    (b) => (b['quantity'] as num) > 0 || (b['reserved'] as num) > 0,
    (b) =>
        ' · registrado ${Snapshot.qty(b['quantity'] as num)} ${s.unit(b['articleId'])}',
  );
  final first = options.isEmpty ? null : s.batch(options.first.value);
  return OpSpec(
    title: 'Conteo físico por lote',
    path: '/counts',
    queuedLabel: 'Conteo físico',
    fields: [
      OpField(
        'batchId',
        'Lote y almacén',
        kind: FieldKind.select,
        options: options,
      ),
      OpField(
        'countedQuantity',
        'Cantidad contada',
        kind: FieldKind.number,
        initial: first == null
            ? '0'
            : Snapshot.qty(first['quantity'] as num).replaceAll(',', ''),
        hint: (v) {
          final b = s.batch(v['batchId']);
          return b == null
              ? null
              : 'Registrado: ${Snapshot.qty(b['quantity'] as num)} ${_unitOfBatch(s, v)} · reservado: ${Snapshot.qty(b['reserved'] as num)}';
        },
      ),
      OpField('reason', 'Motivo del conteo'),
      OpField('reference', 'Referencia del conteo'),
    ],
    validate: (v, _) {
      final b = s.batch(v['batchId']);
      return qtyError(
            v['countedQuantity']!,
            _unitOfBatch(s, v) ?? '',
            zero: true,
            label: 'El conteo',
          ) ??
          (b != null &&
                  (double.parse(_num(v['countedQuantity']!)) * 1000).round() <
                      (b['reserved'] as num)
              ? 'El conteo no puede quedar por debajo de la cantidad reservada.'
              : null);
    },
    body: (v, _) => {
      'batchId': v['batchId'],
      'countedQuantity': _num(v['countedQuantity']!),
      'reason': v['reason']!.trim(),
      'reference': v['reference']!.trim(),
    },
  );
}

OpSpec wasteSpec(Snapshot s) => OpSpec(
  title: 'Registrar merma',
  path: '/waste',
  queuedLabel: 'Merma',
  fields: [
    OpField(
      'batchId',
      'Lote y almacén',
      kind: FieldKind.select,
      options: _batchOptions(
        s,
        (b) => (b['quantity'] as num) > (b['reserved'] as num),
        (_) => '',
      ),
      hint: (v) {
        final b = s.batch(v['batchId']);
        return b == null
            ? null
            : 'Disponible para merma: ${Snapshot.qty((b['quantity'] as num) - (b['reserved'] as num))} ${_unitOfBatch(s, v)}';
      },
    ),
    OpField('quantity', 'Cantidad', kind: FieldKind.number, initial: '1'),
    OpField(
      'reason',
      'Causa',
      kind: FieldKind.select,
      options: const [
        Option('Daño', 'Daño'),
        Option('Caducidad', 'Caducidad'),
        Option('Derrame', 'Derrame'),
        Option('Pérdida en almacenamiento', 'Pérdida en almacenamiento'),
      ],
    ),
  ],
  validate: (v, _) {
    final b = s.batch(v['batchId']);
    return qtyError(
      v['quantity']!,
      _unitOfBatch(s, v) ?? '',
      max: b == null
          ? null
          : (b['quantity'] as num).toInt() - (b['reserved'] as num).toInt(),
    );
  },
  body: (v, _) => {
    'batchId': v['batchId'],
    'quantity': _num(v['quantity']!),
    'reason': v['reason'],
  },
);

OpSpec customerReturnSpec(Snapshot s) => OpSpec(
  title: 'Recibir devolución de cliente',
  path: '/returns/customer',
  queuedLabel: 'Devolución de cliente',
  fields: [
    OpField(
      'batchId',
      'Artículo y lote originalmente despachado',
      kind: FieldKind.select,
      options: _batchOptions(
        s,
        (b) => s.returnable(b) > 0,
        (b) =>
            ' · devolvible ${Snapshot.qty(s.returnable(b))} ${s.unit(b['articleId'])}',
      ),
    ),
    OpField(
      'warehouseId',
      'Almacén que recibe',
      kind: FieldKind.select,
      options: warehouseOptions(s),
    ),
    OpField(
      'partnerId',
      'Cliente o punto de venta',
      kind: FieldKind.select,
      options: partnerOptions(s, supplier: false),
    ),
    OpField('quantity', 'Cantidad', kind: FieldKind.number, initial: '1'),
    OpField('reason', 'Motivo de devolución'),
    OpField('reference', 'Referencia de devolución'),
  ],
  validate: (v, _) {
    final b = s.batch(v['batchId']);
    return qtyError(
      v['quantity']!,
      _unitOfBatch(s, v) ?? '',
      max: b == null ? null : s.returnable(b),
    );
  },
  body: (v, _) => {
    'batchId': v['batchId'],
    'warehouseId': v['warehouseId'],
    'partnerId': v['partnerId'],
    'quantity': _num(v['quantity']!),
    'reason': v['reason']!.trim(),
    'reference': v['reference']!.trim(),
  },
);

OpSpec supplierReturnSpec(Snapshot s) => OpSpec(
  title: 'Devolver mercancía a proveedor',
  path: '/returns/supplier',
  queuedLabel: 'Devolución a proveedor',
  fields: [
    OpField(
      'batchId',
      'Artículo, lote y almacén',
      kind: FieldKind.select,
      options: _batchOptions(
        s,
        (b) => (b['quantity'] as num) > (b['reserved'] as num),
        (b) =>
            ' · ${Snapshot.qty((b['quantity'] as num) - (b['reserved'] as num))} ${s.unit(b['articleId'])}',
      ),
    ),
    OpField(
      'partnerId',
      'Proveedor',
      kind: FieldKind.select,
      options: partnerOptions(s, supplier: true),
    ),
    OpField('quantity', 'Cantidad', kind: FieldKind.number, initial: '1'),
    OpField('reason', 'Motivo de devolución'),
    OpField('reference', 'Referencia de devolución'),
  ],
  validate: (v, _) {
    final b = s.batch(v['batchId']);
    return qtyError(
      v['quantity']!,
      _unitOfBatch(s, v) ?? '',
      max: b == null
          ? null
          : (b['quantity'] as num).toInt() - (b['reserved'] as num).toInt(),
    );
  },
  body: (v, _) => {
    'batchId': v['batchId'],
    'partnerId': v['partnerId'],
    'quantity': _num(v['quantity']!),
    'reason': v['reason']!.trim(),
    'reference': v['reference']!.trim(),
  },
);

// ---- purchases and requests --------------------------------------------------

String? _linesError(Snapshot s, Lines lines) {
  if (lines.isEmpty) return 'Agrega al menos un artículo.';
  final seen = <String>{};
  for (final line in lines) {
    final id = line['articleId'] ?? '';
    if (id.isEmpty) return 'Elige el artículo de cada línea.';
    if (!seen.add(id)) return 'Cada artículo debe aparecer una sola vez.';
    final error = qtyError(line['quantity'] ?? '', s.unit(id));
    if (error != null) return '${s.articleName(id)}: $error';
  }
  return null;
}

List<Map<String, dynamic>> _items(Lines lines) => [
  for (final l in lines)
    {'articleId': l['articleId'], 'quantity': _num(l['quantity']!)},
];

OpSpec purchaseSpec(Snapshot s) => OpSpec(
  title: 'Compra a proveedor',
  path: '/purchases',
  queuedLabel: 'Compra a proveedor',
  lines: LineGroup(articleOptions(s)),
  fields: [
    OpField(
      'partnerId',
      'Proveedor',
      kind: FieldKind.select,
      options: partnerOptions(s, supplier: true),
    ),
    OpField('reference', 'Referencia de la orden'),
  ],
  validate: (_, lines) => _linesError(s, lines),
  body: (v, lines) => {
    'partnerId': v['partnerId'],
    'reference': v['reference']!.trim(),
    'items': _items(lines),
  },
);

OpSpec requestSpec(Snapshot s) => OpSpec(
  title: 'Solicitud al almacén',
  path: '/requests',
  queuedLabel: 'Solicitud de abastecimiento',
  lines: LineGroup(articleOptions(s)),
  fields: [
    OpField(
      'warehouseId',
      'Almacén',
      kind: FieldKind.select,
      options: warehouseOptions(s),
    ),
    OpField('destination', 'Empresa / punto de venta destinatario'),
    OpField('reference', 'Referencia de la solicitud'),
  ],
  validate: (_, lines) => _linesError(s, lines),
  body: (v, lines) => {
    'warehouseId': v['warehouseId'],
    'destination': v['destination']!.trim(),
    'reference': v['reference']!.trim(),
    'items': _items(lines),
  },
);

OpSpec dispatchSpec(Snapshot s, Rec request) {
  final pending = [
    for (final item in s.requestItems(request))
      if ((item['quantity'] as num) - s.dispatched(item) > 0)
        (item, (item['quantity'] as num).toInt() - s.dispatched(item)),
  ];
  return OpSpec(
    title: 'Despacho parcial · ${request['reference']}',
    path: '/requests/${request['id']}',
    method: 'PATCH',
    queuedLabel: 'Despacho de ${request['reference']}',
    note:
        'Indica cuánto entregar ahora. Puedes dejar artículos en cero para una entrega posterior.',
    fields: [
      for (final (item, left) in pending)
        OpField(
          'q_${item['articleId']}',
          '${s.articleName(item['articleId'])} (pendiente ${Snapshot.qty(left)} ${s.unit(item['articleId'])})',
          kind: FieldKind.number,
          initial: Snapshot.qty(left).replaceAll(',', ''),
        ),
    ],
    validate: (v, _) {
      var total = 0.0;
      for (final (item, left) in pending) {
        final text = v['q_${item['articleId']}']!;
        final error = qtyError(
          text,
          s.unit(item['articleId']),
          max: left,
          zero: true,
        );
        if (error != null) return '${s.articleName(item['articleId'])}: $error';
        total += double.parse(_num(text));
      }
      return total == 0 ? 'Indica al menos una cantidad para despachar.' : null;
    },
    body: (v, _) => {
      'action': 'dispatch',
      'items': [
        for (final (item, _) in pending)
          {
            'articleId': item['articleId'],
            'quantity': _num(v['q_${item['articleId']}']!),
          },
      ],
    },
  );
}

// ---- catalog ---------------------------------------------------------------

const _kinds = [
  Option('Mercancía', 'Mercancía'),
  Option('Insumo', 'Insumo'),
  Option('Producto terminado', 'Producto terminado'),
];

OpSpec articleSpec() => OpSpec(
  title: 'Nuevo artículo',
  path: '/articles',
  queuedLabel: 'Nuevo artículo',
  fields: [
    OpField('sku', 'SKU'),
    OpField('name', 'Nombre'),
    OpField('kind', 'Tipo', kind: FieldKind.select, options: _kinds),
    OpField(
      'unit',
      'Unidad',
      kind: FieldKind.select,
      options: const [
        Option('pzas', 'Piezas (pzas)'),
        Option('kg', 'Kilogramos (kg)'),
        Option('L', 'Litros (L)'),
      ],
    ),
  ],
  body: (v, _) => {
    'sku': v['sku']!.trim(),
    'name': v['name']!.trim(),
    'kind': v['kind'],
    'unit': v['unit'],
  },
);

OpSpec editArticleSpec(Rec a) => OpSpec(
  title: 'Editar artículo',
  path: '/articles/${a['id']}',
  method: 'PATCH',
  queuedLabel: 'Edición de ${a['sku']}',
  fields: [
    OpField('name', 'Nombre', initial: '${a['name']}'),
    OpField(
      'active',
      'Estado',
      kind: FieldKind.select,
      options: const [Option('true', 'Activo'), Option('false', 'Desactivado')],
      initial: '${a['active'] != false}',
    ),
  ],
  body: (v, _) => {'name': v['name']!.trim(), 'active': v['active'] == 'true'},
);

OpSpec warehouseSpec() => OpSpec(
  title: 'Nuevo almacén',
  path: '/warehouses',
  queuedLabel: 'Nuevo almacén',
  fields: [OpField('name', 'Nombre'), OpField('location', 'Ubicación')],
  body: (v, _) => {
    'name': v['name']!.trim(),
    'location': v['location']!.trim(),
  },
);

OpSpec partnerSpec() => OpSpec(
  title: 'Empresa / punto de venta',
  path: '/partners',
  queuedLabel: 'Nueva empresa',
  fields: [
    OpField('name', 'Nombre'),
    OpField(
      'kind',
      'Tipo',
      kind: FieldKind.select,
      options: const [
        Option('Proveedor', 'Proveedor'),
        Option('Cliente', 'Cliente'),
        Option('Punto de venta', 'Punto de venta'),
      ],
    ),
    OpField('reference', 'Dirección o referencia'),
  ],
  body: (v, _) => {
    'name': v['name']!.trim(),
    'kind': v['kind'],
    'reference': v['reference']!.trim(),
  },
);

OpSpec policySpec(Snapshot s) => OpSpec(
  title: 'Mínimo por artículo y almacén',
  path: '/policies',
  queuedLabel: 'Stock mínimo',
  note: 'La alerta aparece cuando el disponible es menor al mínimo.',
  fields: [
    OpField(
      'articleId',
      'Artículo',
      kind: FieldKind.select,
      options: articleOptions(s),
    ),
    OpField(
      'warehouseId',
      'Almacén',
      kind: FieldKind.select,
      options: warehouseOptions(s),
    ),
    OpField('minimum', 'Stock mínimo', kind: FieldKind.number, initial: '0'),
  ],
  validate: (v, _) => qtyError(
    v['minimum']!,
    s.unit(v['articleId']),
    zero: true,
    label: 'El mínimo',
  ),
  body: (v, _) => {
    'articleId': v['articleId'],
    'warehouseId': v['warehouseId'],
    'minimum': _num(v['minimum']!),
  },
);

OpSpec companySpec(Snapshot s) {
  final company = (s.raw['company'] as Map?) ?? const {};
  return OpSpec(
    title: 'Nombre de la empresa',
    path: '/company',
    method: 'PATCH',
    queuedLabel: 'Nombre de la empresa',
    note: 'El logo se cambia desde la versión web; aquí se conserva el actual.',
    fields: [
      OpField('name', 'Nombre comercial', initial: '${company['name'] ?? ''}'),
    ],
    body: (v, _) => {'name': v['name']!.trim(), 'logo': company['logo'] ?? ''},
  );
}

// ---- CSV imports -------------------------------------------------------------

OpSpec importArticlesSpec() => OpSpec(
  title: 'Importar artículos desde CSV',
  path: '/articles/import',
  queuedLabel: 'Importación de artículos',
  submitLabel: 'Importar artículos',
  note:
      'Pega el contenido del archivo CSV. Columnas requeridas: SKU, Nombre, Tipo y Unidad. Máximo 200 filas.',
  fields: [OpField('csv', 'Contenido del CSV', kind: FieldKind.multiline)],
  validate: (v, _) {
    try {
      parseArticlesCsv(v['csv']!);
      return null;
    } on FormatException catch (e) {
      return e.message;
    }
  },
  body: (v, _) => {'rows': parseArticlesCsv(v['csv']!)},
);

OpSpec importInventorySpec(Snapshot s) => OpSpec(
  title: 'Importar existencias iniciales',
  path: '/inventory/import',
  queuedLabel: 'Importación de existencias',
  submitLabel: 'Importar existencias',
  note:
      'Pega el contenido del CSV. Columnas: SKU, Almacén, Proveedor, Lote, Cantidad, Caducidad y Referencia; Costo (unitario, MXN) es opcional. Los nombres deben coincidir con el catálogo. Máximo 100 filas.',
  fields: [OpField('csv', 'Contenido del CSV', kind: FieldKind.multiline)],
  validate: (v, _) {
    try {
      parseInventoryCsv(v['csv']!, s);
      return null;
    } on FormatException catch (e) {
      return e.message;
    }
  },
  body: (v, _) => {'rows': parseInventoryCsv(v['csv']!, s)},
);

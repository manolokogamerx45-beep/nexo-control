import 'snapshot.dart';

/// Lower-case, accent-free text used to match CSV headers and catalog names.
String normalized(Object? value) {
  const from = 'áàäâéèëêíìïîóòöôúùüûñ';
  const to = 'aaaaeeeeiiiioooouuuun';
  final buffer = StringBuffer();
  for (final unit in '$value'.trim().toLowerCase().runes) {
    final char = String.fromCharCode(unit), at = from.indexOf(char);
    buffer.write(at < 0 ? char : to[at]);
  }
  return buffer.toString();
}

class CsvTable {
  CsvTable(this.headers, this.rows);
  final List<String> headers;
  final List<List<String>> rows;
  int column(List<String> names) =>
      headers.indexWhere((h) => names.contains(h));
}

/// Parses comma or semicolon separated text, with quoted cells (as Excel exports).
CsvTable parseCsvTable(String input) {
  final text = input.replaceAll('﻿', '').replaceAll(RegExp(r'\r\n?'), '\n');
  var commas = 0, semicolons = 0, quoted = false;
  for (final char in text.split('')) {
    if (char == '"') {
      quoted = !quoted;
    } else if (!quoted && char == '\n') {
      break;
    } else if (!quoted && char == ',') {
      commas++;
    } else if (!quoted && char == ';') {
      semicolons++;
    }
  }
  final delimiter = semicolons > commas ? ';' : ',';
  final rows = <List<String>>[[]];
  var value = '', inside = false;
  for (var i = 0; i < text.length; i++) {
    final c = text[i];
    if (inside) {
      if (c == '"' && i + 1 < text.length && text[i + 1] == '"') {
        value += '"';
        i++;
      } else if (c == '"') {
        inside = false;
      } else {
        value += c;
      }
    } else if (c == '"' && value.isEmpty) {
      inside = true;
    } else if (c == delimiter) {
      rows.last.add(value);
      value = '';
    } else if (c == '\n') {
      rows.last.add(value);
      rows.add([]);
      value = '';
    } else {
      value += c;
    }
  }
  if (inside) {
    throw const FormatException('El CSV contiene comillas sin cerrar.');
  }
  rows.last.add(value);
  final clean = rows.where((r) => r.any((c) => c.trim().isNotEmpty)).toList();
  final headers = clean.isEmpty ? <String>[] : clean.removeAt(0);
  return CsvTable([for (final h in headers) normalized(h)], clean);
}

String _cell(List<String> row, int index) =>
    index < 0 || index >= row.length ? '' : row[index].trim();

/// Rows for `POST /articles/import`.
List<Map<String, dynamic>> parseArticlesCsv(String text) {
  final table = parseCsvTable(text);
  final sku = table.column(['sku', 'codigo']),
      name = table.column(['nombre', 'name', 'articulo', 'producto']),
      kind = table.column(['tipo', 'kind']),
      unit = table.column(['unidad', 'unit']);
  if ([sku, name, kind, unit].any((i) => i < 0)) {
    throw const FormatException(
      'El encabezado debe incluir SKU, Nombre, Tipo y Unidad.',
    );
  }
  if (table.rows.isEmpty) {
    throw const FormatException('El archivo no contiene artículos.');
  }
  if (table.rows.length > 200) {
    throw const FormatException('Solo se permiten 200 artículos por archivo.');
  }
  const kinds = {
    'insumo': 'Insumo',
    'producto terminado': 'Producto terminado',
    'mercancia': 'Mercancía',
  };
  const units = {
    'pzas': 'pzas',
    'pieza': 'pzas',
    'piezas': 'pzas',
    'kg': 'kg',
    'kilogramo': 'kg',
    'kilogramos': 'kg',
    'l': 'L',
    'litro': 'L',
    'litros': 'L',
  };
  return [
    for (var i = 0; i < table.rows.length; i++)
      () {
        final row = table.rows[i];
        final k = kinds[normalized(_cell(row, kind))],
            u = units[normalized(_cell(row, unit))];
        if (k == null || u == null) {
          throw FormatException('Tipo o unidad inválido en la fila ${i + 2}.');
        }
        return {
          'sku': _cell(row, sku).toUpperCase(),
          'name': _cell(row, name),
          'kind': k,
          'unit': u,
        };
      }(),
  ];
}

/// Rows for `POST /inventory/import`; names are matched against the catalog.
List<Map<String, dynamic>> parseInventoryCsv(String text, Snapshot s) {
  final table = parseCsvTable(text);
  final sku = table.column(['sku', 'codigo']),
      warehouse = table.column(['almacen', 'bodega']),
      supplier = table.column(['proveedor']),
      lot = table.column(['lote']),
      quantity = table.column(['cantidad']),
      expiry = table.column(['caducidad', 'vencimiento']),
      reference = table.column(['referencia', 'documento']),
      cost = table.column(['costo', 'costo unitario', 'costo_unitario']);
  if ([
    sku,
    warehouse,
    supplier,
    lot,
    quantity,
    expiry,
    reference,
  ].any((i) => i < 0)) {
    throw const FormatException(
      'El encabezado debe incluir SKU, Almacén, Proveedor, Lote, Cantidad, Caducidad y Referencia.',
    );
  }
  if (table.rows.isEmpty) {
    throw const FormatException('El archivo no contiene existencias.');
  }
  if (table.rows.length > 100) {
    throw const FormatException(
      'Solo se permiten 100 existencias por archivo.',
    );
  }
  Map<String, dynamic> unique(
    Iterable<Map<String, dynamic>> matches,
    String label,
    int line,
  ) {
    if (matches.length != 1) {
      throw FormatException('$label no encontrado o ambiguo en la fila $line.');
    }
    return matches.first;
  }

  return [
    for (var i = 0; i < table.rows.length; i++)
      () {
        final row = table.rows[i], line = i + 2;
        final a = unique(
          s.articles.where((x) => x['sku'] == _cell(row, sku).toUpperCase()),
          'SKU',
          line,
        );
        final w = unique(
          s.warehouses.where(
            (x) => normalized(x['name']) == normalized(_cell(row, warehouse)),
          ),
          'Almacén',
          line,
        );
        final p = unique(
          s.partners.where(
            (x) =>
                x['kind'] == 'Proveedor' &&
                normalized(x['name']) == normalized(_cell(row, supplier)),
          ),
          'Proveedor',
          line,
        );
        return {
          'articleId': a['id'],
          'warehouseId': w['id'],
          'partnerId': p['id'],
          'lot': _cell(row, lot),
          'quantity': _cell(row, quantity).replaceAll(',', '.'),
          'expiry': _cell(row, expiry),
          'reference': _cell(row, reference),
          if (cost >= 0)
            'unitCost': _cell(row, cost).replaceAll(RegExp(r'[$,]'), ''),
        };
      }(),
  ];
}

String csvEscape(Object? value) {
  final text = '$value';
  return RegExp(r'[",\n;]').hasMatch(text)
      ? '"${text.replaceAll('"', '""')}"'
      : text;
}

/// The same inventory CSV the web exports.
String inventoryCsv(Snapshot s, {String query = ''}) {
  final rows = <List<Object?>>[
    [
      'SKU',
      'Artículo',
      'Almacén',
      'Físico',
      'Reservado',
      'Disponible',
      'Unidad',
    ],
  ];
  for (final a in s.articles) {
    if (!'${a['sku']} ${a['name']}'.toLowerCase().contains(
      query.toLowerCase(),
    )) {
      continue;
    }
    for (final w in s.warehouses) {
      final t = s.totals('${a['id']}', '${w['id']}');
      rows.add([
        a['sku'],
        a['name'],
        w['name'],
        t.physical / 1000,
        t.reserved / 1000,
        t.available / 1000,
        a['unit'],
      ]);
    }
  }
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../auth/auth_repository.dart';
import 'csv.dart';
import 'op_specs.dart';
import 'ops_view_model.dart';
import 'snapshot.dart';
import 'ui.dart';

/// What every section needs from the shell: data, the user and ways to act.
class Host {
  const Host({
    required this.vm,
    required this.s,
    required this.user,
    required this.form,
    required this.act,
    required this.go,
    required this.info,
  });
  final OpsViewModel vm;
  final Snapshot s;
  final AppUser user;
  final Future<void> Function(OpSpec spec) form;

  /// Sends a state change (approve, cancel...), asking first when [confirm] is set.
  final Future<void> Function(
    String path,
    String method,
    Map<String, dynamic> body,
    String label, {
    String? confirm,
  })
  act;
  final void Function(String section) go;
  final void Function(String title, Widget child) info;
  bool allow([List<String> roles = const []]) => s.allow(roles);
}

Widget primaryButton(String label, VoidCallback onTap, {IconData? icon}) =>
    FilledButton.icon(
      onPressed: onTap,
      icon: Icon(icon ?? Icons.add, size: 18),
      label: Text(label),
      style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
    );

Widget secondaryButton(String label, VoidCallback onTap) => OutlinedButton(
  onPressed: onTap,
  style: OutlinedButton.styleFrom(minimumSize: const Size(48, 44)),
  child: Text(label),
);

String _unitQty(Snapshot s, Object? articleId, num thousandths) =>
    '${Snapshot.qty(thousandths)} ${s.unit(articleId)}';

class OverviewSection extends StatelessWidget {
  const OverviewSection(this.h, {super.key});
  final Host h;
  @override
  Widget build(BuildContext context) {
    final s = h.s, low = s.lowStock, expired = s.expired;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader('Resumen', subtitle: s.companyName),
        MetricGrid([
          MetricTile(
            'Artículos',
            '${s.articles.where((a) => a['active'] != false).length}',
          ),
          MetricTile('Almacenes', '${s.warehouses.length}'),
          MetricTile('Solicitudes pendientes', '${s.pendingRequests}'),
          MetricTile('Alertas de stock bajo', '${low.length}'),
        ]),
        const SizedBox(height: 20),
        Text(
          'Requieren atención',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        if (low.isEmpty && expired.isEmpty)
          const EmptyNote('Sin alertas: no hay stock bajo ni lotes caducados.')
        else
          CardGrid([
            for (final p in low)
              RecCard(
                title: s.articleName(p['articleId']),
                pills: const [Pill('Stock bajo', warn: true)],
                lines: [
                  s.warehouseName(p['warehouseId']),
                  '${_unitQty(s, p['articleId'], s.totals('${p['articleId']}', '${p['warehouseId']}').available)} disponibles; mínimo ${_unitQty(s, p['articleId'], p['minimum'] as num)}',
                ],
                onTap: () => h.go('inventory'),
              ),
            for (final b in expired)
              RecCard(
                title: s.articleName(b['articleId']),
                pills: const [Pill('Caducado', warn: true)],
                lines: [
                  s.warehouseName(b['warehouseId']),
                  'Lote ${b['lot']} · ${b['expiry']}',
                ],
                onTap: () => h.go('lots'),
              ),
          ]),
        if (s.articles.isEmpty) ...[
          const SizedBox(height: 12),
          const EmptyNote(
            'Tu operación, paso a paso: configura almacenes y empresas → crea artículos → recibe lotes → atiende solicitudes → consulta las entregas.',
          ),
        ],
      ],
    );
  }
}

class InventorySection extends StatefulWidget {
  const InventorySection(this.h, {super.key});
  final Host h;
  @override
  State<InventorySection> createState() => _InventorySectionState();
}

class _InventorySectionState extends State<InventorySection> {
  String query = '', warehouse = '';
  bool onlyLow = false;
  int limit = 30;

  void detail(Rec a, Rec w) {
    final s = widget.h.s;
    final batches = [
      for (final b in s.batches)
        if (b['articleId'] == a['id'] &&
            b['warehouseId'] == w['id'] &&
            ((b['quantity'] as num) > 0 || (b['reserved'] as num) > 0))
          b,
    ];
    final policy = s.policies
        .where((p) => p['articleId'] == a['id'] && p['warehouseId'] == w['id'])
        .firstOrNull;
    widget.h.info(
      '${a['name']} · ${w['name']}',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('SKU ${a['sku']} · ${a['kind']}'),
          Text(
            policy == null
                ? 'Sin mínimo definido'
                : 'Mínimo: ${_unitQty(s, a['id'], policy['minimum'] as num)}',
          ),
          const SizedBox(height: 12),
          if (batches.isEmpty)
            const Text('Sin existencias en este almacén.')
          else
            for (final b in batches)
              RecCard(
                title: 'Lote ${b['lot']}',
                lines: [
                  'Existencia: ${_unitQty(s, a['id'], b['quantity'] as num)} · reservado ${Snapshot.qty(b['reserved'] as num)}',
                  'Entrada: ${formatDate(b['receivedAt'])}',
                  'Caducidad: ${b['expiry'] ?? 'Sin caducidad'}',
                ],
                pills: [if (!s.usable(b)) const Pill('Caducado', warn: true)],
              ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final h = widget.h, s = h.s;
    final rows =
        [
              for (final a in s.articles)
                for (final w in s.warehouses)
                  if ((warehouse.isEmpty || warehouse == w['id']) &&
                      '${a['sku']} ${a['name']}'.toLowerCase().contains(
                        query.toLowerCase().trim(),
                      ))
                    (
                      a: a,
                      w: w,
                      t: s.totals('${a['id']}', '${w['id']}'),
                      p: s.policies
                          .where(
                            (p) =>
                                p['articleId'] == a['id'] &&
                                p['warehouseId'] == w['id'],
                          )
                          .firstOrNull,
                    ),
            ]
            .where(
              (r) =>
                  !onlyLow ||
                  (r.p != null && r.t.available < (r.p!['minimum'] as num)),
            )
            .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          'Inventario',
          subtitle:
              'Existencias físicas, reservadas y disponibles por almacén.',
          actions: [
            if (h.allow(['almacen'])) ...[
              primaryButton('Recibir mercancía', () => h.form(receiptSpec(s))),
              secondaryButton('Salida PEPS', () => h.form(issueSpec(s))),
              secondaryButton('Transferir', () => h.form(transferSpec(s))),
              secondaryButton('Conteo físico', () => h.form(countSpec(s))),
              secondaryButton('Definir mínimo', () => h.form(policySpec(s))),
              secondaryButton(
                'Importar existencias',
                () => h.form(importInventorySpec(s)),
              ),
            ],
            secondaryButton('Copiar CSV', () async {
              await Clipboard.setData(
                ClipboardData(text: inventoryCsv(s, query: query)),
              );
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Inventario copiado como CSV.')),
                );
              }
            }),
          ],
        ),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            SizedBox(
              width: 320,
              child: TextField(
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Buscar artículo o SKU',
                ),
                onChanged: (v) => setState(() {
                  query = v;
                  limit = 30;
                }),
              ),
            ),
            SizedBox(
              width: 240,
              child: DropdownButtonFormField<String>(
                initialValue: warehouse,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Almacén'),
                items: [
                  const DropdownMenuItem(
                    value: '',
                    child: Text('Todos los almacenes'),
                  ),
                  for (final w in s.warehouses)
                    DropdownMenuItem(
                      value: '${w['id']}',
                      child: Text(
                        '${w['name']}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: (v) => setState(() {
                  warehouse = v ?? '';
                  limit = 30;
                }),
              ),
            ),
            FilterChip(
              label: const Text('Solo stock bajo'),
              selected: onlyLow,
              onSelected: (v) => setState(() => onlyLow = v),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (rows.isEmpty)
          const EmptyNote('No hay resultados con estos filtros.')
        else
          CardGrid([
            for (final r in rows.take(limit))
              RecCard(
                title: '${r.a['sku']} · ${r.a['name']}',
                pills: [
                  if (r.p != null)
                    r.t.available < (r.p!['minimum'] as num)
                        ? const Pill('Stock bajo', warn: true)
                        : const Pill('En nivel', ok: true),
                ],
                lines: [
                  r.w['name'] as String,
                  'Físico ${_unitQty(s, r.a['id'], r.t.physical)} · Reservado ${Snapshot.qty(r.t.reserved)} · Disponible ${Snapshot.qty(r.t.available)}',
                  if (r.p != null)
                    'Mínimo ${Snapshot.qty(r.p!['minimum'] as num)}',
                ],
                onTap: () => detail(r.a, r.w),
              ),
          ]),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('${rows.length} resultados'),
              if (rows.length > limit)
                TextButton(
                  onPressed: () => setState(() => limit += 30),
                  child: const Text('Mostrar más'),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class ArticlesSection extends StatelessWidget {
  const ArticlesSection(this.h, {super.key});
  final Host h;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SectionHeader(
        'Artículos',
        subtitle:
            'Catálogo con rotación PEPS: primero en entrar, primero en salir.',
        actions: [
          if (h.allow(['compras'])) ...[
            primaryButton('Nuevo artículo', () => h.form(articleSpec())),
            secondaryButton('Importar CSV', () => h.form(importArticlesSpec())),
          ],
        ],
      ),
      if (h.s.articles.isEmpty)
        const EmptyNote('El catálogo está vacío.')
      else
        CardGrid([
          for (final a in h.s.articles)
            RecCard(
              title: '${a['sku']} · ${a['name']}',
              pills: [
                a['active'] == false
                    ? const Pill('Desactivado', warn: true)
                    : const Pill('Activo', ok: true),
              ],
              lines: ['${a['kind']} · ${a['unit']} · Rotación PEPS'],
              actions: [
                if (h.allow(['compras']))
                  secondaryButton('Editar', () => h.form(editArticleSpec(a))),
              ],
            ),
        ]),
    ],
  );
}

class RequestsSection extends StatelessWidget {
  const RequestsSection(this.h, {super.key});
  final Host h;

  void detail(Rec r) {
    final s = h.s;
    h.info(
      'Solicitud ${r['reference']}',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${r['destination']} · ${s.warehouseName(r['warehouseId'])}'),
          Text(
            'Solicitó ${r['createdByName']} · ${formatDate(r['createdAt'])}',
          ),
          const SizedBox(height: 12),
          for (final item in s.requestItems(r))
            RecCard(
              title: s.articleName(item['articleId']),
              lines: [
                'Pedido ${_unitQty(s, item['articleId'], item['quantity'] as num)} · despachado ${Snapshot.qty(s.dispatched(item))}',
                for (final a in (item['allocations'] as List? ?? const []))
                  'Lote ${s.batch((a as Map)['batchId'])?['lot'] ?? '—'}: ${Snapshot.qty(a['qty'] as num)} (despachado ${Snapshot.qty((a['dispatched'] as num?) ?? 0)})',
              ],
            ),
          const SizedBox(height: 8),
          Text(
            'Historial',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          for (final e in (r['history'] as List? ?? const []))
            Text(
              '${(e as Map)['status']} · ${formatDate(e['at'])} · ${e['actor']}',
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = h.s;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          'Solicitudes de abastecimiento',
          subtitle:
              'Del punto de venta al almacén: solicitud, reserva, despacho y recepción.',
          actions: [
            if (h.allow(['solicitante', 'compras', 'almacen']))
              primaryButton('Nueva solicitud', () => h.form(requestSpec(s))),
          ],
        ),
        if (s.requests.isEmpty)
          const EmptyNote('Aún no hay solicitudes.')
        else
          CardGrid([
            for (final r in s.requests)
              RecCard(
                title: '${r['reference']}',
                pills: [
                  Pill(
                    '${r['status']}',
                    warn: ['Pendiente', 'Cancelada'].contains(r['status']),
                    ok: r['status'] == 'Recibida',
                  ),
                ],
                lines: [
                  '${r['createdByName']} → ${r['destination']}',
                  [
                    for (final i in s.requestItems(r))
                      '${s.articleName(i['articleId'])} ${_unitQty(s, i['articleId'], i['quantity'] as num)}',
                  ].join(' · '),
                  '${s.warehouseName(r['warehouseId'])} · ${formatDate(r['createdAt'])}',
                ],
                onTap: () => detail(r),
                actions: [
                  secondaryButton('Detalle', () => detail(r)),
                  if (h.allow(['almacen']) && r['status'] == 'Pendiente')
                    primaryButton(
                      'Aprobar',
                      () => h.act(
                        '/requests/${r['id']}',
                        'PATCH',
                        {'action': 'approve'},
                        'Aprobar ${r['reference']}',
                      ),
                      icon: Icons.check,
                    ),
                  if (h.allow(['almacen']) &&
                      [
                        'Aprobada',
                        'Parcialmente despachada',
                      ].contains(r['status']))
                    primaryButton(
                      'Despachar',
                      () => h.form(dispatchSpec(s, r)),
                      icon: Icons.local_shipping_outlined,
                    ),
                  if (h.allow(['almacen']) &&
                      [
                        'Pendiente',
                        'Aprobada',
                        'Parcialmente despachada',
                      ].contains(r['status']))
                    secondaryButton(
                      'Cancelar',
                      () => h.act(
                        '/requests/${r['id']}',
                        'PATCH',
                        {'action': 'cancel'},
                        'Cancelar ${r['reference']}',
                        confirm:
                            '¿Cancelar la solicitud ${r['reference']}? Se liberarán las reservas pendientes.',
                      ),
                    ),
                  if (r['status'] == 'Despachada' &&
                      (h.user.role == 'administrador' ||
                          r['createdBy'] == s.userId))
                    primaryButton(
                      'Confirmar recepción',
                      () => h.act(
                        '/requests/${r['id']}',
                        'PATCH',
                        {'action': 'receive'},
                        'Recepción de ${r['reference']}',
                      ),
                      icon: Icons.inventory_outlined,
                    ),
                ],
              ),
          ]),
      ],
    );
  }
}

class LotsSection extends StatefulWidget {
  const LotsSection(this.h, {super.key});
  final Host h;
  @override
  State<LotsSection> createState() => _LotsSectionState();
}

class _LotsSectionState extends State<LotsSection> {
  int limit = 30;

  void trace(Rec b) {
    final s = widget.h.s;
    final events = s.events.where((e) => e['batchId'] == b['id']).toList();
    widget.h.info(
      'Trazabilidad · ${b['lot']}',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${s.articleName(b['articleId'])} · ${s.warehouseName(b['warehouseId'])}',
          ),
          const SizedBox(height: 12),
          if (events.isEmpty) const Text('Sin movimientos registrados.'),
          for (final e in events) EventCard(s, e),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final h = widget.h, s = h.s;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(
          'Lotes y trazabilidad',
          subtitle: 'Cada recepción es una capa PEPS con su recorrido.',
        ),
        if (s.batches.isEmpty)
          const EmptyNote('Todavía no hay lotes.')
        else
          CardGrid([
            for (final b in s.batches.take(limit))
              RecCard(
                title: '${s.articleName(b['articleId'])} · ${b['lot']}',
                pills: [if (!s.usable(b)) const Pill('Caducado', warn: true)],
                lines: [
                  s.warehouseName(b['warehouseId']),
                  'Entrada ${formatDate(b['receivedAt'])} · Caducidad ${b['expiry'] ?? 'sin caducidad'}',
                  'Existencia ${_unitQty(s, b['articleId'], b['quantity'] as num)} · reservado ${Snapshot.qty(b['reserved'] as num)}',
                ],
                actions: [secondaryButton('Recorrido', () => trace(b))],
              ),
          ]),
        if (s.batches.length > limit)
          Center(
            child: TextButton(
              onPressed: () => setState(() => limit += 30),
              child: const Text('Mostrar más'),
            ),
          ),
      ],
    );
  }
}

class EventCard extends StatelessWidget {
  const EventCard(this.s, this.e, {super.key});
  final Snapshot s;
  final Rec e;
  @override
  Widget build(BuildContext context) {
    final batch = s.batch(e['batchId']);
    final place = e['destinationWarehouseId'] != null
        ? '${s.warehouseName(e['warehouseId'])} → ${s.warehouseName(e['destinationWarehouseId'])}'
        : e['sourceWarehouseId'] != null
        ? '${s.warehouseName(e['sourceWarehouseId'])} → ${s.warehouseName(e['warehouseId'])}'
        : '${s.warehouseName(e['warehouseId'])} · ${e['destination'] ?? s.partnerName(e['partnerId'])}';
    return RecCard(
      title:
          '${s.articleName(e['articleId'])} · ${_unitQty(s, e['articleId'], e['qty'] as num)}',
      pills: [Pill('${e['type']}')],
      lines: [
        'Lote ${batch?['lot'] ?? '—'} · $place',
        if ('${e['reference'] ?? ''}'.isNotEmpty) 'Ref. ${e['reference']}',
        '${formatDate(e['at'])} · ${e['actorName'] ?? ''}',
      ],
    );
  }
}

class EventsSection extends StatefulWidget {
  const EventsSection(this.h, this.kind, {super.key});
  final Host h;

  /// `movements`, `returns` or `waste`.
  final String kind;
  @override
  State<EventsSection> createState() => _EventsSectionState();
}

class _EventsSectionState extends State<EventsSection> {
  int limit = 40;
  @override
  Widget build(BuildContext context) {
    final h = widget.h, s = h.s, kind = widget.kind;
    final events = [
      for (final e in s.events)
        if (kind == 'waste'
            ? e['type'] == 'Merma'
            : kind == 'returns'
            ? '${e['type']}'.startsWith('Devolución')
            : true)
          e,
    ];
    final almacen = h.allow(['almacen']);
    final (title, subtitle) = switch (kind) {
      'waste' => ('Mermas', 'Pérdidas registradas con su causa.'),
      'returns' => (
        'Devoluciones',
        'Devoluciones de clientes y a proveedores.',
      ),
      _ => (
        'Movimientos',
        'Entradas, salidas, ajustes y transferencias por lote.',
      ),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          title,
          subtitle: subtitle,
          actions: [
            if (almacen && kind == 'waste')
              primaryButton('Registrar merma', () => h.form(wasteSpec(s))),
            if (almacen && kind == 'returns') ...[
              primaryButton(
                'Recibir de cliente',
                () => h.form(customerReturnSpec(s)),
              ),
              secondaryButton(
                'Devolver a proveedor',
                () => h.form(supplierReturnSpec(s)),
              ),
            ],
            if (almacen && kind == 'movements') ...[
              primaryButton('Recibir mercancía', () => h.form(receiptSpec(s))),
              secondaryButton('Salida PEPS', () => h.form(issueSpec(s))),
              secondaryButton('Conteo físico', () => h.form(countSpec(s))),
              secondaryButton('Registrar merma', () => h.form(wasteSpec(s))),
            ],
          ],
        ),
        if (events.isEmpty)
          const EmptyNote('Aún no hay registros.')
        else
          CardGrid([for (final e in events.take(limit)) EventCard(s, e)]),
        if (events.length > limit)
          Center(
            child: TextButton(
              onPressed: () => setState(() => limit += 40),
              child: const Text('Mostrar más'),
            ),
          ),
      ],
    );
  }
}

class TransfersSection extends StatelessWidget {
  const TransfersSection(this.h, {super.key});
  final Host h;
  @override
  Widget build(BuildContext context) {
    final s = h.s, almacen = h.allow(['almacen']);
    Widget step(
      Rec t,
      String action,
      String label, {
      bool primary = true,
      String? confirm,
    }) {
      void run() => h.act(
        '/transfers/${t['id']}',
        'PATCH',
        {'action': action},
        '$label ${t['reference']}',
        confirm: confirm,
      );
      return primary
          ? primaryButton(label, run, icon: Icons.arrow_forward)
          : secondaryButton(label, run);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          'Transferencias',
          subtitle:
              'Preparar reserva el inventario; enviar lo descuenta del origen; recibirlo crea las existencias en el destino.',
          actions: [
            if (almacen)
              primaryButton(
                'Nueva transferencia',
                () => h.form(transferSpec(s)),
              ),
          ],
        ),
        if (s.transfers.isEmpty)
          const EmptyNote('Aún no hay transferencias.')
        else
          CardGrid([
            for (final t in s.transfers)
              RecCard(
                title: '${t['reference']}',
                pills: [
                  Pill(
                    '${t['status']}',
                    warn: ['Cancelada', 'Rechazada'].contains(t['status']),
                    ok: t['status'] == 'Recibida',
                  ),
                ],
                lines: [
                  '${s.articleName(t['articleId'])} · ${_unitQty(s, t['articleId'], t['quantity'] as num)}',
                  '${s.warehouseName(t['sourceWarehouseId'])} → ${s.warehouseName(t['destinationWarehouseId'])}',
                  formatDate(t['createdAt']),
                ],
                actions: [
                  if (almacen && t['status'] == 'Preparada') ...[
                    step(t, 'send', 'Enviar'),
                    step(
                      t,
                      'cancel',
                      'Cancelar',
                      primary: false,
                      confirm: '¿Cancelar la transferencia ${t['reference']}?',
                    ),
                  ],
                  if (almacen && t['status'] == 'Enviada') ...[
                    step(t, 'receive', 'Recibir'),
                    step(
                      t,
                      'reject',
                      'Rechazar',
                      primary: false,
                      confirm:
                          '¿Rechazar la transferencia ${t['reference']}? La mercancía regresa al origen.',
                    ),
                  ],
                ],
              ),
          ]),
      ],
    );
  }
}

class PurchasesSection extends StatelessWidget {
  const PurchasesSection(this.h, {super.key});
  final Host h;
  @override
  Widget build(BuildContext context) {
    final s = h.s;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          'Compras a proveedores',
          subtitle:
              'Cada orden puede recibirse por artículo y en varias entregas.',
          actions: [
            if (h.allow(['compras']))
              primaryButton('Nueva compra', () => h.form(purchaseSpec(s))),
          ],
        ),
        if (s.purchases.isEmpty)
          const EmptyNote('Aún no hay órdenes de compra.')
        else
          CardGrid([
            for (final p in s.purchases)
              RecCard(
                title: '${p['reference']}',
                pills: [
                  Pill(
                    '${p['status']}',
                    ok: p['status'] == 'Recibida',
                    warn: p['status'] == 'Recepción parcial',
                  ),
                ],
                lines: [
                  s.partnerName(p['partnerId']),
                  for (final i in s.purchaseItems(p))
                    '${s.articleName(i['articleId'])}: pedido ${_unitQty(s, i['articleId'], i['quantity'] as num)} · recibido ${Snapshot.qty(i['received'] as num)}',
                  formatDate(p['createdAt']),
                ],
                actions: [
                  if (h.allow(['almacen']) && p['status'] != 'Recibida')
                    primaryButton(
                      'Recibir',
                      () => h.form(receiptSpec(s, purchase: p)),
                      icon: Icons.move_to_inbox_outlined,
                    ),
                ],
              ),
          ]),
      ],
    );
  }
}

class PartnersSection extends StatelessWidget {
  const PartnersSection(this.h, {super.key});
  final Host h;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SectionHeader(
        'Empresas y puntos de venta',
        subtitle: 'Proveedores, clientes y puntos de venta.',
        actions: [
          if (h.allow(['compras']))
            primaryButton('Agregar empresa', () => h.form(partnerSpec())),
        ],
      ),
      if (h.s.partners.isEmpty)
        const EmptyNote('Aún no hay empresas.')
      else
        CardGrid([
          for (final p in h.s.partners)
            RecCard(
              title: '${p['name']}',
              pills: [Pill('${p['kind']}')],
              lines: ['${p['reference']}'],
            ),
        ]),
    ],
  );
}

class WarehousesSection extends StatelessWidget {
  const WarehousesSection(this.h, {super.key});
  final Host h;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SectionHeader(
        'Almacenes',
        subtitle: 'Ubicaciones donde se guarda el inventario.',
        actions: [
          if (h.allow())
            primaryButton('Nuevo almacén', () => h.form(warehouseSpec())),
        ],
      ),
      if (h.s.warehouses.isEmpty)
        const EmptyNote('Aún no hay almacenes.')
      else
        CardGrid([
          for (final w in h.s.warehouses)
            RecCard(
              title: '${w['name']}',
              lines: [
                '${w['location']}',
                '${h.s.batches.where((b) => b['warehouseId'] == w['id'] && (b['quantity'] as num) > 0).length} lotes con existencia',
              ],
              onTap: () => h.go('inventory'),
            ),
        ]),
    ],
  );
}

class CompanySection extends StatelessWidget {
  const CompanySection(this.h, {super.key});
  final Host h;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SectionHeader(
        'Mi empresa',
        subtitle: 'Nombre que ven todos los usuarios.',
        actions: [
          primaryButton(
            'Editar nombre',
            () => h.form(companySpec(h.s)),
            icon: Icons.edit_outlined,
          ),
        ],
      ),
      RecCard(
        title: h.s.companyName,
        lines: const ['El logo se cambia desde la versión web.'],
      ),
    ],
  );
}

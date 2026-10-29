import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/api_client.dart';
import '../auth/auth_view_model.dart';
import '../auth/auth_screen.dart';
import '../privacy/privacy_notice_screen.dart';
import 'inventory_view_model.dart';

String number(num value) => NumberFormat('#,##0.##', 'es_MX').format(value);
String money(num value) => NumberFormat.currency(
  locale: 'es_MX',
  symbol: r'$',
  decimalDigits: 0,
).format(value);

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.auth, required this.repository});
  final AuthViewModel auth;
  final InventoryRepository repository;
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final InventoryViewModel stock;
  final search = TextEditingController();
  int page = 0;
  static const titles = ['Resumen', 'Inventario', 'Movimientos', 'Más'];
  @override
  void initState() {
    super.initState();
    stock = InventoryViewModel(widget.repository)..load();
  }

  @override
  void dispose() {
    stock.dispose();
    search.dispose();
    super.dispose();
  }

  void openInventory({String location = 'Todos', bool low = false}) {
    search.clear();
    stock.filter(search: '', location: location, low: low);
    setState(() => page = 1);
  }

  Future<void> record() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => stock.live
          ? LiveMovementForm(stock: stock)
          : MovementForm(stock: stock),
    );
  }

  void openPage(String title, Widget Function() content) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => AnimatedBuilder(
          animation: stock,
          builder: (context, _) => Scaffold(
            appBar: AppBar(title: Text(title)),
            body: SafeArea(
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  if (!stock.live) ...[
                    const DemoNotice(),
                    const SizedBox(height: 20),
                  ],
                  content(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: stock,
    builder: (context, _) {
      final wide = MediaQuery.sizeOf(context).width >= 760;
      final body = stock.loading
          ? const Center(child: CircularProgressIndicator())
          : stock.error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(stock.error!),
                  TextButton(
                    onPressed: stock.load,
                    child: const Text('Volver a intentar'),
                  ),
                ],
              ),
            )
          : ListView(
              padding: EdgeInsets.fromLTRB(
                wide ? 32 : 20,
                8,
                wide ? 32 : 20,
                100,
              ),
              children: [
                if (!stock.live) ...[
                  const DemoNotice(),
                  const SizedBox(height: 24),
                ],
                if (page == 0) dashboard(),
                if (page == 1) inventory(),
                if (page == 2) movementList(),
                if (page == 3) more(),
              ],
            );
      return Scaffold(
        appBar: AppBar(
          title: Row(
            children: [
              const Icon(Icons.hub_outlined),
              const SizedBox(width: 10),
              Flexible(
                child: Text(
                  page == 0 ? 'Nexo' : titles[page],
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
          actions: [
            if (stock.live)
              IconButton(
                tooltip: 'Actualizar',
                onPressed: stock.loading ? null : stock.load,
                icon: const Icon(Icons.refresh),
              ),
            IconButton(
              tooltip: 'Mi perfil',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => ProfileScreen(auth: widget.auth),
                ),
              ),
              icon: const Icon(Icons.account_circle_outlined),
            ),
            const SizedBox(width: 8),
          ],
        ),
        body: SafeArea(
          child: wide
              ? Row(
                  children: [
                    NavigationRail(
                      selectedIndex: page,
                      onDestinationSelected: (v) => setState(() => page = v),
                      labelType: NavigationRailLabelType.all,
                      destinations: const [
                        NavigationRailDestination(
                          icon: Icon(Icons.dashboard_outlined),
                          label: Text('Resumen'),
                        ),
                        NavigationRailDestination(
                          icon: Icon(Icons.inventory_2_outlined),
                          label: Text('Inventario'),
                        ),
                        NavigationRailDestination(
                          icon: Icon(Icons.swap_horiz),
                          label: Text('Movimientos'),
                        ),
                        NavigationRailDestination(
                          icon: Icon(Icons.grid_view),
                          label: Text('Más'),
                        ),
                      ],
                    ),
                    const VerticalDivider(width: 1),
                    Expanded(child: body),
                  ],
                )
              : body,
        ),
        bottomNavigationBar: wide
            ? null
            : NavigationBar(
                selectedIndex: page,
                onDestinationSelected: (v) => setState(() => page = v),
                destinations: const [
                  NavigationDestination(
                    icon: Icon(Icons.dashboard_outlined),
                    selectedIcon: Icon(Icons.dashboard),
                    label: 'Inicio',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.inventory_2_outlined),
                    selectedIcon: Icon(Icons.inventory_2),
                    label: 'Inventario',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.swap_horiz),
                    label: 'Actividad',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.grid_view),
                    label: 'Más',
                  ),
                ],
              ),
        floatingActionButton:
            !stock.loading &&
                stock.error == null &&
                widget.auth.canOperate &&
                (page == 1 || page == 2)
            ? FloatingActionButton.extended(
                onPressed: record,
                icon: const Icon(Icons.add),
                label: Text(
                  stock.live ? 'Registrar movimiento' : 'Movimiento de prueba',
                ),
              )
            : null,
      );
    },
  );
  Widget heading(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Text(
      text,
      style: Theme.of(
        context,
      ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
    ),
  );
  Widget dashboard() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        'Hola, ${widget.auth.demo ? 'visitante' : widget.auth.user!.name.split(' ').first}',
        style: Theme.of(context).textTheme.bodyLarge,
      ),
      const SizedBox(height: 6),
      Text(
        'Tu almacén,\na simple vista.',
        style: Theme.of(context).textTheme.headlineMedium?.copyWith(
          fontWeight: FontWeight.w800,
          color: const Color(0xFF244D40),
        ),
      ),
      const SizedBox(height: 22),
      // Real batches carry no unit cost yet, so the value is demo-only.
      if (!stock.live)
        Card(
          color: const Color(0xFF244D40),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'VALOR DEL INVENTARIO · MXN',
                  style: TextStyle(
                    color: Color(0xFFD6ED95),
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  money(stock.totalValue),
                  style: const TextStyle(
                    fontSize: 36,
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Estimación con costos de ejemplo',
                  style: TextStyle(color: Colors.white),
                ),
              ],
            ),
          ),
        ),
      Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [
          metric(
            '${stock.items.length}',
            'Artículos',
            Icons.inventory_2_outlined,
          ),
          metric(
            '${stock.warehouses.length}',
            'Almacenes',
            Icons.warehouse_outlined,
          ),
        ],
      ),
      const SizedBox(height: 26),
      heading('Requieren atención'),
      Card(
        child: ListTile(
          contentPadding: const EdgeInsets.all(16),
          leading: const Icon(
            Icons.warning_amber_rounded,
            color: Color(0xFF8D5300),
          ),
          title: Text(
            '${stock.items.where((e) => e.low).length} ${stock.items.where((e) => e.low).length == 1 ? 'artículo' : 'artículos'} con stock bajo',
          ),
          subtitle: const Text('Consulta los niveles mínimos'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => openInventory(low: true),
        ),
      ),
      const SizedBox(height: 16),
      heading('Actividad reciente'),
      ...stock.movements.take(3).map(movementCard),
      TextButton(
        onPressed: () => setState(() => page = 2),
        child: const Text('Ver todos los movimientos'),
      ),
    ],
  );
  Widget metric(String value, String label, IconData icon) => SizedBox(
    width: 150,
    child: Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: const Color(0xFF52751E)),
            const SizedBox(height: 12),
            Text(
              value,
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800),
            ),
            Text(label),
          ],
        ),
      ),
    ),
  );
  Widget inventory() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      TextField(
        controller: search,
        onChanged: (s) => stock.filter(search: s),
        decoration: InputDecoration(
          labelText: 'Buscar artículo, SKU o lote',
          prefixIcon: const Icon(Icons.search),
          suffixIcon: search.text.isEmpty
              ? null
              : IconButton(
                  tooltip: 'Borrar búsqueda',
                  onPressed: () {
                    search.clear();
                    stock.filter(search: '');
                  },
                  icon: const Icon(Icons.close),
                ),
        ),
      ),
      const SizedBox(height: 16),
      DropdownButtonFormField<String>(
        initialValue: stock.warehouse,
        key: ValueKey(stock.warehouse),
        isExpanded: true,
        decoration: const InputDecoration(labelText: 'Almacén'),
        items: [
          'Todos',
          ...stock.warehouses,
        ].map((e) => DropdownMenuItem(value: e, child: Text(e))).toList(),
        onChanged: (v) => stock.filter(location: v),
      ),
      const SizedBox(height: 12),
      Align(
        alignment: Alignment.centerLeft,
        child: FilterChip(
          label: const Text('Solo stock bajo'),
          selected: stock.onlyLow,
          onSelected: (v) => stock.filter(low: v),
        ),
      ),
      const SizedBox(height: 16),
      Text(
        '${stock.filtered.length} artículos',
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      const SizedBox(height: 12),
      if (stock.filtered.isEmpty)
        empty('No encontramos artículos.', 'Cambia la búsqueda o los filtros.'),
      ...stock.filtered.map(
        (item) => Card(
          child: InkWell(
            borderRadius: BorderRadius.circular(20),
            onTap: () => detail(item),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          item.text('sku'),
                          style: const TextStyle(
                            color: Color(0xFF596650),
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      Icon(
                        item.low
                            ? Icons.warning_amber_rounded
                            : Icons.check_circle_outline,
                        color: item.low
                            ? const Color(0xFF8D5300)
                            : const Color(0xFF52751E),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    item.name,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(item.text('warehouse')),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 12,
                    runSpacing: 6,
                    children: [
                      Text(
                        '${number(item.quantity)} ${item.text('unit')}',
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF244D40),
                        ),
                      ),
                      if (item.low) const Chip(label: Text('Stock bajo')),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ],
  );
  void detail(StockItem item) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (context) => SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(item.name, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 20),
          ...{
            'SKU': item.text('sku'),
            'Lote': item.text('lot'),
            stock.live ? 'Disponible' : 'Existencias':
                '${number(item.quantity)} ${item.text('unit')}',
            if (stock.live) ...{
              'Físico':
                  '${number(item.data['physical'] as num)} ${item.text('unit')}',
              'Reservado':
                  '${number(item.data['reserved'] as num)} ${item.text('unit')}',
            },
            'Mínimo': item.minimum == null
                ? 'Sin configurar'
                : '${number(item.minimum!)} ${item.text('unit')}',
            'Almacén': item.text('warehouse'),
            'Caducidad': item.text('expiry'),
            'Proveedor': item.text('supplier'),
            if (item.cost != null) 'Costo unitario': '${money(item.cost!)} MXN',
          }.entries.map(
            (e) => Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(e.key, style: const TextStyle(color: Color(0xFF596650))),
                  Text(
                    e.value,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
          ),
          if (!stock.live) ...[const DemoNotice(), const SizedBox(height: 16)],
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cerrar'),
          ),
        ],
      ),
    ),
  );
  Widget movementCard(Map<String, dynamic> row) {
    final item = stock.item(row['item'].toString()),
        incoming = row['incoming'] as bool? ?? row['type'] == 'Entrada';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              backgroundColor: incoming
                  ? const Color(0xFFE9F1D8)
                  : const Color(0xFFF9EAD4),
              child: Icon(
                incoming ? Icons.south_west : Icons.north_east,
                color: const Color(0xFF244D40),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${row['type']} · ${number(row['qty'] as num)} ${item.text('unit')}',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  Text(item.name),
                  const SizedBox(height: 4),
                  Text(
                    '${row['date']}\n${row['reason']}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFF596650),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget movementList() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      heading('Historial de movimientos'),
      if (!widget.auth.canOperate)
        const Padding(
          padding: EdgeInsets.only(bottom: 16),
          child: Text('Tu perfil tiene acceso de consulta.'),
        ),
      if (stock.movements.isEmpty)
        empty('Sin movimientos.', 'Aún no hay operaciones registradas.'),
      ...stock.movements.map(movementCard),
    ],
  );
  Widget more() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      heading('Explora tu operación'),
      menu(
        Icons.warehouse_outlined,
        'Almacenes',
        '${stock.warehouses.length} ubicaciones',
        () => openPage(
          'Almacenes',
          () => Column(
            children: stock.warehouses
                .map(
                  (w) => Card(
                    child: ListTile(
                      title: Text(w),
                      subtitle: Text(
                        '${stock.items.where((e) => e.text('warehouse') == w).length} artículos',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () {
                        Navigator.pop(context);
                        openInventory(location: w);
                      },
                    ),
                  ),
                )
                .toList(),
          ),
        ),
      ),
      menu(
        Icons.qr_code_2,
        'Lotes y caducidades',
        'Trazabilidad por artículo',
        () => openPage(
          'Lotes y caducidades',
          () => Column(
            children: stock.lots.map((lot) {
              final i = stock.item(lot['item'].toString());
              return Card(
                child: ListTile(
                  title: Text('${lot['lot']}'),
                  subtitle: Text(
                    '${i.name} · ${number(lot['qty'] as num)} ${i.text('unit')}\n${i.text('warehouse')} · Caducidad: ${lot['expiry'] ?? 'Sin caducidad'}',
                  ),
                  isThreeLine: true,
                  onTap: () => detail(i),
                ),
              );
            }).toList(),
          ),
        ),
      ),
      menu(
        Icons.shopping_bag_outlined,
        'Compras',
        '${stock.purchases.length} ${stock.live ? 'órdenes' : 'órdenes de ejemplo'}',
        () => openPage(
          'Compras',
          () => Column(
            children: stock.purchases
                .map(
                  (p) => Card(
                    child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            p['id'] as String,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          Text(p['supplier'] as String),
                          const SizedBox(height: 12),
                          Text(p['lines'] as String),
                          const SizedBox(height: 8),
                          Text(
                            [
                              if (p['amount'] != null)
                                '${money(p['amount'] as num)} MXN',
                              p['date'],
                              p['status'],
                            ].join(' · '),
                          ),
                        ],
                      ),
                    ),
                  ),
                )
                .toList(),
          ),
        ),
      ),
      menu(
        Icons.handshake_outlined,
        'Proveedores',
        '${stock.suppliers.length} ${stock.live ? 'contactos' : 'contactos de ejemplo'}',
        () => openPage(
          'Proveedores',
          () => Column(
            children: stock.suppliers
                .map(
                  (s) => Card(
                    child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            s['name'] as String,
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          Text(s['category'] as String),
                          const SizedBox(height: 12),
                          Text(s['detail'] as String),
                        ],
                      ),
                    ),
                  ),
                )
                .toList(),
          ),
        ),
      ),
      menu(
        Icons.delete_outline,
        'Mermas',
        'Pérdidas de inventario',
        () => openPage(
          'Mermas',
          () => Column(
            children: stock.wastes
                .map(
                  (w) => Card(
                    child: ListTile(
                      title: Text(stock.item(w['item'].toString()).name),
                      subtitle: Text(
                        '${number(w['qty'] as num)} ${stock.item(w['item'].toString()).text('unit')} · ${w['cause']}\n${w['date']}',
                      ),
                      isThreeLine: true,
                    ),
                  ),
                )
                .toList(),
          ),
        ),
      ),
      const SizedBox(height: 20),
      const Text(
        'Nexo móvil · 0.1.0\nFlutter · Firebase · API compartida',
        textAlign: TextAlign.center,
        style: TextStyle(color: Color(0xFF596650)),
      ),
    ],
  );
  Widget menu(
    IconData icon,
    String title,
    String subtitle,
    VoidCallback action,
  ) => Card(
    child: ListTile(
      minVerticalPadding: 18,
      leading: Icon(icon, color: const Color(0xFF244D40)),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: action,
    ),
  );
  Widget empty(String title, String description) => Padding(
    padding: const EdgeInsets.all(32),
    child: Column(
      children: [
        const Icon(Icons.search_off, size: 48),
        const SizedBox(height: 16),
        Text(title),
        Text(description, textAlign: TextAlign.center),
      ],
    ),
  );
}

class DemoNotice extends StatelessWidget {
  const DemoNotice({super.key});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFFEAF0DC),
      borderRadius: BorderRadius.circular(12),
    ),
    child: const Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.science_outlined, size: 20, color: Color(0xFF38501B)),
        SizedBox(width: 8),
        Expanded(
          child: Text(
            'Inventario de demostración. Los cambios son locales y se reinician al cerrar la app o salir de la sesión.',
            style: TextStyle(fontSize: 12, color: Color(0xFF38501B)),
          ),
        ),
      ],
    ),
  );
}

class MovementForm extends StatefulWidget {
  const MovementForm({super.key, required this.stock});
  final InventoryViewModel stock;
  @override
  State<MovementForm> createState() => _MovementFormState();
}

class _MovementFormState extends State<MovementForm> {
  final form = GlobalKey<FormState>(),
      quantity = TextEditingController(),
      reason = TextEditingController();
  late String id = widget.stock.items.first.id;
  String type = 'Entrada';
  String? error;
  @override
  void dispose() {
    quantity.dispose();
    reason.dispose();
    super.dispose();
  }

  void save() {
    if (!form.currentState!.validate()) return;
    try {
      widget.stock.record(
        id: id,
        type: type,
        quantity: double.parse(quantity.text.replaceAll(',', '.')),
        reason: reason.text,
      );
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Movimiento de prueba registrado.')),
      );
    } on FormatException catch (e) {
      setState(() => error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: EdgeInsets.fromLTRB(
      24,
      24,
      24,
      MediaQuery.viewInsetsOf(context).bottom + 32,
    ),
    child: Form(
      key: form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Movimiento de prueba',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 12),
          const DemoNotice(),
          const SizedBox(height: 20),
          DropdownButtonFormField<String>(
            initialValue: type,
            decoration: const InputDecoration(labelText: 'Tipo'),
            items: [
              'Entrada',
              'Salida',
              'Merma',
            ].map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
            onChanged: (v) => setState(() => type = v!),
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: id,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Artículo'),
            items: widget.stock.items
                .map(
                  (i) => DropdownMenuItem(
                    value: i.id,
                    child: Text(i.name, overflow: TextOverflow.ellipsis),
                  ),
                )
                .toList(),
            onChanged: (v) => setState(() => id = v!),
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: quantity,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: 'Cantidad (${widget.stock.item(id).text('unit')})',
              helperText:
                  'Disponible: ${number(widget.stock.item(id).quantity)}',
            ),
            validator: (v) {
              final n = double.tryParse((v ?? '').replaceAll(',', '.'));
              return n == null || !n.isFinite || n <= 0
                  ? 'Escribe una cantidad mayor que cero.'
                  : null;
            },
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: reason,
            maxLength: 160,
            decoration: const InputDecoration(labelText: 'Motivo'),
            validator: (v) =>
                (v?.trim().length ?? 0) < 3 ? 'Describe el motivo.' : null,
          ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
          FilledButton(onPressed: save, child: const Text('Registrar prueba')),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
        ],
      ),
    ),
  );
}

/// Registers receipts, FIFO issues and waste against the shared API.
class LiveMovementForm extends StatefulWidget {
  const LiveMovementForm({super.key, required this.stock});
  final InventoryViewModel stock;
  @override
  State<LiveMovementForm> createState() => _LiveMovementFormState();
}

class _LiveMovementFormState extends State<LiveMovementForm> {
  final form = GlobalKey<FormState>(),
      quantity = TextEditingController(),
      lot = TextEditingController(),
      reference = TextEditingController(),
      reason = TextEditingController();
  final operationId = InventoryViewModel.newOperationId();
  String type = 'Entrada';
  String? articleId, warehouseId, partnerId, itemId, batchId, error;
  DateTime? expiry;
  bool busy = false;

  InventoryViewModel get stock => widget.stock;
  List<Map<String, dynamic>> get suppliers =>
      stock.catalogPartners.where((p) => p['kind'] == 'Proveedor').toList();
  List<Map<String, dynamic>> get customers =>
      stock.catalogPartners.where((p) => p['kind'] != 'Proveedor').toList();
  List<StockItem> get issuable =>
      stock.items.where((e) => e.quantity > 0).toList();
  List<Map<String, dynamic>> get wasteable =>
      stock.lots.where((l) => ((l['wasteable'] as num?) ?? 0) > 0).toList();

  String get unit => switch (type) {
    'Entrada' =>
      stock.catalogArticles.firstWhere(
            (a) => a['id'] == articleId,
            orElse: () => const {'unit': ''},
          )['unit']
          as String,
    'Salida' => itemId == null ? '' : stock.item(itemId!).text('unit'),
    _ =>
      batchId == null
          ? ''
          : stock
                .item(
                  stock.lots
                      .firstWhere((l) => l['batchId'] == batchId)['item']
                      .toString(),
                )
                .text('unit'),
  };

  num? get limit => switch (type) {
    'Salida' => itemId == null ? null : stock.item(itemId!).quantity,
    'Merma' =>
      batchId == null
          ? null
          : stock.lots.firstWhere((l) => l['batchId'] == batchId)['wasteable']
                as num,
    _ => null,
  };

  /// What is still missing in the web before this movement can be registered.
  String? get missing => switch (type) {
    'Entrada' when stock.catalogArticles.isEmpty =>
      'Primero da de alta un artículo en la web.',
    'Entrada' when stock.catalogWarehouses.isEmpty =>
      'Primero crea un almacén en la web.',
    'Entrada' when suppliers.isEmpty =>
      'Primero registra un proveedor en la web.',
    'Salida' when issuable.isEmpty => 'No hay existencias disponibles.',
    'Salida' when customers.isEmpty =>
      'Primero registra un cliente o punto de venta en la web.',
    'Merma' when wasteable.isEmpty => 'No hay lotes con existencias libres.',
    _ => null,
  };

  @override
  void dispose() {
    for (final c in [quantity, lot, reference, reason]) {
      c.dispose();
    }
    super.dispose();
  }

  String? validateQuantity(String? value) {
    final text = (value ?? '').trim().replaceAll(',', '.');
    if (!RegExp(r'^\d+(\.\d{1,3})?$').hasMatch(text) ||
        double.parse(text) <= 0) {
      return 'Escribe una cantidad mayor que cero, con hasta 3 decimales.';
    }
    if (unit == 'pzas' && text.contains('.')) {
      return 'Las piezas requieren cantidades enteras.';
    }
    if (limit != null && double.parse(text) > limit!) {
      return 'Supera lo disponible (${number(limit!)} $unit).';
    }
    return null;
  }

  Future<void> save() async {
    if (!form.currentState!.validate()) return;
    final amount = quantity.text.trim().replaceAll(',', '.');
    final (path, data) = switch (type) {
      'Entrada' => (
        '/receipts',
        {
          'articleId': articleId,
          'warehouseId': warehouseId,
          'partnerId': partnerId,
          'quantity': amount,
          'lot': lot.text.trim(),
          'reference': reference.text.trim(),
          if (expiry != null)
            'expiry': DateFormat('yyyy-MM-dd').format(expiry!),
        },
      ),
      'Salida' => (
        '/issues',
        {
          'articleId': stock.item(itemId!).data['articleId'],
          'warehouseId': stock.item(itemId!).data['warehouseId'],
          'partnerId': partnerId,
          'quantity': amount,
          'reference': reference.text.trim(),
        },
      ),
      _ => (
        '/waste',
        {'batchId': batchId, 'quantity': amount, 'reason': reason.text.trim()},
      ),
    };
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await stock.submit(path, data, operationId);
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      Navigator.pop(context);
      messenger.showSnackBar(
        SnackBar(content: Text('$type registrada correctamente.')),
      );
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget select(
    String label,
    String? value,
    List<(String, String)> options,
    ValueChanged<String?> onChanged,
  ) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: DropdownButtonFormField<String>(
      key: ValueKey('$type-$label'),
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final (id, text) in options)
          DropdownMenuItem(
            value: id,
            child: Text(text, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: busy ? null : onChanged,
      validator: (v) => v == null ? 'Selecciona una opción.' : null,
    ),
  );

  Widget field(
    TextEditingController controller,
    String label, {
    int max = 80,
    int min = 1,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: TextFormField(
      controller: controller,
      enabled: !busy,
      maxLength: max,
      decoration: InputDecoration(labelText: label),
      validator: (v) =>
          (v?.trim().length ?? 0) < min ? 'Completa este campo.' : null,
    ),
  );

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: EdgeInsets.fromLTRB(
      24,
      24,
      24,
      MediaQuery.viewInsetsOf(context).bottom + 32,
    ),
    child: Form(
      key: form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Registrar movimiento',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 20),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'Entrada', label: Text('Entrada')),
              ButtonSegment(value: 'Salida', label: Text('Salida')),
              ButtonSegment(value: 'Merma', label: Text('Merma')),
            ],
            selected: {type},
            onSelectionChanged: busy
                ? null
                : (s) => setState(() {
                    type = s.first;
                    partnerId = null;
                    error = null;
                  }),
          ),
          const SizedBox(height: 20),
          if (missing != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Text(missing!),
            )
          else ...[
            if (type == 'Entrada') ...[
              select('Artículo', articleId, [
                for (final a in stock.catalogArticles)
                  (a['id'] as String, '${a['sku']} · ${a['name']}'),
              ], (v) => setState(() => articleId = v)),
              select('Almacén', warehouseId, [
                for (final w in stock.catalogWarehouses)
                  (w['id'] as String, w['name'] as String),
              ], (v) => setState(() => warehouseId = v)),
              select('Proveedor', partnerId, [
                for (final p in suppliers)
                  (p['id'] as String, p['name'] as String),
              ], (v) => setState(() => partnerId = v)),
            ],
            if (type == 'Salida') ...[
              select('Artículo y almacén', itemId, [
                for (final i in issuable)
                  (
                    i.id,
                    '${i.name} · ${i.text('warehouse')} (${number(i.quantity)} ${i.text('unit')})',
                  ),
              ], (v) => setState(() => itemId = v)),
              select(
                'Cliente o punto de venta',
                partnerId,
                [
                  for (final p in customers)
                    (p['id'] as String, '${p['name']} · ${p['kind']}'),
                ],
                (v) => setState(() => partnerId = v),
              ),
            ],
            if (type == 'Merma')
              select('Lote', batchId, [
                for (final l in wasteable)
                  (
                    l['batchId'] as String,
                    '${l['lot']} · ${stock.item(l['item'].toString()).name} (${number(l['wasteable'] as num)})',
                  ),
              ], (v) => setState(() => batchId = v)),
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: TextFormField(
                controller: quantity,
                enabled: !busy,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: InputDecoration(
                  labelText: unit.isEmpty ? 'Cantidad' : 'Cantidad ($unit)',
                  helperText: limit == null
                      ? null
                      : 'Disponible: ${number(limit!)} $unit',
                ),
                validator: validateQuantity,
              ),
            ),
            if (type == 'Entrada') ...[
              field(lot, 'Lote', max: 60),
              field(reference, 'Documento de recepción (factura, remisión)'),
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: OutlinedButton.icon(
                  onPressed: busy
                      ? null
                      : () async {
                          final today = DateTime.now();
                          final picked = await showDatePicker(
                            context: context,
                            firstDate: today,
                            lastDate: DateTime(today.year + 20),
                            initialDate: expiry ?? today,
                            helpText: 'Fecha de caducidad',
                          );
                          if (picked != null) setState(() => expiry = picked);
                        },
                  icon: const Icon(Icons.event_outlined),
                  label: Text(
                    expiry == null
                        ? 'Caducidad (opcional)'
                        : 'Caduca: ${DateFormat('dd/MM/yyyy').format(expiry!)}',
                  ),
                ),
              ),
            ],
            if (type == 'Salida')
              field(reference, 'Referencia (remisión, pedido)'),
            if (type == 'Merma')
              field(reason, 'Causa de la merma', max: 200, min: 3),
          ],
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
          FilledButton(
            onPressed: busy || missing != null ? null : save,
            child: busy
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text('Registrar ${type.toLowerCase()}'),
          ),
          TextButton(
            onPressed: busy ? null : () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
        ],
      ),
    ),
  );
}

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.auth});
  final AuthViewModel auth;
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final form = GlobalKey<FormState>();
  late final name = TextEditingController(
    text: widget.auth.user?.name ?? 'Visitante',
  );
  late final department = TextEditingController(
    text: widget.auth.user?.department ?? '',
  );
  late final phone = TextEditingController(text: widget.auth.user?.phone ?? '');
  @override
  void dispose() {
    name.dispose();
    department.dispose();
    phone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.auth,
    builder: (context, _) {
      final auth = widget.auth;
      return Scaffold(
        appBar: AppBar(title: const Text('Mi perfil')),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              const Align(
                child: CircleAvatar(
                  radius: 38,
                  child: Icon(Icons.person_outline, size: 42),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                auth.demo
                    ? 'Modo demostración'
                    : auth.user?.email ?? 'Sesión finalizada',
                textAlign: TextAlign.center,
              ),
              if (!auth.demo)
                Text(
                  auth.user?.roleLabel ?? '',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              const SizedBox(height: 24),
              if (auth.demo)
                const DemoNotice()
              else
                Form(
                  key: form,
                  child: Column(
                    children: [
                      TextFormField(
                        controller: name,
                        maxLength: 80,
                        decoration: const InputDecoration(labelText: 'Nombre'),
                        validator: (v) => (v?.trim().length ?? 0) < 2
                            ? 'Escribe tu nombre.'
                            : null,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: department,
                        maxLength: 80,
                        decoration: const InputDecoration(
                          labelText: 'Departamento',
                        ),
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: phone,
                        maxLength: 30,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(
                          labelText: 'Teléfono',
                        ),
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: auth.busy || auth.user == null
                            ? null
                            : () async {
                                if (form.currentState!.validate()) {
                                  await auth.save(
                                    name.text,
                                    department.text,
                                    phone.text,
                                  );
                                  if (context.mounted && auth.user == null) {
                                    Navigator.pop(context);
                                  }
                                }
                              },
                        child: const Text('Guardar perfil'),
                      ),
                    ],
                  ),
                ),
              AuthFeedback(auth: auth),
              const SizedBox(height: 24),
              OutlinedButton.icon(
                onPressed: auth.busy
                    ? null
                    : () async {
                        await auth.logout();
                        if (context.mounted &&
                            auth.user == null &&
                            !auth.demo) {
                          Navigator.pop(context);
                        }
                      },
                icon: const Icon(Icons.logout),
                label: Text(
                  auth.demo ? 'Salir de la demostración' : 'Cerrar sesión',
                ),
              ),
              const SizedBox(height: 8),
              const PrivacyNoticeLink(),
            ],
          ),
        ),
      );
    },
  );
}

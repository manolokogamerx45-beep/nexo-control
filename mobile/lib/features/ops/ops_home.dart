import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/offline_store.dart';
import '../auth/auth_view_model.dart';
import '../inventory/home_screen.dart' show ProfileScreen;
import 'admin_screen.dart';
import 'metrics_section.dart';
import 'op_form.dart';
import 'op_specs.dart';
import 'ops_view_model.dart';
import 'sections.dart';
import 'snapshot.dart';
import 'ui.dart';

class _Section {
  const _Section(this.id, this.label, this.icon);
  final String id, label;
  final IconData icon;
}

const _all = [
  _Section('overview', 'Resumen', Icons.dashboard_outlined),
  _Section('metrics', 'Indicadores', Icons.insights_outlined),
  _Section('inventory', 'Inventario', Icons.inventory_2_outlined),
  _Section('articles', 'Artículos', Icons.category_outlined),
  _Section('requests', 'Solicitudes', Icons.assignment_outlined),
  _Section('lots', 'Lotes y trazabilidad', Icons.qr_code_2),
  _Section('movements', 'Movimientos', Icons.swap_vert),
  _Section('transfers', 'Transferencias', Icons.compare_arrows),
  _Section('returns', 'Devoluciones', Icons.assignment_return_outlined),
  _Section('waste', 'Mermas', Icons.delete_outline),
  _Section('purchases', 'Compras', Icons.shopping_cart_outlined),
  _Section('partners', 'Empresas y puntos de venta', Icons.storefront_outlined),
  _Section('warehouses', 'Almacenes', Icons.warehouse_outlined),
  _Section('company', 'Mi empresa', Icons.business_outlined),
];

/// The signed-in workspace: the same sections as the web, laid out for the
/// screen at hand (sidebar on tablets and desktops, drawer + bottom bar on
/// phones) and usable without a connection.
class OpsHome extends StatefulWidget {
  const OpsHome({
    super.key,
    required this.auth,
    required this.api,
    required this.store,
    this.vm,
  });
  final AuthViewModel auth;
  final ApiClient api;
  final OfflineStore store;

  /// Replaces the default view model (used by tests).
  final OpsViewModel? vm;
  @override
  State<OpsHome> createState() => _OpsHomeState();
}

class _OpsHomeState extends State<OpsHome> with WidgetsBindingObserver {
  late final OpsViewModel vm;
  final scaffold = GlobalKey<ScaffoldState>();
  String section = 'overview';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    vm =
        widget.vm ??
        OpsViewModel(
          api: widget.api,
          store: widget.store,
          userId: widget.auth.user!.id,
          onSessionExpired: widget.auth.sessionExpired,
        );
    vm.init();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    vm.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) vm.refresh();
  }

  List<_Section> sections(Snapshot s) => [
    for (final x in _all)
      if (s.requester
          ? const ['overview', 'articles', 'requests'].contains(x.id)
          : x.id != 'company' || s.allow())
        x,
  ];

  void toast(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  void say(SubmitOutcome o) => toast(
    o == SubmitOutcome.sent
        ? 'Cambios guardados en el servidor.'
        : 'Sin conexión: guardado en este dispositivo. Se enviará al reconectar.',
  );

  Future<void> openForm(OpSpec spec) async {
    final s = vm.snapshot;
    if (s == null) return;
    final outcome = await showOpForm(context, vm, s, spec);
    if (outcome != null) say(outcome);
  }

  Future<void> act(
    String path,
    String method,
    Map<String, dynamic> body,
    String label, {
    String? confirm,
  }) async {
    if (confirm != null) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          content: Text(confirm),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('No'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Sí, continuar'),
            ),
          ],
        ),
      );
      if (ok != true) return;
    }
    try {
      say(
        await vm.submit(path: path, method: method, body: body, label: label),
      );
    } on ApiException catch (e) {
      toast(e.message);
    }
  }

  void info(String title, Widget child) {
    final body = SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            child,
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cerrar'),
              ),
            ),
          ],
        ),
      ),
    );
    if (MediaQuery.sizeOf(context).width >= 700) {
      showDialog<void>(
        context: context,
        builder: (_) => Dialog(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 600, maxHeight: 720),
            child: body,
          ),
        ),
      );
    } else {
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: true,
        builder: (_) => body,
      );
    }
  }

  void go(String id) {
    setState(() => section = id);
    if (scaffold.currentState?.isDrawerOpen ?? false) Navigator.pop(context);
  }

  Future<void> refresh() async {
    await vm.refresh();
    if (section == 'metrics') await vm.loadMetrics();
  }

  void showPending() => info(
    'Operaciones por enviar',
    AnimatedBuilder(
      animation: vm,
      builder: (context, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (vm.queue.isEmpty) const Text('No hay operaciones pendientes.'),
          for (final op in vm.queue)
            RecCard(
              title: op.label,
              pills: [
                op.error == null
                    ? const Pill('Pendiente')
                    : const Pill('Rechazada', warn: true),
              ],
              lines: [
                'Registrada ${ago(op.createdAt)}',
                if (op.error != null) op.error!,
              ],
              actions: [
                OutlinedButton(
                  onPressed: () => vm.discard(op),
                  child: Text(
                    op.error == null ? 'Descartar' : 'Quitar de la lista',
                  ),
                ),
              ],
            ),
          if (vm.pendingCount > 0)
            FilledButton.icon(
              onPressed: vm.refresh,
              icon: const Icon(Icons.sync),
              label: const Text('Enviar ahora'),
            ),
        ],
      ),
    ),
  );

  Future<void> signOut() async {
    if (vm.queue.isNotEmpty) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Operaciones sin enviar'),
          content: Text(
            'Tienes ${vm.queue.length} operaciones que aún no llegan al servidor. Si cierras sesión se perderán.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Volver'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Cerrar sesión y descartar'),
            ),
          ],
        ),
      );
      if (ok != true) return;
    }
    await widget.store.writeQueue(vm.userId, []);
    await widget.store.clear(vm.userId);
    await widget.auth.logout();
  }

  Widget sidebar(List<_Section> list, {required bool inDrawer}) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  vm.snapshot?.companyName ?? 'Nexo',
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                children: [
                  for (final x in list)
                    ListTile(
                      leading: Icon(x.icon),
                      title: Text(x.label),
                      selected: section == x.id,
                      selectedTileColor: theme.colorScheme.primaryContainer
                          .withValues(alpha: .5),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      onTap: () => go(x.id),
                    ),
                  // Account actions scroll with the list so they never squeeze it on short screens.
                  const Divider(),
                  ListTile(
                    leading: CircleAvatar(
                      child: Text(
                        (widget.auth.user?.name ?? '?').characters.first
                            .toUpperCase(),
                      ),
                    ),
                    title: Text(
                      widget.auth.user?.name ?? '',
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(widget.auth.user?.roleLabel ?? ''),
                    onTap: () {
                      if (inDrawer) Navigator.pop(context);
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => ProfileScreen(auth: widget.auth),
                        ),
                      );
                    },
                  ),
                  if (widget.auth.user?.admin == true)
                    ListTile(
                      leading: const Icon(Icons.admin_panel_settings_outlined),
                      title: const Text('Usuarios y accesos'),
                      onTap: () {
                        if (inDrawer) Navigator.pop(context);
                        Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => AdminScreen(
                              api: widget.api,
                              currentUserId: widget.auth.user!.id,
                            ),
                          ),
                        );
                      },
                    ),
                  ListTile(
                    leading: const Icon(Icons.logout),
                    title: const Text('Cerrar sesión'),
                    onTap: signOut,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget banner() {
    final theme = Theme.of(context);
    String? text;
    var warn = false;
    if (vm.offline) {
      text =
          'Sin conexión · datos de ${ago(vm.syncedAt)}${vm.pendingCount > 0 ? ' · ${vm.pendingCount} por enviar' : ''}';
      warn = true;
    } else if (vm.failedCount > 0) {
      text =
          '${vm.failedCount} operación(es) rechazadas por el servidor. Toca para revisarlas.';
      warn = true;
    } else if (vm.pendingCount > 0) {
      text = '${vm.pendingCount} operación(es) por enviar.';
    } else if (vm.error != null) {
      text = vm.error;
      warn = true;
    }
    return Column(
      children: [
        if (vm.syncing) const LinearProgressIndicator(minHeight: 3),
        if (text != null)
          Semantics(
            liveRegion: true,
            child: Material(
              color: warn
                  ? theme.colorScheme.tertiaryContainer
                  : theme.colorScheme.secondaryContainer,
              child: InkWell(
                onTap: vm.queue.isNotEmpty ? showPending : vm.refresh,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      Icon(
                        vm.offline
                            ? Icons.cloud_off_outlined
                            : Icons.sync_problem_outlined,
                        size: 20,
                      ),
                      const SizedBox(width: 10),
                      Expanded(child: Text(text)),
                      TextButton(
                        onPressed: vm.queue.isNotEmpty
                            ? showPending
                            : vm.refresh,
                        child: Text(vm.queue.isNotEmpty ? 'Ver' : 'Reintentar'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget body(Snapshot s) {
    final h = Host(
      vm: vm,
      s: s,
      user: widget.auth.user!,
      form: openForm,
      act: act,
      go: go,
      info: info,
    );
    return switch (section) {
      'metrics' => MetricsSection(h),
      'inventory' => InventorySection(h),
      'articles' => ArticlesSection(h),
      'requests' => RequestsSection(h),
      'lots' => LotsSection(h),
      'movements' => EventsSection(h, 'movements'),
      'returns' => EventsSection(h, 'returns'),
      'waste' => EventsSection(h, 'waste'),
      'transfers' => TransfersSection(h),
      'purchases' => PurchasesSection(h),
      'partners' => PartnersSection(h),
      'warehouses' => WarehousesSection(h),
      'company' => CompanySection(h),
      _ => OverviewSection(h),
    };
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: Listenable.merge([vm, widget.auth]),
    builder: (context, _) {
      final s = vm.snapshot;
      final wide = MediaQuery.sizeOf(context).width >= 900;
      final list = s == null ? <_Section>[] : sections(s);
      if (list.isNotEmpty && !list.any((x) => x.id == section)) {
        section = 'overview';
      }
      final quick = s?.requester == true
          ? const ['overview', 'articles', 'requests']
          : const ['overview', 'inventory', 'movements'];
      final index = quick.contains(section)
          ? quick.indexOf(section)
          : quick.length;
      final title =
          list.where((x) => x.id == section).firstOrNull?.label ?? 'Nexo';
      Widget content;
      if (s == null) {
        content = vm.loading
            ? const Center(
                child: CircularProgressIndicator(
                  semanticsLabel: 'Cargando inventario',
                ),
              )
            : Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        vm.offline
                            ? Icons.cloud_off_outlined
                            : Icons.error_outline,
                        size: 48,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        vm.offline
                            ? 'Sin conexión y todavía no hay datos guardados en este dispositivo. Conéctate una vez para descargar el inventario.'
                            : vm.error ?? 'No se pudo cargar el inventario.',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: vm.refresh,
                        child: const Text('Reintentar'),
                      ),
                    ],
                  ),
                ),
              );
      } else {
        content = RefreshIndicator(
          onRefresh: refresh,
          child: ListView(
            padding: EdgeInsets.fromLTRB(
              wide ? 28 : 16,
              16,
              wide ? 28 : 16,
              32,
            ),
            children: [
              Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 1100),
                  child: body(s),
                ),
              ),
            ],
          ),
        );
      }
      final inner = Scaffold(
        key: wide ? null : scaffold,
        appBar: AppBar(
          title: Text(title),
          actions: [
            if (vm.queue.isNotEmpty)
              IconButton(
                tooltip: 'Operaciones por enviar',
                onPressed: showPending,
                icon: Badge.count(
                  count: vm.queue.length,
                  child: const Icon(Icons.cloud_upload_outlined),
                ),
              ),
            IconButton(
              tooltip: 'Actualizar',
              onPressed: vm.syncing ? null : refresh,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        drawer: wide ? null : Drawer(child: sidebar(list, inDrawer: true)),
        body: Column(
          children: [
            banner(),
            Expanded(child: content),
          ],
        ),
        bottomNavigationBar: wide || list.isEmpty
            ? null
            : NavigationBar(
                selectedIndex: index,
                onDestinationSelected: (i) => i < quick.length
                    ? go(quick[i])
                    : scaffold.currentState?.openDrawer(),
                destinations: [
                  for (final id in quick)
                    NavigationDestination(
                      icon: Icon(_all.firstWhere((x) => x.id == id).icon),
                      label: _all.firstWhere((x) => x.id == id).label,
                    ),
                  const NavigationDestination(
                    icon: Icon(Icons.menu),
                    label: 'Más',
                  ),
                ],
              ),
      );
      if (!wide) return inner;
      return Scaffold(
        body: Row(
          children: [
            SizedBox(width: 280, child: sidebar(list, inDrawer: false)),
            const VerticalDivider(width: 1),
            Expanded(child: inner),
          ],
        ),
      );
    },
  );
}

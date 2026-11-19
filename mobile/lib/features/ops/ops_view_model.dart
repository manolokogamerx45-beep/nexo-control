import 'dart:async';
import 'dart:math';
import 'package:flutter/foundation.dart';
import '../../core/api_client.dart';
import '../../core/offline_store.dart';
import 'snapshot.dart';

enum SubmitOutcome { sent, queued }

/// Working copy of the inventory for a signed-in user.
///
/// Reads always show the last synchronised data. Writes go to the server when
/// there is a connection and otherwise wait in a local queue that is sent, in
/// order, as soon as the server answers again.
class OpsViewModel extends ChangeNotifier {
  OpsViewModel({
    required this.api,
    required this.store,
    required this.userId,
    this.onSessionExpired,
    this.retryEvery = const Duration(seconds: 30),
  });
  final ApiClient api;
  final OfflineStore store;
  final String userId;
  final VoidCallback? onSessionExpired;
  final Duration retryEvery;

  Snapshot? snapshot;
  DateTime? syncedAt;
  List<PendingOp> queue = [];
  bool loading = true, syncing = false, offline = false, disposed = false;
  String? error;

  Map<String, dynamic>? metrics;
  int months = 6;
  bool metricsLoading = false, metricsStale = false;
  String? metricsError;

  Timer? _timer;
  bool _flushing = false;
  int sentOnLastSync = 0;

  /// Operations still waiting to be sent (not the ones the server rejected).
  int get pendingCount => queue.where((op) => op.error == null).length;
  int get failedCount => queue.where((op) => op.error != null).length;

  Future<void> init() async {
    queue = await store.readQueue(userId);
    final cached = await store.readSnapshot(userId);
    if (cached != null) {
      snapshot = Snapshot(cached.data);
      syncedAt = cached.at;
      loading = false;
      notifyListeners();
    }
    await refresh();
    _timer = Timer.periodic(retryEvery, (_) {
      if (offline || pendingCount > 0) refresh();
    });
  }

  @override
  void notifyListeners() {
    if (!disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    disposed = true;
    _timer?.cancel();
    super.dispose();
  }

  bool _isOffline(ApiException e) => e.status == 0;

  /// Sends what is queued, then downloads the current inventory.
  Future<void> refresh() async {
    if (syncing) return;
    syncing = true;
    error = null;
    notifyListeners();
    try {
      final lost = await flush();
      if (lost) {
        offline = true;
      } else {
        final data = await api.request('/operations/snapshot');
        snapshot = Snapshot(data);
        syncedAt = DateTime.now();
        await store.writeSnapshot(userId, data, syncedAt!);
        offline = false;
        unawaited(_prefetchMetrics());
      }
    } on ApiException catch (e) {
      if (_isOffline(e)) {
        offline = true;
      } else if (e.status == 401) {
        onSessionExpired?.call();
      } else {
        error = e.message;
      }
    } catch (_) {
      error = 'No se pudo cargar el inventario.';
    }
    loading = false;
    syncing = false;
    notifyListeners();
  }

  /// Sends queued operations one by one. A rejected operation is flagged and
  /// skipped; a lost connection stops the run and keeps the rest.
  Future<bool> flush() async {
    if (_flushing) return false;
    _flushing = true;
    sentOnLastSync = 0;
    var lost = false;
    try {
      for (final op in List.of(queue)) {
        if (op.error != null) continue;
        try {
          await api.request(
            '/operations${op.path}',
            method: op.method,
            data: {...op.body, '_operationId': op.id},
          );
          queue.remove(op);
          sentOnLastSync++;
        } on ApiException catch (e) {
          if (_isOffline(e)) {
            lost = true;
            break;
          }
          if (e.status == 401) rethrow;
          op.error = e.message;
        }
        await store.writeQueue(userId, queue);
      }
    } finally {
      _flushing = false;
    }
    return lost;
  }

  static String newOperationId() => List.generate(
    32,
    (_) => Random.secure().nextInt(16).toRadixString(16),
  ).join();

  /// Registers an operation. Server rejections (stock, permissions...) are
  /// thrown so the form can show them; a missing connection queues it.
  Future<SubmitOutcome> submit({
    required String path,
    required String method,
    required Map<String, dynamic> body,
    required String label,
  }) async {
    final op = PendingOp(
      id: newOperationId(),
      method: method,
      path: path,
      body: body,
      label: label,
      createdAt: DateTime.now(),
    );
    // Keep order: never jump ahead of work that is still waiting.
    if (!offline && pendingCount == 0) {
      try {
        await api.request(
          '/operations$path',
          method: method,
          data: {...body, '_operationId': op.id},
        );
        await refresh();
        return SubmitOutcome.sent;
      } on ApiException catch (e) {
        if (!_isOffline(e)) {
          if (e.status == 401) onSessionExpired?.call();
          rethrow;
        }
        // The request may have arrived; the same ID makes the retry safe.
        offline = true;
      }
    }
    queue.add(op);
    await store.writeQueue(userId, queue);
    notifyListeners();
    if (!offline) unawaited(refresh());
    return SubmitOutcome.queued;
  }

  Future<void> discard(PendingOp op) async {
    queue.remove(op);
    await store.writeQueue(userId, queue);
    notifyListeners();
  }

  Future<void> _prefetchMetrics() async {
    try {
      final data = await api.request('/operations/metrics/6');
      await store.writeMetrics(userId, 6, data);
    } on ApiException {
      // Best effort: indicators fall back to the previous copy.
    }
  }

  Future<void> loadMetrics([int? period]) async {
    months = period ?? months;
    metricsLoading = true;
    metricsError = null;
    notifyListeners();
    try {
      final data = await api.request('/operations/metrics/$months');
      metrics = data;
      metricsStale = false;
      await store.writeMetrics(userId, months, data);
    } on ApiException catch (e) {
      final cached = await store.readMetrics(userId, months);
      if (_isOffline(e) && cached != null) {
        metrics = cached;
        metricsStale = true;
      } else {
        metrics = null;
        metricsError = _isOffline(e)
            ? 'Sin conexión: este periodo aún no se ha descargado.'
            : e.message;
      }
    }
    metricsLoading = false;
    notifyListeners();
  }
}

import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// An operation recorded on the device that has not reached the server yet.
///
/// The [id] is sent as `_operationId`, so the server applies a retried
/// submission only once even if the first attempt arrived but its answer was
/// lost.
class PendingOp {
  PendingOp({
    required this.id,
    required this.method,
    required this.path,
    required this.body,
    required this.label,
    required this.createdAt,
    this.error,
  });

  factory PendingOp.fromJson(Map<String, dynamic> json) => PendingOp(
    id: json['id'] as String,
    method: json['method'] as String,
    path: json['path'] as String,
    body: Map<String, dynamic>.from(json['body'] as Map),
    label: json['label'] as String,
    createdAt: DateTime.parse(json['createdAt'] as String),
    error: json['error'] as String?,
  );

  final String id, method, path, label;
  final Map<String, dynamic> body;
  final DateTime createdAt;

  /// Set when the server rejected the operation; it stays listed until the
  /// user discards it.
  String? error;

  Map<String, dynamic> toJson() => {
    'id': id,
    'method': method,
    'path': path,
    'body': body,
    'label': label,
    'createdAt': createdAt.toIso8601String(),
    'error': error,
  };
}

class CachedSnapshot {
  const CachedSnapshot(this.data, this.at);
  final Map<String, dynamic> data;
  final DateTime at;
}

/// Local copy of the last synchronised data and the queue of unsent work.
/// Everything is stored per user, so a shared phone never mixes accounts.
abstract class OfflineStore {
  Future<CachedSnapshot?> readSnapshot(String userId);
  Future<void> writeSnapshot(
    String userId,
    Map<String, dynamic> data,
    DateTime at,
  );
  Future<Map<String, dynamic>?> readMetrics(String userId, int months);
  Future<void> writeMetrics(
    String userId,
    int months,
    Map<String, dynamic> data,
  );
  Future<List<PendingOp>> readQueue(String userId);
  Future<void> writeQueue(String userId, List<PendingOp> queue);
  Future<Map<String, dynamic>?> readUser();
  Future<void> writeUser(Map<String, dynamic>? user);

  /// Removes the cached inventory of [userId] (used when signing out).
  Future<void> clear(String userId);
}

/// Encrypted on-device storage (Android Keystore / iOS Keychain).
class SecureOfflineStore implements OfflineStore {
  SecureOfflineStore({FlutterSecureStorage? storage, this.scope = 'default'})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(encryptedSharedPreferences: true),
          );
  final FlutterSecureStorage _storage;
  final String scope;
  String _key(String kind, String user) => 'nexo.$scope.$kind.$user';

  Future<Map<String, dynamic>?> _read(String key) async {
    final text = await _storage.read(key: key);
    if (text == null) return null;
    try {
      return Map<String, dynamic>.from(jsonDecode(text) as Map);
    } catch (_) {
      await _storage.delete(key: key);
      return null;
    }
  }

  @override
  Future<CachedSnapshot?> readSnapshot(String userId) async {
    final map = await _read(_key('snapshot', userId));
    final at = DateTime.tryParse('${map?['at']}');
    if (map == null || at == null) return null;
    return CachedSnapshot(Map<String, dynamic>.from(map['data'] as Map), at);
  }

  @override
  Future<void> writeSnapshot(
    String userId,
    Map<String, dynamic> data,
    DateTime at,
  ) => _storage.write(
    key: _key('snapshot', userId),
    value: jsonEncode({'at': at.toIso8601String(), 'data': data}),
  );

  @override
  Future<Map<String, dynamic>?> readMetrics(String userId, int months) =>
      _read(_key('metrics$months', userId));

  @override
  Future<void> writeMetrics(
    String userId,
    int months,
    Map<String, dynamic> data,
  ) => _storage.write(
    key: _key('metrics$months', userId),
    value: jsonEncode(data),
  );

  @override
  Future<List<PendingOp>> readQueue(String userId) async {
    final text = await _storage.read(key: _key('queue', userId));
    if (text == null) return [];
    try {
      return [
        for (final e in jsonDecode(text) as List)
          PendingOp.fromJson(Map<String, dynamic>.from(e as Map)),
      ];
    } catch (_) {
      return [];
    }
  }

  @override
  Future<void> writeQueue(String userId, List<PendingOp> queue) => queue.isEmpty
      ? _storage.delete(key: _key('queue', userId))
      : _storage.write(
          key: _key('queue', userId),
          value: jsonEncode([for (final op in queue) op.toJson()]),
        );

  @override
  Future<Map<String, dynamic>?> readUser() => _read(_key('user', 'last'));

  @override
  Future<void> writeUser(Map<String, dynamic>? user) => user == null
      ? _storage.delete(key: _key('user', 'last'))
      : _storage.write(key: _key('user', 'last'), value: jsonEncode(user));

  @override
  Future<void> clear(String userId) async {
    await _storage.delete(key: _key('snapshot', userId));
    for (final months in const [3, 6, 12]) {
      await _storage.delete(key: _key('metrics$months', userId));
    }
  }
}

class MemoryOfflineStore implements OfflineStore {
  final _values = <String, Object?>{};
  @override
  Future<CachedSnapshot?> readSnapshot(String userId) async {
    final value = _values['snapshot.$userId'] as CachedSnapshot?;
    return value == null
        ? null
        : CachedSnapshot(
            Map<String, dynamic>.from(
              jsonDecode(jsonEncode(value.data)) as Map,
            ),
            value.at,
          );
  }

  @override
  Future<void> writeSnapshot(
    String userId,
    Map<String, dynamic> data,
    DateTime at,
  ) async => _values['snapshot.$userId'] = CachedSnapshot(data, at);
  @override
  Future<Map<String, dynamic>?> readMetrics(String userId, int months) async =>
      _values['metrics$months.$userId'] as Map<String, dynamic>?;
  @override
  Future<void> writeMetrics(
    String userId,
    int months,
    Map<String, dynamic> data,
  ) async => _values['metrics$months.$userId'] = data;
  @override
  Future<List<PendingOp>> readQueue(String userId) async => [
    for (final e
        in (_values['queue.$userId'] as List<Map<String, dynamic>>? ??
            const []))
      PendingOp.fromJson(e),
  ];
  @override
  Future<void> writeQueue(String userId, List<PendingOp> queue) async =>
      _values['queue.$userId'] = [
        for (final op in queue)
          Map<String, dynamic>.from(jsonDecode(jsonEncode(op.toJson())) as Map),
      ];
  @override
  Future<Map<String, dynamic>?> readUser() async =>
      _values['user'] as Map<String, dynamic>?;
  @override
  Future<void> writeUser(Map<String, dynamic>? user) async =>
      _values['user'] = user;
  @override
  Future<void> clear(String userId) async {
    _values.removeWhere(
      (key, _) => key.startsWith('snapshot.') || key.startsWith('metrics'),
    );
  }
}

import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import '../../core/api_client.dart';

class AppUser {
  const AppUser({
    required this.name,
    required this.email,
    required this.role,
    required this.status,
    this.id = '',
    this.department = '',
    this.phone = '',
    this.provider = 'google',
  });
  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
    id: j['id'] as String,
    name: j['name'] as String,
    email: j['email'] as String,
    role: j['role'] as String,
    status: j['status'] as String,
    department: j['department'] as String? ?? '',
    phone: j['phone'] as String? ?? '',
    provider: j['provider'] as String? ?? 'google',
  );
  final String id, name, email, role, status, department, phone, provider;
  bool get active => status == 'active';
  bool get admin => active && role == 'administrador';
  String get roleLabel =>
      const {
        'administrador': 'Administrador',
        'compras': 'Compras',
        'almacen': 'Almacén',
        'consulta': 'Consulta',
      }[role] ??
      role;
}

abstract class AuthRepository {
  Future<AppUser?> restore();
  Future<AppUser> login(String email, String password);
  Future<AppUser> google();
  Future<String> register(String name, String email, String password);
  Future<AppUser> refresh();
  Future<AppUser> updateProfile(String name, String department, String phone);
  Future<void> logout();
}

class ServerAuthRepository implements AuthRepository {
  ServerAuthRepository(this.api, {FlutterSecureStorage? storage})
    : storage = storage ?? const FlutterSecureStorage() {
    api.onSession = (value) async {
      if (value == null) {
        await this.storage.delete(key: _key);
      } else {
        await this.storage.write(key: _key, value: value);
      }
    };
  }
  final ApiClient api;
  final FlutterSecureStorage storage;
  String get _key => 'nexo.session.${Uri.parse(api.baseUrl).origin}';
  AppUser _user(Map<String, dynamic> data) =>
      AppUser.fromJson(data['user'] as Map<String, dynamic>);
  @override
  Future<AppUser?> restore() async {
    api.sessionCookie = await storage.read(key: _key);
    if (api.sessionCookie == null) return null;
    try {
      return await refresh();
    } on ApiException catch (e) {
      if (e.status == 401) return null;
      rethrow;
    }
  }

  @override
  Future<AppUser> refresh() async => _user(await api.request('/me'));
  @override
  Future<AppUser> login(String email, String password) async => _user(
    await api.request(
      '/auth/login',
      method: 'POST',
      data: {'email': email.trim(), 'password': password},
    ),
  );
  @override
  Future<String> register(String name, String email, String password) async =>
      (await api.request(
            '/auth/register',
            method: 'POST',
            data: {
              'name': name.trim(),
              'email': email.trim(),
              'password': password,
            },
          ))['message']
          as String;
  @override
  Future<AppUser> updateProfile(
    String name,
    String department,
    String phone,
  ) async => _user(
    await api.request(
      '/me',
      method: 'PATCH',
      data: {
        'name': name.trim(),
        'department': department.trim(),
        'phone': phone.trim(),
      },
    ),
  );
  @override
  Future<void> logout() async {
    await api.request('/auth/logout', method: 'POST', data: {});
    api.sessionCookie = null;
    await storage.delete(key: _key);
  }

  String _secret() => base64UrlEncode(
    List<int>.generate(32, (_) => Random.secure().nextInt(256)),
  ).replaceAll('=', '');
  @override
  Future<AppUser> google() async {
    final verifier = _secret(), state = _secret();
    final challenge = base64UrlEncode(
      sha256.convert(utf8.encode(verifier)).bytes,
    ).replaceAll('=', '');
    final target = api.url('/api/v1/auth/google', {
      'mobile': '1',
      'challenge': challenge,
      'app_state': state,
    });
    try {
      final result = await FlutterWebAuth2.authenticate(
        url: target.toString(),
        callbackUrlScheme: 'com.jidenova.nexo',
      );
      final uri = Uri.parse(result);
      if (uri.scheme != 'com.jidenova.nexo' ||
          uri.host != 'auth' ||
          uri.queryParameters['state'] != state) {
        throw const ApiException('No se pudo validar la respuesta de Google.');
      }
      final error = uri.queryParameters['error'];
      if (error != null) {
        throw ApiException(
          const {
                'google_cancelled': 'Acceso cancelado.',
                'account_disabled': 'Tu cuenta está desactivada.',
                'account_exists': 'Usa la contraseña de tu cuenta existente.',
                'google_unavailable':
                    'Google no está configurado en el servidor.',
              }[error] ??
              'No se pudo iniciar sesión con Google.',
        );
      }
      final code = uri.queryParameters['code'];
      if (code == null) {
        throw const ApiException('La respuesta de Google está incompleta.');
      }
      return _user(
        await api.request(
          '/auth/mobile/exchange',
          method: 'POST',
          data: {'code': code, 'verifier': verifier},
        ),
      );
    } on PlatformException catch (e) {
      throw ApiException(
        e.code == 'CANCELED'
            ? 'Acceso cancelado.'
            : 'No se pudo abrir el navegador para Google.',
      );
    }
  }
}

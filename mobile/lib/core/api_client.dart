import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class ApiException implements Exception {
  const ApiException(this.message, [this.status = 0]);
  final String message;
  final int status;
  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({required this.baseUrl, http.Client? client})
    : _client = client ?? http.Client() {
    final uri = Uri.parse(baseUrl);
    final local = ['127.0.0.1', 'localhost', '10.0.2.2'].contains(uri.host);
    if (uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        (uri.path.isNotEmpty && uri.path != '/') ||
        uri.host.isEmpty ||
        (uri.scheme != 'https' &&
            !(kDebugMode && local && uri.scheme == 'http'))) {
      throw const ApiException('Configura una URL HTTPS válida para la API.');
    }
  }
  final String baseUrl;
  final http.Client _client;
  String? sessionCookie;
  Future<void> Function(String?)? onSession;
  Uri url(String path, [Map<String, String>? query]) =>
      Uri.parse(baseUrl).resolve(path).replace(queryParameters: query);
  Future<Map<String, dynamic>> request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? data,
  }) async {
    try {
      final req = http.Request(method, url('/api/v1$path'))
        ..followRedirects = false
        ..headers.addAll({
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Origin': Uri.parse(baseUrl).origin,
          'Cookie': ?sessionCookie,
        });
      if (data != null) req.body = jsonEncode(data);
      final response = await http.Response.fromStream(
        await _client.send(req).timeout(const Duration(seconds: 20)),
      ).timeout(const Duration(seconds: 20));
      Map<String, dynamic> body;
      try {
        body = jsonDecode(response.body) as Map<String, dynamic>;
      } catch (_) {
        throw const ApiException('La API devolvió una respuesta no válida.');
      }
      if (response.statusCode >= 400) {
        if (response.statusCode == 401) {
          sessionCookie = null;
          await onSession?.call(null);
        }
        throw ApiException(
          body['error'] as String? ?? 'No se pudo completar la solicitud.',
          response.statusCode,
        );
      }
      final cookie = response.headers['set-cookie'];
      if (cookie != null) {
        final match = RegExp(
          r'(?:^|,\s*)((?:__Host-)?nexo_session)=([^;]*)',
        ).firstMatch(cookie);
        if (match != null) {
          sessionCookie = match.group(2)!.isEmpty
              ? null
              : '${match.group(1)}=${match.group(2)}';
          await onSession?.call(sessionCookie);
        }
      }
      return body;
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException(
        'El servidor tardó demasiado. Vuelve a intentar.',
      );
    } on http.ClientException {
      throw const ApiException(
        'No se pudo conectar. Comprueba tu conexión y la API.',
      );
    }
  }

  void close() => _client.close();
}

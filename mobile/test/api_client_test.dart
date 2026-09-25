import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexo_mobile/core/api_client.dart';

void main() {
  test(
    'session cookie is retained, sent with Origin, and removed on expiry',
    () async {
      var call = 0;
      String? saved;
      final api = ApiClient(
        baseUrl: 'https://nexo.example',
        client: MockClient((req) async {
          expect(req.headers['Origin'], 'https://nexo.example');
          if (call++ == 0) {
            return http.Response(
              '{"ok":true}',
              200,
              headers: {
                'set-cookie':
                    '__Host-nexo_session=opaque; Path=/; HttpOnly; Secure',
              },
            );
          }
          expect(req.headers['Cookie'], '__Host-nexo_session=opaque');
          return http.Response('{"error":"Sesión expirada"}', 401);
        }),
      );
      api.onSession = (value) async {
        saved = value;
      };
      await api.request(
        '/auth/login',
        method: 'POST',
        data: {'email': 'test@example.test'},
      );
      expect(saved, '__Host-nexo_session=opaque');
      await expectLater(
        api.request('/me'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
      );
      expect(saved, isNull);
      expect(api.sessionCookie, isNull);
      api.close();
    },
  );
  test('rejects insecure remote URLs and malformed API responses', () async {
    for (final url in [
      'http://example.com',
      'https://user:password@example.com',
      'https://example.com/path',
    ]) {
      expect(() => ApiClient(baseUrl: url), throwsA(isA<ApiException>()));
    }
    final api = ApiClient(
      baseUrl: 'https://nexo.example',
      client: MockClient((_) async => http.Response('<html>error</html>', 502)),
    );
    await expectLater(api.request('/me'), throwsA(isA<ApiException>()));
    api.close();
  });
}

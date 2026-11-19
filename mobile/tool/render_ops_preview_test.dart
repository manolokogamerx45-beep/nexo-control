// Optional local render of the signed-in workspace:
// flutter test tool/render_ops_preview_test.dart --dart-define=PREVIEW_FONT=C:/Windows/Fonts/segoeui.ttf
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexo_mobile/core/offline_store.dart';
import 'package:nexo_mobile/features/auth/auth_view_model.dart';
import 'package:nexo_mobile/main.dart';
import '../test/ops_test.dart' show FakeAuth, FakeServer, apiFor;

Map<String, dynamic> year() {
  final months = [
    '2026-06',
    '2026-07',
    '2026-08',
    '2026-09',
    '2026-10',
    '2026-11',
  ];
  final values = [12, 18, 9, 24, 21, 15];
  return {
    'months': 6,
    'inventoryValue': 47889.3,
    'costCoverage': {'valued': 17, 'total': 18},
    'totals': {
      'movements': 99,
      'waste': 6,
      'wasteValue': 3198.3,
      'rotation': 5.25,
    },
    'monthly': [
      for (var i = 0; i < 6; i++)
        {
          'month': months[i],
          'movements': {
            'entries': 4,
            'exits': 4,
            'waste': i % 3,
            'supplierReturns': 0,
            'adjustments': 0,
            'transfers': 1,
            'total': values[i],
          },
          'entryValue': 1000.0 * (i + 2),
          'exitValue': 800.0 * (i + 1),
          'wasteValue': 90.0 * (i % 3),
          'openingValue': 0,
          'closingValue': 6000.0 + i * 8000,
          'rotation': 3.7 - i * .5,
        },
    ],
    'articles': [
      {
        'sku': 'TOR-01',
        'name': 'Tornillo 1/4',
        'unit': 'pzas',
        'stock': 49000,
        'exits': 272000,
        'averageStock': 28000,
        'rotation': 9.71,
        'coverageDays': 31,
        'waste': 6000,
        'stockValue': 88.2,
        'valued': true,
      },
    ],
  };
}

void main() {
  const font = String.fromEnvironment('PREVIEW_FONT');
  for (final (name, size) in [
    ('phone', const Size(390, 844)),
    ('desktop', const Size(1280, 860)),
  ]) {
    testWidgets('render $name workspace', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.runAsync(() async {
        final bytes = await File(font).readAsBytes();
        await (FontLoader(
          'Roboto',
        )..addFont(Future.value(ByteData.sublistView(bytes)))).load();
        await (FontLoader(
          'MaterialIcons',
        )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
      });
      final server = FakeServer()..metricsOverride = year();
      final boundary = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: NexoApp(
            auth: AuthViewModel(FakeAuth()),
            api: apiFor(server),
            store: MemoryOfflineStore(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      Future<void> capture(String file) async {
        await tester.runAsync(() async {
          final image =
              await (boundary.currentContext!.findRenderObject()!
                      as RenderRepaintBoundary)
                  .toImage(pixelRatio: 1.5);
          final png = await image.toByteData(format: ui.ImageByteFormat.png);
          final out = File('build/previews/$name-$file.png');
          await out.parent.create(recursive: true);
          await out.writeAsBytes(png!.buffer.asUint8List());
          image.dispose();
        });
      }

      Future<void> go(String label) async {
        if (size.width < 900) {
          await tester.tap(find.byType(DrawerButton));
          await tester.pumpAndSettle();
        }
        await tester.tap(find.widgetWithText(ListTile, label));
        await tester.pumpAndSettle();
      }

      await capture('overview');
      await go('Indicadores');
      if (size.width < 900) {
        tester.view.physicalSize = const Size(390, 2300);
        await tester.pumpAndSettle();
      }
      await capture('metrics');
      tester.view.physicalSize = size;
      await tester.pumpAndSettle();
      await go('Inventario');
      await capture('inventory');
      await go('Solicitudes');
      await capture('requests');
      await tester.tap(find.text('Nueva solicitud'));
      await tester.pumpAndSettle();
      await capture('form');
      await tester.tap(find.widgetWithText(OutlinedButton, 'Cancelar').last);
      await tester.pumpAndSettle();
      server.online = false;
      await tester.tap(find.byTooltip('Actualizar'));
      await tester.pumpAndSettle();
      await capture('offline');
      await tester.pumpWidget(const SizedBox());
    });
  }
}

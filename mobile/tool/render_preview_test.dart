// Optional local render: flutter test tool/render_preview_test.dart
// --dart-define=PREVIEW_FONT=C:/Windows/Fonts/segoeui.ttf
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexo_mobile/main.dart';
import 'package:nexo_mobile/features/auth/auth_view_model.dart';
import 'package:nexo_mobile/features/inventory/inventory_view_model.dart';
import '../test/widget_test.dart' show FakeAuth, MemoryInventory;

void main() {
  const font = String.fromEnvironment('PREVIEW_FONT');
  testWidgets('render phone previews from actual Flutter widgets', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.runAsync(() async {
      final bytes = await File(font).readAsBytes();
      final loader = FontLoader('Roboto')
        ..addFont(Future.value(ByteData.sublistView(bytes)));
      await loader.load();
      final icons = FontLoader('MaterialIcons')
        ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
      await icons.load();
    });
    final data = await tester.runAsync(() => DemoInventoryRepository().load());
    final auth = AuthViewModel(FakeAuth());
    final boundary = GlobalKey();
    await tester.pumpWidget(
      RepaintBoundary(
        key: boundary,
        child: NexoApp(auth: auth, inventoryRepository: MemoryInventory(data!)),
      ),
    );
    await tester.pumpAndSettle();
    Future<void> capture(String name) async {
      await tester.runAsync(() async {
        final image =
            await (boundary.currentContext!.findRenderObject()!
                    as RenderRepaintBoundary)
                .toImage(pixelRatio: 2);
        final png = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('build/previews/$name.png');
        await file.parent.create(recursive: true);
        await file.writeAsBytes(png!.buffer.asUint8List());
        image.dispose();
      });
    }

    await capture('login');
    auth.explore();
    await tester.pumpAndSettle();
    await capture('dashboard');
    await tester.tap(find.text('Inventario').last);
    await tester.pumpAndSettle();
    await capture('inventory');
    await tester.pumpWidget(const SizedBox());
    auth.dispose();
    debugDefaultTargetPlatformOverride = null;
  }, skip: font.isEmpty);
}

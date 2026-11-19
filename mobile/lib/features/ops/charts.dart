import 'package:flutter/material.dart';

class ChartPoint {
  const ChartPoint(this.label, this.value);
  final String label;
  final double value;
}

double niceMax(double v) {
  if (v <= 0) return 1;
  var p = 1.0;
  while (p * 10 <= v) {
    p *= 10;
  }
  while (p > v) {
    p /= 10;
  }
  final n = v / p;
  return (n <= 1
          ? 1
          : n <= 2
          ? 2
          : n <= 2.5
          ? 2.5
          : n <= 5
          ? 5
          : 10) *
      p;
}

/// One-series column chart that scales to any width. Tap a column to read its
/// exact value; the whole series is also exposed to screen readers.
class ColumnChart extends StatefulWidget {
  const ColumnChart({
    super.key,
    required this.title,
    required this.note,
    required this.points,
    required this.format,
    this.axisFormat,
  });
  final String title, note;
  final List<ChartPoint> points;
  final String Function(double) format;
  final String Function(double)? axisFormat;
  @override
  State<ColumnChart> createState() => _ColumnChartState();
}

class _ColumnChartState extends State<ColumnChart> {
  int? selected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final points = widget.points;
    final shown = selected ?? (points.isEmpty ? null : points.length - 1);
    final summary = [
      for (final p in points) '${p.label}: ${widget.format(p.value)}',
    ].join(', ');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title, style: theme.textTheme.titleMedium),
            Text(widget.note, style: theme.textTheme.bodySmall),
            const SizedBox(height: 8),
            Text(
              shown == null
                  ? ''
                  : '${points[shown].label} · ${widget.format(points[shown].value)}',
              style: theme.textTheme.titleSmall?.copyWith(
                color: theme.colorScheme.primary,
              ),
            ),
            const SizedBox(height: 8),
            Semantics(
              label: '${widget.title}. $summary',
              excludeSemantics: true,
              child: LayoutBuilder(
                builder: (context, box) => GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTapDown: (d) {
                    const left = 52.0;
                    final slot = (box.maxWidth - left) / points.length;
                    final i = ((d.localPosition.dx - left) / slot).floor();
                    if (i >= 0 && i < points.length) {
                      setState(() => selected = i);
                    }
                  },
                  child: CustomPaint(
                    size: Size(box.maxWidth, 190),
                    painter: _ColumnPainter(
                      points: points,
                      selected: shown,
                      axisFormat: widget.axisFormat ?? widget.format,
                      bar: theme.colorScheme.primary,
                      ink: theme.colorScheme.onSurfaceVariant,
                      grid: theme.colorScheme.outlineVariant,
                      surface: theme.colorScheme.surface,
                      scale: MediaQuery.textScalerOf(context),
                      base: DefaultTextStyle.of(context).style,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ColumnPainter extends CustomPainter {
  _ColumnPainter({
    required this.points,
    required this.selected,
    required this.axisFormat,
    required this.bar,
    required this.ink,
    required this.grid,
    required this.surface,
    required this.scale,
    required this.base,
  });
  final List<ChartPoint> points;
  final int? selected;
  final String Function(double) axisFormat;
  final Color bar, ink, grid, surface;
  final TextScaler scale;

  /// The app's text style, so chart labels use the same font as the rest.
  final TextStyle base;

  void _text(
    Canvas canvas,
    String text,
    Offset at, {
    bool right = false,
    bool center = false,
  }) {
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: base.copyWith(fontSize: 11, color: ink),
      ),
      textDirection: TextDirection.ltr,
      textScaler: scale,
      maxLines: 1,
    )..layout();
    final x = right
        ? at.dx - painter.width
        : center
        ? at.dx - painter.width / 2
        : at.dx;
    painter.paint(canvas, Offset(x, at.dy - painter.height / 2));
  }

  @override
  void paint(Canvas canvas, Size size) {
    const left = 52.0, bottom = 26.0, top = 8.0;
    final plotH = size.height - bottom - top, plotW = size.width - left;
    final max = niceMax(
      points.fold<double>(0, (m, p) => p.value > m ? p.value : m),
    );
    final gridPaint = Paint()
      ..color = grid.withValues(alpha: .5)
      ..strokeWidth = 1;
    for (var i = 0; i <= 4; i++) {
      final y = top + plotH - plotH * i / 4;
      if (i > 0) {
        canvas.drawLine(Offset(left, y), Offset(size.width, y), gridPaint);
      }
      _text(canvas, axisFormat(max * i / 4), Offset(left - 8, y), right: true);
    }
    canvas.drawLine(
      Offset(left, top + plotH),
      Offset(size.width, top + plotH),
      Paint()
        ..color = grid
        ..strokeWidth = 1,
    );
    if (points.isEmpty) return;
    final slot = plotW / points.length;
    final barW = slot * .62 > 24 ? 24.0 : slot * .62;
    // With many columns, label every other one so names never collide.
    final step = slot < 34 ? 2 : 1;
    for (var i = 0; i < points.length; i++) {
      final cx = left + slot * i + slot / 2,
          h = max == 0 ? 0.0 : plotH * points[i].value / max;
      if (i == selected) {
        canvas.drawRect(
          Rect.fromLTWH(left + slot * i, top, slot, plotH),
          Paint()..color = bar.withValues(alpha: .08),
        );
      }
      if (h > 0) {
        canvas.drawRRect(
          RRect.fromRectAndCorners(
            Rect.fromLTWH(cx - barW / 2, top + plotH - h, barW, h),
            topLeft: const Radius.circular(4),
            topRight: const Radius.circular(4),
          ),
          Paint()..color = bar,
        );
      }
      if (i % step == 0 || i == points.length - 1 && step == 1) {
        _text(
          canvas,
          points[i].label,
          Offset(cx, size.height - bottom / 2 + 2),
          center: true,
        );
      }
    }
  }

  @override
  bool shouldRepaint(_ColumnPainter old) =>
      old.points != points ||
      old.selected != selected ||
      old.bar != bar ||
      old.scale != scale;
}

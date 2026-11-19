import 'package:flutter/material.dart';

/// Number of columns a content width can comfortably hold.
int columnsFor(double width, {double min = 260}) =>
    (width / min).floor().clamp(1, 4);

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.warn = false, this.ok = false});
  final String text;
  final bool warn, ok;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (bg, fg) = warn
        ? (const Color(0xFFFFF1D6), const Color(0xFF7A5200))
        : ok
        ? (const Color(0xFFE3F1DC), const Color(0xFF2F5F1F))
        : (scheme.surfaceContainerHighest, scheme.onSurfaceVariant);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        text,
        style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600),
      ),
    );
  }
}

/// Tiles that reflow from four across to one column.
class MetricGrid extends StatelessWidget {
  const MetricGrid(this.tiles, {super.key});
  final List<MetricTile> tiles;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final cols = box.maxWidth >= 840
          ? 4
          : box.maxWidth >= 340
          ? 2
          : 1;
      final width = (box.maxWidth - 12 * (cols - 1)) / cols;
      return Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [for (final t in tiles) SizedBox(width: width, child: t)],
      );
    },
  );
}

class MetricTile extends StatelessWidget {
  const MetricTile(this.label, this.value, {super.key, this.note});
  final String label, value;
  final String? note;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 8),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                value,
                style: theme.textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            if (note != null) ...[
              const SizedBox(height: 4),
              Text(note!, style: theme.textTheme.bodySmall),
            ],
          ],
        ),
      ),
    );
  }
}

/// A record in a list: title, detail lines, an optional status and actions.
class RecCard extends StatelessWidget {
  const RecCard({
    super.key,
    required this.title,
    this.lines = const [],
    this.pills = const [],
    this.actions = const [],
    this.onTap,
  });
  final String title;
  final List<String> lines;
  final List<Widget> pills, actions;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  ConstrainedBox(
                    constraints: BoxConstraints(
                      maxWidth: MediaQuery.sizeOf(context).width - 120,
                    ),
                    child: Text(title, style: theme.textTheme.titleMedium),
                  ),
                  ...pills,
                ],
              ),
              for (final l in lines)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    l,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              if (actions.isNotEmpty) ...[
                const SizedBox(height: 12),
                Wrap(spacing: 8, runSpacing: 8, children: actions),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Lays record cards out in as many columns as the width allows.
class CardGrid extends StatelessWidget {
  const CardGrid(this.children, {super.key, this.min = 420});
  final List<Widget> children;
  final double min;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final cols = columnsFor(box.maxWidth, min: min);
      if (cols == 1) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: children,
        );
      }
      final width = (box.maxWidth - 12 * (cols - 1)) / cols;
      return Wrap(
        spacing: 12,
        children: [for (final c in children) SizedBox(width: width, child: c)],
      );
    },
  );
}

class EmptyNote extends StatelessWidget {
  const EmptyNote(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Center(child: Text(text, textAlign: TextAlign.center)),
    ),
  );
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(
    this.title, {
    super.key,
    this.subtitle,
    this.actions = const [],
  });
  final String title;
  final String? subtitle;
  final List<Widget> actions;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            header: true,
            child: Text(
              title,
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          if (subtitle != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                subtitle!,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: actions),
          ],
        ],
      ),
    );
  }
}

String ago(DateTime? t) {
  if (t == null) return 'nunca';
  final d = DateTime.now().difference(t);
  if (d.inMinutes < 1) return 'hace un momento';
  if (d.inHours < 1) return 'hace ${d.inMinutes} min';
  if (d.inDays < 1) return 'hace ${d.inHours} h';
  return 'hace ${d.inDays} d';
}

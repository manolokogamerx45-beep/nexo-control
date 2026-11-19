import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/api_client.dart';
import 'op_specs.dart';
import 'ops_view_model.dart';
import 'snapshot.dart';

/// Opens [spec] as a dialog on wide screens and as a bottom sheet on phones.
/// Returns how the operation ended, or null if the user cancelled.
Future<SubmitOutcome?> showOpForm(
  BuildContext context,
  OpsViewModel vm,
  Snapshot snapshot,
  OpSpec spec,
) {
  final wide = MediaQuery.sizeOf(context).width >= 700;
  final view = OpFormView(vm: vm, snapshot: snapshot, spec: spec);
  if (wide) {
    return showDialog<SubmitOutcome>(
      context: context,
      builder: (_) => Dialog(
        insetPadding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560, maxHeight: 760),
          child: view,
        ),
      ),
    );
  }
  return showModalBottomSheet<SubmitOutcome>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => view,
  );
}

class OpFormView extends StatefulWidget {
  const OpFormView({
    super.key,
    required this.vm,
    required this.snapshot,
    required this.spec,
  });
  final OpsViewModel vm;
  final Snapshot snapshot;
  final OpSpec spec;
  @override
  State<OpFormView> createState() => _OpFormViewState();
}

class _OpFormViewState extends State<OpFormView> {
  final values = <String, String>{};
  final controllers = <String, TextEditingController>{};
  final lines = <Map<String, String>>[];
  String? error;
  bool busy = false;

  OpSpec get spec => widget.spec;

  @override
  void initState() {
    super.initState();
    for (final f in spec.fields) {
      var initial = f.initial;
      if (f.kind == FieldKind.select &&
          initial.isEmpty &&
          f.options.isNotEmpty) {
        initial = f.options.first.value;
      }
      values[f.name] = initial;
      if (f.kind != FieldKind.select && f.kind != FieldKind.date) {
        controllers[f.name] = TextEditingController(text: initial);
      }
    }
    if (spec.lines != null) addLine();
  }

  @override
  void dispose() {
    for (final c in controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  void addLine() => lines.add({
    'articleId': spec.lines!.articles.isEmpty
        ? ''
        : spec.lines!.articles.first.value,
    'quantity': '1',
  });

  Future<void> save() async {
    for (final f in spec.fields) {
      if (f.kind != FieldKind.select && f.kind != FieldKind.date) {
        values[f.name] = controllers[f.name]!.text;
      }
    }
    String? problem;
    for (final f in spec.fields) {
      if (f.required && (values[f.name] ?? '').trim().isEmpty) {
        problem = f.kind == FieldKind.select
            ? 'No hay opciones disponibles en «${f.label}». Regístralas primero.'
            : 'Completa «${f.label}».';
        break;
      }
    }
    problem ??= spec.validate?.call(values, lines);
    if (problem != null) return setState(() => error = problem);
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final outcome = await widget.vm.submit(
        path: spec.path,
        method: spec.method,
        body: spec.body(values, lines),
        label: spec.queuedLabel,
      );
      if (mounted) Navigator.of(context).pop(outcome);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } on FormatException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget buildField(OpField f) {
    final hint = f.hint?.call(values);
    final decoration = InputDecoration(
      labelText: f.label,
      helperText: hint ?? f.help,
      helperMaxLines: 3,
    );
    switch (f.kind) {
      case FieldKind.select:
        final current = f.options.any((o) => o.value == values[f.name])
            ? values[f.name]
            : null;
        return DropdownButtonFormField<String>(
          key: ValueKey('${f.name}:${f.options.length}'),
          initialValue: current,
          isExpanded: true,
          decoration: decoration,
          items: [
            for (final o in f.options)
              DropdownMenuItem(
                value: o.value,
                child: Text(
                  o.label,
                  overflow: TextOverflow.ellipsis,
                  maxLines: 2,
                ),
              ),
          ],
          onChanged: busy
              ? null
              : (v) => setState(() => values[f.name] = v ?? ''),
        );
      case FieldKind.date:
        final text = values[f.name] ?? '';
        return InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: busy
              ? null
              : () async {
                  final now = DateTime.now();
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: DateTime.tryParse(text) ?? now,
                    firstDate: DateTime(now.year - 1),
                    lastDate: DateTime(now.year + 20),
                  );
                  if (picked != null) {
                    setState(
                      () => values[f.name] = DateFormat(
                        'yyyy-MM-dd',
                      ).format(picked),
                    );
                  }
                },
          child: InputDecorator(
            decoration: decoration.copyWith(
              suffixIcon: text.isEmpty
                  ? const Icon(Icons.calendar_today_outlined)
                  : IconButton(
                      tooltip: 'Quitar fecha',
                      icon: const Icon(Icons.close),
                      onPressed: () => setState(() => values[f.name] = ''),
                    ),
            ),
            child: Text(text.isEmpty ? 'Sin fecha' : text),
          ),
        );
      case FieldKind.multiline:
        return TextField(
          controller: controllers[f.name],
          enabled: !busy,
          minLines: 5,
          maxLines: 10,
          decoration: decoration.copyWith(alignLabelWithHint: true),
        );
      case FieldKind.number:
      case FieldKind.money:
        return TextField(
          controller: controllers[f.name],
          enabled: !busy,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: decoration,
          onChanged: (v) => setState(() => values[f.name] = v),
        );
      case FieldKind.text:
        return TextField(
          controller: controllers[f.name],
          enabled: !busy,
          textCapitalization: TextCapitalization.sentences,
          decoration: decoration,
        );
    }
  }

  Widget buildLines() {
    final group = spec.lines!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Artículos', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        for (var i = 0; i < lines.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: LayoutBuilder(
              builder: (context, box) {
                final article = DropdownButtonFormField<String>(
                  key: ValueKey('line$i:${lines[i]['articleId']}'),
                  initialValue:
                      group.articles.any(
                        (o) => o.value == lines[i]['articleId'],
                      )
                      ? lines[i]['articleId']
                      : null,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: 'Artículo ${i + 1}'),
                  items: [
                    for (final o in group.articles)
                      DropdownMenuItem(
                        value: o.value,
                        child: Text(o.label, overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: busy
                      ? null
                      : (v) => lines[i]['articleId'] = v ?? '',
                );
                final qty = TextFormField(
                  initialValue: lines[i]['quantity'],
                  enabled: !busy,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Cantidad'),
                  onChanged: (v) => lines[i]['quantity'] = v,
                );
                final remove = lines.length > 1
                    ? IconButton(
                        tooltip: 'Quitar artículo',
                        onPressed: busy
                            ? null
                            : () => setState(() => lines.removeAt(i)),
                        icon: const Icon(Icons.delete_outline),
                      )
                    : const SizedBox.shrink();
                return box.maxWidth < 420
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          article,
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(child: qty),
                              remove,
                            ],
                          ),
                        ],
                      )
                    : Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(flex: 3, child: article),
                          const SizedBox(width: 8),
                          Expanded(flex: 2, child: qty),
                          remove,
                        ],
                      );
              },
            ),
          ),
        if (lines.length < group.max)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: busy ? null : () => setState(addLine),
              icon: const Icon(Icons.add),
              label: const Text('Agregar otro artículo'),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final offline = widget.vm.offline;
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          20,
          8,
          20,
          20 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(spec.title, style: Theme.of(context).textTheme.titleLarge),
            if (spec.note != null) ...[
              const SizedBox(height: 8),
              Text(spec.note!, style: Theme.of(context).textTheme.bodySmall),
            ],
            if (offline) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: scheme.tertiaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.cloud_off_outlined, size: 20),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Text(
                        'Sin conexión: se guardará en este dispositivo y se enviará al reconectar.',
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 16),
            for (final f in spec.fields) ...[
              buildField(f),
              const SizedBox(height: 14),
            ],
            if (spec.lines != null) buildLines(),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Semantics(
                  liveRegion: true,
                  child: Text(error!, style: TextStyle(color: scheme.error)),
                ),
              ),
            const SizedBox(height: 16),
            Wrap(
              alignment: WrapAlignment.end,
              spacing: 12,
              runSpacing: 8,
              children: [
                OutlinedButton(
                  onPressed: busy ? null : () => Navigator.of(context).pop(),
                  child: const Text('Cancelar'),
                ),
                FilledButton(
                  onPressed: busy ? null : save,
                  child: busy
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(spec.submitLabel),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

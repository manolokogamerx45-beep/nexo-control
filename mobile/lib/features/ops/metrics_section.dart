import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'charts.dart';
import 'sections.dart';
import 'snapshot.dart';
import 'ui.dart';

const _months = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

String monthLabel(String key) {
  final parts = key.split('-');
  return '${_months[int.parse(parts[1]) - 1]} ${parts[0].substring(2)}';
}

String _times(Object? v) =>
    v == null ? '—' : '${NumberFormat('#,##0.##', 'es_MX').format(v)}×';
String _compactMoney(double v) =>
    '${r'$'}${NumberFormat.compact(locale: 'en').format(v)}';

/// Historical indicators: movements, inventory value, waste and rotation.
class MetricsSection extends StatefulWidget {
  const MetricsSection(this.h, {super.key});
  final Host h;
  @override
  State<MetricsSection> createState() => _MetricsSectionState();
}

class _MetricsSectionState extends State<MetricsSection> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => widget.h.vm.loadMetrics(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final vm = widget.h.vm, m = vm.metrics;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(
          'Indicadores',
          subtitle:
              'Historial de movimientos, valor del inventario, mermas y rotación.',
        ),
        SegmentedButton<int>(
          segments: const [
            ButtonSegment(value: 3, label: Text('3 meses')),
            ButtonSegment(value: 6, label: Text('6 meses')),
            ButtonSegment(value: 12, label: Text('12 meses')),
          ],
          selected: {vm.months},
          onSelectionChanged: (v) => vm.loadMetrics(v.first),
        ),
        const SizedBox(height: 16),
        if (vm.metricsLoading && m == null)
          const Padding(
            padding: EdgeInsets.all(32),
            child: Center(
              child: CircularProgressIndicator(
                semanticsLabel: 'Calculando indicadores',
              ),
            ),
          )
        else if (m == null)
          EmptyNote(vm.metricsError ?? 'Sin datos todavía.')
        else
          _body(context, m, vm.metricsStale),
      ],
    );
  }

  Widget _body(BuildContext context, Map<String, dynamic> m, bool stale) {
    final monthly = [
      for (final e in m['monthly'] as List) Map<String, dynamic>.from(e as Map),
    ];
    final articles = [
      for (final e in m['articles'] as List)
        Map<String, dynamic>.from(e as Map),
    ];
    final totals = Map<String, dynamic>.from(m['totals'] as Map);
    final coverage = Map<String, dynamic>.from(m['costCoverage'] as Map);
    final costed = (coverage['valued'] as num) > 0;
    List<ChartPoint> pts(num Function(Map<String, dynamic>) f) => [
      for (final x in monthly)
        ChartPoint(monthLabel('${x['month']}'), f(x).toDouble()),
    ];
    num mv(Map<String, dynamic> x) => (x['movements'] as Map)['total'] as num;
    num wasteCount(Map<String, dynamic> x) =>
        (x['movements'] as Map)['waste'] as num;
    final count = NumberFormat.decimalPattern('es_MX');
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (stale)
          Card(
            color: theme.colorScheme.tertiaryContainer,
            child: const Padding(
              padding: EdgeInsets.all(12),
              child: Text(
                'Sin conexión: se muestran los indicadores descargados la última vez.',
              ),
            ),
          ),
        MetricGrid([
          MetricTile(
            'Valor del inventario',
            costed ? money(m['inventoryValue'] as num) : 'Sin costos',
            note: costed
                ? '${coverage['valued']} de ${coverage['total']} lotes con costo'
                : 'Captura el costo unitario al recibir mercancía',
          ),
          MetricTile(
            'Movimientos',
            count.format(totals['movements']),
            note: 'En el periodo',
          ),
          MetricTile(
            'Mermas',
            count.format(totals['waste']),
            note: costed
                ? 'Valor: ${money(totals['wasteValue'] as num)}'
                : 'Registros de merma',
          ),
          MetricTile(
            'Rotación',
            costed ? _times(totals['rotation']) : '—',
            note: costed ? 'Salidas ÷ inventario promedio' : 'Requiere costos',
          ),
        ]),
        if (costed && (coverage['valued'] as num) < (coverage['total'] as num))
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: EmptyNote(
              'Hay lotes sin costo unitario: su valor cuenta como \$0.',
            ),
          ),
        const SizedBox(height: 16),
        CardGrid(min: 460, [
          ColumnChart(
            title: 'Movimientos por mes',
            note: 'Registros que cambian existencias',
            points: pts(mv),
            format: (v) => count.format(v),
          ),
          if (costed)
            ColumnChart(
              title: 'Valor del inventario al cierre',
              note: 'Existencias valuadas a costo de recepción',
              points: pts((x) => x['closingValue'] as num),
              format: (v) => money(v),
              axisFormat: _compactMoney,
            ),
          ColumnChart(
            title: 'Mermas por mes',
            note: costed
                ? 'Valor a costo de las mermas'
                : 'Número de registros de merma',
            points: pts(costed ? (x) => x['wasteValue'] as num : wasteCount),
            format: costed ? (v) => money(v) : (v) => count.format(v),
            axisFormat: costed ? _compactMoney : null,
          ),
          if (costed)
            ColumnChart(
              title: 'Rotación mensual',
              note: 'Veces que se renueva el inventario en el mes',
              points: pts((x) => (x['rotation'] as num?) ?? 0),
              format: (v) => _times(v),
              axisFormat: (v) => NumberFormat('#,##0.##', 'es_MX').format(v),
            ),
        ]),
        const SizedBox(height: 8),
        Text('Detalle por mes', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        _table(
          [
            'Mes',
            'Entradas',
            'Salidas',
            'Mermas',
            'Transf.',
            'Ajustes',
            'Dev. prov.',
            if (costed) ...[
              'Valor salidas',
              'Valor mermas',
              'Valor cierre',
              'Rotación',
            ],
          ],
          [
            for (final x in monthly.reversed)
              [
                monthLabel('${x['month']}'),
                for (final k in [
                  'entries',
                  'exits',
                  'waste',
                  'transfers',
                  'adjustments',
                  'supplierReturns',
                ])
                  '${(x['movements'] as Map)[k]}',
                if (costed) ...[
                  money(x['exitValue'] as num),
                  money(x['wasteValue'] as num),
                  money(x['closingValue'] as num),
                  _times(x['rotation']),
                ],
              ],
          ],
        ),
        const SizedBox(height: 20),
        Text('Rotación por artículo', style: theme.textTheme.titleMedium),
        Text(
          'Rotación = unidades que salieron ÷ existencia promedio. Cobertura = días que alcanza la existencia actual al ritmo de salida.',
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 8),
        _table(
          [
            'Artículo',
            'Existencia',
            'Salidas',
            'Promedio',
            'Rotación',
            'Cobertura',
            'Mermas',
            if (costed) 'Valor',
          ],
          [
            for (final a in articles)
              [
                '${a['sku']} · ${a['name']}',
                '${Snapshot.qty(a['stock'] as num)} ${a['unit']}',
                '${Snapshot.qty(a['exits'] as num)} ${a['unit']}',
                '${Snapshot.qty(a['averageStock'] as num)} ${a['unit']}',
                _times(a['rotation']),
                a['coverageDays'] == null
                    ? 'Sin salidas'
                    : '${a['coverageDays']} días',
                '${Snapshot.qty(a['waste'] as num)} ${a['unit']}',
                if (costed)
                  a['valued'] == true
                      ? money(a['stockValue'] as num)
                      : 'Sin costo',
              ],
          ],
        ),
      ],
    );
  }

  Widget _table(List<String> headers, List<List<String>> rows) => Card(
    clipBehavior: Clip.antiAlias,
    child: SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        columnSpacing: 20,
        headingRowHeight: 44,
        dataRowMinHeight: 44,
        dataRowMaxHeight: 56,
        columns: [for (final h in headers) DataColumn(label: Text(h))],
        rows: [
          for (final r in rows)
            DataRow(cells: [for (final c in r) DataCell(Text(c))]),
        ],
      ),
    ),
  );
}

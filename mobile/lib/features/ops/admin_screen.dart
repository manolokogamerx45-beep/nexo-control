import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import 'ui.dart';

const roleLabels = {
  'administrador': 'Administrador',
  'compras': 'Compras',
  'almacen': 'Almacén',
  'consulta': 'Consulta',
  'solicitante': 'Solicitante',
};
const statusLabels = {
  'pending': 'Pendiente',
  'active': 'Activo',
  'disabled': 'Desactivado',
};

/// Administrator tools: who can sign in and with which profile. Needs a
/// connection, because access changes must reach the server immediately.
class AdminScreen extends StatefulWidget {
  const AdminScreen({
    super.key,
    required this.api,
    required this.currentUserId,
  });
  final ApiClient api;
  final String currentUserId;
  @override
  State<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends State<AdminScreen> {
  List<Map<String, dynamic>> users = [], approvals = [];
  bool loading = true;
  String? error;
  final email = TextEditingController();
  String role = 'consulta';

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    email.dispose();
    super.dispose();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final u = await widget.api.request('/users');
      final a = await widget.api.request('/email-approvals');
      users = [
        for (final e in u['users'] as List) Map<String, dynamic>.from(e as Map),
      ];
      approvals = [
        for (final e in a['approvals'] as List)
          Map<String, dynamic>.from(e as Map),
      ];
    } on ApiException catch (e) {
      error = e.status == 0
          ? 'Sin conexión: esta pantalla necesita internet.'
          : e.message;
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> run(Future<void> Function() task) async {
    try {
      await task();
      await load();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> changeUser(
    Map<String, dynamic> user, {
    String? newRole,
    String? newStatus,
  }) => run(
    () => widget.api.request(
      '/users/${user['id']}',
      method: 'PATCH',
      data: {
        'role': newRole ?? user['role'],
        'status': newStatus ?? user['status'],
      },
    ),
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Usuarios y accesos'),
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            onPressed: load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: loading
            ? const Center(child: CircularProgressIndicator())
            : error != null
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(error!),
                ),
              )
            : Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 900),
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Text(
                        'Aprobar un correo por adelantado',
                        style: theme.textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          SizedBox(
                            width: 300,
                            child: TextField(
                              controller: email,
                              keyboardType: TextInputType.emailAddress,
                              decoration: const InputDecoration(
                                labelText: 'Correo electrónico',
                              ),
                            ),
                          ),
                          SizedBox(
                            width: 200,
                            child: DropdownButtonFormField<String>(
                              initialValue: role,
                              isExpanded: true,
                              decoration: const InputDecoration(
                                labelText: 'Perfil',
                              ),
                              items: [
                                for (final e in roleLabels.entries)
                                  DropdownMenuItem(
                                    value: e.key,
                                    child: Text(e.value),
                                  ),
                              ],
                              onChanged: (v) => role = v ?? role,
                            ),
                          ),
                          FilledButton(
                            onPressed: () => run(() async {
                              await widget.api.request(
                                '/email-approvals',
                                method: 'POST',
                                data: {
                                  'email': email.text.trim(),
                                  'role': role,
                                },
                              );
                              email.clear();
                            }),
                            child: const Text('Aprobar correo'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      for (final a in approvals)
                        RecCard(
                          title: '${a['email']}',
                          pills: [
                            Pill(roleLabels['${a['role']}'] ?? '${a['role']}'),
                          ],
                          lines: const [
                            'Aprobado; entrará con este perfil al registrarse.',
                          ],
                          actions: [
                            OutlinedButton(
                              onPressed: () => run(
                                () => widget.api.request(
                                  '/email-approvals',
                                  method: 'DELETE',
                                  data: {'email': a['email']},
                                ),
                              ),
                              child: const Text('Revocar'),
                            ),
                          ],
                        ),
                      const SizedBox(height: 24),
                      Text('Usuarios', style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      CardGrid([
                        for (final u in users)
                          RecCard(
                            title: '${u['name']}',
                            pills: [
                              Pill(
                                statusLabels['${u['status']}'] ??
                                    '${u['status']}',
                                ok: u['status'] == 'active',
                                warn: u['status'] != 'active',
                              ),
                            ],
                            lines: [
                              '${u['email']}',
                              '${u['provider'] == 'google' ? 'Google' : 'Contraseña'}${u['id'] == widget.currentUserId ? ' · Tú' : ''}',
                            ],
                            actions: [
                              SizedBox(
                                width: 170,
                                child: DropdownButtonFormField<String>(
                                  initialValue: '${u['role']}',
                                  isExpanded: true,
                                  decoration: const InputDecoration(
                                    labelText: 'Perfil',
                                    contentPadding: EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 8,
                                    ),
                                  ),
                                  items: [
                                    for (final e in roleLabels.entries)
                                      DropdownMenuItem(
                                        value: e.key,
                                        child: Text(e.value),
                                      ),
                                  ],
                                  onChanged: (v) => v == null
                                      ? null
                                      : changeUser(u, newRole: v),
                                ),
                              ),
                              SizedBox(
                                width: 150,
                                child: DropdownButtonFormField<String>(
                                  initialValue: '${u['status']}',
                                  isExpanded: true,
                                  decoration: const InputDecoration(
                                    labelText: 'Estado',
                                    contentPadding: EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 8,
                                    ),
                                  ),
                                  items: [
                                    for (final e in statusLabels.entries)
                                      DropdownMenuItem(
                                        value: e.key,
                                        child: Text(e.value),
                                      ),
                                  ],
                                  onChanged: (v) => v == null
                                      ? null
                                      : changeUser(u, newStatus: v),
                                ),
                              ),
                            ],
                          ),
                      ]),
                    ],
                  ),
                ),
              ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

/// Aviso corto que se muestra antes de crear una cuenta.
const privacyShortNotice =
    'JIDE NOVA CORE trata tu nombre, correo, departamento y teléfono para '
    'crear tu cuenta, controlar tus permisos y operar el inventario. '
    'No los usamos con fines comerciales.';

class PrivacyNoticeLink extends StatelessWidget {
  const PrivacyNoticeLink({super.key});
  @override
  Widget build(BuildContext context) => TextButton.icon(
    onPressed: () => Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const PrivacyNoticeScreen()),
    ),
    icon: const Icon(Icons.privacy_tip_outlined, size: 18),
    label: const Text('Aviso de privacidad'),
  );
}

/// Aviso de privacidad simplificado; el integral se publica en la web.
class PrivacyNoticeScreen extends StatelessWidget {
  const PrivacyNoticeScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final heading = Theme.of(context).textTheme.titleMedium;
    Widget section(String title, String body) => Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: heading),
          const SizedBox(height: 6),
          Text(body),
        ],
      ),
    );
    return Scaffold(
      appBar: AppBar(title: const Text('Aviso de privacidad')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            section(
              'Responsable',
              'JIDE NOVA CORE (PENDIENTE: razón social y domicilio) es '
                  'responsable del tratamiento de tus datos personales.',
            ),
            section(
              'Datos que tratamos',
              'Nombre, correo, departamento, teléfono, identificador y foto '
                  'de Google si inicias sesión con Google, rol, fechas de acceso '
                  'y la bitácora de tus acciones. No tratamos datos sensibles.',
            ),
            section(
              'Para qué los usamos',
              'Crear y administrar tu cuenta, autenticarte, operar el '
                  'inventario, registrar la trazabilidad de cada movimiento y '
                  'proteger el sistema. No los usamos para mercadotecnia ni '
                  'publicidad.',
            ),
            section(
              'Dónde se guardan',
              'En Cloud Firestore de Google (Firebase), que actúa como '
                  'encargado. En este teléfono solo se guarda tu sesión, en el '
                  'almacenamiento seguro.',
            ),
            section(
              'Tus derechos',
              'Puedes corregir tus datos en Mi perfil. Para acceder, '
                  'cancelar, oponerte o revocar tu consentimiento escribe a '
                  'PENDIENTE: correo para solicitudes ARCO.',
            ),
            const Text(
              'Consulta el aviso de privacidad integral en la versión web de '
              'Nexo, en el enlace del pie de página o en /aviso-privacidad.',
              style: TextStyle(fontSize: 12, color: Color(0xFF586453)),
            ),
          ],
        ),
      ),
    );
  }
}

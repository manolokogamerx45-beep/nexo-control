import 'package:flutter/material.dart';
import 'auth_view_model.dart';

class AuthFeedback extends StatelessWidget {
  const AuthFeedback({super.key, required this.auth});
  final AuthViewModel auth;
  @override
  Widget build(BuildContext context) {
    final message = auth.error ?? auth.notice;
    if (message == null) return const SizedBox.shrink();
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text(
          message,
          style: TextStyle(
            color: auth.error != null
                ? Theme.of(context).colorScheme.error
                : Theme.of(context).colorScheme.primary,
          ),
        ),
      ),
    );
  }
}

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.auth});
  final AuthViewModel auth;
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final form = GlobalKey<FormState>();
  final name = TextEditingController(),
      email = TextEditingController(),
      password = TextEditingController();
  bool registering = false, hidden = true;
  @override
  void dispose() {
    name.dispose();
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (!form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    if (registering) {
      await widget.auth.register(name.text, email.text, password.text);
    } else {
      await widget.auth.login(email.text, password.text);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = widget.auth;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 500),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: AutofillGroup(
                child: Form(
                  key: form,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Align(
                        alignment: Alignment.centerLeft,
                        child: CircleAvatar(
                          radius: 30,
                          backgroundColor: Color(0xFF244D40),
                          child: Icon(
                            Icons.hub_outlined,
                            color: Color(0xFFD6ED95),
                            size: 32,
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),
                      Text(
                        'Nexo',
                        style: Theme.of(context).textTheme.displaySmall
                            ?.copyWith(
                              fontWeight: FontWeight.w800,
                              color: const Color(0xFF244D40),
                            ),
                      ),
                      const Text(
                        'TU OPERACIÓN, CONECTADA',
                        style: TextStyle(
                          letterSpacing: 1.6,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 32),
                      Text(
                        registering
                            ? 'Solicita tu acceso'
                            : 'Todo en su lugar.',
                        style: Theme.of(context).textTheme.headlineMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      Padding(
                        padding: const EdgeInsets.only(top: 8, bottom: 24),
                        child: Text(
                          registering
                              ? 'Un administrador revisará tu solicitud.'
                              : 'Consulta existencias y mantén tu almacén a la mano.',
                        ),
                      ),
                      OutlinedButton.icon(
                        onPressed: auth.busy ? null : auth.google,
                        icon: const Icon(Icons.account_circle_outlined),
                        label: const Text('Continuar con Google'),
                      ),
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 16),
                        child: Center(child: Text('o utiliza tu correo')),
                      ),
                      if (registering) ...[
                        TextFormField(
                          controller: name,
                          maxLength: 80,
                          textCapitalization: TextCapitalization.words,
                          autofillHints: const [AutofillHints.name],
                          decoration: const InputDecoration(
                            labelText: 'Nombre completo',
                          ),
                          validator: (v) => (v?.trim().length ?? 0) < 2
                              ? 'Escribe tu nombre.'
                              : null,
                        ),
                        const SizedBox(height: 12),
                      ],
                      TextFormField(
                        controller: email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(
                          labelText: 'Correo electrónico',
                          prefixIcon: Icon(Icons.alternate_email),
                        ),
                        validator: (v) =>
                            RegExp(
                              r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
                            ).hasMatch(v?.trim() ?? '')
                            ? null
                            : 'Escribe un correo válido.',
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: password,
                        obscureText: hidden,
                        autofillHints: [
                          registering
                              ? AutofillHints.newPassword
                              : AutofillHints.password,
                        ],
                        onFieldSubmitted: (_) {
                          if (!auth.busy) submit();
                        },
                        decoration: InputDecoration(
                          labelText: 'Contraseña',
                          helperText: registering
                              ? 'Al menos 12 caracteres.'
                              : null,
                          suffixIcon: IconButton(
                            tooltip: hidden
                                ? 'Mostrar contraseña'
                                : 'Ocultar contraseña',
                            onPressed: () => setState(() => hidden = !hidden),
                            icon: Icon(
                              hidden
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                          ),
                        ),
                        validator: (v) =>
                            (v?.length ?? 0) < (registering ? 12 : 1)
                            ? 'Revisa tu contraseña.'
                            : null,
                      ),
                      AuthFeedback(auth: auth),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: auth.busy ? null : submit,
                        child: Text(
                          auth.busy
                              ? 'Conectando…'
                              : registering
                              ? 'Solicitar acceso'
                              : 'Iniciar sesión',
                        ),
                      ),
                      TextButton(
                        onPressed: auth.busy
                            ? null
                            : () => setState(() {
                                registering = !registering;
                                form.currentState?.reset();
                              }),
                        child: Text(
                          registering
                              ? 'Ya tengo una cuenta'
                              : 'Solicitar una cuenta',
                        ),
                      ),
                      const Divider(height: 32),
                      TextButton.icon(
                        onPressed: auth.busy ? null : auth.explore,
                        icon: const Icon(Icons.explore_outlined),
                        label: const Text('Explorar demostración'),
                      ),
                      const Text(
                        'La demostración usa datos de ejemplo y no modifica tu almacén.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 12,
                          color: Color(0xFF586453),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class PendingScreen extends StatelessWidget {
  const PendingScreen({super.key, required this.auth});
  final AuthViewModel auth;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Tu cuenta')),
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Icon(
                Icons.hourglass_top_rounded,
                size: 64,
                color: Color(0xFF52751E),
              ),
              const SizedBox(height: 24),
              Text(
                'Acceso pendiente',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 12),
              Text(
                'Hola, ${auth.user!.name}. Un administrador debe activar tu cuenta para continuar.',
                textAlign: TextAlign.center,
              ),
              AuthFeedback(auth: auth),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: auth.busy ? null : auth.refresh,
                child: const Text('Comprobar acceso'),
              ),
              TextButton(
                onPressed: auth.busy ? null : auth.logout,
                child: const Text('Cerrar sesión'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

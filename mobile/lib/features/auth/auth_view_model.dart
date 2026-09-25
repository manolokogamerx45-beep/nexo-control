import 'package:flutter/foundation.dart';
import '../../core/api_client.dart';
import 'auth_repository.dart';

class AuthViewModel extends ChangeNotifier {
  AuthViewModel(this.repository);
  final AuthRepository repository;
  AppUser? user;
  bool busy = false, initializing = true, demo = false;
  String? error, notice;
  Future<void> run(Future<void> Function() task) async {
    if (busy) return;
    busy = true;
    error = null;
    notice = null;
    notifyListeners();
    try {
      await task();
    } on ApiException catch (e) {
      error = e.message;
      if (e.status == 401) user = null;
    } catch (_) {
      error = 'No se pudo completar la operación. Vuelve a intentar.';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> initialize() async {
    await run(() async {
      user = await repository.restore();
    });
    initializing = false;
    notifyListeners();
  }

  Future<void> login(String email, String password) => run(() async {
    user = await repository.login(email, password);
  });
  Future<void> google() => run(() async {
    user = await repository.google();
  });
  Future<void> register(String name, String email, String password) =>
      run(() async {
        notice = await repository.register(name, email, password);
      });
  Future<void> refresh() => run(() async {
    user = await repository.refresh();
  });
  Future<void> save(String name, String department, String phone) =>
      run(() async {
        user = await repository.updateProfile(name, department, phone);
        notice = 'Perfil actualizado.';
      });
  Future<void> logout() => run(() async {
    if (!demo) await repository.logout();
    user = null;
    demo = false;
  });
  void explore() {
    if (busy) return;
    demo = true;
    error = null;
    notice = null;
    notifyListeners();
  }

  bool get canOperate =>
      demo ||
      (user?.active == true &&
          ['administrador', 'almacen'].contains(user!.role));
}

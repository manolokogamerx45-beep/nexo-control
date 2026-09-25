# Nexo móvil

Aplicación nativa Flutter para Android, con estructura iOS preparada. Primera entrega organizada con **Mobile-D** y **MVVM por módulos**. El backend compartido sigue siendo Node.js + Firebase Cloud Firestore; Docker ejecuta la API y la web.

## Funciones de esta entrega

- Inicio de sesión por contraseña y Google en el navegador del teléfono.
- Sesión guardada en el almacenamiento seguro del sistema, aprobación pendiente, edición del perfil y cierre de sesión en la API real.
- Resumen, búsqueda por nombre/SKU/lote, filtro por almacén y nivel de existencias, detalle del artículo, lotes, compras, proveedores y mermas.
- Entradas, salidas y mermas de **prueba local**, con validación de cantidades. Administrador y Almacén ven estos controles; las cuentas de consulta solo consultan. El modo visitante permite explorar la demostración sin crear una cuenta.
- Interfaz Material 3 en español, formularios desplazables, navegación inferior en teléfonos y lateral en tabletas.

**El inventario es una demostración**, igual que en la web: no se sincroniza ni se guarda en Firestore. Los cambios se pierden al cerrar el proceso o salir de la sesión. Usuarios, roles y perfiles sí usan el servidor real. La app no contiene claves privadas de Firebase ni un administrador predefinido.

## Android local

Requisitos: Flutter 3.44.0 / Dart 3.12, Android SDK, Java 17 o compatible y un emulador o teléfono con depuración USB autorizada. En este equipo Flutter está instalado en `C:\src\flutter\bin\flutter.bat`.

Desde la raíz del repositorio inicia el backend configurado según el README principal:

```powershell
npm start
```

En otra terminal, con un único dispositivo Android conectado:

```powershell
adb reverse tcp:4173 tcp:4173
cd mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://127.0.0.1:4173
```

Si `adb` no está en PATH, en Windows suele estar en `$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe`. Para varios dispositivos utiliza `adb -s ID reverse ...` y `flutter run -d ID ...`.

La redirección USB permite que tanto la app como el navegador Android accedan al servidor del equipo usando **127.0.0.1**. `APP_ORIGIN` debe ser `http://127.0.0.1:4173`, que coincide con la URI OAuth web ya registrada. No cambies a `10.0.2.2`: el origen y el callback de Google deben coincidir. La excepción HTTP se limita a localhost y 127.0.0.1 en la compilación **debug**.

## Acceso con Google

Se reutiliza el cliente OAuth web existente. No necesitas poner `google-services.json`, la clave de servicio de Firebase ni el secreto de Google dentro de Flutter.

1. Flutter genera un verificador aleatorio PKCE y un estado de retorno.
2. Abre `/api/v1/auth/google?mobile=1&challenge=...&app_state=...` en el navegador del sistema.
3. La API valida Google, el estado ligado al navegador, nonce, correo verificado y permisos existentes.
4. Retorna a `com.jidenova.nexo://auth` con un **código de un solo uso**, válido durante 60 segundos, ligado al verificador de la app.
5. Flutter valida el estado y canjea el código en `POST /api/v1/auth/mobile/exchange`. Guarda la cookie en almacenamiento seguro y envía `Cookie` y `Origin` al mismo servidor.

Las sesiones caducan y se revocan con las reglas existentes de la API. Una cuenta nueva sigue pendiente; el modo demostración no otorga permisos de servidor. Las pruebas automatizadas simulan Google: el consentimiento real en el teléfono necesita la interacción del propietario de la cuenta.

## Compilar y verificar

```powershell
flutter analyze
flutter test
flutter build apk --debug
```

APK: `build/app/outputs/flutter-apk/app-debug.apk`. Es una compilación de desarrollo, conectada por defecto al servidor local; no es una publicación en Play Store. El flujo CI en `.github/workflows/mobile.yml` analiza, prueba y genera este APK.

Para producción hay que desplegar la API con HTTPS, registrar su callback OAuth, usar `--dart-define=API_BASE_URL=https://TU-DOMINIO`, configurar la firma de publicación y probar el acceso en teléfonos reales. La aplicación rechaza servidores remotos HTTP. Nunca distribuyas credenciales privadas dentro del APK. La compilación release no tiene configurada una firma; **debe añadirse una firma privada antes de publicar**.

## iOS

El directorio `ios/` está preparado por Flutter, pero no se compiló ni se probó desde Windows. Se necesita macOS, Xcode, firma Apple y un backend HTTPS accesible. Revisar Keychain y el flujo del navegador en un iPhone antes de publicar. No se entrega un IPA.

## Arquitectura

```text
lib/main.dart                             Tema, localización y sesión raíz
lib/core/api_client.dart                  HTTP, origen, cookies y errores
lib/features/auth/auth_repository.dart    Contrato, API y almacenamiento seguro
lib/features/auth/auth_view_model.dart    Estado y operaciones de acceso
lib/features/auth/auth_screen.dart        Acceso y aprobación pendiente
lib/features/inventory/inventory_view_model.dart  Modelo, repositorio demo y estado
lib/features/inventory/home_screen.dart   Pantallas de inventario, formularios y perfil
assets/demo_catalog.json                  Catálogo de ejemplo sin datos privados
test/                                    Pruebas de pantallas, estado y API
```

La siguiente entrega debe implementar repositorios y endpoints de inventario con autorización y transacciones en el servidor, antes de añadir sincronización offline, cámara para códigos y notificaciones.


## Verificación de esta entrega · 24 de septiembre de 2026

- `flutter analyze`: sin incidencias.
- `flutter test`: 7 pruebas aprobadas. Navegación y formularios a 320, 390 y 840 píxeles con escala de texto 1.5; cuenta pendiente, filtros, cantidades, mermas y manejo de cookies/caducidad.
- `npm test`: 16 aprobadas y 2 exclusivas del emulador omitidas.
- `npm run test:firestore`: 18 aprobadas, incluidas las pruebas nuevas del canje móvil, código expirado/reutilizado, PKCE incorrecto, concurrencia, cuenta suspendida y estado del navegador.
- APK debug generado para Android 7.0 (API 24) o superior, objetivo API 36. Identificador `com.jidenova.nexo_mobile`.
- Vistas previas renderizadas con los widgets reales de Flutter y revisadas. Se pueden regenerar con `flutter test tool/render_preview_test.dart --dart-define=PREVIEW_FONT=C:/Windows/Fonts/segoeui.ttf` en este equipo.
- Servidor local reiniciado con la ruta móvil; Firestore online responde correctamente a la comprobación de disponibilidad.
- Pendiente: instalación y prueba en el celular del usuario, consentimiento real de Google en Android e iOS en macOS. El emulador Android se cerró durante la compilación por consumo de memoria; no se declara una prueba funcional del APK en dispositivo.
